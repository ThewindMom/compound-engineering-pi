#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { buildAdapterFromUpstream } from '../src/lib/upstream.mjs'

const execFile = promisify(execFileCallback)
const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
const args = parseArgs(process.argv.slice(2))

const release = {
  tag: args.tag,
  commit: args.commit,
  releaseName: args.releaseName,
  releasedAt: args.releasedAt,
}

const checkout = args.source
  ? { path: path.resolve(args.source), cleanup: async () => {} }
  : await cloneUpstream({ tag: args.tag, repo: args.repo ?? 'https://github.com/EveryInc/compound-engineering-plugin.git' })

try {
  const pluginDir = path.join(checkout.path, args.pluginPath ?? 'plugins', 'compound-engineering')
  const result = await buildAdapterFromUpstream({ pluginDir, repoRoot, release })
  console.log(JSON.stringify({
    pluginVersion: result.plugin.version,
    copiedSkills: result.copiedSkills.length,
    generatedPrompts: result.generatedPrompts.length,
    generatedAgents: result.generatedAgents.length,
    pluginDir,
  }, null, 2))
} finally {
  await checkout.cleanup()
}

async function cloneUpstream({ tag, repo }) {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'compound-engineering-upstream-'))
  const target = path.join(tempRoot, 'checkout')
  const cloneArgs = ['clone', '--depth', '1']
  if (tag) cloneArgs.push('--branch', tag)
  cloneArgs.push(repo, target)
  await execFile('git', cloneArgs)
  return {
    path: target,
    cleanup: async () => {
      await fs.promises.rm(tempRoot, { recursive: true, force: true })
    },
  }
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (!current.startsWith('--')) continue
    const key = current.slice(2)
    const next = argv[index + 1]
    parsed[key] = next && !next.startsWith('--') ? (index += 1, next) : 'true'
  }
  return parsed
}
