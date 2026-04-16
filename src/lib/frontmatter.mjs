export function parseFrontmatter(document) {
  const text = String(document ?? "")
  if (!text.startsWith("---\n")) {
    return { data: {}, body: text }
  }

  const end = text.indexOf("\n---\n", 4)
  if (end === -1) {
    return { data: {}, body: text }
  }

  const raw = text.slice(4, end)
  const body = text.slice(end + 5)
  const data = {}

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const separator = trimmed.indexOf(":")
    if (separator === -1) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    data[key] = parseScalar(value)
  }

  return { data, body }
}

function parseScalar(value) {
  if (value === "") return ""
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  if (value === "true") return true
  if (value === "false") return false
  if (value === "null") return null
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  return value
}

export function renderFrontmatter(data, body) {
  const entries = Object.entries(data).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return String(body ?? "")

  const lines = entries.map(([key, value]) => `${key}: ${formatScalar(value)}`)
  return `---\n${lines.join("\n")}\n---\n\n${String(body ?? "").trim()}\n`
}

function formatScalar(value) {
  if (value === null) return "null"
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  const text = String(value ?? "")
  return JSON.stringify(text)
}
