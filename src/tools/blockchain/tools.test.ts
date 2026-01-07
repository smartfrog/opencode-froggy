import { describe, it, expect } from "vitest"
import {
  formatTransactionReceipt,
  formatTransactionList,
  formatBalance,
  formatTokenTransferList,
} from "./formatters"
import { type EthTransaction, type EthTokenTransfer } from "./types"

describe("Blockchain Formatters", () => {
  describe("formatTransactionReceipt", () => {
    it("should format successful transaction receipt", () => {
      const receipt = {
        status: "0x1",
        blockNumber: "0xf4240",
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        gasUsed: "0x5208",
        effectiveGasPrice: "0x3b9aca00",
        logs: [],
      }

      const result = formatTransactionReceipt("0xabc123", receipt)

      expect(result).toContain("## Transaction Details")
      expect(result).toContain("**Hash:** 0xabc123")
      expect(result).toContain("**Status:** Success")
      expect(result).toContain("**Block:** 1000000")
      expect(result).toContain("**From:** 0x1111111111111111111111111111111111111111")
      expect(result).toContain("**To:** 0x2222222222222222222222222222222222222222")
      expect(result).toContain("**Gas Used:** 21000")
      expect(result).toContain("**Log Count:** 0")
    })

    it("should format failed transaction receipt", () => {
      const receipt = {
        status: "0x0",
        blockNumber: "0xf4240",
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        gasUsed: "0x5208",
        effectiveGasPrice: "0x3b9aca00",
        logs: [],
      }

      const result = formatTransactionReceipt("0xabc123", receipt)

      expect(result).toContain("**Status:** Failed")
    })

    it("should handle contract creation", () => {
      const receipt = {
        status: "0x1",
        blockNumber: "0xf4240",
        from: "0x1111111111111111111111111111111111111111",
        to: null,
        contractAddress: "0x3333333333333333333333333333333333333333",
        gasUsed: "0x5208",
        effectiveGasPrice: "0x3b9aca00",
        logs: [],
      }

      const result = formatTransactionReceipt("0xabc123", receipt)

      expect(result).toContain("**To:** Contract Creation")
      expect(result).toContain("**Contract Created:** 0x3333333333333333333333333333333333333333")
    })
  })

  describe("formatTransactionList", () => {
    it("should format transaction list with in and out", () => {
      const address = "0x1234567890123456789012345678901234567890"
      const transactions: EthTransaction[] = [
        {
          hash: "0xabc123",
          blockNumber: "1000000",
          blockHash: "0x...",
          timeStamp: "1640000000",
          from: address,
          to: "0x2222222222222222222222222222222222222222",
          value: "1000000000000000000",
          gas: "21000",
          gasPrice: "1000000000",
          gasUsed: "21000",
          nonce: "1",
          transactionIndex: "0",
          input: "0x",
          isError: "0",
          txreceipt_status: "1",
          contractAddress: "",
          cumulativeGasUsed: "21000",
          confirmations: "100",
          methodId: "0x",
          functionName: "transfer(address,uint256)",
        },
        {
          hash: "0xdef456",
          blockNumber: "999999",
          blockHash: "0x...",
          timeStamp: "1639999000",
          from: "0x3333333333333333333333333333333333333333",
          to: address,
          value: "500000000000000000",
          gas: "21000",
          gasPrice: "1000000000",
          gasUsed: "21000",
          nonce: "1",
          transactionIndex: "0",
          input: "0x",
          isError: "0",
          txreceipt_status: "1",
          contractAddress: "",
          cumulativeGasUsed: "21000",
          confirmations: "100",
          methodId: "0x",
          functionName: "",
        },
      ]

      const result = formatTransactionList(address, transactions)

      expect(result).toContain("## Transactions for 0x1234...7890")
      expect(result).toContain("**Total:** 2 (1 incoming, 1 outgoing)")
      expect(result).toContain("[OUT]")
      expect(result).toContain("[IN]")
      expect(result).toContain("Value: 1 ETH")
      expect(result).toContain("Value: 0.5 ETH")
      expect(result).toContain("Function: transfer(address,uint256)")
    })

    it("should return no transactions message for empty list", () => {
      const result = formatTransactionList(
        "0x1234567890123456789012345678901234567890",
        []
      )

      expect(result).toContain("No transactions found")
    })
  })

  describe("formatBalance", () => {
    it("should format balance in ETH and Wei", () => {
      const result = formatBalance(
        "0x1234567890123456789012345678901234567890",
        "1500000000000000000"
      )

      expect(result).toContain("## Balance for 0x1234567890123456789012345678901234567890")
      expect(result).toContain("**ETH:** 1.5")
      expect(result).toContain("**Wei:** 1500000000000000000")
    })

    it("should handle zero balance", () => {
      const result = formatBalance(
        "0x1234567890123456789012345678901234567890",
        "0"
      )

      expect(result).toContain("**ETH:** 0")
      expect(result).toContain("**Wei:** 0")
    })
  })

  describe("formatTokenTransferList", () => {
    it("should format token transfer list", () => {
      const address = "0x1234567890123456789012345678901234567890"
      const transfers: EthTokenTransfer[] = [
        {
          hash: "0xtoken123",
          blockNumber: "1000000",
          timeStamp: "1640000000",
          from: address,
          to: "0x2222222222222222222222222222222222222222",
          value: "1000000000000000000",
          contractAddress: "0x4444444444444444444444444444444444444444",
          tokenName: "Test Token",
          tokenSymbol: "TST",
          tokenDecimal: "18",
          gas: "60000",
          gasPrice: "1000000000",
          gasUsed: "55000",
          nonce: "1",
          transactionIndex: "0",
        },
      ]

      const result = formatTokenTransferList(address, transfers)

      expect(result).toContain("## ERC-20 Token Transfers for 0x1234...7890")
      expect(result).toContain("**Total:** 1 transfers")
      expect(result).toContain("**Unique Tokens:** 1")
      expect(result).toContain("Token: Test Token (TST)")
      expect(result).toContain("[OUT]")
      expect(result).toContain("Value: 1 TST")
    })

    it("should return no transfers message for empty list", () => {
      const result = formatTokenTransferList(
        "0x1234567890123456789012345678901234567890",
        []
      )

      expect(result).toContain("No ERC-20 token transfers found")
    })

    it("should show token summary with multiple tokens", () => {
      const address = "0x1234567890123456789012345678901234567890"
      const transfers: EthTokenTransfer[] = [
        {
          hash: "0xtoken1",
          blockNumber: "1000000",
          timeStamp: "1640000000",
          from: address,
          to: "0x2222222222222222222222222222222222222222",
          value: "1000000000000000000",
          contractAddress: "0x4444444444444444444444444444444444444444",
          tokenName: "Token A",
          tokenSymbol: "TKA",
          tokenDecimal: "18",
          gas: "60000",
          gasPrice: "1000000000",
          gasUsed: "55000",
          nonce: "1",
          transactionIndex: "0",
        },
        {
          hash: "0xtoken2",
          blockNumber: "1000001",
          timeStamp: "1640001000",
          from: "0x3333333333333333333333333333333333333333",
          to: address,
          value: "2000000000000000000",
          contractAddress: "0x5555555555555555555555555555555555555555",
          tokenName: "Token B",
          tokenSymbol: "TKB",
          tokenDecimal: "18",
          gas: "60000",
          gasPrice: "1000000000",
          gasUsed: "55000",
          nonce: "1",
          transactionIndex: "0",
        },
      ]

      const result = formatTokenTransferList(address, transfers)

      expect(result).toContain("**Unique Tokens:** 2")
      expect(result).toContain("TKA: 0 in, 1 out")
      expect(result).toContain("TKB: 1 in, 0 out")
    })
  })
})
