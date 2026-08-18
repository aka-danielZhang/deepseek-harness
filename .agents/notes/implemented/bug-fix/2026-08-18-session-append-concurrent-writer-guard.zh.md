# Agent Note: 会话 append 复核持久修订值以拒绝跨进程并发写者

Status: implemented

[English](2026-08-18-session-append-concurrent-writer-guard.md) | 中文

## Problem

会话写入路径上的每个单写者防护都只在进程内生效：`prepare()` 通过进程内 `SessionStore` 拒绝第二个存活会话，协调器的冲突逻辑只比较自己的映射表。而 `Session.append` 按内存日志长度分配 `seq`，`appendCore` 只对协调器的内存游标校验批次。因此，共享同一 sessions 根目录的两个 harness 进程（`dsh web` 服务器旁边再跑一个 headless 或第二个服务器）能够向同一 JSONL 日志交错写入。实际观察到的交错是：进程 B 恢复了进程 A 仍持有存活的会话，把构造器的 [`session/end-seed` 边界标记](../architecture/2026-07-30-session-end-seed-log-boundary.md)落盘；A 的陈旧 `Session` 随后为下一个事件分配了相同 seq，此后每个事件在各自视角都局部一致，而文件在已提交区域内出现重复 seq。由于扫描器只在最后一个 `turn/end` 之后才容忍缺口，下一次冷加载会以 `corrupt session log: seq gap in committed region` 拒绝整条日志，会话永久无法加载——错误在写入很久之后才暴露、看起来像磁盘损坏，且重启无济于事。已向上游报告，见 [discussion #3099](https://github.com/deepseek-ai/deepseek-harness/discussions/3099)。SQLite 后端此前已能凭 `PRIMARY KEY (session_id, seq)` 约束大声失败；JSONL 后端没有等效防护。

## Decision

[共享写入协调器](../architecture/2026-06-18-shared-persistence-write-coordinator.md)只在记住的持久修订值处认为自己的每 id 游标有效。`SessionState.revision` 记录游标建立时的源限定修订值——由 `commitPrepared`（其新鲜性校验刚刚钉定该值）和活动前缀接管设置——并在每次 `appendBatch` 成功后通过 `readStoredRevision` 刷新。每次 append 前，`appendCore` 重读修订值，不一致就以指明并发写者的错误拒绝写入。被拒绝的 `appendBatch` 必须保持已存储日志不变（钩子契约现已写明回滚义务），因此失败路径会在调用方重试前重新建立基线：瞬时 I/O 故障不会卡死会话的持久化，既有的回滚重试测试钉住了这一点。该防护以批次为粒度——在同一批次内竞速的外部 append 仍会交错——两个持久化 README 都记录了该窗口。

## Verification

一个共享协调器合约场景用同一存储域上的两个 context 模拟两个进程——一个恢复并发布会话，另一个保持陈旧存活会话——断言陈旧方的 flush 拒绝且已存储日志仍能干净加载；它对 memory、JSONL（两种编码）和 SQLite 后端运行。既有 JSONL 与 zstd 回滚重试测试原样通过，证明回滚过的 append 不会误触发防护。SQLite 事务中回滚测试改为直接调用 `appendBatch` 钩子，因为协调器防护现在合理地先拒绝它原来的服务层场景。

## Alternatives considered

**每会话目录的跨进程锁文件/租约。** 更强——它阻止第二次恢复，而不是事后检测其影响——但带来陈旧锁回收、PID 复用和 Windows 语义问题，并改变第二个进程的行为边界。暂缓；修订值校验已足够大声地指明原因，操作者可以据此行动。

**`appendLines` 内的 JSONL 局部大小检查。** 更小，但把协调逻辑复制进单个后端，契约对协调器其他后端仍然缺位，且无法识别保持大小不变的外部截断重写。

**声明共享根目录不受支持、不做改动。** JSONL README 此前已写明每会话一个写者；没有强制执行，那句话留给用户的只有静默损坏和迟来的隐晦报错。强制执行把已记录的限制变成了行为。

**加载时容忍重复（重编号或丢弃）。** 拒绝：加载器的拒绝是刻意设计；在读取方之下重写持久历史——包括之后每一处 `sourceEventSeqs` 引用——比在写入时拒绝更糟。

## Consequences

跨进程交错现在会在外部写入后的第一次 append 时失败，错误指明原因和处置方式，已存储日志保持可加载；此前它静默损坏，并以不可恢复的已提交区域缺口形式暴露。每个 append 批次多付两次轻量修订值读取。一个批次的检查-写入竞态窗口仍然存在，并已在两个持久化 README 中记录；SQLite 的 `PRIMARY KEY (session_id, seq)` 保留为协调器防护之下的第二道防线。
