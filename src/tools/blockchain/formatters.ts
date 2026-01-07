/**
 * Formatting utilities for blockchain data
 */

import { weiToEth, formatTimestamp, shortenAddress } from "./etherscan-client"
import { type EthTransaction, type EthTokenTransfer } from "./types"

export function formatTransactionReceipt(
  hash: string,
  receipt: Record<string, unknown>
): string {
  const status = receipt.status === "0x1" ? "Success" : "Failed"
  const gasUsed = receipt.gasUsed ? parseInt(String(receipt.gasUsed), 16).toString() : "N/A"
  const effectiveGasPrice = receipt.effectiveGasPrice 
    ? parseInt(String(receipt.effectiveGasPrice), 16).toString() 
    : "N/A"
  
  const gasCostWei = receipt.gasUsed && receipt.effectiveGasPrice
    ? (BigInt(String(receipt.gasUsed)) * BigInt(String(receipt.effectiveGasPrice))).toString()
    : "0"

  const lines = [
    `## Transaction Details`,
    ``,
    `**Hash:** ${hash}`,
    `**Status:** ${status}`,
    `**Block:** ${receipt.blockNumber ? parseInt(String(receipt.blockNumber), 16) : "Pending"}`,
    ``,
    `### Addresses`,
    `**From:** ${receipt.from}`,
    `**To:** ${receipt.to ?? "Contract Creation"}`,
    receipt.contractAddress ? `**Contract Created:** ${receipt.contractAddress}` : null,
    ``,
    `### Gas`,
    `**Gas Used:** ${gasUsed}`,
    `**Effective Gas Price:** ${effectiveGasPrice} wei`,
    `**Transaction Cost:** ${weiToEth(gasCostWei)} ETH`,
    ``,
    `### Logs`,
    `**Log Count:** ${Array.isArray(receipt.logs) ? receipt.logs.length : 0}`,
  ].filter(Boolean)

  return lines.join("\n")
}

export function formatTransaction(tx: EthTransaction, address: string): string {
  const isOutgoing = tx.from.toLowerCase() === address.toLowerCase()
  const direction = isOutgoing ? "OUT" : "IN"
  const counterparty = isOutgoing ? (tx.to ?? "Contract Creation") : tx.from
  const status = tx.isError === "0" ? "OK" : "FAIL"
  const value = weiToEth(tx.value)
  const date = formatTimestamp(tx.timeStamp)

  return [
    `[${direction}] ${date}`,
    `  Hash: ${tx.hash}`,
    `  ${isOutgoing ? "To" : "From"}: ${counterparty}`,
    `  Value: ${value} ETH`,
    `  Status: ${status}`,
    tx.functionName ? `  Function: ${tx.functionName}` : null,
  ].filter(Boolean).join("\n")
}

export function formatTransactionList(
  address: string,
  transactions: EthTransaction[]
): string {
  if (transactions.length === 0) {
    return `No transactions found for address: ${address}`
  }

  const addressLower = address.toLowerCase()
  const inCount = transactions.filter(tx => tx.to?.toLowerCase() === addressLower).length
  const outCount = transactions.length - inCount

  const lines = [
    `## Transactions for ${shortenAddress(address)}`,
    ``,
    `**Total:** ${transactions.length} (${inCount} incoming, ${outCount} outgoing)`,
    `**Address:** ${address}`,
    ``,
    `### Recent Transactions`,
    ``,
    ...transactions.map(tx => formatTransaction(tx, address)),
  ]

  return lines.join("\n")
}

export function formatBalance(address: string, balanceWei: string): string {
  const balanceEth = weiToEth(balanceWei)

  const lines = [
    `## Balance for ${address}`,
    ``,
    `**ETH:** ${balanceEth}`,
    `**Wei:** ${balanceWei}`,
  ]

  return lines.join("\n")
}

function formatTokenValue(value: string, decimals: string): string {
  const dec = parseInt(decimals, 10) || 18
  const valueBigInt = BigInt(value)
  const divisor = BigInt(10 ** dec)
  const wholePart = valueBigInt / divisor
  const fractionPart = valueBigInt % divisor
  
  const fractionStr = fractionPart.toString().padStart(dec, "0")
  const trimmedFraction = fractionStr.replace(/0+$/, "").slice(0, 6)
  
  if (trimmedFraction === "") {
    return wholePart.toString()
  }
  
  return `${wholePart}.${trimmedFraction}`
}

export function formatTokenTransfer(transfer: EthTokenTransfer, address: string): string {
  const isOutgoing = transfer.from.toLowerCase() === address.toLowerCase()
  const direction = isOutgoing ? "OUT" : "IN"
  const counterparty = isOutgoing ? (transfer.to ?? "Unknown") : transfer.from
  const value = formatTokenValue(transfer.value, transfer.tokenDecimal)
  const date = formatTimestamp(transfer.timeStamp)

  return [
    `[${direction}] ${date}`,
    `  Token: ${transfer.tokenName} (${transfer.tokenSymbol})`,
    `  Hash: ${transfer.hash}`,
    `  ${isOutgoing ? "To" : "From"}: ${counterparty}`,
    `  Value: ${value} ${transfer.tokenSymbol}`,
    `  Contract: ${transfer.contractAddress}`,
  ].join("\n")
}

export function formatTokenTransferList(
  address: string,
  transfers: EthTokenTransfer[]
): string {
  if (transfers.length === 0) {
    return `No ERC-20 token transfers found for address: ${address}`
  }

  const tokenSummary = new Map<string, { in: number; out: number; symbol: string }>()
  let inCount = 0
  let outCount = 0
  
  const addressLower = address.toLowerCase()
  
  for (const transfer of transfers) {
    const isOutgoing = transfer.from.toLowerCase() === addressLower
    
    if (!tokenSummary.has(transfer.contractAddress)) {
      tokenSummary.set(transfer.contractAddress, { in: 0, out: 0, symbol: transfer.tokenSymbol })
    }
    const stats = tokenSummary.get(transfer.contractAddress)!
    
    if (isOutgoing) {
      stats.out++
      outCount++
    } else {
      stats.in++
      inCount++
    }
  }

  const lines = [
    `## ERC-20 Token Transfers for ${shortenAddress(address)}`,
    ``,
    `**Total:** ${transfers.length} transfers (${inCount} incoming, ${outCount} outgoing)`,
    `**Address:** ${address}`,
    `**Unique Tokens:** ${tokenSummary.size}`,
    ``,
    `### Token Summary`,
    ...Array.from(tokenSummary.entries()).map(([contract, stats]) => 
      `- ${stats.symbol}: ${stats.in} in, ${stats.out} out (${shortenAddress(contract)})`
    ),
    ``,
    `### Recent Transfers`,
    ``,
    ...transfers.map(t => formatTokenTransfer(t, address)),
  ]

  return lines.join("\n")
}
