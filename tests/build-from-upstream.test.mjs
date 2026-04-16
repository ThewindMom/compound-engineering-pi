import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildAdapterFromUpstream } from '../src/lib/upstream.mjs'

const fixturePluginDir = path.resolve('tests/fixtures/sample-upstream/plugins/compound-engineering')

test('buildAdapterFromUpstream copies skills and generates prompts + agent metadata', async () => {
  const repoRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cepi-build-test-'))
  await fs.promises.mkdir(path.join(repoRoot, 'skills'), { recursive: true })
  await fs.promises.mkdir(path.join(repoRoot, 'prompts'), { recursive: true })
  await fs.promises.mkdir(path.join(repoRoot, 'pi-resources', 'compound-engineering'), { recursive: true })
  await fs.promises.writeFile(path.join(repoRoot, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.0' }, null, 2))
  await fs.promises.writeFile(path.join(repoRoot, 'upstream.lock.json'), JSON.stringify({
    upstream: { owner: 'EveryInc', repo: 'compound-engineering-plugin', pluginPath: 'plugins/compound-engineering', tag: 'old', version: '0.0.0', commit: 'abc' },
    adapter: { generatedAt: 'old' },
  }, null, 2))

  const result = await buildAdapterFromUpstream({
    pluginDir: fixturePluginDir,
    repoRoot,
    release: {
      tag: 'compound-engineering-v9.9.9',
      commit: 'fixture-commit',
      releaseName: 'fixture',
      releasedAt: '2026-04-16T00:00:00Z',
    },
  })

  assert.equal(result.plugin.version, '9.9.9')
  assert.equal(fs.existsSync(path.join(repoRoot, 'skills', 'ce-plan', 'SKILL.md')), true)
  assert.equal(fs.existsSync(path.join(repoRoot, 'skills', 'sample-researcher.md')), true)
  assert.equal(fs.existsSync(path.join(repoRoot, 'prompts', 'ce-plan.md')), true)

  const metadata = JSON.parse(await fs.promises.readFile(path.join(repoRoot, 'pi-resources', 'compound-engineering', 'agent-metadata.json'), 'utf8'))
  assert.equal(metadata['sample-researcher'].model, 'sonnet')
  assert.equal(metadata['sample-researcher'].role, 'research')
})
