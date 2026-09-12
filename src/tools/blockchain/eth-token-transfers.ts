/**
 * Tool to list ERC-20 token transfers for an address
 */

import { EtherscanClient, EtherscanClientError, validateAddress } from "./etherscan-client"
import { formatTokenTransferList } from "./formatters"
import { DEFAULT_TRANSACTION_LIMIT, CHAIN_ID_DESCRIPTION } from "./types"

export interface EthTokenTransfersArgs {
  address: string
  limit?: number
  chainId?: string
}

export async function getTokenTransfers(
  address: string,
  limit: number = DEFAULT_TRANSACTION_LIMIT,
  chainId?: string
): Promise<string> {
  validateAddress(address)
  const client = new EtherscanClient(undefined, chainId)
  
  const transfers = await client.getTokenTransfers(address, limit)

  return formatTokenTransferList(address, transfers)
}

export const ethTokenTransfersTool = {
  name: "eth-token-transfers",
  description:
    "List ERC-20 token transfers for an Ethereum address. " +
    "Shows token names, symbols, values, and transaction details.",
  input: {
    type: "object",
    properties: {
      address: { type: "string", description: "Ethereum address (0x...)" },
      limit: {
        type: "number",
        description: `Maximum number of transfers to return (default: ${DEFAULT_TRANSACTION_LIMIT})`,
      },
      chainId: { type: "string", description: CHAIN_ID_DESCRIPTION },
    },
    required: ["address"],
    additionalProperties: false,
  },
  async execute(input: unknown): Promise<{ content: string }> {
    const args = input as EthTokenTransfersArgs
    try {
      return { content: await getTokenTransfers(args.address, args.limit, args.chainId) }
    } catch (error) {
      if (error instanceof EtherscanClientError) {
        return { content: `Error: ${error.message}` }
      }
      throw error
    }
  },
}
