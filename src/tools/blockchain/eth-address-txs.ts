/**
 * Tool to list Ethereum transactions for an address
 */

import { tool, type ToolContext } from "@opencode-ai/plugin"
import { EtherscanClient, EtherscanClientError, validateAddress } from "./etherscan-client"
import { formatTransactionList } from "./formatters"
import { DEFAULT_TRANSACTION_LIMIT, CHAIN_ID_DESCRIPTION } from "./types"

export interface EthAddressTxsArgs {
  address: string
  limit?: number
  chainId?: string
}

export async function getAddressTransactions(
  address: string,
  limit: number = DEFAULT_TRANSACTION_LIMIT,
  chainId?: string
): Promise<string> {
  validateAddress(address)
  const client = new EtherscanClient(undefined, chainId)
  
  const transactions = await client.getTransactions(address, limit)

  return formatTransactionList(address, transactions)
}

export const ethAddressTxsTool = tool({
  description: 
    "List Ethereum transactions for an address. " +
    "Shows incoming and outgoing transactions with values, timestamps, and status.",
  args: {
    address: tool.schema
      .string()
      .describe("Ethereum address (0x...)"),
    limit: tool.schema
      .number()
      .optional()
      .describe(`Maximum number of transactions to return (default: ${DEFAULT_TRANSACTION_LIMIT})`),
    chainId: tool.schema
      .string()
      .optional()
      .describe(CHAIN_ID_DESCRIPTION),
  },
  async execute(args: EthAddressTxsArgs, _context: ToolContext): Promise<string> {
    try {
      return await getAddressTransactions(args.address, args.limit, args.chainId)
    } catch (error) {
      if (error instanceof EtherscanClientError) {
        return `Error: ${error.message}`
      }
      throw error
    }
  },
})
