import { describe, expect, it } from "bun:test"
import { response, textResponse } from "./bounds"

describe("bounded memory responses", () => {
  it("rejects a response exceeding its serialized budget", () => {
    expect(() => response({ content: "\u0000".repeat(4_000) })).toThrow("Response exceeds")
  })

  it("preserves large Markdown responses in full", () => {
    const content = "x".repeat(70_000)
    expect(textResponse(content).content).toBe(content)
  })
})
