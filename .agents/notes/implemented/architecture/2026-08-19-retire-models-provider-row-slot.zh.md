# Agent Note: 退役 Models 供应商行级槽位（插件改走 DOM 注入）

状态：已实现

[English](2026-08-19-retire-models-provider-row-slot.md) | 中文

## 问题

fork 曾携带 `settings.models.provider` 行级槽位（PR #1），让 out-of-tree 的 dsh-provider-balance 插件能在 Models 设置页每个供应商行上挂配额徽标。槽位本身可用，但它让插件依赖 fork 专有源码：在上游 harness 上该槽位永远不会被声明，徽标静默消失。

## 决策

插件客户端学会了把**同一个**徽标组件通过自己的 `react-dom/client` root 挂进插入在供应商行操作区旁的外源容器（路由 id 从编辑按钮的无障碍名解析；宿主 React 树不被触碰；MutationObserver 扫描重申位置、行消失即卸载）。已在上游 upstream/master 纯净 worktree 上端到端验证：渲染效果一致，宿主零改动。既然这条路径成立，fork 槽位就是冗余，本次 revert 将其移除（ffffaf39）。若上游将来原生提供等价行级座位，插件可以机会式采用，但不再依赖它。

## 备选方案

**保留 fork 专有行级槽位。** 否决，因为供应商徽标可以继续由插件持有而无需修改 Harness；保留槽位却会让每次上游基线合并都携带一个只服务于单个出树插件的 UI 契约。

**等待上游提供槽位后再显示徽标。** 否决，因为可访问操作标签已经为插件提供了失配即隐藏的路由锚点；等待会移除有用行为，却不能减少当前 fork 代码。

## 影响

- fork master 在 ui-settings / ui-settings-models 上不再与上游分叉，同步成本相应下降。
- FORK.md 将其记录为已退役先例，并派生规则：插件侧 DOM 注入能覆盖行级 UI 需求时优先插件侧，不给 fork 添源码负担。
