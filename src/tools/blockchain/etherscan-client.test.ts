import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EtherscanClient, EtherscanClientError, weiToEth, formatTimestamp, shortenAddress } from "./etherscan-client"

describe("EtherscanClient", () => {
  const originalEnv = process.env.ETHERSCAN_API_KEY
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal("fetch", mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalEnv) {
      process.env.ETHERSCAN_API_KEY = originalEnv
    } else {
      delete process.env.ETHERSCAN_API_KEY
    }
  })

  describe("constructor", () => {
    it("should throw error when API key is missing", () => {
      delete process.env.ETHERSCAN_API_KEY

      expect(() => new EtherscanClient()).toThrow(EtherscanClientError)
      expect(() => new EtherscanClient()).toThrow("ETHERSCAN_API_KEY environment variable is required")
    })

    it("should create client with API key from environment", () => {
      process.env.ETHERSCAN_API_KEY = "test-api-key"

      const client = new EtherscanClient()
      expect(client).toBeInstanceOf(EtherscanClient)
    })

    it("should create client with provided API key", () => {
      delete process.env.ETHERSCAN_API_KEY

      const client = new EtherscanClient("provided-api-key")
      expect(client).toBeInstanceOf(EtherscanClient)
    })

    it("should create client with custom chainId", () => {
      process.env.ETHERSCAN_API_KEY = "test-api-key"

      const client = new EtherscanClient(undefined, "137")
      expect(client).toBeInstanceOf(EtherscanClient)
    })
  })

  describe("getBalance", () => {
    it("should return balance for valid address", async () => {
      process.env.ETHERSCAN_API_KEY = "test-api-key"

      const mockResponse = {
        status: "1",
        message: "OK",
        result: "1000000000000000000",
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const client = new EtherscanClient()
      const balance = await client.getBalance("0x1234567890123456789012345678901234567890")

      expect(balance).toBe("1000000000000000000")
      expect(mockFetch).toHaveBeenCalledTimes(1)
      
      const callUrl = mockFetch.mock.calls[0][0] as string
      expect(callUrl).toContain("module=account")
      expect(callUrl).toContain("action=balance")
      expect(callUrl).toContain("chainid=1")
      expect(callUrl).toContain("/v2/api")
    })

    it("should use custom chainId in requests", async () => {
      process.env.ETHERSCAN_API_KEY = "test-api-key"

      const mockResponse = {
        status: "1",
        message: "OK",
        result: "500000000000000000",
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const client = new EtherscanClient(undefined, "137")
      await client.getBalance("0x1234567890123456789012345678901234567890")

      const callUrl = mockFetch.mock.calls[0][0] as string
      expect(callUrl).toContain("chainid=137")
    })

    it("should throw error on API failure", async () => {
      process.env.ETHERSCAN_API_KEY = "test-api-key"

      const mockResponse = {
        status: "0",
        message: "NOTOK",
        result: "Invalid address format",
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const client = new EtherscanClient()

      await expect(
        client.getBalance("invalid-address")
      ).rejects.toThrow(EtherscanClientError)
    })

    it("should throw error on HTTP failure", async () => {
      process.env.ETHERSCAN_API_KEY = "test-api-key"

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as Response)

      const client = new EtherscanClient()

      await expect(
        client.getBalance("0x1234567890123456789012345678901234567890")
      ).rejects.toThrow("Etherscan API HTTP error: 500 Internal Server Error")
    })
  })

  describe("getTransactions", () => {
    it("should return transactions for valid address", async () => {
      process.env.ETHERSCAN_API_KEY = "test-api-key"

      const mockTransactions = [
        {
          hash: "0xabc123",
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          value: "1000000000000000000",
          timeStamp: "1640000000",
          isError: "0",
        },
      ]

      const mockResponse = {
        status: "1",
        message: "OK",
        result: mockTransactions,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const client = new EtherscanClient()
      const transactions = await client.getTransactions(
        "0x1234567890123456789012345678901234567890",
        10
      )

      expect(transactions).toHaveLength(1)
      expect(transactions[0].hash).toBe("0xabc123")
    })

    it("should return empty array when no transactions found", async () => {
      process.env.ETHERSCAN_API_KEY = "test-api-key"

      const mockResponse = {
        status: "0",
        message: "No transactions found",
        result: "No transactions found",
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const client = new EtherscanClient()
      const transactions = await client.getTransactions(
        "0x1234567890123456789012345678901234567890"
      )

      expect(transactions).toEqual([])
    })
  })

  describe("getTokenTransfers", () => {
    it("should return token transfers for valid address", async () => {
      process.env.ETHERSCAN_API_KEY = "test-api-key"

      const mockTransfers = [
        {
          hash: "0xdef456",
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          value: "1000000000000000000",
          tokenName: "Test Token",
          tokenSymbol: "TST",
          tokenDecimal: "18",
          contractAddress: "0x3333333333333333333333333333333333333333",
        },
      ]

      const mockResponse = {
        status: "1",
        message: "OK",
        result: mockTransfers,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const client = new EtherscanClient()
      const transfers = await client.getTokenTransfers(
        "0x1234567890123456789012345678901234567890"
      )

      expect(transfers).toHaveLength(1)
      expect(transfers[0].tokenSymbol).toBe("TST")
    })
  })
})

describe("weiToEth", () => {
  it("should convert 1 ETH correctly", () => {
    expect(weiToEth("1000000000000000000")).toBe("1")
  })

  it("should convert 0.5 ETH correctly", () => {
    expect(weiToEth("500000000000000000")).toBe("0.5")
  })

  it("should convert 0 ETH correctly", () => {
    expect(weiToEth("0")).toBe("0")
  })

  it("should handle large values", () => {
    expect(weiToEth("123456789000000000000000000")).toBe("123456789")
  })

  it("should handle small fractional values", () => {
    const result = weiToEth("1234567890123456789")
    expect(result).toBe("1.234567890123456789")
  })
})

describe("formatTimestamp", () => {
  it("should format Unix timestamp to ISO string", () => {
    const result = formatTimestamp("1640000000")
    expect(result).toBe("2021-12-20T11:33:20.000Z")
  })
})

describe("shortenAddress", () => {
  it("should shorten long address", () => {
    const address = "0x1234567890123456789012345678901234567890"
    expect(shortenAddress(address)).toBe("0x1234...7890")
  })

  it("should return short address unchanged", () => {
    const address = "0x12345"
    expect(shortenAddress(address)).toBe("0x12345")
  })
})
