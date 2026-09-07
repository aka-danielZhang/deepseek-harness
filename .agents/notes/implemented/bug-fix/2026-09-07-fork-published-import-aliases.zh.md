# Agent Note: 保留 fork 包导入名

Status: implemented

[English](2026-09-07-fork-published-import-aliases.md) | 中文

## 问题

创造模式引用 `@deepseek-ai/dsh-tool-cordis`。fork 发布时重命名依赖键，导致 Profile 模块回退目录只有 `@crazx/dsh-tool-cordis`，而构建后的导入与随包预设行仍使用原名。即使 fork 包存在于运行时树的其他位置，全新安装仍会将预设判为损坏。

## 决策

发布器将包自身名称改为 fork scope，但保留依赖键。普通、可选和开发依赖使用 npm 别名指向选定的 fork 版本。peer 依赖保留原键，要求宿主提供选定 fork semver；peer 元数据因此仍对应同名键。vendor 包保留各自的发布版本线。

## 考虑过的替代方案

**仅在 Desktop 补软链接。** 只能修复一份安装，npm 产物对其他消费者和 Profile 仍然无效。

**将导入和预设行改为 fork scope。** 未修改的上游包同样引用原名。改写这些消费者会扩大 fork，并提高服务实例重复的风险。

## 影响

Profile 回退发现能看到随包预设使用的名称。消费者必须经同名别名提供 fork peer；peer 范围不能使用 npm alias specifier。发布前执行 manifest 回归测试，再写 registry。发布验证还需要安装产物的预设列表与挂载检查，因为源码工作区解析无法验证 npm 安装行为。
