/**
 * Event decoder for common ERC-20 and WETH events
 */

import { type TransactionLog, type DecodedEvent, type LabeledAddress } from "./types"

const EVENT_SIGNATURES: Record<string, string> = {
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef": "Transfer",
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925": "Approval",
  "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c": "Deposit",
  "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65": "Withdrawal",
}

function decodeAddress(topic: string): string {
  return "0x" + topic.slice(26).toLowerCase()
}

function decodeUint256(data: string): string {
  const hex = data.startsWith("0x") ? data.slice(2) : data
  if (hex === "") return "0"
  return BigInt("0x" + hex).toString()
}

export interface AddressResolver {
  resolve(address: string): Promise<LabeledAddress>
}

export async function decodeEvent(
  log: TransactionLog,
  resolver: AddressResolver
): Promise<DecodedEvent | null> {
  const topic0 = log.topics[0]
  const signature = EVENT_SIGNATURES[topic0]

  if (!signature) {
    return null
  }

  const contractAddress = await resolver.resolve(log.address)

  switch (signature) {
    case "Transfer": {
      if (log.topics.length < 3) return null
      const from = decodeAddress(log.topics[1])
      const to = decodeAddress(log.topics[2])
      const value = decodeUint256(log.data)
      return {
        name: "Transfer",
        address: contractAddress,
        params: { from, to, value },
      }
    }

    case "Approval": {
      if (log.topics.length < 3) return null
      const owner = decodeAddress(log.topics[1])
      const spender = decodeAddress(log.topics[2])
      const value = decodeUint256(log.data)
      return {
        name: "Approval",
        address: contractAddress,
        params: { owner, spender, value },
      }
    }

    case "Deposit": {
      if (log.topics.length < 2) return null
      const dst = decodeAddress(log.topics[1])
      const wad = decodeUint256(log.data)
      return {
        name: "Deposit",
        address: contractAddress,
        params: { dst, wad },
      }
    }

    case "Withdrawal": {
      if (log.topics.length < 2) return null
      const src = decodeAddress(log.topics[1])
      const wad = decodeUint256(log.data)
      return {
        name: "Withdrawal",
        address: contractAddress,
        params: { src, wad },
      }
    }

    default:
      return null
  }
}

export async function decodeEvents(
  logs: TransactionLog[],
  resolver: AddressResolver
): Promise<{ decoded: DecodedEvent[]; undecodedCount: number }> {
  const decoded: DecodedEvent[] = []
  let undecodedCount = 0

  for (const log of logs) {
    const event = await decodeEvent(log, resolver)
    if (event) {
      decoded.push(event)
    } else {
      undecodedCount++
    }
  }

  return { decoded, undecodedCount }
}

export function isKnownEvent(topic0: string): boolean {
  return topic0 in EVENT_SIGNATURES
}

export function getEventName(topic0: string): string | null {
  return EVENT_SIGNATURES[topic0] ?? null
}
