/**
 * Tool to get Ethereum address balance
 */

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

export const ethAddressBalanceTool = {
  name: "eth-address-balance",
  description:
    "Get the ETH balance of an Ethereum address. " +
    "Returns balance in both ETH and Wei.",
  input: {
    type: "object",
    properties: {
      address: { type: "string", description: "Ethereum address (0x...)" },
      chainId: { type: "string", description: CHAIN_ID_DESCRIPTION },
    },
    required: ["address"],
    additionalProperties: false,
  },
  async execute(input: unknown): Promise<{ content: string }> {
    const args = input as EthAddressBalanceArgs
    try {
      return { content: await getAddressBalance(args.address, args.chainId) }
    } catch (error) {
      if (error instanceof EtherscanClientError) {
        return { content: `Error: ${error.message}` }
      }
      throw error
    }
  },
}
