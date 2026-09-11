# Agent Note: publish-fork 对 fork peer 做别名改写

Status: implemented

[English](2026-09-09-publish-fork-peer-alias.md) | 中文

## Problem

`@crazx/dsh-api-session-controller@0.1.5-alpha.1.zw.1` 发布出的 `peerDependencies` 里带着
`@deepseek-ai/dsh-agent-default-model: "0.1.5-alpha.1.zw.1"`。`rewriteManifest` 把 `workspace:^`
协议替换成了发布版本，却刻意跳过 peer 字段的 `npm:@crazx/...` 别名，理由是“peer 必须是纯
semver”。该版本只存在于 fork scope 下，于是任何自身不提供该 peer 的消费方（例如依赖
controller 但不依赖 default-model 的 `dsh-desktop` 插件）在 `auto-install-peers` 下解析失败，
报出指向官方包名的 `ERR_PNPM_NO_MATCHING_VERSION`。自带该别名的消费方（dsh-thread）在抽查中
掩盖了这个缺陷。

## Decision

fork 修改包依赖在所有 manifest 字段中一视同仁地改写：`dependencies`、`devDependencies`、
`optionalDependencies`、`peerDependencies` 一律发布为原始 import 名下的
`npm:@crazx/<name>@<version>`。npm 与 pnpm 都接受 peer 字段中的别名 spec，而且别名是唯一能让
普通消费方真正解析成功的 spec。

```mermaid
flowchart LR
  A[workspace:^ peer edge] --> B{versionOf has dep?}
  B -->|yes| C[npm:@crazx/name@zw.N in every field]
  B -->|no| D[target's own version line]
  C --> E[plain consumers resolve under auto-install-peers]
```

已损坏的 zw.1 tarball 无法替换（npm 版本不可变），因此修复以 `0.1.5-alpha.1.zw.2` 随 tag
`v0.1.5-alpha.1+zw.2` 发布；下游 manifest 的别名必须指向 zw.2。

## Alternatives considered

**peer 保留裸版本、要求宿主自行预置。** 否决：这让 fork 包集合的任何独立或部分安装都以
“官方包确实没有这个版本”的报错收场——正是本次事故产生的支持陷阱。

**fork 只增加行为时把 peer 钉到官方版本。** 否决：peer 会被官方包满足，从而在 fork 实例旁边
静默引入第二份已分叉的实现。

## Verification

`scripts/publish-fork.spec.ts` 现在对全部四个依赖字段断言别名形态，并在断言旁保留事故成因
（10/10 通过）；`publish-fork.mjs 2 --dry-run --base 0.1.5-alpha.1 --upstream-ref
dsh-v0.1.5-alpha.1` 产出修正后的集合，zw.2 发布通过从 registry 解析全部 `@crazx` 包及一个
普通消费方 lockfile 验证。
