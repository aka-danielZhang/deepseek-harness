import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const { rewriteManifest } = await import(new URL('./publish-fork.mjs', import.meta.url).href) as {
  rewriteManifest: (
    source: string, name: string, version: string, versions: Map<string, string>,
    output: string, src: string, workspace: Map<string, string>,
  ) => string
}
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function rewrite(fields: Record<string, unknown>): Record<string, unknown> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-fork-manifest-'))
  roots.push(root)
  const source = join(root, 'package.json')
  const output = join(root, 'staged/package.json')
  writeFileSync(source, JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.2-rc.1', ...fields }))
  rewriteManifest(source, '@deepseek-ai/dsh', '0.1.2-rc.1.zw.2', new Map([
    ['@deepseek-ai/dsh-tool-cordis', '0.1.2-rc.1.zw.2'],
  ]), output, root, new Map([['@deepseek-ai/cordis', '4.0.2']]))
  return JSON.parse(readFileSync(output, 'utf8')) as Record<string, unknown>
}

describe('fork package manifests', () => {
  it.each(['dependencies', 'devDependencies', 'optionalDependencies'])('preserves import names in %s', (field) => {
    const manifest = rewrite({ [field]: { '@deepseek-ai/dsh-tool-cordis': 'workspace:^' } })
    expect(manifest[field]).toEqual({ '@deepseek-ai/dsh-tool-cordis': 'npm:@crazx/dsh-tool-cordis@0.1.2-rc.1.zw.2' })
    expect(manifest.name).toBe('@crazx/dsh')
  })

  it('keeps peer names with a semver requirement on the host-provided fork instance', () => {
    expect(rewrite({ peerDependencies: { '@deepseek-ai/dsh-tool-cordis': 'workspace:^' } }).peerDependencies)
      .toEqual({ '@deepseek-ai/dsh-tool-cordis': '0.1.2-rc.1.zw.2' })
  })

  it('retains peer metadata under the same package name', () => {
    const peerDependenciesMeta = { '@deepseek-ai/dsh-tool-cordis': { optional: true } }
    const manifest = rewrite({ peerDependencies: { '@deepseek-ai/dsh-tool-cordis': 'workspace:^' }, peerDependenciesMeta })
    expect(Object.keys(manifest.peerDependencies as object)).toEqual(Object.keys(peerDependenciesMeta))
    expect(manifest.peerDependenciesMeta).toEqual(peerDependenciesMeta)
  })

  it('keeps vendor versions on their own version line and ordinary dependencies unchanged', () => {
    const manifest = rewrite({ dependencies: { '@deepseek-ai/cordis': 'workspace:^', 'js-yaml': '^4.2.0' } })
    expect(manifest.dependencies).toEqual({ '@deepseek-ai/cordis': '^4.0.2', 'js-yaml': '^4.2.0' })
  })
})
