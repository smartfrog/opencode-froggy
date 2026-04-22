import { describe, it, expect } from "vitest"
import { injectPluginSkillsIntoSystem } from "./skill-injection"

const SAMPLE_ITEMS = `  <skill>\n    <name>tdd</name>\n    <description>Apply TDD</description>\n  </skill>`

describe("injectPluginSkillsIntoSystem", () => {
  it("should do nothing when pluginSkillsXmlItems is null", () => {
    const system = ["some prompt", "<available_skills>\n  <skill><name>x</name></skill>\n</available_skills>"]
    const before = [...system]

    injectPluginSkillsIntoSystem(system, null)

    expect(system).toEqual(before)
  })

  it("should inject items inside existing <available_skills> block", () => {
    const system = [
      "header text",
      "<available_skills>\n  <skill>\n    <name>x</name>\n    <description>d</description>\n  </skill>\n</available_skills>",
      "footer text",
    ]

    injectPluginSkillsIntoSystem(system, SAMPLE_ITEMS)

    expect(system[0]).toBe("header text")
    expect(system[2]).toBe("footer text")
    expect(system[1]).toContain("<name>x</name>")
    expect(system[1]).toContain("<name>tdd</name>")
    const openCount = (system[1].match(/<available_skills>/g) ?? []).length
    const closeCount = (system[1].match(/<\/available_skills>/g) ?? []).length
    expect(openCount).toBe(1)
    expect(closeCount).toBe(1)
  })

  it("should inject items before </available_skills>", () => {
    const system = [
      "<available_skills>\n  <skill>\n    <name>native</name>\n    <description>n</description>\n  </skill>\n</available_skills>",
    ]

    injectPluginSkillsIntoSystem(system, SAMPLE_ITEMS)

    const nativeIndex = system[0].indexOf("<name>native</name>")
    const tddIndex = system[0].indexOf("<name>tdd</name>")
    const closeIndex = system[0].indexOf("</available_skills>")

    expect(nativeIndex).toBeGreaterThan(-1)
    expect(tddIndex).toBeGreaterThan(nativeIndex)
    expect(closeIndex).toBeGreaterThan(tddIndex)
  })

  it("should push a standalone block when no <available_skills> exists", () => {
    const system = ["plain prompt", "another segment"]

    injectPluginSkillsIntoSystem(system, SAMPLE_ITEMS)

    expect(system).toHaveLength(3)
    expect(system[2]).toBe(`<available_skills>\n${SAMPLE_ITEMS}\n</available_skills>`)
  })

  it("should only inject into the first matching segment", () => {
    const system = [
      "<available_skills>\n  <skill>\n    <name>first</name>\n    <description>d</description>\n  </skill>\n</available_skills>",
      "<available_skills>\n  <skill>\n    <name>second</name>\n    <description>d</description>\n  </skill>\n</available_skills>",
    ]

    injectPluginSkillsIntoSystem(system, SAMPLE_ITEMS)

    expect(system[0]).toContain("<name>tdd</name>")
    expect(system[1]).not.toContain("<name>tdd</name>")
  })

  it("should do nothing when pluginSkillsXmlItems is empty string", () => {
    const system = ["<available_skills>\n</available_skills>"]
    const before = [...system]

    injectPluginSkillsIntoSystem(system, "")

    expect(system).toEqual(before)
  })
})
