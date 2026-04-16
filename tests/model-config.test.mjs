import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPiInvocationArgs, resolveAgentModel } from '../src/lib/model-config.mjs'

test('resolveAgentModel prefers global overrides over upstream metadata', () => {
  const metadata = {
    'security-reviewer': {
      name: 'security-reviewer',
      role: 'review',
      model: 'haiku',
    },
  }

  const config = {
    defaults: { thinking: 'low' },
    roles: { review: { model: 'sonnet', thinking: 'high' } },
    agents: { 'security-reviewer': { model: 'openai/gpt-4o', thinking: 'medium' } },
  }

  const resolution = resolveAgentModel('security-reviewer', metadata, config)
  assert.equal(resolution.values.model, 'openai/gpt-4o')
  assert.equal(resolution.values.thinking, 'medium')
  assert.equal(resolution.role, 'review')
})

test('resolveAgentModel falls back to upstream metadata before pi default', () => {
  const metadata = {
    'coherence-reviewer': {
      name: 'coherence-reviewer',
      role: 'document-review',
      model: 'haiku',
    },
  }

  const resolution = resolveAgentModel('coherence-reviewer', metadata, {})
  assert.equal(resolution.values.model, 'haiku')
  assert.equal(resolution.values.thinking, 'medium')
})

test('buildPiInvocationArgs includes provider/model/thinking flags correctly', () => {
  assert.deepEqual(
    buildPiInvocationArgs({
      prompt: '/skill:security-reviewer audit auth flow',
      provider: 'openai',
      model: 'gpt-4o',
      thinking: 'high',
    }),
    ['--no-session', '--provider', 'openai', '--model', 'gpt-4o', '--thinking', 'high', '-p', '/skill:security-reviewer audit auth flow'],
  )

  assert.deepEqual(
    buildPiInvocationArgs({
      prompt: '/skill:coherence-reviewer review plan',
      model: 'sonnet:high',
      thinking: 'low',
    }),
    ['--no-session', '--model', 'sonnet:high', '-p', '/skill:coherence-reviewer review plan'],
  )
})
