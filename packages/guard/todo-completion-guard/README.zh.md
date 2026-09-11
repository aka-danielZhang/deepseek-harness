---
description: "建议性回合结束 guard：提醒模型处理未完成 todo，供选择、组合或排查此插件的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-todo-completion-guard

[English](README.md) | 中文

## 摘要

本包在一个本可完成的回合关闭前，给模型最后一次核对未完成 todo 项的机会。它向同一回合引导一条带来源归属的提醒，然后由模型完成这些项、围绕明确的延后重写清单，或解释为何仍有工作保持开放。它绝不否决完成，也绝不循环。使用 `todo_write` 的自主会话应选择它；当开放清单绝不能触发另一次模型 step 时不要选择它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

`dsh` base 组合已把本 guard 与 `tool-todo` 一同挂载；自定义组合可挂载同一条无需配置的行。

### 何时选择

当 agent 用 `todo_write` 规划多步工作，且意外遗留的开放清单应触发一次核对 step 时选择它。当回合无论计划状态如何都必须立即结束，或 todo 事件来自自定义词汇而不是 `@deepseek-ai/dsh-tool-todo` 时不要选择它。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-todo-completion-guard'
```

本包没有配置字段。提醒文案、每回合一次上限与 max-token 豁免都是正确性属性，不是部署旋钮。没有 `tool-todo` 时就没有 `todo/write` 事件，guard 天然保持静默。

### 回合结束时发生什么

在 `agent/turn-stopping`，guard 读取当前 `turn/start` 之后最近一次 `todo/write`。`pending` 与 `in_progress` 都算未完成。只要回合没有撞到输出 token 上限，guard 就注入一条提醒，loop 观察到待处理输入后再运行一个 step。同一回合第二次结束时不再提醒。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

实现从 `@deepseek-ai/dsh-tool-todo` 消费 `TodoItem` 与 `todo/write` 声明，因此事件词汇只有一个所有者。它扫描不可变的 `Session.snapshotEvents()` 视图，并把检查范围限制在当前回合。

当 `assistant/message` 或 `assistant/attempt` 的 stream 以 `max-tokens` 结束时，回合被视为撞墙。此结果会抑制提醒，因为另一个 step 很可能撞到同一上限。`WeakMap<Agent, turn>` 提供每回合一次上限，同时不会保留已释放的 agent。

提醒是一条来源为插件、`form: 'notice'` 的 `user/message`。它通过正常 steering 追加，在日志中保持可归属，且不创造本包专有的 session event。不发布运行时不变量伙伴；这个无状态建议器除了所评估的 turn-stopping listener 外，不拥有独立的可变关系或事件流。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 当前回合检查、撞墙检测、提醒构造与监听器注册 |
| [`tests/todo-completion-guard.spec.ts`](tests/todo-completion-guard.spec.ts) | 已完成、未完成、max-token 与每回合一次行为 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Todo 工具包](../../todo/tool-todo/README.zh.md)——`TodoItem`、`todo/write` 与整表替换语义的所有者。
- [工具子系统参考](../../../docs/subsystems/tools.zh.md)——工具执行与模型可见上下文所有权。
- [Todo 完成决策](../../../.agents/notes/implemented/feature/2026-08-19-todo-completion-guard.zh.md)——理由与被否决的强制方案。
- [guard 组映射](../README.zh.md)——同组的循环卫生策略。

-----

<a id="model-experience"></a>
## 模型体验

### 未完成清单提醒

#### 模型看到什么

当回合本可结束但仍有开放事项时，模型会收到一条带来源归属的上下文消息。事项行保留清单中的当前顺序与状态。

##### 提醒模板

```markdown
The todo list still has <count> unfinished item(s) while this turn is about to end:
- [<pending|in_progress>] <item content>
Before finishing the reply: complete the remaining item(s) and mark them completed with todo_write; or, if items are genuinely dropped or deferred, rewrite the list to reflect that and say why in one line. If the work legitimately continues in a later turn or you are blocked waiting for the user, state that explicitly in the reply and the list may stay as is.
```

#### Token 影响

当前回合没有开放清单或回合已撞墙时为零 token。触发时，一条有界指令加每个未完成事项进入保留历史。

#### KV Cache 影响

仅追加。提醒位于可复用请求前缀之后，不会重写更早的模型输入。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义建议性契约，而不是等待实现的强制工作。

- **仅提供建议**——模型可以确认提醒后仍保留开放事项；guard 从不强制再次延续。
- **仅限活进程的预算**——进程重启会重建 `WeakMap`，因此跨重启的回合可能再收到一次提醒。
- **按 agent 可见**——子 agent 的未完成清单不会驱动父 agent；每个 agent 只核对自己的 session log。
- **不提供可配置文案或阈值**——改变这些语义需要修改并测试包契约。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
