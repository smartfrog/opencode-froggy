import { response } from "../memory/bounds"
import { openProjectMemory } from "../memory/project"
import { inputRecord, requireMemoryWriter } from "../memory/tool-input"

export function createMemoryBackupTool(directory: string) {
  return {
    name: "memory-backup",
    options: { codemode: false },
    description: "Create and verify a standalone local SQLite backup, including record history. Only memory-manager may create backups. Does not restore, migrate, publish or delete data; returns the backup path and size.",
    input: { type: "object", properties: {}, additionalProperties: false },
    async execute(input: unknown, context: unknown) {
      inputRecord(input, [])
      requireMemoryWriter(context)
      const { store } = openProjectMemory(directory, { readonly: true })
      try {
        return response(store.backup())
      } finally {
        store.close()
      }
    },
  }
}
