import { describe, it, expect } from "vitest"
import {
  decodeEvent,
  decodeEvents,
  isKnownEvent,
  getEventName,
  type AddressResolver,
} from "./event-decoder"
import { type TransactionLog, type LabeledAddress } from "./types"

const mockResolver: AddressResolver = {
  async resolve(address: string): Promise<LabeledAddress> {
    return { address, label: null }
  },
}

describe("Event Decoder", () => {
  describe("isKnownEvent", () => {
    it("should recognize Transfer event", () => {
      const topic0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
      expect(isKnownEvent(topic0)).toBe(true)
    })

    it("should recognize Approval event", () => {
      const topic0 = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925"
      expect(isKnownEvent(topic0)).toBe(true)
    })

    it("should recognize Deposit event", () => {
      const topic0 = "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c"
      expect(isKnownEvent(topic0)).toBe(true)
    })

    it("should recognize Withdrawal event", () => {
      const topic0 = "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65"
      expect(isKnownEvent(topic0)).toBe(true)
    })

    it("should return false for unknown event", () => {
      const topic0 = "0x0000000000000000000000000000000000000000000000000000000000000000"
      expect(isKnownEvent(topic0)).toBe(false)
    })
  })

  describe("getEventName", () => {
    it("should return Transfer for Transfer topic", () => {
      const topic0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
      expect(getEventName(topic0)).toBe("Transfer")
    })

    it("should return null for unknown topic", () => {
      const topic0 = "0x0000000000000000000000000000000000000000000000000000000000000000"
      expect(getEventName(topic0)).toBe(null)
    })
  })

  describe("decodeEvent", () => {
    it("should decode Transfer event", async () => {
      const log: TransactionLog = {
        address: "0x6b175474e89094c44da98b954eedeac495271d0f",
        topics: [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          "0x000000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c8",
          "0x000000000000000000000000000000002b0184b12e908bf97941f2f5385c9820",
        ],
        data: "0x000000000000000000000000000000000000000000000278fd3c000000000000",
        blockNumber: "0x1234",
        transactionHash: "0xabc",
        transactionIndex: "0x0",
        blockHash: "0xdef",
        logIndex: "0x0",
        removed: false,
      }

      const result = await decodeEvent(log, mockResolver)

      expect(result).not.toBeNull()
      expect(result!.name).toBe("Transfer")
      expect(result!.params.from).toBe("0xba12222222228d8ba445958a75a0704d566bf2c8")
      expect(result!.params.to).toBe("0x000000002b0184b12e908bf97941f2f5385c9820")
      expect(result!.params.value).toBe("11676589714374635028480")
    })

    it("should decode Approval event", async () => {
      const log: TransactionLog = {
        address: "0x6b175474e89094c44da98b954eedeac495271d0f",
        topics: [
          "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
          "0x0000000000000000000000001111111111111111111111111111111111111111",
          "0x0000000000000000000000002222222222222222222222222222222222222222",
        ],
        data: "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
        blockNumber: "0x1234",
        transactionHash: "0xabc",
        transactionIndex: "0x0",
        blockHash: "0xdef",
        logIndex: "0x0",
        removed: false,
      }

      const result = await decodeEvent(log, mockResolver)

      expect(result).not.toBeNull()
      expect(result!.name).toBe("Approval")
      expect(result!.params.owner).toBe("0x1111111111111111111111111111111111111111")
      expect(result!.params.spender).toBe("0x2222222222222222222222222222222222222222")
      expect(result!.params.value).toBe("1000000000000000000")
    })

    it("should decode Deposit event (WETH)", async () => {
      const log: TransactionLog = {
        address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
        topics: [
          "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c",
          "0x0000000000000000000000001111111111111111111111111111111111111111",
        ],
        data: "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
        blockNumber: "0x1234",
        transactionHash: "0xabc",
        transactionIndex: "0x0",
        blockHash: "0xdef",
        logIndex: "0x0",
        removed: false,
      }

      const result = await decodeEvent(log, mockResolver)

      expect(result).not.toBeNull()
      expect(result!.name).toBe("Deposit")
      expect(result!.params.dst).toBe("0x1111111111111111111111111111111111111111")
      expect(result!.params.wad).toBe("1000000000000000000")
    })

    it("should decode Withdrawal event (WETH)", async () => {
      const log: TransactionLog = {
        address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
        topics: [
          "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65",
          "0x0000000000000000000000001111111111111111111111111111111111111111",
        ],
        data: "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
        blockNumber: "0x1234",
        transactionHash: "0xabc",
        transactionIndex: "0x0",
        blockHash: "0xdef",
        logIndex: "0x0",
        removed: false,
      }

      const result = await decodeEvent(log, mockResolver)

      expect(result).not.toBeNull()
      expect(result!.name).toBe("Withdrawal")
      expect(result!.params.src).toBe("0x1111111111111111111111111111111111111111")
      expect(result!.params.wad).toBe("1000000000000000000")
    })

    it("should return null for unknown event", async () => {
      const log: TransactionLog = {
        address: "0x1234567890123456789012345678901234567890",
        topics: ["0x0000000000000000000000000000000000000000000000000000000000000000"],
        data: "0x",
        blockNumber: "0x1234",
        transactionHash: "0xabc",
        transactionIndex: "0x0",
        blockHash: "0xdef",
        logIndex: "0x0",
        removed: false,
      }

      const result = await decodeEvent(log, mockResolver)

      expect(result).toBeNull()
    })
  })

  describe("decodeEvents", () => {
    it("should decode multiple events and count undecoded", async () => {
      const logs: TransactionLog[] = [
        {
          address: "0x6b175474e89094c44da98b954eedeac495271d0f",
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            "0x0000000000000000000000001111111111111111111111111111111111111111",
            "0x0000000000000000000000002222222222222222222222222222222222222222",
          ],
          data: "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
          blockNumber: "0x1234",
          transactionHash: "0xabc",
          transactionIndex: "0x0",
          blockHash: "0xdef",
          logIndex: "0x0",
          removed: false,
        },
        {
          address: "0x1234567890123456789012345678901234567890",
          topics: ["0x0000000000000000000000000000000000000000000000000000000000000000"],
          data: "0x",
          blockNumber: "0x1234",
          transactionHash: "0xabc",
          transactionIndex: "0x0",
          blockHash: "0xdef",
          logIndex: "0x1",
          removed: false,
        },
        {
          address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
          topics: [
            "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c",
            "0x0000000000000000000000001111111111111111111111111111111111111111",
          ],
          data: "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
          blockNumber: "0x1234",
          transactionHash: "0xabc",
          transactionIndex: "0x0",
          blockHash: "0xdef",
          logIndex: "0x2",
          removed: false,
        },
      ]

      const result = await decodeEvents(logs, mockResolver)

      expect(result.decoded.length).toBe(2)
      expect(result.undecodedCount).toBe(1)
      expect(result.decoded[0].name).toBe("Transfer")
      expect(result.decoded[1].name).toBe("Deposit")
    })
  })
})
