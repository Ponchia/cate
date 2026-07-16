<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/cate-logo.svg" />
    <img src="assets/cate-logo-light.svg" alt="Cate" width="140" />
  </picture>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.de.md">Deutsch</a>
</p>

> **注意：** 本翻译由机器自动生成，可能存在不准确之处。

<p align="center">
  编码智能体的任务控制中心：一块容纳终端、编辑器、浏览器和文档的无限画布。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/0-AI-UG/cate?style=flat-square" alt="MIT License" /></a>
  <a href="https://github.com/0-AI-UG/cate/actions"><img src="https://img.shields.io/github/actions/workflow/status/0-AI-UG/cate/ci.yml?style=flat-square" alt="CI" /></a>
  <a href="https://github.com/0-AI-UG/cate/releases"><img src="https://img.shields.io/github/downloads/0-AI-UG/cate/total?style=flat-square" alt="Downloads" /></a>
</p>

---

<p align="center">
  <img src="assets/demo-canvas.gif" alt="Cate demo" width="900" />
</p>

Cate 是一款基于无限画布的桌面 IDE，为同时运行大量终端和编码智能体而设计。在 Cate 终端里运行 Claude Code、Codex 或任意智能体 CLI，画布就成了任务控制中心：每个终端都会显示它的智能体是在工作、已完成还是在等你，一旦有智能体需要输入，Cate 会立即发出通知。一键创建并行的 git worktree，每个 worktree 在画布上拥有自己的彩色领地，五个智能体跑在五个分支上，依然是五条泾渭分明的工作流，而不是一堆标签页。

围绕这个核心是一套完整的 IDE：Monaco 编辑器、内嵌浏览器、文档查看器、git 工具和内置智能体聊天。面板可以浮在画布任意位置、停靠成标签和分屏，或拆分到独立的系统窗口。重新打开文件夹时，Cate 会还原整个布局。

**快速开始：** 打开一个文件夹，它就成为一个工作区。右键添加面板，按 `Cmd+K` 打开命令面板，把面板拖到停靠区即可创建标签和分屏。无需任何配置文件。

## 安装

下载预构建版本。日常使用请勿从源码构建。

| 平台 | 格式 | 链接 |
|----------|---------|------|
| macOS | DMG、ZIP（`arm64`、`x64`） | [最新版本](https://github.com/0-AI-UG/cate/releases/latest) |
| Windows | NSIS 安装器、ZIP（`x64`） | [最新版本](https://github.com/0-AI-UG/cate/releases/latest) |
| Linux | AppImage、DEB、`tar.gz`（`x64`） | [最新版本](https://github.com/0-AI-UG/cate/releases/latest) |

## 包含什么

- **感知智能体的终端：** Cate 能检测在任意终端中运行的编码智能体（Claude Code、Codex 等）。标签页实时显示智能体状态：运行中、已完成或等待输入，当智能体需要你时还会发出系统通知。终端在重启和跨窗口移动后保留回滚缓冲、颜色和全屏 TUI。
- **并行工作：** 描述你要做什么，Cate 就会创建一个 git worktree，带有自己的分支、颜色和画布领地。可以把 PR 直接检出到 worktree，还能自动把 `.env` 或 `node_modules` 符号链接到每个新 worktree。
- **智能体可驱动的浏览器：** 内置浏览器面板，智能体可通过 `cate` CLI 在 shell 中控制：打开页面、截图、读取无障碍快照、点击和输入。
- **内置智能体聊天：** 内嵌编码智能体（Pi），支持聊天线程和按线程记忆模型。通过 OAuth 或 API key 接入 Anthropic、OpenAI Codex、GitHub Copilot、Gemini、OpenRouter、Groq、Mistral、DeepSeek 等。
- **画布与布局：** 无限缩放和平移，四个区域的标签和分屏停靠，可拆分窗口，保存布局，多项目会话还原。
- **编辑器与文档：** Monaco 编辑器，支持语法高亮、多光标、差异对比和 Markdown 预览；文档面板可渲染 PDF、DOCX 和图片。
- **Git：** 感知 git 的文件树，带实时监听；外加版本控制侧边栏，处理暂存、分支、worktree、历史和行内差异。全文搜索。
- **远程工作区：** 通过 SSH 连接远程机器，像本地文件夹一样工作。终端、智能体和搜索通过轻量级运行时守护进程在远端执行。
- **导航：** 跨画布搜索文件、终端回滚和面板标题；命令面板；面板间键盘导航。

## 扩展

Cate 提供第三方面板的扩展系统（MCP 服务器、图表等），每个扩展运行在独立的隔离 webview 中。在配套仓库浏览和开发：[0-AI-UG/cate-extensions](https://github.com/0-AI-UG/cate-extensions)。

## 键盘快捷键

下表为 macOS；Windows/Linux 上用 `Ctrl` 代替 `Cmd`。

| 面板与文件 | | 视图与导航 | |
|---|---|---|---|
| 新建终端 | `Cmd+T` | 命令面板 | `Cmd+K` |
| 新建编辑器 | `Cmd+Shift+E` | 全局搜索 | `Cmd+Shift+F` |
| 新建浏览器 | `Cmd+Shift+B` | 切换侧边栏 | `Cmd+B` |
| 新建智能体 | `Cmd+Shift+A` | 切换文件浏览器 | `Cmd+Shift+X` |
| 新建画布 | `Cmd+Shift+C` | 切换小地图 | `Cmd+Shift+M` |
| 新建文件 | `Cmd+N` | 聚焦下一个 / 上一个面板 | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| 保存文件 | `Cmd+S` | 在面板间移动 | `Cmd+←↑↓→` |
| 关闭面板 | `Cmd+W` | 删除聚焦的面板 | `Cmd+Backspace` |

| 画布 | |
|---|---|
| 放大 / 缩小 | `Cmd+=` / `Cmd+-` |
| 重置缩放 | `Cmd+0` |
| 缩放至全部 / 选区 | `Cmd+1` / `Cmd+2` |
| 自动布局画布 | `Cmd+Shift+L` |
| 平移画布 | `Shift+←↑↓→` |
| 切换选择 / 抓手工具 | `Shift+Space` |
| 撤销 / 重做 | `Cmd+Z` / `Cmd+Shift+Z` |

所有快捷键都可以在设置中重新绑定。

## 从源码构建

面向贡献者。其他情况请用上面的发布版本。

**前置条件：**
- [Bun](https://bun.sh)：包管理器和脚本运行器。
- [Node.js](https://nodejs.org/) 20 或 22 LTS（见 `.nvmrc`），需在 PATH 中。构建脚本在其下运行；运行时守护进程自带 Node 22。
- **仅 Linux：** `node-pty` 为 macOS 和 Windows 提供预构建二进制，但不含 Linux，因此需要从源码编译。请安装 Python 3 和 C++ 工具链：
  - Debian/Ubuntu：`sudo apt install build-essential python3`
  - Fedora/RHEL：`sudo dnf install @development-tools gcc-c++ make python3`
  - Arch：`sudo pacman -S base-devel python`

全新克隆后，一条命令完成全部准备（安装依赖并构建本地运行时守护进程）：

```bash
git clone https://github.com/0-AI-UG/cate.git
cd cate
bun run setup
```

然后：

```bash
bun run dev          # 带热重载的开发服务器
bun run typecheck
bun run test         # 单元测试（vitest）
bun run test:e2e     # Playwright 集成测试
bun run build        # 生产构建
bun run package      # 打包分发（:mac、:win、:linux）
```

打包后的二进制文件位于 `release/`。运行时守护进程由 `bun run runtime:tarball` 重新构建（修改 `src/runtime/` 下的内容后需重新运行）。

## 架构

```text
src/
├── agent/      # 内置 Pi 编码智能体：进程管理、鉴权、市场、面板 UI
├── cli/        # Cate 终端内可用的 `cate` CLI（浏览器控制、面板、编辑器）
├── main/       # Electron 主进程：IPC、工作区、窗口、更新器、安全
├── preload/    # 上下文隔离的 IPC 桥
├── renderer/   # React 18 应用：画布、停靠、面板、侧边栏、store、hooks
├── runtime/    # 远程（SSH）工作区的运行时守护进程：终端、智能体、搜索
└── shared/     # IPC 通道与共享类型
```

Cate 的所有 IPC 都经过上下文隔离的 preload 桥。文件系统访问限定在已注册的工作区根目录，浏览器面板禁用 Node 集成，终端无法在批准目录之外启动。

**技术栈：** Electron 41、React 18、Zustand 5、Monaco 0.52、xterm.js 5.5 + node-pty 1.0、Tailwind 3.4、electron-vite、electron-builder、electron-updater、Sentry。PDF 和 DOCX 用 pdf.js 与 mammoth，git 用 simple-git，文件监听用 `@parcel/watcher` 与 chokidar。内置编码智能体基于 `@earendil-works/pi`，作为按需运行时随应用分发。

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。逐版本的历史记录在 [CHANGELOG](CHANGELOG.md)。

## Star 历史

<a href="https://www.star-history.com/?repos=0-AI-UG%2Fcate&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=0-AI-UG/cate&type=date&theme=dark&legend=top-left&sealed_token=LE-sv5TdJtUmugufglkRue9ZJ6mVXcScJNurvXl9qwGAOHy-taiZA7-UfpBCAHbsxUZESm-1aSxX55u3DTth--kCTUty5gqe7XMhmI-dHz2IOkizZgAk26fW8iovuRbeMSyla3c2T9w9fAj6x2_SZZEGbmvonWJvvLcI-X35nHZFkQQIn_ueBO07uQZM" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=0-AI-UG/cate&type=date&legend=top-left&sealed_token=LE-sv5TdJtUmugufglkRue9ZJ6mVXcScJNurvXl9qwGAOHy-taiZA7-UfpBCAHbsxUZESm-1aSxX55u3DTth--kCTUty5gqe7XMhmI-dHz2IOkizZgAk26fW8iovuRbeMSyla3c2T9w9fAj6x2_SZZEGbmvonWJvvLcI-X35nHZFkQQIn_ueBO07uQZM" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=0-AI-UG/cate&type=date&legend=top-left&sealed_token=LE-sv5TdJtUmugufglkRue9ZJ6mVXcScJNurvXl9qwGAOHy-taiZA7-UfpBCAHbsxUZESm-1aSxX55u3DTth--kCTUty5gqe7XMhmI-dHz2IOkizZgAk26fW8iovuRbeMSyla3c2T9w9fAj6x2_SZZEGbmvonWJvvLcI-X35nHZFkQQIn_ueBO07uQZM" />
 </picture>
</a>

## 许可证

[MIT](LICENSE)
