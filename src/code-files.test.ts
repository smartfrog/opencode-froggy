import { describe, expect, it } from "vitest"
import { CODE_EXTENSIONS, hasCodeExtension } from "./code-files"

describe("hasCodeExtension", () => {
  it("should return false for non-code extensions", () => {
    expect(hasCodeExtension("/tmp/README.md")).toBe(false)
  })

  it("should return true for code extensions", () => {
    expect(hasCodeExtension("/tmp/main.ts")).toBe(true)
  })

  it("should handle uppercase extensions", () => {
    expect(hasCodeExtension("/tmp/MAIN.JS")).toBe(true)
  })

  it("should return false when no extension exists", () => {
    expect(hasCodeExtension("/tmp/Makefile")).toBe(false)
  })
})

describe("CODE_EXTENSIONS", () => {
  it("should include go and rust extensions", () => {
    expect(CODE_EXTENSIONS.has(".go")).toBe(true)
    expect(CODE_EXTENSIONS.has(".rs")).toBe(true)
  })
})
