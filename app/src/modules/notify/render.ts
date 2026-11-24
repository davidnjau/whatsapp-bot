const VAR_PATTERN = /\{\{\s*(\w+)\s*\}\}/g

export function listVariables(body: string): string[] {
  return [...new Set([...body.matchAll(VAR_PATTERN)].map((m) => m[1]))]
}

export function renderTemplate(
  body: string,
  variables: Record<string, string | number>,
): { text: string; missing: string[] } {
  const missing: string[] = []
  const text = body.replace(VAR_PATTERN, (_match, name: string) => {
    const value = variables[name]
    if (value === undefined || value === null || value === '') {
      missing.push(name)
      return `{{${name}}}`
    }
    return String(value)
  })
  return { text, missing: [...new Set(missing)] }
}
