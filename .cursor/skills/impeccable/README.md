# Impeccable 项目技能

这是 pixel-aigc 仓库内的项目技能，路径是 `.cursor/skills/impeccable`。把它放进仓库不会使 Impeccable 在云端全局可用；只有读取本仓库、并且任务触发该技能的代理才会用到它。本说明不是技能指令。

## 版本与来源

- 技能版本：`4.8.0`（`SKILL.md` 的 `metadata.version`）。
- 引擎版本：`0.1.18`（`scripts/VERSION`）。引擎二进制不在此目录中。
- 来源：Codex 本机安装的同一份 4.8.0 项目分发，压缩包 SHA256 `6cf678056be028ed49980e97ef87f00d56842b76b951ef9e33402e412b8b8a2b`，共 63 个文件。
- 对照：其中 62 个文件与 [pbakaus/impeccable@7510e233](https://github.com/pbakaus/impeccable/tree/7510e233b228864606888d252abacf5e7148bf87/.agents/skills/impeccable) 的 git blob 字节一致。该提交仍把技能标为 4.8.0，时间晚于 tag `skill-v4.8.0`。`scripts/impeccable.cmd` 正文相同；压缩包使用 CRLF，仓库用 `.gitattributes` 在检出时保留 CRLF。

## 许可证

上游仓库许可证是 Apache-2.0，版权 2025 Paul Bakaus。技能压缩包本身没有 `LICENSE` 或 `NOTICE`。这里补上的是上述提交仓库根目录的原文：

- `LICENSE`
- `NOTICE.md`：`reference/ios.md` 与 `reference/android.md` 改编自 [ehmo/platform-design-skills](https://github.com/ehmo/platform-design-skills)（MIT，作者 ehmo）。

## 调用

在本仓库的设计任务中直接要求使用 Impeccable。脚本入口：

- POSIX：`.cursor/skills/impeccable/scripts/impeccable`（可执行）
- Windows：`.cursor/skills/impeccable/scripts/impeccable.cmd`

`SKILL.md` 把包含该文件的目录定义为 `<skill-base-dir>`。正文里的 `.agents/skills/impeccable/scripts/impeccable` 由这个目录解析；只有运行时没有 base directory 时，才回退到字面路径 `.agents/skills/impeccable/scripts`。这次没有改那些句子。启动器自己用脚本所在目录设置 `IMPECCABLE_SKILL_DIR`，不依赖 `.agents` 路径，也不依赖本机绝对路径。

## 依赖

启动器不需要 Node。首次运行会从 `https://github.com/pbakaus/impeccable/releases/download/engine-v0.1.18/` 下载对应平台的引擎到用户缓存（默认 `~/.impeccable`），并用旁边的 `scripts/engine-checksums.txt` 校验；校验失败则拒绝执行。可用 `IMPECCABLE_BIN` 指向已安装的引擎，或用 `IMPECCABLE_HOME` 改缓存位置。不要把引擎、缓存、`.impeccable/` 运行产物或凭证提交进仓库。
