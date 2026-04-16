import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseFrontmatter } from './frontmatter.mjs'

export const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
export const GLOBAL_MODEL_CONFIG_PATH = path.join(os.homedir(), '.pi', 'agent', 'compound-engineering', 'ce-models.json')

export const ADAPTER_DEFAULTS = Object.freeze({
  defaults: { thinking: 'medium' },
  roles: {
    research: { thinking: 'high' },
    review: { thinking: 'medium' },
    'document-review': { thinking: 'medium' },
    workflow: { thinking: 'medium' },
    docs: { thinking: 'low' },
    design: { thinking: 'medium' },
  },
})

export function normalizeAgentName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function sanitizePromptName(value) {
  return normalizeAgentName(String(value ?? '').replace(/:/g, '-'))
}

export function inferRoleFromSourcePath(sourcePath = '') {
  const normalized = String(sourcePath).replace(/\\/g, '/')
  const match = normalized.match(/agents\/([^/]+)\//)
  return match?.[1] ?? undefined
}

export function readJsonIfExists(filePath) {
  if (!filePath) return undefined
  if (!fs.existsSync(filePath)) return undefined
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

export function readGlobalModelConfig(explicitPath) {
  return readJsonIfExists(explicitPath ? path.resolve(explicitPath) : GLOBAL_MODEL_CONFIG_PATH) ?? {}
}

export function parseAgentMetadataDocument(document, sourcePath) {
  const { data } = parseFrontmatter(document)
  return normalizeAgentMetadata({
    name: data.name,
    description: data.description,
    model: data.model,
    role: data.role ?? inferRoleFromSourcePath(sourcePath),
    sourcePath,
  })
}

export function normalizeAgentMetadata(metadata) {
  if (!metadata) return undefined
  const name = normalizeAgentName(metadata.name)
  if (!name) return undefined
  return {
    name,
    description: metadata.description ? String(metadata.description) : undefined,
    model: metadata.model ? String(metadata.model) : undefined,
    provider: metadata.provider ? String(metadata.provider) : undefined,
    thinking: metadata.thinking ? String(metadata.thinking) : undefined,
    role: metadata.role ? String(metadata.role) : undefined,
    sourcePath: metadata.sourcePath ? String(metadata.sourcePath) : undefined,
  }
}

export function mergeDefined(base, overlay) {
  const next = { ...(base ?? {}) }
  for (const [key, value] of Object.entries(overlay ?? {})) {
    if (value !== undefined && value !== null && value !== '') next[key] = value
  }
  return next
}

export function resolveAgentModel(agentName, metadataMap = {}, config = {}) {
  const normalizedAgent = normalizeAgentName(agentName)
  const metadata = normalizedAgent ? metadataMap[normalizedAgent] : undefined
  const role = metadata?.role

  let resolved = mergeDefined({}, ADAPTER_DEFAULTS.defaults)
  if (role && ADAPTER_DEFAULTS.roles[role]) {
    resolved = mergeDefined(resolved, ADAPTER_DEFAULTS.roles[role])
  }

  const sources = []
  if (Object.keys(resolved).length > 0) {
    sources.push({ level: 'adapter-defaults', values: { ...resolved } })
  }

  if (metadata?.model && metadata.model !== 'inherit') {
    resolved = mergeDefined(resolved, {
      model: metadata.model,
      provider: metadata.provider,
      thinking: metadata.thinking,
    })
    sources.push({
      level: 'upstream-agent-metadata',
      values: { model: metadata.model, provider: metadata.provider, thinking: metadata.thinking },
    })
  }

  if (config.defaults) {
    resolved = mergeDefined(resolved, config.defaults)
    sources.push({ level: 'global-defaults', values: { ...config.defaults } })
  }

  if (role && config.roles?.[role]) {
    resolved = mergeDefined(resolved, config.roles[role])
    sources.push({ level: 'global-role-override', values: { ...config.roles[role] } })
  }

  if (normalizedAgent && config.agents?.[normalizedAgent]) {
    resolved = mergeDefined(resolved, config.agents[normalizedAgent])
    sources.push({ level: 'global-agent-override', values: { ...config.agents[normalizedAgent] } })
  }

  if (resolved.model === 'inherit') delete resolved.model
  if (resolved.thinking && !THINKING_LEVELS.has(resolved.thinking)) {
    throw new Error(`Invalid thinking level for ${normalizedAgent || agentName}: ${resolved.thinking}`)
  }

  return {
    agent: normalizedAgent,
    role,
    metadata,
    configPath: config.__path,
    values: resolved,
    sources,
  }
}

export function buildPiInvocationArgs({ prompt, model, provider, thinking }) {
  const args = ['--no-session']

  if (provider && model && !String(model).includes('/')) {
    args.push('--provider', String(provider))
  }

  if (model) {
    args.push('--model', String(model))
  }

  const hasThinkingShorthand = typeof model === 'string' && /:(off|minimal|low|medium|high|xhigh)$/.test(model)
  if (thinking && !hasThinkingShorthand) {
    args.push('--thinking', String(thinking))
  }

  args.push('-p', String(prompt))
  return args
}

export function shellEscape(value) {
  return "'" + String(value).replace(/'/g, `'"'"'`) + "'"
}

export function resolveMetadataPath(explicitPath, cwd, importMetaUrl) {
  if (explicitPath && String(explicitPath).trim()) return path.resolve(String(explicitPath))

  const extensionDir = path.dirname(new URL(importMetaUrl).pathname)
  const candidates = [
    path.join(cwd, '.pi', 'compound-engineering', 'agent-metadata.json'),
    path.join(extensionDir, '..', 'pi-resources', 'compound-engineering', 'agent-metadata.json'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return undefined
}
