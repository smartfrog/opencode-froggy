/**
 * Viem client for EVM RPC calls
 * Uses public RPCs to avoid Etherscan rate limits
 */

import {
  createPublicClient,
  http,
  parseAbi,
  type PublicClient,
  type Chain,
  type TransactionReceipt,
  type Block,
} from "viem"
import {
  mainnet,
  polygon,
  arbitrum,
  optimism,
  base,
  bsc,
  avalanche,
  fantom,
  zkSync,
  gnosis,
  celo,
  linea,
  scroll,
  mantle,
  blast,
} from "viem/chains"
import { type TokenMetadata, DEFAULT_CHAIN_ID } from "./types"

const CHAIN_MAP: Record<string, Chain> = {
  "1": mainnet,
  "137": polygon,
  "42161": arbitrum,
  "10": optimism,
  "8453": base,
  "56": bsc,
  "43114": avalanche,
  "250": fantom,
  "324": zkSync,
  "100": gnosis,
  "42220": celo,
  "59144": linea,
  "534352": scroll,
  "5000": mantle,
  "81457": blast,
}

const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
])

const clientCache: Map<string, PublicClient> = new Map()

function getClient(chainId: string): PublicClient {
  const cached = clientCache.get(chainId)
  if (cached) {
    return cached
  }

  const chain = CHAIN_MAP[chainId] ?? mainnet
  const client = createPublicClient({
    chain,
    transport: http(),
    batch: {
      multicall: true,
    },
  })

  clientCache.set(chainId, client)
  return client
}

export async function getTransactionReceipt(
  hash: string,
  chainId: string = DEFAULT_CHAIN_ID
): Promise<TransactionReceipt | null> {
  const client = getClient(chainId)

  try {
    return await client.getTransactionReceipt({
      hash: hash as `0x${string}`,
    })
  } catch {
    return null
  }
}

export async function getBlock(
  blockNumber: bigint,
  chainId: string = DEFAULT_CHAIN_ID
): Promise<Block | null> {
  const client = getClient(chainId)

  try {
    return await client.getBlock({ blockNumber })
  } catch {
    return null
  }
}

export async function getTokenMetadata(
  contractAddress: string,
  chainId: string = DEFAULT_CHAIN_ID
): Promise<TokenMetadata> {
  const client = getClient(chainId)
  const address = contractAddress as `0x${string}`

  const [name, symbol, decimals] = await Promise.all([
    client
      .readContract({
        address,
        abi: ERC20_ABI,
        functionName: "name",
      })
      .catch(() => null),
    client
      .readContract({
        address,
        abi: ERC20_ABI,
        functionName: "symbol",
      })
      .catch(() => null),
    client
      .readContract({
        address,
        abi: ERC20_ABI,
        functionName: "decimals",
      })
      .catch(() => null),
  ])

  return {
    name: name ?? "Unknown",
    symbol: symbol ?? "???",
    decimals: decimals ?? 18,
  }
}
