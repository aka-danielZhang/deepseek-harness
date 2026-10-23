// @vitest-environment jsdom
/**
 * The work/alternate region assembly on SlotTestRuntime (real apply, the
 * WorkspacesRegion occupying the sidebar hole): with no alternate the region
 * is the stock browser verbatim; registering an alternate raises the
 * 「work / Quno」 strip and swaps the bodies; disposing the alternate falls
 * back to the browser from either tab.
 */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'

// The shipped Chinese copy is the assertion currency (see rename-assembly).
usePinnedBrowserLanguages('zh-CN')

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

async function createRuntime(): Promise<SlotTestRuntime> {
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('shortcuts', { register: () => () => {}, catalog: createSnapshotStore([]) })
  runtime.ctx.provide('layout', { selectPanel: vi.fn(), beginNavigation: () => new AbortController().signal })
  runtime.releaseWorkspaceSource()
  runtime.remote.provideNamespaces({ directoryPicker: {} })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  return runtime
}

type FrameProps = PropsRenderSlots<'sidebar.workspaces'>
function RegionFrame({ renderSlot }: FrameProps) {
  return renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} })
}

async function mountRegion(): Promise<SlotTestRuntime> {
  const runtime = await createRuntime()
  onTestFinished(() => runtime.ctx.fiber.dispose())
  await runtime.root.declare(
    { 'sidebar.workspaces': { kind: 'single', scope: 'root' } } as never,
    RegionFrame as never,
  )
  await runtime.mount({ inject: [...inject], apply })
  runtime.renderRoot()
  await waitFor(() => {
    // The stock browser's section header is on screen.
    expect(document.body.textContent).toContain('工作区')
  })
  return runtime
}

describe('WorkspacesRegion', () => {
  it('renders the stock browser verbatim while no alternate is registered', async () => {
    await mountRegion()
    expect(document.querySelector('[role="tablist"]')).toBeNull()
  })

  it('raises the tab strip with the alternate, swaps bodies, and falls back on dispose', async () => {
    const runtime = await mountRegion()
    const disposeAlternate = runtime.ctx.slots.inject('sidebar.workspaces.alternate', () => runtime.ctx.slots.register(
      { name: 'sidebar.workspaces.alternate', id: 'quno', order: 10, label: 'Quno' },
      () => <div data-testid="quno-alternate">Quno 视图</div>,
    ))
    await waitFor(() => {
      expect(document.querySelector('[role="tablist"]')).not.toBeNull()
    })
    const strip = document.querySelector('[role="tablist"]')!
    expect(strip.textContent).toContain('work')
    expect(strip.textContent).toContain('Quno')
    // The browser tab is active first: the stock header is still on screen and
    // the alternate body is not mounted.
    expect(document.body.textContent).toContain('工作区')
    expect(document.querySelector('[data-testid="quno-alternate"]')).toBeNull()

    act(() => { fireEvent.click(strip.querySelectorAll('[role="tab"]')[1]!) })
    await waitFor(() => {
      expect(document.querySelector('[data-testid="quno-alternate"]')).not.toBeNull()
    })
    expect(document.body.textContent).not.toContain('工作区')

    // Disposing the alternate from the active tab falls back to the browser
    // and removes the strip.
    act(() => { disposeAlternate() })
    await waitFor(() => {
      expect(document.querySelector('[role="tablist"]')).toBeNull()
      expect(document.querySelector('[data-testid="quno-alternate"]')).toBeNull()
    })
    expect(document.body.textContent).toContain('工作区')
  })

  it('follows the on-screen conversation: a stock 新会话 returns to work, a quno main re-activates the alternate', async () => {
    const runtime = await mountRegion()
    await runtime.ctx.slots.inject('sidebar.workspaces.alternate', () => runtime.ctx.slots.register(
      { name: 'sidebar.workspaces.alternate', id: 'quno', order: 10, label: 'Quno' },
      () => <div data-testid="quno-alternate">Quno 视图</div>,
    ))
    await waitFor(() => {
      expect(document.querySelector('[role="tablist"]')).not.toBeNull()
    })
    const tabs = () => document.querySelectorAll('[role="tab"]')
    const alternateSelected = () => tabs()[1]!.getAttribute('aria-selected') === 'true'

    // Open the alternate tab, then create a stock session (新会话 semantics:
    // a new non-quno Session takes the main view) — the strip returns to work.
    act(() => { fireEvent.click(tabs()[1]!) })
    await waitFor(() => expect(document.querySelector('[data-testid="quno-alternate"]')).not.toBeNull())
    await runtime.sessions.add({ id: 's-new' })
    await runtime.sessions.setProjection('s-new', 'agentPreset', null)
    // The main view holds exactly one Session: moving it means releasing the
    // previous mainView retention, as the shell does.
    const firstRef = runtime.sessions.retainFor(runtime.ctx, 's-new' as never, { source: 'mainView' })
    await act(async () => { await Promise.resolve() })
    await waitFor(() => expect(alternateSelected()).toBe(false))
    expect(document.querySelector('[data-testid="quno-alternate"]')).toBeNull()

    // The main view becoming a Quno main (preset projection 'quno') re-activates
    // the alternate tab.
    await runtime.sessions.add({ id: 's-quno' })
    await runtime.sessions.setProjection('s-quno', 'agentPreset', 'quno')
    await act(async () => {
      firstRef.release()
      runtime.sessions.retainFor(runtime.ctx, 's-quno' as never, { source: 'mainView' })
      await Promise.resolve()
    })
    await waitFor(() => expect(alternateSelected()).toBe(true))
    expect(document.querySelector('[data-testid="quno-alternate"]')).not.toBeNull()
  })
})
