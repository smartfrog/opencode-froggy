const MAX_RESPONSE_CHARACTERS = 20_000

export function textRange(value: string, offset: number, limit: number) {
  const characters = Array.from(value)
  return { text: characters.slice(offset, offset + limit).join(""), hasMore: offset + limit < characters.length }
}

export function capText(value: string, limit: number): { text: string; truncated: boolean } {
  const characters = Array.from(value)
  if (characters.length <= limit) return { text: value, truncated: false }
  return { text: characters.slice(0, limit).join("") + "…", truncated: true }
}

export function response(value: unknown): { content: string } {
  const content = JSON.stringify(value)
  if (content.length > MAX_RESPONSE_CHARACTERS) throw new Error(`Response exceeds ${MAX_RESPONSE_CHARACTERS} characters; narrow the request`)
  return { content }
}
