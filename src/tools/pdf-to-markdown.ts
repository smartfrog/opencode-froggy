import { convertPdfToMarkdown, type PdfToMarkdownArgs } from "./pdf-to-markdown-core"

export const pdfToMarkdownTool = {
  name: "pdf-to-markdown",
  description:
    "Convert a text-based PDF into enriched Markdown (headings, paragraphs, lists). Returns Markdown as plain text.",
  input: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Absolute path to the PDF file to convert",
      },
      maxPages: {
        type: "number",
        description: "Limit the number of pages to convert",
      },
    },
    required: ["filePath"],
    additionalProperties: false,
  },
  async execute(input: unknown) {
    const args = input as PdfToMarkdownArgs
    return { content: await convertPdfToMarkdown(args.filePath, { maxPages: args.maxPages }) }
  },
}
