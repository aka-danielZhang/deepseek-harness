/**
 * Publish the fork-modified packages under the fork scope.
 *
 * Policy (FORK.md「发布纪律」): every source package that diverges from
 * upstream must reach consumers as a published npm version; downstream
 * repos consume npm only. This script materializes that policy:
 *
 * - select the changed packages (git diff upstream/master..master, or the
 *   --all flag for every @deepseek-ai/* package);
 * - rewrite each package.json into a staging copy: scope @deepseek-ai →
 *   the fork scope, version → <upstream>.zw.<N>, cross-references between
 *   fork dependencies retain import names with npm aliases to the fork;
 * - pack from the staging copy (pnpm pack resolves workspace: protocols
 *   from the real tree, so the staging copy packs against live deps);
 * - publish each tarball to the registry with the given dist-tag.
 *
 * Usage: node scripts/publish-fork.mjs <zw-number> [--dist-tag latest]
 *        node scripts/publish-fork.mjs <zw-number> --dry-run
 *        node scripts/publish-fork.mjs --list
 *
 * Auth: NODE_AUTH_TOKEN (or a logged-in local npm). GitHub Actions calls
 * this script from .github/workflows/npm-release.yml.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const UPSTREAM_SCOPE = '@deepseek-ai'
const FORK_SCOPE = process.env.FORK_NPM_SCOPE ?? '@crazx'

/** Package-directory overrides for packages whose dir name ≠ package name. */
const DIR_OVERRIDES = new Map([
  ['@deepseek-ai/dsh', 'apps/cli'],
])

function dirname(p) { return p.split('/').slice(0, -1).join('/') }

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts })
}

function sh(cmd, opts = {}) {
  return execFileSync(cmd, [cmd.endsWith('.sh') ? cmd : cmd], { encoding: 'utf8', shell: true, ...opts })
}

/** Package name → directory for every workspace @deepseek-ai/* package. */
function workspacePackages() {
  const list = JSON.parse(run('pnpm', ['ls', '-r', '--json', '--depth', '-1']))
  const map = new Map()
  for (const entry of list) {
    const name = entry.name
    if (!name?.startsWith(UPSTREAM_SCOPE + '/')) continue
    map.set(name, resolve(entry.path))
  }
  return map
}

/** The fork-modified package set: source dirs of the diff vs upstream. */
function changedPackages(all) {
  const base = run('git', ['merge-base', 'HEAD', 'upstream/master']).trim()
  const files = run('git', ['diff', '--name-only', base, 'HEAD']).split('\n')
  // Source-only filter: composition ymls and docs change without a publish
  // obligation; a package joins the set only when its src/ (or the package
  // itself) diverges.
  const sourceFiles = files.filter(f => /^packages\/[^/]+\/[^/]+\/(src|lib)\//.test(f) || f.startsWith('apps/cli/'))
  // Package roots differ by shape: packages/<a>/<b>/pkg vs apps/<app>. Derive
  // each root from the file by trimming the known tails.
  const topDirs = new Set(sourceFiles.map(f => {
    if (f.startsWith('apps/')) return f.split('/').slice(0, 2).join('/')
    return f.split('/').slice(0, 3).join('/')
  }))
  const selected = []
  for (const [name, dir] of all) {
    const overrideDir = DIR_OVERRIDES.get(name)
    if (overrideDir !== undefined) {
      if (topDirs.has(overrideDir) || topDirs.has(overrideDir.split('/').slice(0, 2).join('/'))) selected.push(name)
      continue
    }
    if (topDirs.has(dir.slice(repoRoot.length + 1))) selected.push(name)
  }
  return selected
}

/**
 * Rewrite a manifest without changing the names used by built imports and YAML rows.
 * @param {string} pkgJson - Source manifest path.
 * @param {string} name - Original package name.
 * @param {string} version - Published version of this package.
 * @param {Map<string, string>} versionOf - Published versions by original package name.
 * @param {string} stagingPath - Destination manifest path.
 * @param {string} src - Source package directory.
 * @param {Map<string, string>} workspaceVersions - Original workspace versions.
 * @returns {string} Published package name.
 */
export function rewriteManifest(pkgJson, name, version, versionOf, stagingPath, src, workspaceVersions) {
  const manifest = JSON.parse(readFileSync(pkgJson, 'utf8'))
  const upstreamVersion = manifest.version
  const renamed = `${FORK_SCOPE}/${name.slice(UPSTREAM_SCOPE.length + 1)}`
  manifest.name = renamed
  manifest.version = version
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = manifest[field]
    if (deps === undefined) continue
    for (const [dep, spec] of Object.entries(deps)) {
      if (versionOf.has(dep)) {
        // Peers require semver, not npm aliases; the host supplies the same
        // fork instance under its original import name.
        const targetVersion = versionOf.get(dep)
        deps[dep] = field === 'peerDependencies'
          ? targetVersion
          : `npm:${FORK_SCOPE}/${dep.slice(UPSTREAM_SCOPE.length + 1)}@${targetVersion}`
      } else if (typeof spec === 'string' && spec.startsWith('workspace:')) {
        // Non-fork workspace dep: keep the protocol's range shape against the
        // TARGET package's real published version — vendor-line packages
        // (cordis 4.x, schemastery 3.x, cordis-plugin-* 1.x) carry their own
        // version lines on npm; pinning them to the fork's upstream-line
        // version publishes unsatisfiable ranges that peer edges then resolve
        // against the registry (overrides cannot reach peers), breaking
        // standalone installs of the @crazx set (zw.3 schemastery incident).
        const op = spec.replace('workspace:', '').replace(/[^~^]/g, '')
        const target = workspaceVersions.get(dep) ?? upstreamVersion
        deps[dep] = `${op === '' ? '' : op}${target}`
      }
    }
  }
  if (manifest.repository?.url?.includes('deepseek-ai')) {
    manifest.repository = {
      ...manifest.repository,
      url: manifest.repository.url.replace('github.com/deepseek-ai/deepseek-harness', 'github.com/aka-danielZhang/deepseek-harness'),
    }
  }
  manifest.publishConfig = { ...manifest.publishConfig, access: 'public' }
  mkdirSync(dirname(stagingPath), { recursive: true })
  writeFileSync(stagingPath, JSON.stringify(manifest, null, 2) + '\n')
  return renamed
}

async function main() {
  const args = process.argv.slice(2)
  const listOnly = args.includes('--list')
  const dryRun = args.includes('--dry-run')
  const distTagIdx = args.indexOf('--dist-tag')
  const distTag = distTagIdx !== -1 ? args[distTagIdx + 1] : 'latest'
  const zw = args.find(a => /^\d+$/.test(a))

  const all = workspacePackages()
  // name -> real published version for every workspace package: workspace:
  // deps of vendor-line packages (cordis, schemastery, plugin-*) must rewrite
  // against their own version lines, not the fork's upstream-line version.
  const workspaceVersions = new Map()
  for (const [nme, dir] of all) {
    workspaceVersions.set(nme, JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')).version)
  }
  const selected = args.includes('--all') ? [...all.keys()] : changedPackages(all)

  if (listOnly) {
    console.log(`fork-modified packages (${selected.length}):`)
    for (const name of selected.sort()) console.log(' ', name)
    return
  }
  if (zw === undefined) {
    console.error('publish-fork: zw patch number required (e.g. `node scripts/publish-fork.mjs 1`)')
    process.exit(1)
  }

  // Both local and CI publication must preserve the names consumers import.
  run('pnpm', ['exec', 'vitest', 'run', 'scripts/publish-fork.spec.ts'])

  // Upstream base version: every fork package carries it in package.json
  // today (one workspace, one rc line). The zw tag spells the baseline
  // (v<base>+zw.<N>) and the workflow passes it as --base; without it, fall
  // back to requiring one common base across the set. Fail loud on drift.
  const baseIdx = args.indexOf('--base')
  const expectedBase = baseIdx !== -1 ? args[baseIdx + 1] : undefined
  const versionOf = new Map()
  let commonBase
  for (const name of selected) {
    const manifest = JSON.parse(readFileSync(resolve(all.get(name), 'package.json'), 'utf8'))
    const base = manifest.version
    if (expectedBase !== undefined) {
      if (base !== expectedBase) {
        console.error(`publish-fork: unexpected base version for ${name}: ${base} (tag/manifest drift; expected ${expectedBase})`)
        process.exit(1)
      }
    } else if (commonBase === undefined) {
      commonBase = base
    } else if (base !== commonBase) {
      console.error(`publish-fork: unexpected base version for ${name}: ${base} (the set spans more than one upstream line; pin with --base)`)
      process.exit(1)
    }
    versionOf.set(name, `${base}.zw.${zw}`)
  }

  const staging = resolve(repoRoot, '.publish-staging')
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })

  const renamedOf = new Map()
  for (const name of selected) {
    const src = all.get(name)
    const rel = src.slice(repoRoot.length + 1)
    const dst = resolve(staging, rel)
    // Pack the REAL package first (workspace protocols resolve), then splice
    // the rewritten manifest in: stage a full copy for manifest rewriting,
    // but pack from the real tree with a temporary manifest swap.
    cpSync(src, dst, { recursive: true, filter: p => !p.includes('/node_modules/') && !p.includes('/lib/') })
    const renamed = rewriteManifest(resolve(src, 'package.json'), name, versionOf.get(name), versionOf, resolve(dst, 'package.json'), src, workspaceVersions)
    renamedOf.set(name, { renamed, stagingDir: dst })
  }

  console.log(`publish-fork: ${selected.length} package(s) as ${FORK_SCOPE}/* version *.zw.${zw}, dist-tag ${distTag}${dryRun ? ' (dry run)' : ''}`)
  for (const name of selected) {
    const { renamed, stagingDir } = renamedOf.get(name)
    // Pack from the STAGING copy: it needs lib/ from the built real tree.
    const real = all.get(name)
    cpSync(resolve(real, 'lib'), resolve(stagingDir, 'lib'), { recursive: true })
    const out = run('pnpm', ['pack', '--pack-destination', staging], { cwd: stagingDir })
    const tgz = out.trim().split('\n').pop()
    const tarball = resolve(staging, basename(tgz))
    if (dryRun) {
      console.log(`  [dry] ${renamed}@${versionOf.get(name)} -> ${basename(tarball)}`)
      continue
    }
    // Idempotent: a rerun after a partial publish skips what the registry
    // already holds (npm refuses republishing a version — that E403 aborts
    // the whole run otherwise).
    const version = versionOf.get(name)
    try {
      run('npm', ['view', `${renamed}@${version}`, 'version'], { stdio: 'pipe' })
      console.log(`  skip ${renamed}@${version} (already published)`)
      continue
    } catch {
      // Not on the registry yet — publish below.
    }
    run('npm', ['publish', tarball, '--access', 'public', '--tag', distTag])
    console.log(`  published ${renamed}@${version}`)
  }
  if (!dryRun) rmSync(staging, { recursive: true, force: true })
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main()
