/**
 * The browsing region wrapper: the stock browser as the 「work」 tab, and a
 * composed alternate view (registered by an out-of-tree plugin into
 * `sidebar.workspaces.alternate`) as the further tab. With no alternate the
 * wrapper renders the browser directly — the region is byte-identical to the
 * stock one.
 *
 * The tab strip exists only while the alternate seat is occupied; its label
 * re-reads per render from the seat meta, so a localized label follows the
 * active locale without re-registration.
 *
 * @module @deepseek-ai/dsh-client-ui-workspace/rows/workspaces-region
 */

import { useEffect, useState } from 'react'
import type { WorkspacesRegionProps } from '../contract/slots.ts'
import { WorkspaceBrowser } from './WorkspaceBrowser.tsx'
import css from './WorkspacesRegion.module.css'

/** Render the region: the tab strip beside the alternate seat, else the browser. */
export function WorkspacesRegion(props: WorkspacesRegionProps) {
  const { useAlternate, wide, expandSidebar, renderSlot, t } = props
  const meta = useAlternate(value => value)
  const [activeAlternate, setActiveAlternate] = useState(false)
  // A disposed alternate (plugin unload, master switch) must not leave the
  // region on a tab that no longer renders: fall back to the browser.
  useEffect(() => {
    if (!meta.occupied && activeAlternate) setActiveAlternate(false)
  }, [meta.occupied, activeAlternate])
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
          <span className={css.glyph} aria-hidden="true">W</span>
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
          {t('tabs.work')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={showAlternate}
          className={css.tab}
          data-active={showAlternate || undefined}
          onClick={() => { setActiveAlternate(true) }}
        >
          {meta.label()}
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
