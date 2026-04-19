# Video Metadata Studio

跨平台视频元数据处理工具（Electron + FFmpeg）。

用于将视频统一处理为更适合竖屏分发的输出形态，并在导出时重写元数据、更新文件指纹（MD5）、按规则重命名，支持批量处理。

## 功能特性

- 批量导入视频文件，支持拖拽文件/文件夹、手动添加文件、递归添加整个目录
- 非 `1080x1920` 视频自动缩放并补边到 `1080x1920`
- `1080x1920` 视频支持免缩放重封装（可选强制重编码）
- 导出时重写多组容器与流级元数据（含设备/系统随机化字段）
- 支持可选补帧（`60/120 FPS`）
- 支持可选内容微扰（低/中/高）与速度微改范围
- 导出后执行有效性校验，并确保输出 MD5 与原文件不同
- 支持处理完成后删除原文件（高风险选项，默认开启）
- 内置应用内更新（`electron-updater`，GitHub Releases 渠道）

## 运行环境

- macOS 12+
- Windows 10+
- Node.js 20+（建议与 CI 保持一致）

## 快速开始（开发）

1. 安装依赖

```bash
npm ci
```

2. 启动桌面应用

```bash
npm start
```

## 打包命令

```bash
# mac
npm run dist:mac

# Windows
npm run dist:win

# mac + Windows
npm run dist
```

默认输出目录为 `release/`。

## 自动发布流程

项目已内置一键发布脚本：

```bash
bash scripts/release-all.sh [patch|minor|major] [--yes] [--no-wait]
```

脚本会执行以下步骤：

1. 校验当前分支与工作区状态
2. 拉取 `main` 最新代码
3. 更新版本号（`package.json` / `package-lock.json`）
4. 提交版本变更并创建 `vX.Y.Z` 标签
5. 推送 `main` 与标签
6. 创建 GitHub Release
7. 轮询 `Build And Release` 工作流并输出产物链接
8. 校验 Release 中是否包含 `latest-mac.yml`（缺失则失败）

可选参数：

- `--no-wait`：创建 Release 后立即返回，不等待 CI 构建完成

## 自动更新说明（重要）

应用通过 `electron-updater` 从 GitHub Release 拉取更新信息，支持以下流程：

1. 点击“检查更新”
2. 发现新版本后点击“下载更新”
3. 下载完成后点击“重启安装更新”

macOS 客户端检查更新时依赖 `latest-mac.yml`，该文件必须存在于对应版本的 Release Assets 中。

若发布后点击“检查更新”报错（如 `Cannot find latest-mac.yml`）：

- 先确认 Release Assets 中是否存在 `latest-mac.yml`
- 同时应包含对应的 `zip`（及 `blockmap`）文件
- 必要时重新运行发布工作流，或手动补传缺失资产

## 项目结构

- `main.js`: Electron 主进程、IPC、更新检查
- `renderer.js`: 前端交互逻辑、任务发起与状态展示
- `preload.js`: 渲染层安全桥接 API
- `lib/videoProcessor.js`: 核心视频处理管线（FFmpeg 调用、元数据重写、校验）
- `scripts/release-all.sh`: 一键发布脚本
- `.github/workflows/release.yml`: Release 触发的 CI 构建/发布流程

## 风险提示

- “处理完成后删除原视频”为不可逆操作，请确保输入目录已备份
- 元数据重写和内容微扰属于有损处理，建议先小批量验证参数后再全量执行

## License

MIT
