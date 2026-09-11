/**
 * web-log — fork-local `dsh web` boot with stdout/stderr persisted to a log
 * file, exposed as the launcher subcommands `dsh web:log` / `dsh web:log:tmp`.
 *
 * The boot runs as a child process re-invoking this very bin (`dsh web …`),
 * so the tee is byte-exact and the logging wrapper never shares a process —
 * or a crash — with the harness. Per launch one `web-<timestamp>.log` file is
 * written, with a `web-latest.log` symlink alongside always naming the newest.
 * @module @deepseek-ai/dsh/web-log
 */

import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/** One logged web boot, as parsed from the launcher command line. */
export interface WebLogOptions {
  /** Log under the OS temp dir instead of $DSH_HOME/logs. */
  readonly tmp: boolean
  /** Extra patch-list overlays, forwarded to `dsh web --patch`. */
  readonly patches: readonly string[]
  /** Web-app arguments, forwarded verbatim. */
  readonly args: readonly string[]
}

/**
 * Resolve the log directory: `DSH_WEB_LOG_DIR` wins; otherwise the tmp variant
 * falls to the OS temp dir (auto-reaped) and the default to `$DSH_HOME/logs`.
 * @param env - the environment to read; injectable for tests.
 * @param tmp - whether the OS temp dir is the fallback.
 * @returns the directory this launch's log file belongs in.
 */
export function resolveLogDir(env: NodeJS.ProcessEnv, tmp: boolean): string {
  if (env.DSH_WEB_LOG_DIR !== undefined && env.DSH_WEB_LOG_DIR !== '') return env.DSH_WEB_LOG_DIR
  if (tmp) return join(env.TMPDIR ?? tmpdir(), 'dsh-web-logs')
  return join(env.DSH_HOME ?? join(homedir(), '.dsh'), 'logs')
}

/**
 * The `yyyymmdd-HHMMSS` name stamp for one launch's log file.
 * @param now - the launch time to format.
 * @returns the zero-padded local-time stamp.
 */
export function logStamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/**
 * Boot `dsh web` as a child of this bin, teeing its combined output to the
 * console and the log file, and exit with the child's code. Never returns:
 * the child's exit (or a spawn failure) ends this process.
 * @param options - the parsed `web:log` invocation: the log-dir variant and
 *   the flags forwarded to `dsh web`.
 */
export function runWebLog(options: WebLogOptions): void {
  const dir = resolveLogDir(process.env, options.tmp)
  mkdirSync(dir, { recursive: true })
  const log = join(dir, `web-${logStamp(new Date())}.log`)
  // `ln -sfn`: replace whatever web-latest.log pointed at before this launch.
  rmSync(join(dir, 'web-latest.log'), { force: true })
  symlinkSync(log, join(dir, 'web-latest.log'))
  const stream = createWriteStream(log, { flags: 'a' })

  const bin = process.argv[1]
  if (bin === undefined) throw new Error('dsh web:log: no entry script to re-invoke')
  const argv = [
    ...process.execArgv,
    bin,
    'web',
    ...options.patches.flatMap(patch => ['--patch', patch]),
    ...options.args,
  ]
  const child = spawn(process.execPath, argv, { stdio: ['inherit', 'pipe', 'pipe'] })
  const header = `[web-log] ${new Date().toISOString()} starting (pid: ${child.pid ?? '?'}, log: ${log})\n`
  process.stdout.write(header)
  stream.write(header)
  child.stdout.on('data', (chunk: Buffer | string) => {
    process.stdout.write(chunk)
    stream.write(chunk)
  })
  child.stderr.on('data', (chunk: Buffer | string) => {
    process.stderr.write(chunk)
    stream.write(chunk)
  })
  // Ctrl-C and termination reach the harness, not this thin wrapper.
  const forward = (signal: NodeJS.Signals): void => { child.kill(signal) }
  process.on('SIGINT', forward.bind(null, 'SIGINT'))
  process.on('SIGTERM', forward.bind(null, 'SIGTERM'))
  let finished = false
  const finish = (code: number): void => {
    if (finished) return
    finished = true
    stream.end(() => process.exit(code))
  }
  child.on('error', (error: Error) => {
    process.stderr.write(`[web-log] failed to spawn dsh web: ${error.message}\n`)
    finish(1)
  })
  // 'close', not 'exit': the stdio streams are drained by then, so the crash
  // tail a logged boot exists to capture cannot be cut off by an early end.
  child.on('close', (code: number | null) => {
    finish(code ?? 1)
  })
}
