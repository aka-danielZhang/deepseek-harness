# Agent Note: Basic compaction 回退到有界层次摘要

Status: implemented

[English](2026-08-22-bounded-hierarchical-compaction-fallback.md) | 中文

## Problem

默认压缩后端会选择一个有界会话区域，但随后用一次辅助请求摘要整个区域。因此，一段历史可能已经超过会话模型的压力阈值，同时仍大于摘要模型自身的上下文窗口。Provider 返回 `CONTEXT_WINDOW_EXCEEDED`，自动 listener 记录失败后继续，不会落下检查点，而下一次请求会再次携带同一段超大历史。安装一个出树 hierarchy Provider 并不能修正默认行为，因为 shipped 和 user preset 仍在各自隔离的 compaction realm 中挂载 `@deepseek-ai/dsh-compaction-basic`。

现有的[前缀 cache 决策](../../archived/bug-fix/2026-07-21-compaction-summary-prefix-cache-reuse.md)对于能够装入的请求仍然有价值。把每次摘要都替换成 map-reduce 虽然能修复溢出，却会不必要地增加调用、削弱热前缀复用，并改变既有 one-shot 请求契约。

## Decision

`@deepseek-ai/dsh-compaction-basic` 保留既有 one-shot 摘要器作为首选路径，并在内部拥有有界层次回退。Preset 继续零配置挂载同一个 Provider；不改写任何 shipped 或 user composition。

满足任一条件时启动回退：

- 估算的 one-shot 输入加上已配置的 `maxTokens` 无法装入已解析摘要目标的上下文窗口；
- 能够装入的 one-shot 请求返回规范的 `CONTEXT_WINDOW_EXCEEDED`。

没有声明 `contextWindow` 的适配器仍接收旧 one-shot 请求。请求成功时完全兼容；如果它溢出，压缩会报告有界恢复需要容量元数据，而不是猜测 chunk 大小。

### 有界 hierarchy

Map 规划会把按时间排序的消息分组为绝不拆开工具调用及其结果的单元，再扣除固定 system、可选 tools、指令和输出预留后，在 `floor(contextWindow * chunkInputRatio)` 内贪心装箱。每个 map 输出使用固定检查点 section 协议，并携带稳定的一基 source-unit 坐标。

Reduce 轮次在同一有界输入规则下消费按顺序排列的 `<partial-summary>` 消息，直到只剩一个检查点。Provider 已确认的上下文溢出只会在工具配对平衡边界二分被拒绝的 map 或 reduce span。成功 sibling 会继续保留，绝不会仅因另一个 span 失败而重放。`maxDepth` 和显式无进展检查共同限制递归。

每个 stage 都拒绝图片输出、缺失标题、截断、取消和非规范 Provider 失败。Provider 拒绝的原子 source 或 partial 会报告不可分溢出。现有 region transaction 拥有持久变更，因此任何部分 hierarchy 结果都不会进入会话表层。

### 配置与来源

Hierarchy 字段是普通策略字段，可由精确 provider/model 配置项覆盖：

- `chunkInputRatio: 0.6`
- `mapMaxTokens: 4096`
- `reduceMaxTokens: 8192`
- `maxDepth: 4`
- `replayTools: false`

能够装入的 one-shot 继续使用 `maxTokens`。Hierarchy stage 上限单独配置，因为 map 和 reduce 输出承担不同的成本与收敛角色。默认省略工具 schema，为源消息保留空间；严格 Provider 可以选择开启回放。

`llmStreamCall: true` 继续表示恰好有一次成功调用经过当前上下文的 `ctx.llm.stream()`，并带有完整 `rawOutput`。多调用结果和发生过失败尝试后的恢复不会设置该标记。只有每个成功 stage 都报告 usage 且没有失败模型尝试时才进行汇总；最终 `rawOutput` 只表示最终 stage 输出，不是人工拼接的所有调用输出。

## Alternatives considered

- **把 preset 行替换为出树 hierarchy Provider**——否决：安装并不会挂载 preset-owned Provider，user preset 具有独立所有权，而且修改每个当前与未来 composition 会把产品默认行为重复放在错误层。
- **始终使用 map-reduce**——否决：能够装入的请求已有经过测试、可复用 cache 的 one-shot 路径。为小历史支付多次调用并放弃前缀一致性没有必要。
- **以更小输出上限重试同一个 one-shot**——否决：已观察到的失败来自超大输入。降低输出上限无法让任意大的回放变得有界，并会增加截断风险。
- **在摘要前截断或抽样所选历史**——否决：静默丢失 source 会违反检查点保真度，还可能拆开工具语义。结构化、按时间排序的 map-reduce 会保留显式 source coverage。
- **增量提交 map 检查点**——否决：后续 stage 失败会暴露不完整的持久检查点。现有全有或全无 region transaction 仍是正确的变更所有者。

## Consequences

- 每个已经挂载 `@deepseek-ai/dsh-compaction-basic` 的 preset 无需 composition 变更即可获得超大历史恢复。
- 能够装入的请求保留此前 cache note 所记录的 one-shot 消息形状、`maxTokens`、目标优先级、错误、输出投影与热前缀行为。本 note 是对该决策的部分扩展，而非完全取代。
- 超大压缩可能消耗多次 Provider 调用，并且通常具有更弱的 KV Cache 复用。它以调用成本换取请求大小必然取得进展。
- 严格结构化输出使 hierarchy 在任一 stage 无法生成完整检查点时 fail closed。自动压力处理会像以前一样保留最新持久表层并记录运行失败。
- 聚焦 Vitest 覆盖配置校验、one-shot 兼容、工具配对规划、map-reduce 收敛、自适应局部二分、深度／无进展边界、取消、结构错误／截断／视觉输出、模型策略覆盖，以及诚实的来源／usage。修改后的包继续满足仓库逐文件 100% 覆盖门。
