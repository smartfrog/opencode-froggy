export const MAX_RESPONSE_CHARACTERS = 20_000
export const SUMMARY_TITLE_CHARACTERS = 200
export const SUMMARY_TEXT_CHARACTERS = 400
export const TOPIC_CHARACTERS = 80
export const TOPIC_TITLE_CHARACTERS = 120
export const OVERVIEW_TOPICS = 30
export const SEARCH_LIMIT = 10
export const DETAIL_FIELD_CHARACTERS = 1_200
export const DETAIL_ARRAY_ITEMS = 8
export const DETAIL_ARRAY_ITEM_CHARACTERS = 300
export const NOTE_CONTENT_CHARACTERS = 16_000
export const RANGE_LIMIT = 20_000
export const HISTORY_LIMIT = 5

export interface TextRange {
  text: string
  offset: number
  nextOffset: number | null
  hasMore: boolean
  totalCharacters: number
}

export function textRange(value: string, offset = 0, limit = RANGE_LIMIT): TextRange {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer")
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > RANGE_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${RANGE_LIMIT}`)
  }
  const characters = Array.from(value)
  if (offset > characters.length) throw new Error(`offset ${offset} exceeds ${characters.length} characters`)
  const end = Math.min(offset + limit, characters.length)
  return {
    text: characters.slice(offset, end).join(""),
    offset,
    nextOffset: end < characters.length ? end : null,
    hasMore: end < characters.length,
    totalCharacters: characters.length,
  }
}

export function capText(value: string, limit: number): { text: string; truncated: boolean } {
  const characters = Array.from(value)
  if (characters.length <= limit) return { text: value, truncated: false }
  return { text: characters.slice(0, limit).join("") + "\n… [truncated]", truncated: true }
}

export function capArray<T>(value: T[], limit: number): { items: T[]; omitted: number } {
  if (value.length <= limit) return { items: value, omitted: 0 }
  return { items: value.slice(0, limit), omitted: value.length - limit }
}

export function response(value: unknown): { content: string } {
  const content = JSON.stringify(value)
  if (content.length > MAX_RESPONSE_CHARACTERS) {
    throw new Error(`Response exceeds ${MAX_RESPONSE_CHARACTERS} characters; narrow the request or use a field range`)
  }
  return { content }
}

export function pageOffset(value = 0): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("offset must be a non-negative integer")
  return value
}

export function pageLimit(value: number | undefined, fallback: number, maximum: number): number {
  const limit = value ?? fallback
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("limit must be a positive integer")
  return Math.min(limit, maximum)
}

export function pageResponse<T>(
  items: T[],
  offset: number,
  hasMore: boolean,
  build: (items: T[], nextOffset: number | null) => unknown,
): { content: string } {
  let count = items.length
  while (true) {
    const nextOffset = hasMore || count < items.length ? offset + count : null
    const value = build(items.slice(0, count), nextOffset)
    if (JSON.stringify(value).length <= MAX_RESPONSE_CHARACTERS) return response(value)
    if (count <= 1) return response(value)
    count--
  }
}

export function rangeResponse(
  metadata: Record<string, unknown>,
  value: string,
  offset = 0,
  limit = RANGE_LIMIT,
): { content: string } {
  let size = limit
  while (true) {
    const range = textRange(value, offset, size)
    const result = { ...metadata, ...range }
    if (JSON.stringify(result).length <= MAX_RESPONSE_CHARACTERS || size === 1) return response(result)
    size = Math.max(1, Math.floor(size / 2))
  }
}

export function fieldResponse(
  metadata: Record<string, unknown>,
  value: string | string[],
  offset = 0,
  limit?: number,
  item?: number,
  defaultTextLimit = RANGE_LIMIT,
): { content: string } {
  if (typeof value === "string") return rangeResponse(metadata, value, offset, limit ?? defaultTextLimit)
  if (item !== undefined) {
    if (!Number.isSafeInteger(item) || item < 0 || item >= value.length) throw new Error(`item must be between 0 and ${value.length - 1}`)
    return rangeResponse({ ...metadata, item }, value[item], offset, limit ?? RANGE_LIMIT)
  }
  const start = pageOffset(offset)
  if (start > value.length) throw new Error(`offset ${start} exceeds ${value.length} items`)
  const size = pageLimit(limit, DETAIL_ARRAY_ITEMS, 50)
  const items = value.slice(start, start + size).map((entry) => capText(entry, DETAIL_ARRAY_ITEM_CHARACTERS))
  return pageResponse(items, start, start + items.length < value.length, (page, nextOffset) => ({
    ...metadata,
    offset: start,
    nextOffset,
    hasMore: nextOffset !== null,
    totalItems: value.length,
    items: page.map((entry) => entry.text),
    truncatedItems: page.some((entry) => entry.truncated),
  }))
}
