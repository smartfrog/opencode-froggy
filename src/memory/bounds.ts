const MAX_JSON_CHARACTERS = 20_000

export function textResponse(content: string): { content: string } {
  return { content }
}

export function response(value: unknown): { content: string } {
  const content = JSON.stringify(value)
  if (content.length > MAX_JSON_CHARACTERS) throw new Error(`Response exceeds ${MAX_JSON_CHARACTERS} characters; narrow the request`)
  return textResponse(content)
}
