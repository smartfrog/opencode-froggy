import { tool, type ToolContext } from "@opencode-ai/plugin"
import { convertPdfToMarkdown, type PdfToMarkdownArgs } from "./pdf-to-markdown-core"

export const pdfToMarkdownTool = tool({
  description:
    "Convert a text-based PDF into enriched Markdown (headings, paragraphs, lists). Returns Markdown as plain text.",
  args: {
    filePath: tool.schema.string().describe("Absolute path to the PDF file to convert"),
    maxPages: tool.schema
      .number()
      .int()
      .positive()
      .optional()
      .describe("Limit the number of pages to convert"),
  },
  async execute(args: PdfToMarkdownArgs, _context: ToolContext) {
    return convertPdfToMarkdown(args.filePath, { maxPages: args.maxPages })
  },
})
