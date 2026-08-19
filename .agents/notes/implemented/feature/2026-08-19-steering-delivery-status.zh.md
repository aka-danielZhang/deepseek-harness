# Agent Note: 会话流中的插话投递状态

Status: implemented

[English](2026-08-19-steering-delivery-status.md) | 中文

## 问题

轮次进行中的插话（`steer()` 加入运行中轮次的 FIFO，在下一个 step 边界被消费）在会话流里的呈现是不诚实的。`ChatView` 把待处理 steering 气泡渲染在轮次级运行状态**之后**，于是插话在视觉上悬在挂于插话前内容的「Deep diving...」指示器下方。读者由此得出「agent 一直收不到消息」的结论：屏幕上没有任何东西说明消息已被接纳、模型何时会看到它。真相——现已接纳、下一个 step 边界即模型可见、除非轮次被取消否则必然送达——只存在于 AgentLoop 契约里。

## 决策

`ui-conversation` 内两处呈现改动，不动运行时与 wire 协议：

- **顺序。** `ChatView` 把待处理 steering 气泡渲染在轮次状态**之前**。会话流读作「旧内容 → 你的插话 → 仍在工作」，这正是如实的叙述：消息已在运行中的轮次之内，轮次在它下方继续。轮次状态本身仍是整轮信号（不随步骤闪烁），无待处理插话时依旧渲染在末尾。
- **投递说明。** 每条待处理气泡在气泡下方带一条弱化说明：所属轮次运行中显示 `chat.steering.received`（「已接收 · 当前步骤结束后发送给模型」），无运行轮次时显示 `chat.steering.parked`（「已接收 · 将在智能体下次运行时发送」）——被拒步骤之后确实可能存在驻留的 steering，此时承诺 step 边界会是假话。说明只随 pending 投影存在：既有的瞬时→持久交接（在接纳的 `user/message` 上退役队列项）会替换整个气泡，因此说明消失的那一刻正是消息变为模型可见的那一刻。没有新增任何状态机；说明只是队列快照加上 ChatView 本就订阅的 running 位的纯函数。

## 备选方案

**插话即中断重发（聊天应用语义）。** 否决：这改的是 steering 契约本身——丢弃在途步骤、重发请求、重新计费——而不是既有契约的呈现。AgentLoop 的不打断 FIFO 就是刻意语义；抱怨点在显示的诚实性，不在投递模型。

**只把状态移到气泡下方、不加说明。** 否决，是半真半假：读起来像「agent 正在处理我的消息」，而模型其实还没看到。说明承载的正是缺失的事实。

**在会话流里加独立的待处理状态卡。** 否决：问题与审批已经用编辑器接管表达各自的等待；再来一个待处理面会与承载消息本身的气泡重复。

**客户端插件纯 CSS 调序。** 否决：伪元素说明无法本地化、无法被辅助技术可靠读取、无法跟随 running 位；从包外依赖内部 class 名也是 slot 体系禁止的耦合。

## 后果

轮次中插话读作「已加入轮次」且带明确的投递承诺；该承诺在准确的模型可见边界自行退场。插话到达或退役时，重排会移动轮次状态的 DOM 节点（React 按槽位协调会重挂 `TurnStatus`），组件对此本就免疫：其时钟锚定在记录的 `turn/start` 而非挂载时刻。待处理 steering 与运行状态并存处的 a11y 与 golden 顺序改变（`steering`、`steer-all`、`subagent-interrupt` 的 web e2e golden）；无待处理 steering 的快照不变。驻留措辞刻意不承诺时间，因为驻留 steering 只在下一次 follow-up/steer 唤醒，UI 无法预知。

## 关联

待处理 steering 投影与持久交接由 [ui-conversation](../../../../packages/client/ui-conversation/README.md) 和 `client/runtime` 的 `queue-mirror.ts` 拥有；下一个 step 边界的消费契约是 `packages/core/agent/src/runtime-types.ts` 的 `Agent.steer()`。
