import { describe, expect, it } from "bun:test"
import { capText, response, textRange } from "./bounds"

describe("bounded memory responses", () => {
  it("splits text without breaking Unicode characters", () => {
    expect(textRange("😀ABC", 0, 2)).toEqual({ text: "😀A", hasMore: true })
  })

  it("marks the end of a text", () => {
    expect(textRange("😀ABC", 2, 2)).toEqual({ text: "BC", hasMore: false })
  })

  it("caps summary previews", () => {
    expect(capText("😀ABC", 2)).toEqual({ text: "😀A…", truncated: true })
  })

  it("rejects a response exceeding its serialized budget", () => {
    expect(() => response({ content: "\u0000".repeat(4_000) })).toThrow("Response exceeds")
  })
})
