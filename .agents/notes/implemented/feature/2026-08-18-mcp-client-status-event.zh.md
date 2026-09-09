# Agent Note：mcp-client 连接状态事件

Status: implemented

[English](2026-08-18-mcp-client-status-event.md) | 中文

## Problem

MCP 服务器连接的观察者——按服务器列出实时状态的设置界面、清单页、看门狗——此前没有忠实的信号来源。fiber 生命周期无法替代：`failOnStartupError: false` 时，一个永远够不到端点的服务器仍会达到 `active` 的 fiber 并停在重连循环里，因此「fiber active」说明不了已连接、重试中还是已耗尽。轮询 `ctx.tools` 同样不行：连接丢失后工具会保持注册（且调用失败）直到放弃点，因此「已注册」区分不了已连接与中断进行中。

## Decision

`packages/mcp/mcp-client` 的连接 supervisor 在自己的每个 commit 点发布 Cordis 事件 `mcp-client/status(serverName, status, toolCount)`——绝不先于它所报告的状态变更：

- 尝试开始时发 `connecting`（首次尝试在任何 await 之前发布，因为 `connectGeneration` 的同步前缀会先占据 client 槽位）；
- 连接加初始工具同步完成时发 `connected`；
- 退避定时器布防时发 `reconnecting`（supervisor 在布防前先重置 `connectedAt`，因此「已建立后丢失」的连接报告 reconnecting 而非 connected）；
- 放弃、禁用重连后的丢失、世代未正常关闭时发 `failed`；
- 拆除时发 `disposed`。

一次完成的工具同步会重新发布当前状态，因为 `toolCount` 会在状态不变时变化——包括排队注销执行后携带 `toolCount: 0` 的第二个 `failed`/`disposed`。状态本身由纯函数 `computeMcpClientStatus(facts)` 推导，其判定顺序是有语义负担的（`failed` 先于 `reconnecting`、`connected` 先于在途分支），并按分支有单测。事件使用共享 Cordis 总线，监听器按约定同步执行：同步抛错由发射方收容并记日志，异步工作必须自行处理 rejection。`serverName` 只在一个注册作用域内唯一，因此复用跨 Agent scope 同名实例的部署需要额外的观察者自有身份。

事件声明与 `McpClientStatus` 联合类型放在 `src/types.ts`（纯类型），并由包根再导出；catalog 把 `mcp-client` 作用域映射到 Tools 子系统页。

## Alternatives considered

**观察 fiber 生命周期。** 弃用：`failOnStartupError: false` 时，失败的服务器是处于重连循环中的 active fiber；fiber 状态表达不了连接状态。

**轮询工具注册表。** 弃用：中断期间工具保持注册直到放弃点，因此注册表恰好在调用失败时读作「存在」。

**让每个观察者各自建立探测连接。** 弃用：这会按观察者复制 supervisor 的传输工作，且仍看不到 supervisor 自己的重试预算。

## Consequences

`dsh-mcp-settings` 仅凭该事件喂养其服务器状态注册表；其 Web 设置页无需触碰 supervisor 即可按服务器显示 connected/reconnecting/failed。未来的观察者以同样方式订阅——无新服务面、无轮询约定。supervisor 自身行为不变：每个 publish 调用都是纯附加，事件只携带已提交的事实。
