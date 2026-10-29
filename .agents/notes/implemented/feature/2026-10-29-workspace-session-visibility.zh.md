# Agent Note: 由贡献方控制 Workspace Session 可见性

Status: implemented

[English](2026-10-29-workspace-session-visibility.md) | 中文

## 问题

Quno 的永久主对话是普通 Session，不是 subagent，因此即使产品已经提供 Quno 独立入口，它仍会出现在 Workspace 浏览列表中。隐藏这条对话需要同时覆盖分组、平铺和搜索视图，既不能把 Quno 专属规则写进共享 Workspace 浏览器，也不能只用 CSS 隐藏行。

## 决策

`UiWorkspace` 提供 `registerSessionVisibilityFilter(filter)`。每次注册拥有一个谓词，并返回幂等注销函数。注册和注销都会发布版本变更；分组、平铺和搜索派生会重新计算全部谓词，同时保留现有 `origin: 'subagent'` 与归档过滤。过滤只改变展示：Workspace 成员关系、Host 搜索、持久日志、直接导航和历史召回均维持原行为。谓词及其版本归属 `UiWorkspaceService` 实例，不使用模块级注册表。

公开谓词接收现有 Client `SessionSummary`，因此功能插件可以读取 `agentPreset` 等投影，而 Workspace 包不需要认识这些 preset 名称。调用方在较旧组合上运行时可以探测该方法是否存在。

## 考虑过的替代方案

**在 `sessionVisible` 中直接判断 Quno preset。** 这会把某个功能的业务规则放进共享 UI 包，使其他 Workspace 消费方被迫了解不属于自己的概念。

**通过 DOM 标记或 CSS 隐藏 Quno 行。** CSS 无法从分组计数、平铺成员、搜索结果和排序状态中移除 Session，而且搜索行没有相同的标记槽位。

**把主对话标记为 subagent。** 这会错误描述其生命周期和归属，并可能改变 Session 路由，而不只是浏览可见性。

## 后果

Workspace 浏览获得一条按功能注册可见性规则的途径，支持实时注销且不需要修改 Host。没有注册项的既有组合保持原行为。注册器测试覆盖重复谓词与幂等注销；浏览器测试覆盖分组、平铺、本地搜索、Host 内容搜索和版本变更驱动的重算。Workspace 聚焦套件 180 项测试通过，`build:artifacts` 后接 `build:check` 通过。
