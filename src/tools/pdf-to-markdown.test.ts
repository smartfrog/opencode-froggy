import { describe, it, expect } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { convertPdfToMarkdown } from "./pdf-to-markdown-core"

interface PdfTextLine {
  text: string
  fontSize: number
  x: number
  y: number
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
}

function buildPdf(lines: PdfTextLine[]): Buffer {
  const header = "%PDF-1.4\n%\xFF\xFF\xFF\xFF\n"
  const objects: string[] = []

  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
  objects.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
  objects.push(
    "3 0 obj\n" +
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\n" +
      "endobj\n"
  )
  objects.push("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n")

  const textCommands = lines
    .map(line => {
      const escaped = escapePdfText(line.text)
      return `/F1 ${line.fontSize} Tf 1 0 0 1 ${line.x} ${line.y} Tm (${escaped}) Tj`
    })
    .join("\n")

  const stream = `BT\n${textCommands}\nET`
  const streamLength = Buffer.byteLength(stream, "utf-8")
  objects.push(
    `5 0 obj\n<< /Length ${streamLength} >>\nstream\n${stream}\nendstream\nendobj\n`
  )

  const offsets: number[] = [0]
  let currentOffset = Buffer.byteLength(header, "utf-8")

  for (const obj of objects) {
    offsets.push(currentOffset)
    currentOffset += Buffer.byteLength(obj, "utf-8")
  }

  const xrefOffset = currentOffset
  const xrefLines = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f "]

  for (let i = 1; i < offsets.length; i += 1) {
    xrefLines.push(`${String(offsets[i]).padStart(10, "0")} 00000 n `)
  }

  const xref = `${xrefLines.join("\n")}\n`
  const trailer =
    "trailer\n" +
    `<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    "startxref\n" +
    `${xrefOffset}\n` +
    "%%EOF\n"

  const pdfContent = [header, ...objects, xref, trailer].join("")
  return Buffer.from(pdfContent, "binary")
}

async function withTempPdf(lines: PdfTextLine[], run: (filePath: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "pdf-md-"))
  const filePath = join(dir, "sample.pdf")

  try {
    await writeFile(filePath, buildPdf(lines))
    await run(filePath)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe("pdf-to-markdown", () => {
  it("renders headings based on font size", async () => {
    await withTempPdf(
      [
        { text: "Title", fontSize: 24, x: 100, y: 700 },
        { text: "Body text", fontSize: 12, x: 100, y: 660 },
      ],
      async filePath => {
        const markdown = await convertPdfToMarkdown(filePath)
        expect(markdown).toContain("# Title")
      }
    )
  })

  it("merges nearby lines into a paragraph", async () => {
    await withTempPdf(
      [
        { text: "First line", fontSize: 12, x: 100, y: 700 },
        { text: "Second line", fontSize: 12, x: 100, y: 684 },
      ],
      async filePath => {
        const markdown = await convertPdfToMarkdown(filePath)
        expect(markdown).toContain("First line Second line")
      }
    )
  })

  it("formats bullet markers as list items", async () => {
    await withTempPdf(
      [{ text: "- Bullet item", fontSize: 12, x: 100, y: 700 }],
      async filePath => {
        const markdown = await convertPdfToMarkdown(filePath)
        expect(markdown).toContain("- Bullet item")
      }
    )
  })
})
