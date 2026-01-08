/**
 * Tool to get Ethereum transaction details by hash
 */

import { tool, type ToolContext } from "@opencode-ai/plugin"
import { EtherscanClient, EtherscanClientError, validateTxHash, weiToEth } from "./etherscan-client"
import {
  CHAIN_ID_DESCRIPTION,
  type TransactionDetails,
  type LabeledAddress,
  type InternalTransactionDetails,
  type TokenTransferDetails,
  type TransactionLog,
} from "./types"
import { decodeEvents, type AddressResolver } from "./event-decoder"

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
  private client: EtherscanClient
  private cache: Map<string, LabeledAddress> = new Map()

  constructor(client: EtherscanClient) {
    this.client = client
  }

  async resolve(address: string): Promise<LabeledAddress> {
    const lowerAddress = address.toLowerCase()
    const cached = this.cache.get(lowerAddress)
    if (cached) {
      return cached
    }

    const info = await this.client.getContractInfo(address).catch(() => null)
    const result: LabeledAddress = { address, label: info?.ContractName ?? null }
    this.cache.set(lowerAddress, result)
    return result
  }

  addFromTokenTransfer(address: string, tokenName: string): void {
    const lowerAddress = address.toLowerCase()
    if (!this.cache.has(lowerAddress)) {
      this.cache.set(lowerAddress, { address, label: tokenName })
    }
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
  const client = new EtherscanClient(undefined, chainId)
  const resolver = new ContractLabelResolver(client)

  const receipt = await client.getTransactionReceipt(hash)

  if (!receipt) {
    throw new EtherscanClientError(`Transaction not found: ${hash}`)
  }

  const status = receipt.status === "0x1" ? "success" : "failed"
  const gasUsed = receipt.gasUsed ? parseInt(String(receipt.gasUsed), 16) : 0
  const effectiveGasPrice = receipt.effectiveGasPrice
    ? parseInt(String(receipt.effectiveGasPrice), 16).toString()
    : "0"
  const gasCostWei =
    receipt.gasUsed && receipt.effectiveGasPrice
      ? (BigInt(String(receipt.gasUsed)) * BigInt(String(receipt.effectiveGasPrice))).toString()
      : "0"
  const block = receipt.blockNumber ? parseInt(String(receipt.blockNumber), 16) : 0

  const fromAddress = await resolver.resolve(String(receipt.from))
  const toAddress = receipt.to ? await resolver.resolve(String(receipt.to)) : null

  const result: TransactionDetails = {
    hash,
    status,
    block,
    timestamp: null,
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

  if (options.includeTokenTransfers) {
    const tokenTxs = await client.getTokenTransfersByHash(hash)
    const tokenDetails: TokenTransferDetails[] = []

    for (const tx of tokenTxs) {
      resolver.addFromTokenTransfer(tx.contractAddress, tx.tokenName)

      const from = await resolver.resolve(tx.from)
      const to = await resolver.resolve(tx.to)
      const decimals = parseInt(tx.tokenDecimal, 10) || 18

      tokenDetails.push({
        token: {
          address: tx.contractAddress,
          name: tx.tokenName,
          symbol: tx.tokenSymbol,
          decimals,
        },
        from,
        to,
        value: formatTokenValue(tx.value, decimals),
      })
    }

    result.tokenTransfers = tokenDetails
  }

  if (options.decodeLogs && Array.isArray(receipt.logs)) {
    const { decoded, undecodedCount } = await decodeEvents(receipt.logs as TransactionLog[], resolver)
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
