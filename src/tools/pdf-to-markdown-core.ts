import { readFile } from "node:fs/promises"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import { type TextItem, type TextMarkedContent, type DocumentInitParameters } from "pdfjs-dist/types/src/display/api"

export interface PdfToMarkdownArgs {
  filePath: string
  maxPages?: number
}

interface TextLine {
  text: string
  y: number
  x: number
  fontSize: number
}

interface MarkdownOptions {
  maxPages?: number
}

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return "str" in item
}

function getFontSize(item: TextItem): number {
  if (typeof item.height === "number" && item.height > 0) {
    return item.height
  }

  const [a, b] = item.transform
  const size = Math.hypot(a, b)
  return size > 0 ? size : 0
}

function mergeLineText(previous: string, next: string): string {
  if (previous.endsWith("-") && !previous.endsWith(" -")) {
    return `${previous.slice(0, -1)}${next}`
  }

  if (/[\s-]$/.test(previous) || /^[,.;:!?)]/.test(next)) {
    return `${previous}${next}`
  }

  return `${previous} ${next}`
}

function groupTextLines(items: TextItem[]): TextLine[] {
  const sorted = [...items].sort((a, b) => {
    const yDiff = b.transform[5] - a.transform[5]
    if (Math.abs(yDiff) > 0.1) return yDiff
    return a.transform[4] - b.transform[4]
  })

  const lines: TextLine[] = []

  for (const item of sorted) {
    const text = item.str.trim()
    if (!text) continue

    const y = item.transform[5]
    const x = item.transform[4]
    const fontSize = getFontSize(item)

    const lastLine = lines[lines.length - 1]
    if (lastLine) {
      const tolerance = Math.max(2, Math.min(lastLine.fontSize, fontSize) * 0.5)
      if (Math.abs(lastLine.y - y) <= tolerance) {
        lastLine.text = mergeLineText(lastLine.text, text)
        lastLine.fontSize = Math.max(lastLine.fontSize, fontSize)
        continue
      }
    }

    lines.push({ text, y, x, fontSize })
  }

  return lines
}

function getHeadingLevel(
  fontSize: number,
  maxFontSize: number,
  bodyFontSize: number
): number | null {
  if (maxFontSize === 0) return null
  if (fontSize < bodyFontSize * 1.2) return null

  const ratio = fontSize / maxFontSize

  if (ratio >= 0.85) return 1
  if (ratio >= 0.7) return 2
  if (ratio >= 0.6) return 3
  return null
}

function getBodyFontSize(lines: TextLine[]): number {
  const counts = new Map<number, number>()

  for (const line of lines) {
    const rounded = Math.round(line.fontSize * 10) / 10
    counts.set(rounded, (counts.get(rounded) ?? 0) + 1)
  }

  let bestSize = 0
  let bestCount = 0

  for (const [size, count] of counts) {
    if (count > bestCount || (count === bestCount && size < bestSize)) {
      bestSize = size
      bestCount = count
    }
  }

  return bestSize || Math.max(...lines.map(line => line.fontSize))
}

function formatListItem(text: string): string | null {
  const trimmed = text.trim()
  const match = /^([*\-]|\u2022|\d+\.)\s+(.*)$/.exec(trimmed)
  if (!match) return null

  return `- ${match[2].trim()}`
}

function shouldMergeLines(previous: TextLine, next: TextLine): boolean {
  if (next.y > previous.y) return false

  const gap = previous.y - next.y
  const fontSize = previous.fontSize || next.fontSize
  const gapThreshold = Math.max(4, fontSize * 1.6)
  const fontDelta = Math.abs(previous.fontSize - next.fontSize)

  if (fontDelta > fontSize * 0.4) return false
  return gap <= gapThreshold
}

function linesToMarkdown(lines: TextLine[]): string[] {
  if (lines.length === 0) return []

  const maxFontSize = Math.max(...lines.map(line => line.fontSize))
  const bodyFontSize = getBodyFontSize(lines)
  const output: string[] = []
  let currentParagraph: string | null = null
  let lastLine: TextLine | null = null

  const flushParagraph = () => {
    if (currentParagraph) {
      output.push(currentParagraph, "")
      currentParagraph = null
    }
  }

  for (const line of lines) {
    const text = line.text.replace(/\s+/g, " ").trim()
    if (!text) continue

    const headingLevel = getHeadingLevel(line.fontSize, maxFontSize, bodyFontSize)
    const listItem = formatListItem(text)

    if (headingLevel) {
      flushParagraph()
      output.push(`${"#".repeat(headingLevel)} ${text}`, "")
      lastLine = line
      continue
    }

    if (listItem) {
      flushParagraph()
      output.push(listItem, "")
      lastLine = line
      continue
    }

    if (currentParagraph && lastLine && shouldMergeLines(lastLine, line)) {
      currentParagraph = `${currentParagraph} ${text}`
    } else {
      flushParagraph()
      currentParagraph = text
    }

    lastLine = line
  }

  flushParagraph()

  while (output.length > 0 && output[output.length - 1].trim() === "") {
    output.pop()
  }

  return output
}

export async function convertPdfToMarkdown(
  filePath: string,
  options: MarkdownOptions = {}
): Promise<string> {
  let data: Uint8Array

  try {
    const buffer = await readFile(filePath)
    data = new Uint8Array(buffer)
  } catch (error) {
    throw new Error(`Failed to read PDF at ${filePath}: ${String(error)}`)
  }

  const loadingTask = getDocument({ data } as DocumentInitParameters)
  const pdf = await loadingTask.promise

  const totalPages = pdf.numPages
  const maxPages = options.maxPages && options.maxPages > 0
    ? Math.min(options.maxPages, totalPages)
    : totalPages

  const markdownLines: string[] = []

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent(
      { normalizeWhitespace: true } as Parameters<typeof page.getTextContent>[0]
    )
    const items = textContent.items.filter(isTextItem)
    const lines = groupTextLines(items)
    const pageMarkdown = linesToMarkdown(lines)

    if (pageMarkdown.length > 0) {
      if (markdownLines.length > 0) {
        markdownLines.push("")
      }
      markdownLines.push(...pageMarkdown)
    }
  }

  while (markdownLines.length > 0 && markdownLines[markdownLines.length - 1].trim() === "") {
    markdownLines.pop()
  }

  return markdownLines.join("\n")
}
