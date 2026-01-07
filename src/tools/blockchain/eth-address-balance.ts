/**
 * Tool to get Ethereum address balance
 */

import { tool, type ToolContext } from "@opencode-ai/plugin"
import { EtherscanClient, EtherscanClientError, validateAddress } from "./etherscan-client"
import { formatBalance } from "./formatters"
import { CHAIN_ID_DESCRIPTION } from "./types"

export interface EthAddressBalanceArgs {
  address: string
  chainId?: string
}

export async function getAddressBalance(
  address: string,
  chainId?: string
): Promise<string> {
  validateAddress(address)
  const client = new EtherscanClient(undefined, chainId)
  
  const balanceWei = await client.getBalance(address)

  return formatBalance(address, balanceWei)
}

export const ethAddressBalanceTool = tool({
  description: 
    "Get the ETH balance of an Ethereum address. " +
    "Returns balance in both ETH and Wei.",
  args: {
    address: tool.schema
      .string()
      .describe("Ethereum address (0x...)"),
    chainId: tool.schema
      .string()
      .optional()
      .describe(CHAIN_ID_DESCRIPTION),
  },
  async execute(args: EthAddressBalanceArgs, _context: ToolContext): Promise<string> {
    try {
      return await getAddressBalance(args.address, args.chainId)
    } catch (error) {
      if (error instanceof EtherscanClientError) {
        return `Error: ${error.message}`
      }
      throw error
    }
  },
})
