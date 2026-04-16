import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import {
  GLOBAL_MODEL_CONFIG_PATH,
  buildPiInvocationArgs,
  normalizeAgentName,
  readGlobalModelConfig,
  readJsonIfExists,
  resolveAgentModel,
  shellEscape,
} from '../src/lib/model-config.mjs'

const MAX_BYTES = 50 * 1024
const DEFAULT_SUBAGENT_TIMEOUT_MS = 10 * 60 * 1000
const MAX_PARALLEL_SUBAGENTS = 8

type AgentTask = {
  agent: string
  task: string
  cwd?: string
}

type SubagentResult = {
  agent: string
  task: string
  cwd: string
  exitCode: number
  output: string
  stderr: string
  invocation: {
    args: string[]
    command: string
    resolution: Record<string, unknown>
  }
}

function truncate(value: string): string {
  const input = value ?? ''
  if (Buffer.byteLength(input, 'utf8') <= MAX_BYTES) return input
  return input.slice(0, MAX_BYTES) + '\n\n[Output truncated to 50KB]'
}

function resolveTaskCwd(baseCwd: string, taskCwd?: string): string {
  if (!taskCwd || !taskCwd.trim()) return baseCwd
  if (taskCwd === '~') return os.homedir()
  if (taskCwd.startsWith(`~${path.sep}`)) return path.join(os.homedir(), taskCwd.slice(2))
  return path.resolve(baseCwd, taskCwd)
}

function resolveBundledPath(...segments: string[]): string {
  const extensionDir = path.dirname(fileURLToPath(import.meta.url))
  return path.join(extensionDir, '..', ...segments)
}

function resolveAgentMetadataPath(explicitPath: string | undefined, cwd: string): string | undefined {
  if (explicitPath?.trim()) return path.resolve(explicitPath)

  const projectPath = path.join(cwd, '.pi', 'compound-engineering', 'agent-metadata.json')
  if (fs.existsSync(projectPath)) return projectPath

  const bundledPath = resolveBundledPath('pi-resources', 'compound-engineering', 'agent-metadata.json')
  if (fs.existsSync(bundledPath)) return bundledPath

  return undefined
}

function resolveModelConfigPath(explicitPath?: string): string | undefined {
  if (explicitPath?.trim()) return path.resolve(explicitPath)
  return fs.existsSync(GLOBAL_MODEL_CONFIG_PATH) ? GLOBAL_MODEL_CONFIG_PATH : undefined
}

function resolveMcporterConfigPath(cwd: string, explicit?: string): string | undefined {
  if (explicit?.trim()) return path.resolve(explicit)

  const projectPath = path.join(cwd, '.pi', 'compound-engineering', 'mcporter.json')
  if (fs.existsSync(projectPath)) return projectPath

  const globalPath = path.join(os.homedir(), '.pi', 'agent', 'compound-engineering', 'mcporter.json')
  if (fs.existsSync(globalPath)) return globalPath

  const bundledPath = resolveBundledPath('pi-resources', 'compound-engineering', 'mcporter.json')
  return fs.existsSync(bundledPath) ? bundledPath : undefined
}

function loadResolutionContext(baseCwd: string, agent: string, configPath?: string, metadataPath?: string) {
  const resolvedConfigPath = resolveModelConfigPath(configPath)
  const resolvedMetadataPath = resolveAgentMetadataPath(metadataPath, baseCwd)
  const metadata = readJsonIfExists(resolvedMetadataPath) ?? {}
  const config = readGlobalModelConfig(resolvedConfigPath)
  if (resolvedConfigPath) config.__path = resolvedConfigPath
  const resolution = resolveAgentModel(agent, metadata, config)

  return {
    configPath: resolvedConfigPath,
    metadataPath: resolvedMetadataPath,
    resolution,
  }
}

function buildSubagentModelOverride(values: Record<string, unknown>) {
  const rawModel = typeof values.model === 'string' ? values.model : undefined
  const provider = typeof values.provider === 'string' ? values.provider : undefined
  const thinking = typeof values.thinking === 'string' ? values.thinking : undefined
  const base = rawModel
    ? (provider && !rawModel.includes('/') ? `${provider}/${rawModel}` : rawModel)
    : undefined

  if (!base) return undefined
  if (!thinking || thinking === 'off' || /:(off|minimal|low|medium|high|xhigh)$/.test(base)) return base
  return `${base}:${thinking}`
}

function injectModelOverride(agentName: unknown, target: Record<string, unknown>, baseCwd: string) {
  const normalized = normalizeAgentName(String(agentName ?? ''))
  if (!normalized || target.model) return
  const { resolution } = loadResolutionContext(baseCwd, normalized)
  const modelOverride = buildSubagentModelOverride(resolution.values)
  if (modelOverride) target.model = modelOverride
}

async function runSingleSubagent(
  pi: ExtensionAPI,
  baseCwd: string,
  task: AgentTask,
  options: {
    signal?: AbortSignal
    timeoutMs?: number
    configPath?: string
    metadataPath?: string
    dryRun?: boolean
  } = {},
): Promise<SubagentResult> {
  const agent = normalizeAgentName(task.agent)
  if (!agent) throw new Error('Subagent task is missing a valid agent name')

  const taskText = String(task.task ?? '').trim()
  if (!taskText) throw new Error(`Subagent task for ${agent} is empty`)

  const cwd = resolveTaskCwd(baseCwd, task.cwd)
  const prompt = `/skill:${agent} ${taskText}`
  const { resolution, configPath, metadataPath } = loadResolutionContext(baseCwd, agent, options.configPath, options.metadataPath)
  const args = buildPiInvocationArgs({
    prompt,
    model: resolution.values.model,
    provider: resolution.values.provider,
    thinking: resolution.values.thinking,
  })

  const command = `cd ${shellEscape(cwd)} && pi ${args.map(shellEscape).join(' ')}`
  if (options.dryRun) {
    return {
      agent,
      task: taskText,
      cwd,
      exitCode: 0,
      output: '(dry run)',
      stderr: '',
      invocation: {
        args,
        command,
        resolution: {
          ...resolution,
          configPath,
          metadataPath,
        },
      },
    }
  }

  const result = await pi.exec('bash', ['-lc', command], {
    signal: options.signal,
    timeout: options.timeoutMs ?? DEFAULT_SUBAGENT_TIMEOUT_MS,
  })

  return {
    agent,
    task: taskText,
    cwd,
    exitCode: result.code,
    output: truncate(result.stdout || ''),
    stderr: truncate(result.stderr || ''),
    invocation: {
      args,
      command,
      resolution: {
        ...resolution,
        configPath,
        metadataPath,
      },
    },
  }
}

async function runParallelSubagents(
  pi: ExtensionAPI,
  baseCwd: string,
  tasks: AgentTask[],
  options: {
    signal?: AbortSignal
    timeoutMs?: number
    maxConcurrency?: number
    configPath?: string
    metadataPath?: string
    dryRun?: boolean
    onProgress?: (completed: number, total: number) => void
  } = {},
): Promise<SubagentResult[]> {
  const safeConcurrency = Math.max(1, Math.min(options.maxConcurrency ?? 4, MAX_PARALLEL_SUBAGENTS, tasks.length || 1))
  const results: SubagentResult[] = new Array(tasks.length)
  let nextIndex = 0
  let completed = 0

  const workers = Array.from({ length: safeConcurrency }, async () => {
    while (true) {
      const current = nextIndex
      nextIndex += 1
      if (current >= tasks.length) return
      results[current] = await runSingleSubagent(pi, baseCwd, tasks[current], options)
      completed += 1
      options.onProgress?.(completed, tasks.length)
    }
  })

  await Promise.all(workers)
  return results
}

function formatSubagentSummary(results: SubagentResult[]): string {
  if (results.length === 0) return 'No subagent work was executed.'

  const success = results.filter((result) => result.exitCode === 0).length
  const failed = results.length - success
  const header = failed === 0
    ? `Subagent run completed: ${success}/${results.length} succeeded.`
    : `Subagent run completed: ${success}/${results.length} succeeded, ${failed} failed.`

  const detailLines = results.map((result) => {
    const status = result.exitCode === 0 ? 'ok' : 'error'
    const preview = (result.output || result.stderr || '(no output)').split('\n').slice(0, 6).join('\n')
    return `\n[${status}] ${result.agent}\n${preview}`
  })

  return header + detailLines.join('\n')
}

function registerAskUserQuestionTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'ask_user_question',
    label: 'Ask User Question',
    description: 'Ask the user a question with optional choices.',
    parameters: Type.Object({
      question: Type.String({ description: 'Question shown to the user' }),
      options: Type.Optional(Type.Array(Type.String(), { description: 'Selectable options' })),
      allowCustom: Type.Optional(Type.Boolean({ default: true })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'UI is unavailable in this mode.' }],
          details: {},
        }
      }

      const options = params.options ?? []
      const allowCustom = params.allowCustom ?? true
      if (options.length === 0) {
        const answer = await ctx.ui.input(params.question)
        return {
          content: [{ type: 'text', text: answer ? `User answered: ${answer}` : 'User cancelled.' }],
          details: { answer: answer ?? null },
        }
      }

      const customLabel = 'Other (type custom answer)'
      const selected = await ctx.ui.select(params.question, allowCustom ? [...options, customLabel] : options)
      if (!selected) {
        return {
          content: [{ type: 'text', text: 'User cancelled.' }],
          details: { answer: null },
        }
      }

      if (selected === customLabel) {
        const custom = await ctx.ui.input('Your answer')
        return {
          content: [{ type: 'text', text: custom ? `User answered: ${custom}` : 'User cancelled.' }],
          details: { answer: custom ?? null },
        }
      }

      return {
        content: [{ type: 'text', text: `User selected: ${selected}` }],
        details: { answer: selected },
      }
    },
  })
}

function registerSubagentFallbackTool(pi: ExtensionAPI) {
  const agentTaskSchema = Type.Object({
    agent: Type.String({ description: 'Compound Engineering agent/skill name' }),
    task: Type.String({ description: 'Task text to send to the subagent' }),
    cwd: Type.Optional(Type.String({ description: 'Optional working directory' })),
  })

  pi.registerTool({
    name: 'subagent',
    label: 'Compound Engineering Subagent',
    description: 'Fallback Compound Engineering subagent runner with model-aware routing.',
    parameters: Type.Object({
      agent: Type.Optional(Type.String({ description: 'Single subagent name' })),
      task: Type.Optional(Type.String({ description: 'Single subagent task' })),
      tasks: Type.Optional(Type.Array(agentTaskSchema, { description: 'Parallel subagent tasks' })),
      chain: Type.Optional(Type.Array(agentTaskSchema, { description: 'Sequential subagent tasks. Later tasks may reference {previous}.' })),
      cwd: Type.Optional(Type.String({ description: 'Base working directory' })),
      maxConcurrency: Type.Optional(Type.Number({ description: 'Maximum parallel subagents', default: 4 })),
      timeoutMs: Type.Optional(Type.Number({ description: 'Per-subagent timeout in milliseconds', default: DEFAULT_SUBAGENT_TIMEOUT_MS })),
      configPath: Type.Optional(Type.String({ description: 'Optional override path for ce-models.json. v1 defaults to global-only config.' })),
      metadataPath: Type.Optional(Type.String({ description: 'Optional override path for generated agent metadata.' })),
      dryRun: Type.Optional(Type.Boolean({ description: 'Return invocation details without executing pi.', default: false })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const hasSingle = Boolean(params.agent && params.task)
      const hasTasks = Boolean(params.tasks?.length)
      const hasChain = Boolean(params.chain?.length)
      const modeCount = Number(hasSingle) + Number(hasTasks) + Number(hasChain)
      if (modeCount !== 1) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Provide exactly one of: agent+task, tasks[], or chain[].' }],
          details: {},
        }
      }

      const baseCwd = resolveTaskCwd(ctx.cwd, params.cwd)
      const shared = {
        signal,
        timeoutMs: Number(params.timeoutMs || DEFAULT_SUBAGENT_TIMEOUT_MS),
        configPath: params.configPath,
        metadataPath: params.metadataPath,
        dryRun: params.dryRun ?? false,
      }

      if (hasSingle) {
        const result = await runSingleSubagent(pi, baseCwd, { agent: params.agent, task: params.task }, shared)
        return {
          isError: result.exitCode !== 0,
          content: [{ type: 'text', text: formatSubagentSummary([result]) }],
          details: { results: [result] },
        }
      }

      if (hasTasks) {
        const results = await runParallelSubagents(pi, baseCwd, params.tasks, {
          ...shared,
          maxConcurrency: Number(params.maxConcurrency || 4),
          onProgress: (completed, total) => onUpdate?.({ completed, total }),
        })
        return {
          isError: results.some((result) => result.exitCode !== 0),
          content: [{ type: 'text', text: formatSubagentSummary(results) }],
          details: { results },
        }
      }

      const chainResults: SubagentResult[] = []
      let previous = ''
      for (const step of params.chain ?? []) {
        const resolvedTask = String(step.task).replace(/\{previous\}/g, previous)
        const result = await runSingleSubagent(pi, baseCwd, { ...step, task: resolvedTask }, shared)
        chainResults.push(result)
        previous = result.output || result.stderr || ''
        if (result.exitCode !== 0) break
      }

      return {
        isError: chainResults.some((result) => result.exitCode !== 0),
        content: [{ type: 'text', text: formatSubagentSummary(chainResults) }],
        details: { results: chainResults },
      }
    },
  })
}

function registerMcporterListTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'mcporter_list',
    label: 'MCPorter List',
    description: 'List tools available from an MCP server through MCPorter.',
    parameters: Type.Object({
      server: Type.String({ description: 'Server name' }),
      configPath: Type.Optional(Type.String({ description: 'Optional mcporter config path' })),
      allParameters: Type.Optional(Type.Boolean({ default: false })),
      json: Type.Optional(Type.Boolean({ default: true })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const args = ['list', params.server]
      if (params.allParameters) args.push('--all-parameters')
      if (params.json ?? true) args.push('--json')
      const configPath = resolveMcporterConfigPath(ctx.cwd, params.configPath)
      if (configPath) args.push('--config', configPath)

      const result = await pi.exec('mcporter', args, { signal })
      const output = truncate(result.stdout || result.stderr || '')
      return {
        isError: result.code !== 0,
        content: [{ type: 'text', text: output || '(no output)' }],
        details: { exitCode: result.code, command: `mcporter ${args.join(' ')}`, configPath },
      }
    },
  })
}

function registerMcporterCallTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'mcporter_call',
    label: 'MCPorter Call',
    description: 'Call a specific MCP tool through MCPorter.',
    parameters: Type.Object({
      call: Type.Optional(Type.String({ description: 'Function-style call, e.g. linear.list_issues(limit: 5)' })),
      server: Type.Optional(Type.String({ description: 'Server name (if call is omitted)' })),
      tool: Type.Optional(Type.String({ description: 'Tool name (if call is omitted)' })),
      args: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: 'JSON arguments object' })),
      configPath: Type.Optional(Type.String({ description: 'Optional mcporter config path' })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const args = ['call']
      if (params.call?.trim()) {
        args.push(params.call.trim())
      } else {
        if (!params.server || !params.tool) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Provide either call, or server + tool.' }],
            details: {},
          }
        }
        args.push(`${params.server}.${params.tool}`)
        if (params.args) args.push('--args', JSON.stringify(params.args))
      }

      args.push('--output', 'json')
      const configPath = resolveMcporterConfigPath(ctx.cwd, params.configPath)
      if (configPath) args.push('--config', configPath)

      const result = await pi.exec('mcporter', args, { signal })
      const output = truncate(result.stdout || result.stderr || '')
      return {
        isError: result.code !== 0,
        content: [{ type: 'text', text: output || '(no output)' }],
        details: { exitCode: result.code, command: `mcporter ${args.join(' ')}`, configPath },
      }
    },
  })
}

export default function compoundEngineeringCompat(pi: ExtensionAPI) {
  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName !== 'subagent') return
    const input = event.input as Record<string, unknown>
    const baseCwd = resolveTaskCwd(ctx.cwd, typeof input.cwd === 'string' ? input.cwd : undefined)

    if (typeof input.agent === 'string' && !input.model) {
      injectModelOverride(input.agent, input, baseCwd)
    }

    if (Array.isArray(input.tasks)) {
      for (const task of input.tasks) {
        if (task && typeof task === 'object') {
          injectModelOverride((task as Record<string, unknown>).agent, task as Record<string, unknown>, baseCwd)
        }
      }
    }

    if (Array.isArray(input.chain)) {
      for (const step of input.chain) {
        if (!step || typeof step !== 'object') continue
        const stepRecord = step as Record<string, unknown>
        if (typeof stepRecord.agent === 'string') {
          injectModelOverride(stepRecord.agent, stepRecord, baseCwd)
        }
        if (Array.isArray(stepRecord.parallel)) {
          for (const parallelTask of stepRecord.parallel) {
            if (parallelTask && typeof parallelTask === 'object') {
              injectModelOverride((parallelTask as Record<string, unknown>).agent, parallelTask as Record<string, unknown>, baseCwd)
            }
          }
        }
      }
    }
  })

  pi.on('session_start', async () => {
    const existing = new Set(pi.getAllTools().map((tool) => tool.name))
    if (!existing.has('ask_user_question')) registerAskUserQuestionTool(pi)
    if (!existing.has('subagent')) registerSubagentFallbackTool(pi)
    if (!existing.has('mcporter_list')) registerMcporterListTool(pi)
    if (!existing.has('mcporter_call')) registerMcporterCallTool(pi)
  })
}
