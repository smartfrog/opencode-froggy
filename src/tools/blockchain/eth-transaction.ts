/**
 * Tool to get Ethereum transaction details by hash
 */

import { tool, type ToolContext } from "@opencode-ai/plugin"
import { EtherscanClient, EtherscanClientError } from "./etherscan-client"
import { formatTransactionReceipt } from "./formatters"
import { CHAIN_ID_DESCRIPTION } from "./types"

export interface EthTransactionArgs {
  hash: string
  chainId?: string
}

export async function getTransactionDetails(
  hash: string,
  chainId?: string
): Promise<string> {
  const client = new EtherscanClient(undefined, chainId)
  
  const receipt = await client.getTransactionReceipt(hash)
  
  if (!receipt) {
    return `Transaction not found: ${hash}`
  }

  return formatTransactionReceipt(hash, receipt)
}

export const ethTransactionTool = tool({
  description: 
    "Get Ethereum transaction details by transaction hash. " +
    "Returns status, block, addresses, gas costs, and log count.",
  args: {
    hash: tool.schema
      .string()
      .describe("Transaction hash (0x...)"),
    chainId: tool.schema
      .string()
      .optional()
      .describe(CHAIN_ID_DESCRIPTION),
  },
  async execute(args: EthTransactionArgs, _context: ToolContext): Promise<string> {
    try {
      return await getTransactionDetails(args.hash, args.chainId)
    } catch (error) {
      if (error instanceof EtherscanClientError) {
        return `Error: ${error.message}`
      }
      throw error
    }
  },
})
