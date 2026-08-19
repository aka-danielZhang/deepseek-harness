# Agent Note: Steering delivery status in the chat flow

Status: implemented

English | [中文](2026-08-19-steering-delivery-status.zh.md)

## Problem

Mid-turn steering (`steer()` joins the running turn's FIFO and is consumed at the next step boundary) was presented dishonestly by the chat flow. `ChatView` rendered the pending steering bubble *after* the turn-level running status, so an interjection visually hung below the "Deep diving..." indicator attached to the pre-interjection content. Readers concluded the agent "never receives" the message: nothing on screen said the message was accepted or when the model would see it. The truth — accepted now, model-visible at the next step boundary, guaranteed unless the turn is cancelled — existed only in the AgentLoop contract.

## Decision

Two presentation changes in `ui-conversation`, no runtime or wire changes:

- **Order.** `ChatView` renders pending steering bubbles *before* the turn status. The flow reads "old content → your interjection → still working", which is the truthful account: the message is inside the running turn, and the turn continues below it. The turn status itself stays a whole-turn signal (no per-step flicker) and still renders last when no steering is pending.
- **Delivery note.** Each pending bubble carries a dim caption under the bubble: `chat.steering.received` ("Received · sends to the model after the current step") while the owning turn runs, `chat.steering.parked` ("Received · sends when the agent next runs") when nothing runs — parked steering can exist after a rejected step, and promising a step boundary there would be false. The note rides the pending projection only: the existing transient→durable handoff (queue retirement on the accepted `user/message`) replaces the whole bubble, so the caption's disappearance is exactly the moment the message becomes model-visible. No new state machine was added; the note is a pure function of the queue snapshot plus the running bit ChatView already subscribes to.

## Alternatives considered

**Interrupt-and-resend on steer (chat-app semantics).** Rejected: it changes the steering contract itself — discarding the in-flight step, reissuing requests, recharging tokens — rather than the presentation of the existing contract. The AgentLoop's non-interrupting FIFO is the intended semantics; the complaint was about honesty of display, not the delivery model.

**Moving the status below the bubble with no note.** Rejected as half-truth: it would read as "the agent is processing my message" while the model has not seen it. The note carries the missing fact.

**A separate pending-status card in the flow.** Rejected: questions and approvals already take over the composer for their waits; a second pending surface would duplicate the bubble that already carries the message.

**CSS-only reorder via a client plugin.** Rejected: pseudo-element captions cannot be localized, read reliably by assistive tech, or follow the `running` bit; and depending on internal class names from outside the package is the coupling the slot system forbids.

## Consequences

Mid-turn interjection reads as joined-into-the-turn with an explicit delivery promise; the promise self-retires at the exact model-visibility boundary. The reorder moves the turn status DOM node when steering arrives or retires (React reconciles the conditional slots by remounting `TurnStatus`), which the component already tolerates: its clock is anchored to the logged `turn/start`, not mount time. A11y and golden order change where pending steering coexists with the running status (`steering`, `steer-all`, `subagent-interrupt` web e2e goldens); snapshots without pending steering are unchanged. The parked wording is deliberately vague about timing because parked steering wakes only on the next follow-up/steer, which the UI cannot predict.

## Related

The pending-steering projection and durable handoff are owned by [ui-conversation](../../../../packages/client/ui-conversation/README.md) and `queue-mirror.ts` in `client/runtime`; the next-step-boundary consumption contract is `Agent.steer()` in `packages/core/agent/src/runtime-types.ts`.
