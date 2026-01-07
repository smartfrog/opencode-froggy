/**
 * Etherscan API client for Ethereum blockchain queries
 */

import {
  type EtherscanResponse,
  type EthTransaction,
  type EthTokenTransfer,
  type EthInternalTransaction,
  DEFAULT_TRANSACTION_LIMIT,
  DEFAULT_CHAIN_ID,
} from "./types"

const ETHERSCAN_BASE_URL = "https://api.etherscan.io/v2/api"

export class EtherscanClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EtherscanClientError"
  }
}

export class EtherscanClient {
  private readonly apiKey: string
  private readonly chainId: string
  private readonly baseUrl: string

  constructor(apiKey?: string, chainId?: string, baseUrl?: string) {
    const key = apiKey ?? process.env.ETHERSCAN_API_KEY
    if (!key) {
      throw new EtherscanClientError(
        "ETHERSCAN_API_KEY environment variable is required. " +
        "Get a free API key at https://etherscan.io/apis"
      )
    }
    this.apiKey = key
    this.chainId = chainId ?? DEFAULT_CHAIN_ID
    this.baseUrl = baseUrl ?? ETHERSCAN_BASE_URL
  }

  private async request<T>(params: Record<string, string>): Promise<T> {
    const url = new URL(this.baseUrl)
    url.searchParams.set("apikey", this.apiKey)
    url.searchParams.set("chainid", this.chainId)
    
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }

    const response = await fetch(url.toString())

    if (!response.ok) {
      throw new EtherscanClientError(
        `Etherscan API HTTP error: ${response.status} ${response.statusText}`
      )
    }

    const data = await response.json() as EtherscanResponse<T>

    if (data.status === "0" && data.message !== "No transactions found") {
      throw new EtherscanClientError(`Etherscan API error: ${data.message} - ${data.result}`)
    }

    return data.result
  }

  async getBalance(address: string): Promise<string> {
    return this.request<string>({
      module: "account",
      action: "balance",
      address,
      tag: "latest",
    })
  }

  async getTransactions(
    address: string,
    limit: number = DEFAULT_TRANSACTION_LIMIT
  ): Promise<EthTransaction[]> {
    const result = await this.request<EthTransaction[] | string>({
      module: "account",
      action: "txlist",
      address,
      startblock: "0",
      endblock: "99999999",
      page: "1",
      offset: String(limit),
      sort: "desc",
    })

    if (typeof result === "string") {
      return []
    }

    return result
  }

  async getInternalTransactions(
    address: string,
    limit: number = DEFAULT_TRANSACTION_LIMIT
  ): Promise<EthInternalTransaction[]> {
    const result = await this.request<EthInternalTransaction[] | string>({
      module: "account",
      action: "txlistinternal",
      address,
      startblock: "0",
      endblock: "99999999",
      page: "1",
      offset: String(limit),
      sort: "desc",
    })

    if (typeof result === "string") {
      return []
    }

    return result
  }

  async getTokenTransfers(
    address: string,
    limit: number = DEFAULT_TRANSACTION_LIMIT
  ): Promise<EthTokenTransfer[]> {
    const result = await this.request<EthTokenTransfer[] | string>({
      module: "account",
      action: "tokentx",
      address,
      startblock: "0",
      endblock: "99999999",
      page: "1",
      offset: String(limit),
      sort: "desc",
    })

    if (typeof result === "string") {
      return []
    }

    return result
  }

  async getTransactionByHash(hash: string): Promise<EthTransaction | null> {
    const result = await this.request<EthTransaction[] | string>({
      module: "account",
      action: "txlistinternal",
      txhash: hash,
    })

    if (typeof result === "string" || result.length === 0) {
      const txList = await this.request<EthTransaction[] | string>({
        module: "proxy",
        action: "eth_getTransactionByHash",
        txhash: hash,
      })
      
      if (!txList || typeof txList === "string") {
        return null
      }

      return txList as unknown as EthTransaction
    }

    return result[0]
  }

  async getTransactionReceipt(hash: string): Promise<Record<string, unknown> | null> {
    const result = await this.request<Record<string, unknown> | null>({
      module: "proxy",
      action: "eth_getTransactionReceipt",
      txhash: hash,
    })

    return result
  }
}

export function weiToEth(wei: string): string {
  const weiBigInt = BigInt(wei)
  const ethWhole = weiBigInt / BigInt(10 ** 18)
  const ethFraction = weiBigInt % BigInt(10 ** 18)
  
  const fractionStr = ethFraction.toString().padStart(18, "0")
  const trimmedFraction = fractionStr.replace(/0+$/, "")
  
  if (trimmedFraction === "") {
    return ethWhole.toString()
  }
  
  return `${ethWhole}.${trimmedFraction}`
}

export function formatTimestamp(timestamp: string): string {
  const date = new Date(parseInt(timestamp, 10) * 1000)
  return date.toISOString()
}

export function shortenAddress(address: string): string {
  if (address.length < 12) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}
