# Agent Note: pi-ai 会话亲和头

Status: implemented

[English](2026-09-10-pi-ai-session-affinity-headers.md) | 中文

## Problem

亲和网关按会话路由与缓存。OpenCode Go 在其问题客户端列表中点名 DeepSeek Harness：会话信息只在部分模型路径上送达。具体而言，pi-ai 的 `openai-responses` 分发在路由 compat 开启时发送亲和头，而 `openai-completions` 与 `anthropic-messages` 默认不发送任何会话头，且 harness 的 profile schema 未暴露开关——大多数 Go 模型因此从不携带会话 ID。会话 ID 本身每次调用都有（`GenerateOptions.sessionId`）；缺的只是线上映射。

## Decision

`llm-pi-ai` 的 provider profile 新增 `sessionAffinityHeaders: string[]`。调用携带会话 ID 时，adapter 把每个声明的头名写为该 ID，置于 profile headers 与 attribution 之后——一个注入点覆盖全部线上路径，因为 pi-ai 三个分发都把 harness `headers` 选项最后合并。`opencode-go` 目录路由及 opencode.ai 端点默认启用 `x-opencode-session` + `x-client-request-id`，网关零配置即用；显式空数组表示退出。头名在解析时按 Fetch 校验，attribution 保留集（读取自 `attributionHeaders()`，两处检查不会漂移）被拒绝——`user-agent` 保持其强制值。

## Alternatives considered

**社区 fetch-patch 插件**（`dsh-opencode-session`）包装 `globalThis.fetch`，经 AsyncLocalStorage 把请求关联到会话。作为主路径被否决：它依赖 SDK 永远使用全局 fetch，卸载对其它补丁的顺序敏感，且第三方 host 代码不应进入随包组合。它保留为用户自装的过渡选项，直到本能力上游化。

**profile `headers` 里的静态逐路由头。** 该路由的所有对话共享一个值——违背按会话语义，对亲和缓存也没有可用的键。

**本地改写代理。** 在受影响路径上，请求到达 adapter 之前没有任何会话标识可供代理推导；只会新增一个需要长期维护的 MITM 组件。

**等待 pi-ai 上游。** pi-ai 没有 `x-opencode-session` 概念，其 compat 开关也未在 harness schema 暴露；在我们的节奏上不可行动。

## Consequences

`llm-pi-ai` 进入 fork 发布面，且每个亲和网关（不止 OpenCode）都可按路由配置。未声明的路由线上字节完全一致，隔离性由构造保证。此处字段命名是本仓本地的；向上游贡献时命名应向官方收敛，届时 fork 可退场该偏差。
