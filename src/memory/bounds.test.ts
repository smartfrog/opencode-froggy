import { describe, expect, it } from "bun:test"
import { fieldResponse, rangeResponse } from "./bounds"

describe("bounded memory responses", () => {
  it("returns a complete escaped field through advancing ranges", () => {
    const original = "\u0000😀".repeat(8_000) + "END"
    let offset: number | null = 0
    let rebuilt = ""
    while (offset !== null) {
      const response = rangeResponse({ id: "record", revision: 1 }, original, offset)
      expect(response.content.length).toBeLessThanOrEqual(20_000)
      const page = JSON.parse(response.content)
      if (page.hasMore) expect(page.nextOffset).toBeGreaterThan(offset)
      rebuilt += page.text
      offset = page.nextOffset
    }
    expect(rebuilt).toBe(original)
  })

  it("returns every oversized reference preview through bounded pages", () => {
    const references = Array.from({ length: 70 }, (_, index) => `${index}:` + "\u0000".repeat(1_000))
    let offset: number | null = 0
    const found: string[] = []
    while (offset !== null) {
      const response = fieldResponse({ id: "record", field: "evidence", revision: 1 }, references, offset, 50)
      expect(response.content.length).toBeLessThanOrEqual(20_000)
      const page = JSON.parse(response.content)
      found.push(...page.items)
      expect(page.truncatedItems).toBe(true)
      if (page.hasMore) expect(page.nextOffset).toBeGreaterThan(offset)
      offset = page.nextOffset
    }
    expect(found.map((item) => Number(item.split(":")[0]))).toEqual(Array.from({ length: 70 }, (_, index) => index))
  })

  it("reads a long array item completely without clipping its tail", () => {
    const reference = "\u0000😀".repeat(4_000) + "TAIL"
    let offset: number | null = 0
    let rebuilt = ""
    while (offset !== null) {
      const response = fieldResponse({ id: "record", field: "sources", revision: 1 }, [reference], offset, undefined, 0)
      const page = JSON.parse(response.content)
      expect(response.content.length).toBeLessThanOrEqual(20_000)
      rebuilt += page.text
      offset = page.nextOffset
    }
    expect(rebuilt).toBe(reference)
  })
})
