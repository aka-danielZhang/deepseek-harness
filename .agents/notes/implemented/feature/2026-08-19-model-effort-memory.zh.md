# Agent Note: 按路由记忆推理等级

Status: implemented

[English](2026-08-19-model-effort-memory.md) | 中文

## Problem

在 Web composer 里选择模型时，推理等级每次都被重置为该模型声明的默认值。两个选择入口对这次重置的表述不同——`/model` 弹窗在客户端物化目标模型的 `defaultEffort`，composer 席位发送裸的 `{provider, model}` 交给 Host 物化——但两者都不记忆任何东西，而仅有的持久化层级只有随 prompt 组装落日志的会话级当前值、以及被每次切换覆盖单条 `reasoningEffort` 字段的进程级默认元组。把模型 A 调到 `max`、切到 B、再切回 A 的用户，拿到的是 A 的默认值。用用户自己的话说：选定的推理等级应该按模型缓存。

## Decision

用户在某条提供方／模型路由上最后一次显式选择的等级，被记忆进新的 Settings 命名空间 `agent-model-efforts`（条目列表；每条路由至多一条），由 `AgentDefaultModelConfig` 与既有 `agent-default-model` 命名空间并列持有——切换默认选择永远不会覆盖某条路由的记忆。服务暴露 `recallEffort(provider, model)` 与 `rememberEffort(provider, model, effort?)`；未挂载设置提供方时两者均为空操作，组合配置项保持当前。由于每次更新都会替换路由列表，服务会串行执行完整的“读取、计算、替换”过程；不同路由的并发选择会同时保留，单次写入失败也不会阻断队列后续写入。

Session Controller 的 `session.selectModel` 持有策略：

- 在**不同**路由上的裸选（`reasoningEffort` 缺席）咨询记忆；被记住的等级先对照模型实时的 `reasoning.efforts` 校验（记忆可能比当初提供它的声明活得更久），通过则使用，否则丢弃并清除、照旧物化适配器默认值。
- 在**相同**路由上的裸选是显式的 provider-default 手势（等级面板的 Default 行）；它清除该路由的记忆。
- 线上显式声明的等级被校验、应用并记住。被咨询过的裸选从不写入。

`/model` 弹窗不再为跨路由选择在客户端物化 `defaultEffort`（`selectionOf` 不声明等级），两个入口因此都遵从同一个 Host 决策；同路由选择仍重新声明所持等级。记忆读写经 `ctx.agentDefaultModel.recallEffort`／`rememberEffort`。记忆存储失败只记日志并吞掉——切换已经作用于它的会话。

## Alternatives considered

**按模型键控的客户端 localStorage。** 弃选：桌面壳每次启动分配新的回环端口，而 localStorage 按 origin 隔离，缓存会随每个窗口静默消失；且弹窗/composer 的双入口要在 Host 之外再对齐一个客户端自有的事实源。

**只按当前模型键控的单槽记忆。** 弃选：它在模型之间复现默认元组的 last-wins 问题——A→B→A 依旧恢复不出任何东西。

**把每次物化的默认值都记入记忆。** 弃选：适配器默认值会在用户路过某模型而未动其等级面板时，遮蔽更早的显式选择；记忆必须只持有显式声明。

**为每条被记住的等级加 `SessionEventMap` 事件。** 弃选：记忆是部署状态而非模型可见的会话内容——重建的请求不依赖它，设置文档才是它唯一的家。

## Consequences

经任一选择入口的 A→B→A 会恢复 A 最后显式选择的等级，跨会话、跨 Host 重启，桌面端口漂移无关紧要，因为记忆在 host 侧。陈旧条目在咨询时自愈（丢弃并清除）而非让切换失败，与别处严格的禁止钳制校验一致。代价：存储文档多一个 Settings 分节、裸选路径多一次 `resolveModelInfo` 咨询、记忆按调过的路由各存一条且不自动清理。Web e2e（`declared-reasoning`）经真实 UI 钉住恢复与陈旧丢弃；session-controller 单测钉住写入策略（显式记录、同路由清除、被咨询的裸选不写）。

## Related

线上协议不变：`session.selectModel` 的可选 `reasoningEffort` 语义照旧，不声明等级的客户端只是把决定权交出去。
