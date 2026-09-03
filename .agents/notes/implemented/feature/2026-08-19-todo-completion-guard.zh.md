# Agent Note: todo 完成度回合结束守卫

Status: implemented

[English](2026-08-19-todo-completion-guard.md) | 中文

## 问题

Agent 经常在 `todo_write` 项未完成时就结束回合。工具描述早已写明「完成即打勾，不要攒批」，但提示词只是降概率，不是结构：综合上游反馈与本 fork 自身会话，模型写完可见的回复、丢掉最后一次 `todo_write` 调用，会话留下过期的开放计划（web 计划条会一直渲染到下一个 `turn/start`）。其他 harness 用硬门回答（Cline/Roo 强制以 `attempt_completion` 收尾）；Claude Code 的对应物是 advisory 的 Stop hook。harness loop 本就拥有正确的缝——`agent/turn-stopping` 在本可完成的回合关闭前广播，`steer()` 的监听器会让 loop 在同一回合再跑一步（由契约回归测试 "steer() from an agent/turn-stopping listener continues the same turn" 钉死）——但那里没有任何可组合的监听者盯着 todo。loop 刻意没有轮次预算，其自身的 Stop-hook 桥也挂着 `TODO(stop-loop-guard)` 警告：监听器必须自我限流。

## 决策

新守卫包 `packages/guard/todo-completion-guard` 监听 `agent/turn-stopping`，在回合的当前有效清单存在未完成项时，向该回合注入恰好一条 `notice` 形态的 plugin 上下文。四个属性构成契约：

- **当前有效清单作用域。** 候选清单是当前回合自己的 `turn/start` 之后的最近一次 `todo/write`——与 `todos` 投影的清空规则一致。更早回合的清单是已清空状态，不是残羹；守卫绝不重新清算上一回合。
- **未完成 = 非 `completed`。** `pending` 与 `in_progress` 都算；被遗忘的 pending 项是最常见的残羹。
- **撞墙豁免。** 若回合中任何 step 以 `max-tokens` 收尾（粘性回合结局），守卫保持沉默——强制续 step 大概率再次撞上同一输出上限。
- **每 agent 每回合一次**（挂在活跃 agent 上的 `WeakMap`）。被提醒后仍以开放清单收尾的回合允许结束。这是 loop 缺少轮次预算所要求的自我限流；它取代任何可配置上限。

提醒列出三个出口——完成并打勾、围绕明确放弃重写清单并附一行理由、或显式声明清单合法保持开放——使被用户阻塞或工作延续到下回合的模型有诚实的空操作路径。notice 来源可归属、以 `user/message` 落日志；无新会话事件，遵循模型可见⟺落日志规则。无 `Config`：每个旋钮都是 advisory 契约的正确性属性，而非部署选择。

注册行随 `packages/bundle/base/cordis.patch.yml` 落地，与 `repeat-tool-reminder` 相邻；本守卫沿用了它「只提醒、不否决」的哲学。

## 考虑过的替代方案

**仅提示词加固。** 拒绝作为唯一修复：上游证据表明模型会无视指令；提示词降低频率，守卫是结构性兜底。两层并存。

**强制延续直到清单关闭。** 拒绝：合法延后真实存在（阻塞于用户、工作跨回合）。硬门恰好在模型无事可做时烧 token 反复提示，而强制轮次上限只是用更多机械重新发明 advisory 模式。

**像 repeat-tool-reminder 那样监听 `tools/post-execute`。** 拒绝：残羹发生在回合结束，而非每次调用；停止边界是「即将带着开放清单结束」唯一可观测的点，且 loop 在那里已支持经 `steer()` 同回合延续。

**读取 `todos` 投影服务。** 拒绝：投影是可选挂载的展示单元；守卫通过 `Session.snapshotEvents()` 直接读权威会话日志，使其在任何能触发 `agent/turn-stopping` 的组合中工作。

## 后果

写了清单却未勾完就回复的回合，会获得携带提醒的一个额外 step；顺从的模型在该 step 里打勾或重写清单（行为套件用真实 loop + 真实 `todo_write` 工具钉死这一点）。拒绝或合法延后的模型在恰好一次提醒后结束回合——有界成本：一条消息加一个模型 step。撞墙回合零成本。恢复的会话获得全新的每回合预算，只影响横跨进程重启的回合。组合中未挂 `tool-todo` 时守卫天然无害。已知仍存留的残羹：把清单重写成全勾但实际没做的模型能击穿守卫——那是诚实性问题而非记账问题，超出范围。

## 相关

loop 缺少轮次预算与 Stop-hook 自限警告记录于 `packages/core/agent-loop/README.md`；[repeat-tool-reminder](2026-07-08-repeat-tool-guard.md) 拥有工具链上共享的 advisory 哲学。
