const AVAILABLE_SKILLS_BLOCK_REGEX = /(<available_skills>[\s\S]*?)(<\/available_skills>)/

export function injectPluginSkillsIntoSystem(
  system: string[],
  pluginSkillsXmlItems: string | null
): void {
  if (!pluginSkillsXmlItems) return

  for (let i = 0; i < system.length; i++) {
    const segment = system[i]
    if (AVAILABLE_SKILLS_BLOCK_REGEX.test(segment)) {
      system[i] = segment.replace(
        AVAILABLE_SKILLS_BLOCK_REGEX,
        `$1${pluginSkillsXmlItems}\n$2`
      )
      return
    }
  }

  system.push(`<available_skills>\n${pluginSkillsXmlItems}\n</available_skills>`)
}
