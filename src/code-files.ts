import { extname } from "node:path"

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".vue",
  ".svelte",
  ".go",
  ".rs",
  ".c",
  ".h",
  ".cpp",
  ".cc",
  ".cxx",
  ".hpp",
  ".java",
  ".py",
  ".rb",
  ".php",
  ".sh",
  ".bash",
  ".kt",
  ".kts",
  ".swift",
  ".m",
  ".mm",
  ".cs",
  ".fs",
  ".scala",
  ".clj",
  ".hs",
  ".lua",
])

function hasCodeExtension(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return Boolean(ext && CODE_EXTENSIONS.has(ext))
}

export { CODE_EXTENSIONS, hasCodeExtension }
