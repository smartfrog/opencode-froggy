/**
 * Tool to get Ethereum transaction details by hash
 */

import { tool, type ToolContext } from "@opencode-ai/plugin"
import { EtherscanClient, EtherscanClientError, validateTxHash, weiToEth } from "./etherscan-client"
import { getTransactionReceipt, getBlock, getTokenMetadata } from "./viem-client"
import {
  CHAIN_ID_DESCRIPTION,
  DEFAULT_CHAIN_ID,
  type TransactionDetails,
  type LabeledAddress,
  type InternalTransactionDetails,
  type TokenTransferDetails,
  type TransactionLog,
  type TokenMetadata,
} from "./types"
import { decodeEvents, type AddressResolver } from "./event-decoder"

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

interface RawTokenTransfer {
  contractAddress: string
  from: string
  to: string
  value: string
}

function decodeAddress(topic: string): string {
  if (!topic || topic.length < 66) return "0x0000000000000000000000000000000000000000"
  return "0x" + topic.slice(26).toLowerCase()
}

function decodeUint256(data: string): string {
  if (!data) return "0"
  const hex = data.startsWith("0x") ? data.slice(2) : data
  if (hex === "" || !/^[0-9a-fA-F]+$/.test(hex)) return "0"
  return BigInt("0x" + hex).toString()
}

function extractTransfersFromLogs(logs: TransactionLog[]): RawTokenTransfer[] {
  return logs
    .filter((log) => log.topics[0] === TRANSFER_TOPIC && log.topics.length === 3)
    .map((log) => ({
      contractAddress: log.address.toLowerCase(),
      from: decodeAddress(log.topics[1]),
      to: decodeAddress(log.topics[2]),
      value: decodeUint256(log.data),
    }))
}

interface ViemLog {
  address: string
  topics: readonly string[]
  data: string
  blockNumber?: bigint
  transactionHash?: string
  transactionIndex?: number
  blockHash?: string
  logIndex?: number
  removed?: boolean
}

function mapViemLogsToTransactionLogs(logs: ViemLog[]): TransactionLog[] {
  return logs.map((log) => ({
    address: log.address,
    topics: log.topics as string[],
    data: log.data,
    blockNumber: log.blockNumber?.toString() ?? "",
    transactionHash: log.transactionHash ?? "",
    transactionIndex: log.transactionIndex?.toString() ?? "",
    blockHash: log.blockHash ?? "",
    logIndex: log.logIndex?.toString() ?? "",
    removed: log.removed ?? false,
  }))
}

export interface EthTransactionArgs {
  hash: string
  chainId?: string
  includeInternalTxs?: boolean
  includeTokenTransfers?: boolean
  decodeLogs?: boolean
}

function formatTokenValue(value: string, decimals: number): string {
  const valueBigInt = BigInt(value)
  const divisor = BigInt(10) ** BigInt(decimals)
  const wholePart = valueBigInt / divisor
  const fractionPart = valueBigInt % divisor

  const fractionStr = fractionPart.toString().padStart(decimals, "0")
  const trimmedFraction = fractionStr.replace(/0+$/, "").slice(0, 8)

  if (trimmedFraction === "") {
    return wholePart.toString()
  }

  return `${wholePart}.${trimmedFraction}`
}

class ContractLabelResolver implements AddressResolver {
  private addressCache: Map<string, LabeledAddress> = new Map()
  private tokenCache: Map<string, TokenMetadata> = new Map()
  private chainId: string

  constructor(chainId: string) {
    this.chainId = chainId
  }

  async resolve(address: string): Promise<LabeledAddress> {
    const lowerAddress = address.toLowerCase()
    const cached = this.addressCache.get(lowerAddress)
    if (cached) {
      return cached
    }

    const result: LabeledAddress = { address, label: null }
    this.addressCache.set(lowerAddress, result)
    return result
  }

  async resolveToken(contractAddress: string): Promise<TokenMetadata> {
    const lowerAddress = contractAddress.toLowerCase()
    const cached = this.tokenCache.get(lowerAddress)
    if (cached) {
      return cached
    }

    const metadata = await getTokenMetadata(contractAddress, this.chainId)
    this.tokenCache.set(lowerAddress, metadata)
    return metadata
  }
}

export async function getTransactionDetails(
  hash: string,
  chainId?: string,
  options: {
    includeInternalTxs?: boolean
    includeTokenTransfers?: boolean
    decodeLogs?: boolean
  } = {}
): Promise<TransactionDetails> {
  validateTxHash(hash)
  const resolvedChainId = chainId ?? DEFAULT_CHAIN_ID
  const resolver = new ContractLabelResolver(resolvedChainId)

  const receipt = await getTransactionReceipt(hash, resolvedChainId)

  if (!receipt) {
    throw new EtherscanClientError(`Transaction not found: ${hash}`)
  }

  const status = receipt.status === "success" ? "success" : "failed"
  const gasUsed = Number(receipt.gasUsed)
  const effectiveGasPrice = receipt.effectiveGasPrice?.toString() ?? "0"
  const gasCostWei = (receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n)).toString()
  const blockNumber = Number(receipt.blockNumber)

  let timestamp: string | null = null
  const block = await getBlock(receipt.blockNumber, resolvedChainId)
  if (block?.timestamp) {
    timestamp = new Date(Number(block.timestamp) * 1000).toISOString()
  }

  const fromAddress = await resolver.resolve(receipt.from)
  const toAddress = receipt.to ? await resolver.resolve(receipt.to) : null

  const result: TransactionDetails = {
    hash,
    status,
    block: blockNumber,
    timestamp,
    from: fromAddress,
    to: toAddress,
    value: "0",
    gas: {
      used: gasUsed,
      price: effectiveGasPrice,
      cost: weiToEth(gasCostWei),
    },
  }

  if (options.includeInternalTxs) {
    const client = new EtherscanClient(undefined, resolvedChainId)
    const internalTxs = await client.getInternalTransactionsByHash(hash)
    const internalDetails: InternalTransactionDetails[] = []

    for (const tx of internalTxs) {
      const from = await resolver.resolve(tx.from)
      const to = await resolver.resolve(tx.to)
      internalDetails.push({
        from,
        to,
        value: weiToEth(tx.value),
        type: tx.type || "call",
      })
    }

    result.internalTransactions = internalDetails
  }

  const mappedLogs = Array.isArray(receipt.logs)
    ? mapViemLogsToTransactionLogs(receipt.logs as ViemLog[])
    : []

  if (options.includeTokenTransfers && mappedLogs.length > 0) {
    const rawTransfers = extractTransfersFromLogs(mappedLogs)
    const tokenDetails: TokenTransferDetails[] = []

    for (const transfer of rawTransfers) {
      const from = await resolver.resolve(transfer.from)
      const to = await resolver.resolve(transfer.to)
      const tokenMetadata = await resolver.resolveToken(transfer.contractAddress)

      tokenDetails.push({
        token: {
          address: transfer.contractAddress,
          name: tokenMetadata.name,
          symbol: tokenMetadata.symbol,
          decimals: tokenMetadata.decimals,
        },
        from,
        to,
        value: formatTokenValue(transfer.value, tokenMetadata.decimals),
      })
    }

    result.tokenTransfers = tokenDetails
  }

  if (options.decodeLogs && mappedLogs.length > 0) {
    const { decoded, undecodedCount } = await decodeEvents(mappedLogs, resolver)
    result.decodedEvents = decoded
    result.undecodedEventsCount = undecodedCount
  }

  return result
}

export const ethTransactionTool = tool({
  description:
    "Get Ethereum transaction details by transaction hash. " +
    "Returns status, block, addresses, gas costs in JSON format. " +
    "Use optional parameters to include internal transactions, token transfers, and decoded event logs.",
  args: {
    hash: tool.schema.string().describe("Transaction hash (0x...)"),
    chainId: tool.schema.string().optional().describe(CHAIN_ID_DESCRIPTION),
    includeInternalTxs: tool.schema
      .boolean()
      .optional()
      .describe("Include internal transactions (ETH transfers between contracts)"),
    includeTokenTransfers: tool.schema
      .boolean()
      .optional()
      .describe("Include ERC-20 token transfers"),
    decodeLogs: tool.schema
      .boolean()
      .optional()
      .describe("Decode event logs (Transfer, Approval, Deposit, Withdrawal)"),
  },
  async execute(args: EthTransactionArgs, _context: ToolContext): Promise<string> {
    try {
      const result = await getTransactionDetails(args.hash, args.chainId, {
        includeInternalTxs: args.includeInternalTxs,
        includeTokenTransfers: args.includeTokenTransfers,
        decodeLogs: args.decodeLogs,
      })
      return JSON.stringify(result, null, 2)
    } catch (error) {
      if (error instanceof EtherscanClientError) {
        return JSON.stringify({ error: error.message })
      }
      throw error
    }
  },
})
