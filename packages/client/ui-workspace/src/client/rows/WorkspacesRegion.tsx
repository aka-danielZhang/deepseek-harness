/**
 * The browsing region wrapper: the stock browser as the 「work」 tab, and a
 * composed alternate view (registered by an out-of-tree plugin into
 * `sidebar.workspaces.alternate`) as the further tab. With no alternate the
 * wrapper renders the browser directly — the region is byte-identical to the
 * stock one.
 *
 * The tab strip is a segmented pill styled as native sidebar chrome (32px row,
 * tokens only). The active tab follows the on-screen conversation: a Session
 * whose `agentPreset` projection resolves to the alternate's own domain (the
 * plugin's identity, e.g. a Quno main) activates the alternate; any other
 * Session — a stock 新会话 among them — returns to work. Until the projection
 * resolves, the current tab simply stays.
 *
 * @module @deepseek-ai/dsh-client-ui-workspace/rows/workspaces-region
 */

import { useEffect, useRef, useState } from 'react'
import { IconWorkspaceTreeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspacesRegionProps } from '../contract/slots.ts'
import { WorkspaceBrowser } from './WorkspaceBrowser.tsx'
import css from './WorkspacesRegion.module.css'

/** Render the region: the tab strip beside the alternate seat, else the browser. */
export function WorkspacesRegion(props: WorkspacesRegionProps) {
  const { useAlternate, wide, expandSidebar, renderSlot, t, useSessions } = props
  const meta = useAlternate(value => value)
  const [activeAlternate, setActiveAlternate] = useState(false)
  // A disposed alternate (plugin unload, master switch) must not leave the
  // region on a tab that no longer renders: fall back to the browser.
  useEffect(() => {
    if (!meta.occupied && activeAlternate) setActiveAlternate(false)
  }, [meta.occupied, activeAlternate])

  // The on-screen (mainView) conversation and its resolved preset, as
  // primitives so the selector hooks stay snapshot-stable.
  const mainViewId = useSessions((state) => {
    for (const row of Object.values(state.byId)) {
      if ((row.retainedBy.mainView ?? 0) > 0) return row.id
    }
    return undefined
  })
  const mainViewPreset = useSessions((state) => {
    for (const row of Object.values(state.byId)) {
      if ((row.retainedBy.mainView ?? 0) > 0) {
        const value = row.projectionValues?.agentPreset
        // Resolved-none collapses to '' so the follow can act on it; a
        // pending projection stays undefined and merely defers the decision.
        return typeof value === 'string' ? value : value === null ? '' : undefined
      }
    }
    return undefined
  })

  // Tab follows the on-screen conversation once per Session identity, and only
  // after the preset resolved (a pending projection defers, never misfires).
  const followed = useRef<{ readonly id?: string }>({})
  useEffect(() => {
    if (mainViewId === undefined || followed.current.id === mainViewId) return
    if (mainViewPreset === undefined) return
    followed.current = { id: mainViewId }
    setActiveAlternate(meta.occupied && mainViewPreset === 'quno')
  }, [mainViewId, mainViewPreset, meta.occupied])

  const showAlternate = meta.occupied && activeAlternate

  if (!meta.occupied) return <WorkspaceBrowser {...props} />

  if (!wide) {
    return (
      <div className={css.railSwitch}>
        <button
          type="button"
          className={css.railButton}
          aria-label={t('tabs.work')}
          title={t('tabs.work')}
          data-active={!showAlternate || undefined}
          onClick={() => { setActiveAlternate(false); expandSidebar() }}
        >
          <IconWorkspaceTreeOutlineRegular size={16} />
        </button>
        <button
          type="button"
          className={css.railButton}
          aria-label={meta.label()}
          title={meta.label()}
          data-active={showAlternate || undefined}
          onClick={() => { setActiveAlternate(true); expandSidebar() }}
        >
          <span className={css.glyph} aria-hidden="true">{glyphOf(meta.label())}</span>
        </button>
      </div>
    )
  }

  return (
    <div className={css.region}>
      <div className={css.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={!showAlternate}
          className={css.tab}
          data-active={!showAlternate || undefined}
          onClick={() => { setActiveAlternate(false) }}
        >
          <IconWorkspaceTreeOutlineRegular size={14} />
          <span>{t('tabs.work')}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={showAlternate}
          className={css.tab}
          data-active={showAlternate || undefined}
          onClick={() => { setActiveAlternate(true) }}
        >
          <span className={css.glyph} aria-hidden="true">{glyphOf(meta.label())}</span>
          <span>{meta.label()}</span>
        </button>
      </div>
      <div className={css.body}>
        {showAlternate
          ? renderSlot('sidebar.workspaces.alternate', { active: true })
          : <WorkspaceBrowser {...props} />}
      </div>
    </div>
  )
}

function glyphOf(label: string): string {
  const trimmed = label.trim()
  return trimmed === '' ? '?' : trimmed.charAt(0).toUpperCase()
}
