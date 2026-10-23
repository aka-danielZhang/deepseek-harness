# 2026-10-23 workspaces-alternate-view：浏览区「work / 备选视图」页签接缝

## 背景与判定

dsh-quno 的交互改版要求「Quno 独享侧栏页签、原有浏览区原样保留在 work 页签」。插件侧没有可用接缝：`sidebar.workspaces` 是 single 槽，动态/启动插件占位即**整体替换**（boot 装载的插件没有动态 runner 的自动 shadowing facade，register 必须显式 `priority: -1`，占位后 stock WorkspaceBrowser 完全退场）。要在保留 stock 浏览区的前提下并列一个备选视图，只能改源码——满足「确认没有任何扩展点可用」的门槛，走 `feat/`。

## 改动（最小侵入）

`packages/client/ui-workspace`：

- 新增子槽 **`sidebar.workspaces.alternate`**（list / root，owner `{ active }`，slot 级 inject `hooks.alternate` 提供席位元数据）。
- `sidebar.workspaces` 的占位者由 WorkspaceBrowser 换成 **WorkspacesRegion** 包装：无备选注册时逐字节等价于原浏览器；有注册时顶部出现「work / <备选标签>」页签，按 tab 挂载浏览器或备选条目；备选被 dispose（含总开关关闭）时从任一 tab 回落浏览器并撤掉页签条。
- 席位元数据（occupied + label thunk）由 `alternate-source.ts` 的一条 registry 订阅驱动，label 每次 render 重读、跟随 locale。
- rail 态：有备选时渲染 W/Q 两枚 36px 切换钮（按下即展开），浏览器自身 rail 图标让位；这是对 stock rail 的唯一可见变化。
- `sidebar.workspaces` 原有 children（directoryFlow / 行菜单 / 行 hover 等）声明原样保留并透传。

`packages/extensions/cordis-client-runner`：slot-catalog 再生成（新槽进入模型侧目录）。

## 兼容性

- 无插件注册 alternate 时，区域渲染路径与上游版本完全一致（Region 直返 WorkspaceBrowser）。
- 上游合并成本：新增一个文件组 + 注册占位者改名 + contract 追加类型，不重写上游会动的逻辑。

## 验证

- ui-workspace 467 项 + 新增 `workspaces-region.client.spec.tsx`（stock 等价 / 页签升起与换体 / dispose 回落）全绿；workspace-browser 直接挂载 spec 补 `useAlternate` stub。
- cordis-client-runner 116 项全绿；`gen-client-catalog` 再生成后 `--check` 通过。
- 全仓 `pnpm run build` 通过（client 编译聚合 + bundle）。

## 发布

zw.5：发布集含 `@crazx/dsh-client-ui-workspace`（首次）与 `@crazx/dsh-cordis-client-runner`（首次），其余 fork 修改包按既定管线随 zw.5 重发。下游 dsh-desktop：`runtime/revision.json` 钉 `v0.2.1-rc.2+zw.5`，`prepare-runtime.mjs` FORK_MODIFIED 增补 ui-workspace 与 cordis-client-runner。
