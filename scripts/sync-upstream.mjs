#!/usr/bin/env node
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { buildAdapterFromUpstream } from '../src/lib/upstream.mjs'

const execFile = promisify(execFileCallback)
const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
const args = parseArgs(process.argv.slice(2))
const force = args.force === 'true'
const lockPath = path.join(repoRoot, 'upstream.lock.json')
const lock = JSON.parse(await fs.promises.readFile(lockPath, 'utf8'))
const latest = args.sourceReleaseJson
  ? JSON.parse(await fs.promises.readFile(path.resolve(args.sourceReleaseJson), 'utf8'))
  : await fetchLatestRelease(lock.upstream.owner, lock.upstream.repo)

const summary = {
  previousTag: lock.upstream.tag,
  latestTag: latest.tag_name,
  latestVersion: normalizeVersion(latest.tag_name),
  changed: force || latest.tag_name !== lock.upstream.tag,
}

if (!summary.changed) {
  writeOutputs({ upstream_changed: 'false', upstream_tag: latest.tag_name, upstream_version: summary.latestVersion })
  console.log(JSON.stringify(summary, null, 2))
  process.exit(0)
}

const checkout = await cloneUpstream({ tag: latest.tag_name, owner: lock.upstream.owner, repo: lock.upstream.repo })
try {
  const pluginDir = path.join(checkout.path, lock.upstream.pluginPath)
  const build = await buildAdapterFromUpstream({
    pluginDir,
    repoRoot,
    release: {
      tag: latest.tag_name,
      commit: latest.target_commitish,
      releaseName: latest.name,
      releasedAt: latest.published_at,
    },
  })

  const notesPath = path.join(repoRoot, 'docs', 'generated-release-notes.md')
  const notes = [
    `# Upstream sync: ${latest.tag_name}`,
    '',
    `- Upstream release: ${latest.html_url}`,
    `- Source of truth: https://github.com/${lock.upstream.owner}/${lock.upstream.repo}`,
    `- Generated prompts: ${build.generatedPrompts.length}`,
    `- Generated agents: ${build.generatedAgents.length}`,
    `- Copied skills: ${build.copiedSkills.length}`,
    '',
    '## Upstream release body',
    '',
    latest.body?.trim() || '_No upstream release notes provided._',
  ].join('\n') + '\n'
  await fs.promises.writeFile(notesPath, notes)

  writeOutputs({
    upstream_changed: 'true',
    upstream_tag: latest.tag_name,
    upstream_version: build.plugin.version,
    release_notes_path: notesPath,
  })

  console.log(JSON.stringify({ ...summary, notesPath, pluginVersion: build.plugin.version }, null, 2))
} finally {
  await checkout.cleanup()
}

function normalizeVersion(tag) {
  return String(tag ?? '').replace(/^compound-engineering-v/, '')
}

function fetchLatestRelease(owner, repo) {
  const requestPath = `/repos/${owner}/${repo}/releases/latest`
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: 'api.github.com',
      path: requestPath,
      method: 'GET',
      headers: {
        'user-agent': 'compound-engineering-pi-sync',
        accept: 'application/vnd.github+json',
        ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
    }, (response) => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { raw += chunk })
      response.on('end', () => {
        if (!response.statusCode || response.statusCode >= 300) {
          reject(new Error(`GitHub latest release request failed (${response.statusCode}): ${raw}`))
          return
        }
        resolve(JSON.parse(raw))
      })
    })
    request.on('error', reject)
    request.end()
  })
}

async function cloneUpstream({ tag, owner, repo }) {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'compound-engineering-sync-'))
  const target = path.join(tempRoot, 'checkout')
  await execFile('git', ['clone', '--depth', '1', '--branch', tag, `https://github.com/${owner}/${repo}.git`, target])
  return {
    path: target,
    cleanup: async () => {
      await fs.promises.rm(tempRoot, { recursive: true, force: true })
    },
  }
}

function writeOutputs(values) {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) return
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`)
  fs.appendFileSync(outputPath, lines.join('\n') + '\n')
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
