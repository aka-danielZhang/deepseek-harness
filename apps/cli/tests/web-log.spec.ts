import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { logStamp, resolveLogDir } from '../src/web-log.ts'

describe('resolveLogDir', () => {
  it('lets DSH_WEB_LOG_DIR win over both variants', () => {
    expect(resolveLogDir({ DSH_WEB_LOG_DIR: '/custom' }, false)).toBe('/custom')
    expect(resolveLogDir({ DSH_WEB_LOG_DIR: '/custom' }, true)).toBe('/custom')
    expect(resolveLogDir({ DSH_WEB_LOG_DIR: '' }, false)).toBe(join(homedir(), '.dsh', 'logs'))
  })

  it('falls to $DSH_HOME/logs by default and the OS temp dir for the tmp variant', () => {
    expect(resolveLogDir({ DSH_HOME: '/home' }, false)).toBe(join('/home', 'logs'))
    expect(resolveLogDir({}, false)).toBe(join(homedir(), '.dsh', 'logs'))
    expect(resolveLogDir({ TMPDIR: '/var/tmp' }, true)).toBe(join('/var/tmp', 'dsh-web-logs'))
    expect(resolveLogDir({}, true)).toBe(join(tmpdir(), 'dsh-web-logs'))
  })
})

describe('logStamp', () => {
  it('formats yyyymmdd-HHMMSS with zero padding', () => {
    expect(logStamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102-030405')
    expect(logStamp(new Date(2026, 11, 31, 23, 59, 58))).toBe('20261231-235958')
  })
})
