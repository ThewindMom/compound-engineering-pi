#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
const pkg = JSON.parse(await fs.promises.readFile(path.join(repoRoot, 'package.json'), 'utf8'))
const lock = JSON.parse(await fs.promises.readFile(path.join(repoRoot, 'upstream.lock.json'), 'utf8'))
const tag = `v${pkg.version}`

let shouldRelease = true
try {
  const { stdout } = await execFile('git', ['tag', '--list', tag], { cwd: repoRoot })
  shouldRelease = !stdout.split(/\r?\n/).map((line) => line.trim()).includes(tag)
} catch {
  shouldRelease = true
}

const notesPath = path.join(repoRoot, '.tmp', `release-notes-${pkg.version}.md`)
await fs.promises.mkdir(path.dirname(notesPath), { recursive: true })
await fs.promises.writeFile(notesPath, buildReleaseNotes({ tag, version: pkg.version, lock }))

writeOutputs({
  should_release: shouldRelease ? 'true' : 'false',
  tag,
  version: pkg.version,
  notes_path: notesPath,
})

console.log(JSON.stringify({ shouldRelease, tag, version: pkg.version, notesPath }, null, 2))

function buildReleaseNotes({ tag, version, lock }) {
  return [
    `# ${tag}`,
    '',
    `compound-engineering-pi ${version} packages Compound Engineering ${lock.upstream.version} for Pi.`,
    '',
    '## What this release includes',
    '',
    '- Updated generated Compound Engineering skills and prompt wrappers from the upstream source of truth.',
    '- Maintained Pi compatibility extension with model-aware subagent routing.',
    '- Git-installable package layout for easy `pi install` / `pi update` workflows.',
    '',
    '## Install',
    '',
    '```bash',
    `pi install git:github.com/ThewindMom/compound-engineering-pi@${tag}`,
    '```',
    '',
    '## Update',
    '',
    '```bash',
    'pi update',
    '```',
    '',
    '## Upstream source',
    '',
    `- Repository: https://github.com/${lock.upstream.owner}/${lock.upstream.repo}`,
    `- Upstream tag: ${lock.upstream.tag}`,
    `- Upstream commit: ${lock.upstream.commit}`,
    '',
  ].join('\n') + '\n'
}

function writeOutputs(values) {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) return
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`)
  fs.appendFileSync(outputPath, lines.join('\n') + '\n')
}
