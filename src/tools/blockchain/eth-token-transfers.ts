/**
 * Tool to list ERC-20 token transfers for an address
 */

import { tool, type ToolContext } from "@opencode-ai/plugin"
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

export const ethTokenTransfersTool = tool({
  description: 
    "List ERC-20 token transfers for an Ethereum address. " +
    "Shows token names, symbols, values, and transaction details.",
  args: {
    address: tool.schema
      .string()
      .describe("Ethereum address (0x...)"),
    limit: tool.schema
      .number()
      .optional()
      .describe(`Maximum number of transfers to return (default: ${DEFAULT_TRANSACTION_LIMIT})`),
    chainId: tool.schema
      .string()
      .optional()
      .describe(CHAIN_ID_DESCRIPTION),
  },
  async execute(args: EthTokenTransfersArgs, _context: ToolContext): Promise<string> {
    try {
      return await getTokenTransfers(args.address, args.limit, args.chainId)
    } catch (error) {
      if (error instanceof EtherscanClientError) {
        return `Error: ${error.message}`
      }
      throw error
    }
  },
})
