# FORK.md — 本 fork 的工作流

本仓库是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 fork：`origin` 指向 `aka-danielZhang/deepseek-harness`，`upstream` 指向官方仓库。本文件是 fork 专有约定，上游没有对应文件；根 `AGENTS.md` 的其余规则继续全部适用。

## Fork 的存在目的

处理上游没有 slot、也没有其他扩展点可以覆盖的场景。判断顺序：优先用动态 Cordis 插件或既有 slot 解决；确认没有任何扩展点可用时，才修改仓库代码。在册先例：`mcp-client/status` 事件（`packages/mcp/mcp-client`）。已退役先例：`settings.models.provider` 行级插槽曾为此目的引入，后因 dsh-provider-balance 插件改用纯 DOM 注入路径（宿主零改动）而于 ffffaf39 revert —— 插件侧 DOM 注入能覆盖行级 UI 需求时，优先插件侧，不给 fork 添源码负担。

## 修改三原则

简单、优雅、最小侵入。能加 slot 就加 slot，能不改核心包就不改；每处改动都要评估将来同步 upstream 时的合并成本，避免大面积重写上游会动的文件。

## 发布纪律（npm 是唯一分发形态）

任何源码修改合入 master 后，**受影响的包必须发布到 npm**，下游（dsh-desktop 等）只消费 npm 版本、不依赖 fork 源码。规则：

- **改名换 scope 发布**：`@deepseek-ai` scope 归上游官方所有，fork 无法以原名 publish。fork 修改过的包以 **`@crazx`** scope 发布（`FORK_NPM_SCOPE` 环境变量可覆盖）；下游用 `pnpm.overrides` 的 `npm:@crazx/<pkg>@<ver>` 别名重定向，任意 registry 通用、安装侧零改动。
- **版本编码 zw 层**：npm 版本用预发布段写 `<上游版本>.zw.<N>`（例 `0.1.0-rc.7.zw.1`）。**不用 build metadata**（`0.1.0-rc.7+zw.1`）——npm 视 build metadata 不参与版本序，同版本无法重发，zw 层一多即堵死。git 标签维持 `v<基线>+zw.<N>` 不变（revision.json 钉 ref 字符串，不受影响）。
- **改动面即发布面**：发布集由 `git diff upstream/master..master` 的**源码改动包**（`src/`/`lib/` 变更或 `apps/cli`）自动推导——`node scripts/publish-fork.mjs --list`；仅 docs/tests/cordis.patch.yml 变更的包不进发布集。dsh-desktop 仓 `prepare-runtime.mjs` 的 `FORK_MODIFIED` 名单与本节同源。
- **发布流水线**：`.github/workflows/npm-release.yml`——push tag `v*+zw.*`（或手动 dispatch）→ build → 发布依赖名回归测试 → `scripts/publish-fork.mjs <N>`：staging 重写包自身 scope/版本/repository；依赖键保留源码与配置引用的 `@deepseek-ai/*`，普通依赖以 `npm:@crazx/<pkg>@<版本>` 指向 fork，peer 以原名和对应 fork 的 semver 要求宿主提供同一实例；`workspace:` 按目标包版本收敛，绝不产出 `*`。逐包 pack+publish（`--access public`），并开一个 draft Release 记录。本地同款：`node scripts/publish-fork.mjs <N> [--dry-run]`。凭据走仓库 secret `NPM_TOKEN`。决策见[发布依赖别名](.agents/notes/implemented/bug-fix/2026-09-07-fork-published-import-aliases.md)。
- **下游源码依赖仅限显式调试**：dsh-desktop 仓以专门命令（`pnpm run link:source` / `unlink:source`）切换源码 posture，且不得提交 link: 状态——见该仓 AGENTS.md「npm 依赖纪律」。fork 侧不为下游的源码调试便利做任何让步（不保留 link 入口、不改导出形态）。
- 上游未修改的包**不重发**：下游直接消费 `@deepseek-ai/*` 官方 registry 版本，fork 只对改动面负责。

## 强制告知

任何修改前必须告知用户：这是 fork 本地修改、打算改什么、上游为什么没有对应能力。不允许静默改动。

## 分支命名

前缀按改动性质二选一：

- `fix/`：仅用于修复真实缺陷——harness 自身的行为是错的。先例：`fix/wkwebview-bundle-content-length`（WKWebView 丢 chunked 响应，bundle 加载失败）。
- `feat/`：其余全部，尤其是为开发我们的插件而被迫改源码的能力扩展（加 slot、事件、子命令）。先例：`feat/mcp-client-status-event`；已退役：`feat/models-provider-row-slot`（插件改走 DOM 注入后 revert）。

判断：行为坏了才是 `fix/`；让插件做到以前做不到的事，一律 `feat/`。名字描述能力而非实现形态，以免方案演进后过时（`feat/web-log-script` 最终交付的是 CLI 子命令而非 script）。

## 分支纪律

修改前先检查是否已有相关 fix/feat 分支（`git branch -a`，必要时 `gh pr list --state all`）：

- 存在相关分支 → 先确认它是否已完成这项工作（`git log master..<branch>`、`git diff master...<branch>`）；已完成则在其上续写剩余部分，未开始则不占用该分支名。
- 改动足够大、依赖少、可独立交付 → 单独新开一个 `fix/` 或 `feat/` 分支。
- 都不匹配 → 从 master 新开分支。

已合并进 master 的功能分支（如 `feat/mcp-client-status-event`、`feat/models-provider-row-slot`）是完成态，不复用、不续写。

## 缺陷上报（母仓库 Discussions）

需要改动源码时先评估性质：修的是 harness 自身的**真实缺陷**（行为错误），还是为插件做的能力扩展。扩展走 `feat/`、不要求上报；真实缺陷走 `fix/`，并且**必须**向母仓库反馈：

1. 本地修复完成（测试全绿）并在 fork 开出 PR。
2. 经用户确认后，向 `deepseek-ai/deepseek-harness` 提 Discussion——官方对非成员关闭了 PR 和 Issue，Discussion 是唯一通道（用 `gh api graphql` 的 `createDiscussion`，分类选 General）。
3. Discussion 内容：问题现象、根因、修复方案与验证证据，并**携带 fork 的修复链接**（PR 或分支地址），让维护者可以直接抓取。

先例：Discussion [#3007](https://github.com/deepseek-ai/deepseek-harness/discussions/3007)（WKWebView chunked 响应）与 [#3099](https://github.com/deepseek-ai/deepseek-harness/discussions/3099)（会话持久化并发写者），都附了 fork 的修复链接。

## 上游同步

定期 `git fetch upstream` 并把 `upstream/master` 合入 master；冲突时以保留双方语义为准，fork 本地提交不丢弃。同步后跑受影响包的聚焦测试确认 fork 改动仍然成立。

## 本地启动与日志（web:log）

上游没有启动包装，进程输出只去终端、关窗即失。fork 在 CLI 里加了 `web:log` / `web:log:tmp` 子命令（`apps/cli/src/web-log.ts`），启动同时落盘：

```sh
pnpm dsh web:log                # 默认 3080
pnpm dsh web:log --port 0       # 让系统分配端口（可避开临时端口占用导致的 EADDRINUSE）
pnpm dsh web:log:tmp            # 日志改放系统临时目录（macOS 定期自动清理，无需手动删）
```

实现方式：子命令 spawn 自身 bin 的 `dsh web …` 子进程并把输出 tee 到日志文件，转发 SIGINT/SIGTERM，退出码与子进程一致。日志位置（每次启动一个文件，`web-latest.log` 软链始终指向最新一次）：

```
默认：  ~/.dsh/logs/web-<yyyymmdd-HHMMSS>.log          # 重启后仍在，需手动清理
tmp：   ${TMPDIR:-/tmp}/dsh-web-logs/web-<时间戳>.log  # 操作系统自动回收
```

也可用环境变量自定义目录：`DSH_WEB_LOG_DIR=/path/to/dir pnpm dsh web:log`。

常用查法：

| 目的 | 命令 |
|---|---|
| 实时跟随 | `tail -f ~/.dsh/logs/web-latest.log`（tmp 模式换成 `$TMPDIR/dsh-web-logs/web-latest.log`） |
| 只看余量插件 | `grep 'provider-balance' ~/.dsh/logs/web-latest.log` |
| 有哪些实例在跑 | `lsof -nP -iTCP -sTCP:LISTEN \| grep 'bin.ts web'` |

清理：默认目录 `rm ~/.dsh/logs/web-*.log`（日志不按大小轮转，定期手动删）；tmp 目录不用管，系统会收。

注意盲区：`web-*.log` 只含 stdout/stderr。`ctx.logger` 的流量在 web 组合里没有出口（内建 sink 只是 1000 条内存环形缓冲，没挂 console exporter），上面的 grep 查法对走 logger 的插件无效。logger 落盘由 dsh-desktop 仓库的 `dsh-desktop-log-sink` 插件补齐（同目录 `logger-*.log`，JSONL），该行随 dsh-desktop-bridge 的 bundle 层挂载，终端 `dsh web` 同样生效。
