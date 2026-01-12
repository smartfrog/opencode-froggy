/**
 * Etherscan API types for Ethereum blockchain tools
 */

export interface EtherscanResponse<T> {
  status: "0" | "1"
  message: string
  result: T
}

export interface EthTransaction {
  hash: string
  blockNumber: string
  blockHash: string
  timeStamp: string
  from: string
  to: string
  value: string
  gas: string
  gasPrice: string
  gasUsed: string
  nonce: string
  transactionIndex: string
  input: string
  isError: string
  txreceipt_status: string
  contractAddress: string
  cumulativeGasUsed: string
  confirmations: string
  methodId: string
  functionName: string
}

export interface EthTokenTransfer {
  hash: string
  blockNumber: string
  timeStamp: string
  from: string
  to: string
  value: string
  contractAddress: string
  tokenName: string
  tokenSymbol: string
  tokenDecimal: string
  gas: string
  gasPrice: string
  gasUsed: string
  nonce: string
  transactionIndex: string
}

export interface EthInternalTransaction {
  hash: string
  blockNumber: string
  timeStamp: string
  from: string
  to: string
  value: string
  contractAddress: string
  input: string
  type: string
  gas: string
  gasUsed: string
  isError: string
  errCode: string
}

export interface TransactionReceipt {
  status: string
  blockHash: string
  blockNumber: string
  transactionHash: string
  transactionIndex: string
  from: string
  to: string
  contractAddress: string | null
  cumulativeGasUsed: string
  gasUsed: string
  effectiveGasPrice: string
  logs: TransactionLog[]
}

export interface TransactionLog {
  address: string
  topics: string[]
  data: string
  blockNumber: string
  transactionHash: string
  transactionIndex: string
  blockHash: string
  logIndex: string
  removed: boolean
}

export interface ContractInfo {
  SourceCode: string
  ABI: string
  ContractName: string
  CompilerVersion: string
  OptimizationUsed: string
  Runs: string
  ConstructorArguments: string
  EVMVersion: string
  Library: string
  LicenseType: string
  Proxy: string
  Implementation: string
  SwarmSource: string
}

export interface LabeledAddress {
  address: string
  label: string | null
}

export interface TokenMetadata {
  name: string
  symbol: string
  decimals: number
}

export interface DecodedEvent {
  name: string
  address: LabeledAddress
  params: Record<string, string>
}

export interface TransactionDetails {
  hash: string
  status: "success" | "failed"
  block: number
  timestamp: string | null
  from: LabeledAddress
  to: LabeledAddress | null
  value: string
  gas: {
    used: number
    price: string
    cost: string
  }
  internalTransactions?: InternalTransactionDetails[]
  tokenTransfers?: TokenTransferDetails[]
  decodedEvents?: DecodedEvent[]
  undecodedEventsCount?: number
}

export interface InternalTransactionDetails {
  from: LabeledAddress
  to: LabeledAddress
  value: string
  type: string
}

export interface TokenTransferDetails {
  token: {
    address: string
    name: string
    symbol: string
    decimals: number
  }
  from: LabeledAddress
  to: LabeledAddress
  value: string
}

export const DEFAULT_TRANSACTION_LIMIT = 20

export const DEFAULT_CHAIN_ID = "1"

export const CHAIN_ID_DESCRIPTION =
  "Chain ID (default: 1 for Ethereum). " +
  "Examples: 1=Ethereum, 137=Polygon, 56=BSC, 42161=Arbitrum, " +
  "10=Optimism, 8453=Base, 43114=Avalanche, 250=Fantom, 324=zkSync"
