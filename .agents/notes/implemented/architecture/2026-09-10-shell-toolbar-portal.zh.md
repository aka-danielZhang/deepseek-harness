# Agent Note: Shell 工具栏 Portal

Status: implemented

[English](2026-09-10-shell-toolbar-portal.md) | 中文

## Problem

统一桌面工具栏——其 portal 宿主承载会话标题头的标题簇与右栏角落的 macOS chrome——只存在于 `v0.1.5-alpha.1+zw.3` 发布标签上，从未进入 fork master，因此 `0.1.5-rc.1` 上游合并将其丢失。rc.1 的布局同时把中栏席位改名为 keyed `main` slot，并把面板导航移到构造注入的控制器上；旧的注册表设计（ui-conversation 里的包级 module store，经 `useSyncExternalStore` 读取）不再符合 client 规则：业务组件不携带订阅机制，跨包响应事实必须走框架通道。

## Decision

ui-layout 拥有整套机制。框架新增第五个子 slot `shell.toolbar`：横跨三栏上方的一行，空席位是零高度 `auto` 网格轨道，未被占用时框架渲染与单行布局完全一致。`LayoutController` 持有宿主注册表——`setToolbarHosts`、`releaseToolbarHosts`（以引用相等守卫，过期的 HMR disposer 不会清除新工具栏发布的宿主对）、`getToolbarHosts` 与 `onToolbarHosts`——控制器释放时撤回注册，使标题头在服务下线前回到就地形态。

读取路径与面板选中态共用同一 root 通道：`provideRoot({ hooks: { toolbarHosts } })` 把注册表适配为裸 observable，`GlobalStandardProps` merge 把 `useToolbarHosts` 发布为标准 selector hook。ui-conversation 在会话标题头消费该 hook，把标题簇 portal 进 `centerHost`、右栏角落 portal 进 `sessionEndHost`；标题头自身折叠为 `display: contents`，正文只保留 View 标签行。宿主缺失、工具栏会话中途卸载、空白会话隐藏三种情况都渲染原有就地标题头。浏览器本地的 `ToolbarHosts` 宿主对不会被序列化，也不跨任何 Host RPC。

## Alternatives considered

**原样移植 alpha 的 module store。** ui-conversation 保留自己的包级 `toolbar-hosts.ts` 镜像，经 `useSyncExternalStore` 读取。被否决：现行 client 规则禁止业务组件携带订阅机制、禁止模块级 store 单例，原样移植会把已知违规带进全新架构。

**让 bridge 在无工具栏下发布。** 抑制 stock rail，依赖 bridge 的 overlay 回退承载更新与通知控件。被否决：这会在没有替代席位的情况下移除 stock 侧栏开关和 New Session 入口，并让 macOS 上会话标题头的标题簇滞留在正文里。

## Consequences

即使没有占用方，框架也是两行网格；空行是零高度 `auto` 轨道，组装输出快照确认未被占用的框架渲染结果不变。`useToolbarHosts` 是 `GlobalStandardProps` 的必填成员，因此所有喂完整标准 props 的组件 fixture 都要传入桩——与 `usePanelInfo` 当年的推广成本相同。此前读取 alpha `ILayout` 宿主方法的桌面插件面对的服务面保持不变；读取侧从包级 store 移到标准 hook，bridge 的工具栏是唯一写入方，所有消费方经同一通道观察挂载、重挂载与卸载。

## Verification

控制器注册表的覆盖位于 `packages/client/ui-layout/tests/service.client.spec.ts`（发布/替换/释放转换、身份守卫、释放撤回），框架行位于 `app-frame.client.spec.tsx`，portal/回退/空白路径位于 `packages/client/ui-conversation/tests/skeleton.client.spec.tsx`。`packages/client/test-support/client-runtime` 镜像了该数据源（`runtime.toolbarHosts`），组合测试可以驱动宿主转换。
