# Agent Note: Session appends re-check the durable revision to refuse concurrent cross-process writers

Status: implemented

English | [中文](2026-08-18-session-append-concurrent-writer-guard.zh.md)

## Problem

Every single-writer guard on the session write path was per-process: `prepare()` refuses a second live session through the in-process `SessionStore`, and the coordinator's collision logic compares its own maps. Meanwhile `Session.append` assigns `seq` from the in-memory log length, and `appendCore` validated batches only against the coordinator's in-memory cursor. Two harness processes sharing one sessions root (a `dsh web` server beside a headless run or a second server) could therefore interleave appends to one JSONL log. The concretely observed interleave: process B resumed a session that process A still held live, persisting the constructor's [`session/end-seed` boundary marker](../architecture/2026-07-30-session-end-seed-log-boundary.md); A's stale `Session` later assigned the same seq to its next event, and every following event stayed locally consistent while the file ended up with a duplicate seq inside the committed region. Because the scanner tolerates gaps only after the last `turn/end`, the next cold load rejected the whole log with `corrupt session log: seq gap in committed region`, and the session became permanently unloadable — the error surfaced long after the write, looked like disk damage, and no restart could help. Reported upstream as [discussion #3099](https://github.com/deepseek-ai/deepseek-harness/discussions/3099). The SQLite backend already failed loud here through its `PRIMARY KEY (session_id, seq)` constraint; the JSONL backend had no equivalent.

## Decision

The [shared write coordinator](../architecture/2026-06-18-shared-persistence-write-coordinator.md) treats its per-id cursor as valid only at a remembered durable revision. `SessionState.revision` records the source-qualified revision at which the cursor was established — set by `commitPrepared` (whose freshness check just pinned it) and by live-prefix adoption — and is refreshed from `readStoredRevision` after every successful `appendBatch`. Before each append, `appendCore` re-reads the revision and, on mismatch, rejects with an error naming a concurrent writer instead of writing. A rejected `appendBatch` must leave the stored log unchanged (the hook contract now states this rollback obligation), so the failure path re-establishes the baseline before the caller's retry: a transient I/O failure does not wedge a session's durability, which the pre-existing rollback-retry tests pin. The guard is batch-granular — a foreign append racing inside one batch still interleaves — and both persistence READMEs record that window.

## Verification

A shared coordinator-contract scenario emulates two processes as two contexts over one storage scope — one resumes and publishes while the other keeps a stale live session — and asserts the stale flush rejects and the stored log still loads cleanly; it runs against the memory, JSONL (both encodings), and SQLite backends. The existing JSONL and zstd rollback-retry tests pass unchanged, proving a rolled-back append does not trip the guard. The SQLite mid-transaction rollback test now calls the `appendBatch` hook directly, because the coordinator guard legitimately refuses its former service-level scenario first.

## Alternatives considered

**A cross-process lockfile/lease per session directory.** Stronger — it prevents the second resume rather than detecting its effect — but brings stale-lock reclamation, PID reuse, and Windows semantics, and changes what a second process may do at all. Deferred; the revision check names the cause loudly enough for an operator to act.

**A JSONL-local size check in `appendLines`.** Smaller, but duplicates coordination inside one backend, leaves the contract unspoken for the coordinator's other backends, and cannot see a foreign truncate-and-rewrite that preserves size.

**Declare shared roots unsupported and change nothing.** The JSONL README already said one writer per session; unenforced, that sentence left users with silent corruption and a cryptic late error. Enforcement converts the documented limitation into behavior.

**Tolerate the duplicate at load time (renumber or drop).** Rejected: the loader's refusal is deliberate, and rewriting durable history — including every later `sourceEventSeqs` reference — under a reader is worse than refusing the write.

## Consequences

A cross-process interleave now fails at the first append after the foreign write, with an error that names the cause and the remedy, and the stored log stays loadable; previously it corrupted silently and surfaced as an unrecoverable committed-region gap. Each append batch pays two extra lightweight revision reads. The one-batch check-then-write window remains and is documented in both persistence READMEs; SQLite's `PRIMARY KEY (session_id, seq)` stays as the second line of defense beneath the coordinator guard.
