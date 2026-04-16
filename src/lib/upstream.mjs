import fs from 'node:fs'
import path from 'node:path'
import { parseFrontmatter, renderFrontmatter } from './frontmatter.mjs'
import { inferRoleFromSourcePath, normalizeAgentName, sanitizePromptName } from './model-config.mjs'

export async function buildAdapterFromUpstream({ pluginDir, repoRoot, release = {} }) {
  const skillsDir = path.join(repoRoot, 'skills')
  const promptsDir = path.join(repoRoot, 'prompts')
  const resourcesDir = path.join(repoRoot, 'pi-resources', 'compound-engineering')

  await resetDirectory(skillsDir)
  await resetDirectory(promptsDir)
  await fs.promises.mkdir(resourcesDir, { recursive: true })

  const skillSourceDir = path.join(pluginDir, 'skills')
  const agentSourceDir = path.join(pluginDir, 'agents')
  const pluginManifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json')
  const pluginManifest = JSON.parse(await fs.promises.readFile(pluginManifestPath, 'utf8'))

  const copiedSkills = []
  const generatedPrompts = []
  const generatedAgents = []

  for (const entry of await fs.promises.readdir(skillSourceDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const source = path.join(skillSourceDir, entry.name)
    const target = path.join(skillsDir, entry.name)
    await fs.promises.cp(source, target, { recursive: true })
    copiedSkills.push(entry.name)

    const skillDoc = await fs.promises.readFile(path.join(source, 'SKILL.md'), 'utf8')
    const { data, body } = parseFrontmatter(skillDoc)
    const promptName = sanitizePromptName(data.name || entry.name)
    const promptContent = renderFrontmatter(
      {
        description: data.description || `Compound Engineering prompt wrapper for ${entry.name}`,
        'argument-hint': data['argument-hint'],
        source: `upstream:${path.posix.join('skills', entry.name, 'SKILL.md')}`,
      },
      body,
    )
    await fs.promises.writeFile(path.join(promptsDir, `${promptName}.md`), promptContent)
    generatedPrompts.push(promptName)
  }

  const agentMetadata = {}
  for (const relativeFile of await listFilesRecursive(agentSourceDir, '.md')) {
    const absoluteFile = path.join(agentSourceDir, relativeFile)
    const document = await fs.promises.readFile(absoluteFile, 'utf8')
    const { data, body } = parseFrontmatter(document)
    const sourcePath = path.posix.join('agents', relativeFile.split(path.sep).join('/'))
    const role = data.role || inferRoleFromSourcePath(sourcePath)
    const agentName = normalizeAgentName(data.name || path.basename(relativeFile, '.md'))
    const output = renderFrontmatter(
      {
        name: agentName,
        description: data.description || `Compound Engineering agent ${agentName}`,
        model: data.model,
        role,
        source: `upstream:${sourcePath}`,
      },
      body,
    )

    await fs.promises.writeFile(path.join(skillsDir, `${agentName}.md`), output)
    agentMetadata[agentName] = {
      name: agentName,
      description: data.description || undefined,
      model: data.model || undefined,
      role: role || undefined,
      sourcePath,
    }
    generatedAgents.push(agentName)
  }

  const metadataPath = path.join(resourcesDir, 'agent-metadata.json')
  await fs.promises.writeFile(metadataPath, JSON.stringify(agentMetadata, null, 2) + '\n')

  const mcporterPath = path.join(resourcesDir, 'mcporter.json')
  if (!fs.existsSync(mcporterPath)) {
    await fs.promises.writeFile(mcporterPath, JSON.stringify({ mcpServers: {} }, null, 2) + '\n')
  }

  await updatePackageVersion(path.join(repoRoot, 'package.json'), pluginManifest.version)
  await updateUpstreamLock(path.join(repoRoot, 'upstream.lock.json'), pluginManifest, release)

  return {
    plugin: pluginManifest,
    copiedSkills,
    generatedPrompts,
    generatedAgents,
    metadataPath,
  }
}

async function updatePackageVersion(packagePath, version) {
  const pkg = JSON.parse(await fs.promises.readFile(packagePath, 'utf8'))
  pkg.version = version
  await fs.promises.writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n')
}

async function updateUpstreamLock(lockPath, pluginManifest, release) {
  const lock = JSON.parse(await fs.promises.readFile(lockPath, 'utf8'))
  lock.upstream.version = pluginManifest.version
  if (release.tag) lock.upstream.tag = release.tag
  if (release.commit) lock.upstream.commit = release.commit
  if (release.releaseName) lock.upstream.releaseName = release.releaseName
  if (release.releasedAt) lock.upstream.releasedAt = release.releasedAt
  lock.adapter.generatedAt = new Date().toISOString()
  await fs.promises.writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n')
}

async function resetDirectory(directory) {
  await fs.promises.rm(directory, { recursive: true, force: true })
  await fs.promises.mkdir(directory, { recursive: true })
}

async function listFilesRecursive(root, extension, prefix = '') {
  const results = []
  for (const entry of await fs.promises.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name)
    if (entry.isDirectory()) {
      results.push(...await listFilesRecursive(root, extension, relative))
    } else if (entry.isFile() && relative.endsWith(extension)) {
      results.push(relative)
    }
  }
  return results.sort()
}
