# Aino 内置 Codex 源码

`codex/` 是 Aino 的 Git 子模块，来自 `openai/codex`。当前固定在官方
`rust-v0.167.2` 的提交 `ce21072c90d32c40af7a55b60b2fb35c84a43a6a`。
这里保存完整上游源码，包括 Rust 引擎、App Server、执行器及上游构建脚本；
Aino 的主仓库用 gitlink 记录精确提交，不自动跟随上游 main。

## 获取与更新

克隆 Aino 时使用 `git clone --recurse-submodules`；已有克隆执行：

```sh
git submodule update --init --recursive third_party/codex
```

更新引擎时，在同一变更中更新此子模块提交、`pm/lock.json` 中的 Codex
版本与各平台 SHA-256，以及 `pm/packages.py` 中固定提交的许可证来源。
保留上游 `LICENSE` 和 `NOTICE`。不要在未更新引擎包时宣称修改过的源码
已用于运行。

## 在 Aino 中如何执行

Aino Code 复用 `agent/codex_runtime.py` 和 `agent/transports/aino_code/`，
通过已有 App Server 传输启动包内 Codex；Aino 继续管理账户、模型路由和会话。
`pm/packages.py` 与 `pm/lock.json` 选择同一上游版本的完整官方编译包，
`scripts/bundles/native.py` 将它连同 Python 后台、执行器和沙箱配套程序
一起放入 Aino。用户安装 Aino 后无需再次安装 Codex。

当前安装包使用这个未修改上游版本的官方编译产物，**不是本地重新编译的
Rust 产物**。源码依赖供审阅、开发及后续引擎修改使用，不会在用户首次启动时
临时克隆或编译。若要修改引擎，请按 `codex/docs/install.md` 构建，并使用
上游 `codex/scripts/build_codex_package.py` 生成完整包，再经现有 PM 校验、
签名和打包流程交付；只替换单个 codex 可执行文件会遗漏配套执行程序。

## 本地验证

在仓库根目录运行包锁、引擎入口和协议适配的回归测试：

```sh
scripts/run_tests.sh tests/pm/test_codex_package.py tests/hermes_cli/test_codex_binary_resolution.py tests/agent/transports/aino_code/
```
