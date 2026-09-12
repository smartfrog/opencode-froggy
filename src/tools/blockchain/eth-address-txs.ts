/**
 * Tool to list Ethereum transactions for an address
 */

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

export const ethAddressTxsTool = {
  name: "eth-address-txs",
  description:
    "List Ethereum transactions for an address. " +
    "Shows incoming and outgoing transactions with values, timestamps, and status.",
  input: {
    type: "object",
    properties: {
      address: { type: "string", description: "Ethereum address (0x...)" },
      limit: {
        type: "number",
        description: `Maximum number of transactions to return (default: ${DEFAULT_TRANSACTION_LIMIT})`,
      },
      chainId: { type: "string", description: CHAIN_ID_DESCRIPTION },
    },
    required: ["address"],
    additionalProperties: false,
  },
  async execute(input: unknown): Promise<{ content: string }> {
    const args = input as EthAddressTxsArgs
    try {
      return { content: await getAddressTransactions(args.address, args.limit, args.chainId) }
    } catch (error) {
      if (error instanceof EtherscanClientError) {
        return { content: `Error: ${error.message}` }
      }
      throw error
    }
  },
}
