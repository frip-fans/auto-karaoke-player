# auto-karaoke-player · 本地唱片室

独立的离线卡拉 OK 播放器：Node.js / TypeScript 本地服务 + React / shadcn/ui 控制台 + Electron 桌面外壳。按专辑组织曲库、同曲多版本点播、伴奏与纯人声独立混音，以及 HDMI 观众窗口。

从 [auto-karaoke](https://github.com/frip-fans/auto-karaoke) 的 `player/` 拆出，保留播放器子目录历史。只接收最终 MP4，不依赖制作引擎、歌词 JSON、分离模型或 PyTorch。音轨接口见 [MP4 约定](docs/media-format.md)。

## 开发与本地运行

需要 Node.js 22.12+ 和 FFmpeg（包含 ffprobe），不再需要 Python。Mac 可先运行 `brew install node ffmpeg`。

```bash
npm ci
npm run dev
```

打开 `http://127.0.0.1:8787`。开发模式在同一端口提供 Node.js API 和 Vite 热更新；可用 `KARAOKE_LIBRARY=/path/to/library npm run dev` 指定曲库。

构建后运行浏览器版：

```bash
npm run build
npm start -- --library /path/to/library
# 不自动打开浏览器，或修改端口：
npm start -- --library /path/to/library --port 8789 --no-browser
```

Mac 也可双击 `Start Karaoke.command`，或传入移动硬盘曲库：

```bash
bash "Start Karaoke.command" "/Volumes/My SSD/我的曲库"
```

首次启动脚本会安装 npm 依赖并构建。更新源码后请重新执行 `npm run build`。系统依赖和首次安装需要网络；构建后的应用离线运行，不请求外部字体、脚本或素材。

## Electron 桌面版

```bash
npm run desktop
# 已构建后直接启动，也可指定已有曲库：
npm run start:desktop -- --library /path/to/library
```

Electron 内嵌 Node.js 服务，不再启动 Python 子进程。主窗口和观众窗口保留 Chromium 沙箱，前端通过受限 preload 接口选择曲库。关闭主窗口会退出应用、关闭服务和转码子进程。

默认曲库为系统文档目录下的 `Karaoke/songs`；在“曲库位置与投屏”中可选择其他目录，选择后直接切换，并记住新位置。桌面版优先监听 `127.0.0.1:8787`；如果开发服务等程序占用了该端口，会自动选择空闲端口，切换曲库时沿用本次启动的端口。曲库内容不受端口影响；队列、音量和界面偏好仍属于当前浏览器来源，使用备用端口时可能显示为独立记录。开发时从 PATH 或 `FFMPEG_PATH` / `FFPROBE_PATH` 寻找媒体工具。

## 曲库、专辑、多个版本

可以把一个或多个 MP4 拖到右侧曲库区域，或点击“导入 MP4”。拖到现有专辑容器（包括折叠的专辑标题）时，导入表单自动填入该专辑名，以及按当前歌曲排序的第一首歌的歌手和版本；搜索过滤不会改变取值，确认前仍可修改。确认导入后，文件会复制进曲库。一次可以选多个，填写共有专辑、歌手、版本；每首曲名随后用“编辑”修正。**专辑、曲名、歌手相同**的条目合并展示，不同版本仍有各自的播放和点歌按钮。例如同一首歌的“专辑版”和“Live 2026”。

每个视频首次导入或扫描时会流式计算 SHA-256，并记住原文件名。再次导入相同内容，即使改名，也会自动填入已保存的歌曲信息；明确填写的字段优先。同一指纹存在多份冲突信息时不会随意选择。文件名或歌曲名相同但指纹不同，只在“编辑”中显示待确认候选，确认后才采用，而且不会跨文件复制音轨映射。

已有曲库会补充指纹，后续扫描按文件大小和时间戳复用。曲库内的视频改名或移动后，若指纹只对应一条缺失记录，会重连原歌曲 ID。数据库导入／导出本版暂不提供，搬迁仍可复制整个曲库文件夹。

曲库结构：

```text
songs/
  library.json          # 专辑、曲名、版本、音轨映射和稳定 ID
  media/*.mp4           # 相对路径，原文件内容不修改
  .karaoke-cache/       # 可删除的本地解码缓存
```

关掉服务后，拷贝整个 `songs` 文件夹即可搬到另一台设备，也可重命名曲库根目录。无需同步数据库服务。缓存可以不拷贝，下次自动生成。不要单独改 MP4 的相对路径，否则原记录会显示文件缺失。也可直接把 MP4 放进曲库后点击“↻”扫描，再编辑专辑信息。

空闲时点歌会启动 10 秒倒计时，结束后播放待唱队列第一首；追加点歌不重置计时，队列重排会改变首播歌曲。清空队列或手动播放会取消倒计时。暂停中的歌曲不会被新点歌自动打断。

当前歌曲播放到剩余 45 秒时，“播放中”区域及主播放画面、观众窗口的右上角都会显示待唱队列的下一首曲名（全屏同样显示，字号及内边距随播放区域宽度等比缩放），悬停可查看歌手和版本；调整队列会同步更新。暂停、回退到 45 秒之前或待唱队列为空时显示原播放状态。

曲库中已点歌的版本会显示“已经点歌”和全部待唱排位（从 1 开始）；悬停或键盘聚焦时显示“再次点歌”，点击可重复加入队列。排位随队列排序、移除和播放推进自动更新，不同版本分别统计。

队列、最近唱过的记录和音量存在浏览器 `localStorage`，不写入曲库、不随文件夹同步。换浏览器、设备、端口或清除网站数据会得到独立记录。最近唱过目前记录完整播放结束的歌曲。曲库本身不受影响。

## 调音与 HDMI

视频必须有浏览器支持的编码，推荐现有 H.264 / AAC MP4。画面始终静音。本地服务从 MP4 取出伴奏和**分离的纯人声**，解码为同一时间零点的 PCM；两条 AudioBufferSource 同时开始、同时定位，共用 AudioContext 时钟。

- 伴奏、人声各自 0–100%，人声增大不会降低伴奏；总音量控制混合结果。`V` 切换纯人声导唱。
- `Instrumental` / `Vocals` 标记自动识别。`Original Mix` 不会自动作为纯人声。未标记的双轨需在“编辑 → 音轨对应关系”手动确认。单轨可播放，但没有独立人声调节。
- 首播需等待本地音轨准备；5 分钟歌曲约产生 106 MB PCM 缓存、约 212 MB 解码缓冲。浏览器仅持有当前歌曲的音频；长 Live 视频会需要更多内存。
- 用两个分离 stem 相加，不保证与发行母带逐样本相同。提供轻度限幅防止叠加峰值过载；默认总音量 80%。
- HDMI 选择**扩展屏幕**。点击“观众窗口”，拖到电视/投影仪后点全屏；Mac“系统设置 → 声音”选择 HDMI 输出。观众窗口顶部有黑色拖动栏，右上角图标可进入或退出全屏；全屏时拖动栏隐藏。鼠标移出或窗口失焦约 0.3 秒后隐藏图标，窗口内静止约 1.5 秒后隐藏。观众窗口画面静音，声音由控制窗口统一输出。
- 保持控制窗口运行、电脑不休眠。Electron 观众窗口失焦、被遮挡、隐藏或最小化时保持播放，恢复可见时继续与主窗口对齐。观众页使用本机 BroadcastChannel 消息和定时同步，不依赖动画帧回调；连续定位有节流并等待上一次定位结束。普通浏览器自身的后台限制仍由浏览器决定，声音两轨共用音频时钟。可调“画面延迟”补偿电视处理延迟，正值让画面落后声音。
- 单屏使用画面右下角全屏按钮。Space 播放/暂停，左右键前后 5 秒，F 全屏。浏览器首次可能要求用户点击以启用声音或允许弹窗。

浏览器控制台与观众屏已通过 Linux Chromium / Electron 自动化验证；尚未实机验证 Windows / macOS / Safari / HDMI。建议在出门前用目标 Mac 和音响试播。应用不提供麦克风回放；麦克风接现有卡拉 OK 设备或混音器。

## 项目结构与验证

```text
src/server/       Express API、曲库、FFmpeg 转码与缓存
src/renderer/     React、shadcn/ui 本地组件、Web Audio、观众页
src/shared/       前后端共享类型与曲库接口
src/electron/     窗口、受限 preload、服务生命周期
scripts/dev.ts    单命令开发启动
```

保留 v1 `library.json` 格式、相对媒体路径及稳定歌曲 ID，已有 Python 版曲库可直接打开。旧 PCM 缓存可以删除，Node.js 版会生成自己的缓存。曲库仍用 JSON 原子写入，并串行化修改；最多同时运行两个音轨准备任务。

```bash
npm run typecheck
npm test
npx playwright install chromium
npm run test:browser
npm run test:desktop
```

测试只使用合成视频。服务测试覆盖曲库搬迁、原曲音轨排除、延迟轨道补零、音轨频率与长度、Range 请求、请求校验及并发导入。浏览器测试覆盖双轨同步启动、独立混音、暂停定位、观众窗口静音、编辑和持久化。桌面测试用 Electron 验证服务启动、preload、播放与观众窗口；Linux CI 需要 Xvfb 等虚拟显示（例如 `xvfb-run -a npm run test:desktop`）；自动化测试不替代真实 HDMI 和声卡验证。

## 桌面打包

### GitHub CI/CD 与版本发布

[GitHub Actions](https://github.com/frip-fans/auto-karaoke-player/actions/workflows/build.yml) 在 `master` / `main` 提交和 PR 时运行构建、服务、浏览器、窗口 UI 和 Electron 回归测试。推送 `vX.Y.Z` tag 后会先验证 tag 与 `package.json` / `package-lock.json` 的版本一致，且提交属于 `master` 历史，再构建并上传到 [GitHub Releases](https://github.com/frip-fans/auto-karaoke-player/releases)：

- macOS Apple Silicon：`Auto-Karaoke-Player-X.Y.Z-macOS-arm64.zip`
- macOS Intel：`Auto-Karaoke-Player-X.Y.Z-macOS-x64.zip`
- Windows x64 便携版：`Auto-Karaoke-Player-X.Y.Z-Windows-x64.exe`

每个包附有 `.sha256` 校验文件。Mac 解压后将 `Karaoke.app` 放入「应用程序」。CI 默认生成未签名、未公证的包；macOS 可能需要在「系统设置 → 隐私与安全性」允许打开，Windows 可能显示未知发布者提示。无需配置 Apple 或 Windows 签名凭据。

以后发版时，在 `master` 上更新版本、提交后打 tag（以下以 `0.1.10` 为例）：

```bash
git switch master
git pull --ff-only
npm version 0.1.10 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: release v0.1.10"
git tag -a v0.1.10 -m "Auto Karaoke Player v0.1.10"
git push --atomic origin master v0.1.10
```

也可在 Actions 页面选择分支手动运行工作流，仅生成测试用构建产物。对已有 tag 补跑发布可执行 `gh workflow run build.yml --ref vX.Y.Z`；只有全部测试和三种打包任务成功后，tag 工作流才会发布 Release。

`scripts/prepare-media-tools.mjs` 在目标系统下载并验证媒体工具，CI 自动设置打包和测试所用路径。Mac 使用 [ffmpeg-static b6.1.1](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1) 的对应架构独立二进制，Windows 使用下述 Gyan 构建；许可证、README、来源和下载校验值随包分发。Mac runner 架构使用 [GitHub 的标准 runner 标签](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) 明确区分。

### 本地打包

Windows 单文件便携版使用 electron-builder 的 `portable` 目标：

```bash
KARAOKE_MEDIA_TOOLS_DIR=/absolute/path/windows/media-tools npm run make:windows
```

输出 `out/windows/Auto-Karaoke-Player-0.1.9-Windows-x64.exe`。Windows 10/11 x64 用户只需双击这个 EXE，不需要安装或手动解压；运行时自动展开内置文件到临时目录。曲库默认存放在文档目录，可在应用中切换；队列和设置保存在用户应用数据目录。不要把歌曲放到自动解压的临时目录。此便携构建未签名，Windows 可能显示未知发布者提示。

Windows 媒体工具使用 Gyan 的 FFmpeg 9.0.1 essentials x64 构建；发布目录同时包含上游 LICENSE、README 和来源信息。构建前校验原始 ZIP 的 SHA-256：`fec81ae03971d9dd4be3ebe02e263bd2ec1d789483f931bdba5f5715e65da2e9`。下载地址见 [Gyan 发布页](https://github.com/GyanD/codexffmpeg/releases/tag/9.0.1)。

其他平台或 ZIP 发行：

使用 Electron Forge，构建产物位于 `out/`。在目标系统和 CPU 架构上准备一个名为 `media-tools` 的目录，放入可独立分发的 `ffmpeg`、`ffprobe`（Windows 为 `.exe`）及对应许可证文件。不要直接把依赖开发机动态库的 Homebrew 可执行文件当成可移植发行物。

```bash
KARAOKE_MEDIA_TOOLS_DIR=/absolute/path/media-tools npm run make
```

打包会将整个 `media-tools` 目录放到应用资源目录；用户运行成品时无需安装 Node.js、Python 或 FFmpeg。个人曲库和缓存不进入应用包，复制曲库文件夹即可搬迁。Mac 正式分发可配置 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 启用签名及公证；未配置时生成未签名包。

Windows 顶栏按系统窗口按钮的实际区域自动避让，窗口大小和缩放变化时重新计算，避免覆盖导入和设置按钮。React 界面使用可调整的双栏布局：拖动两栏之间的分隔线调整宽度，松开后自动记住比例；双击恢复默认，也支持聚焦分隔线后用方向键调整。窄窗口自动上下排列。曲库默认按专辑折叠，点击专辑平滑展开或收起歌曲；动画遵循系统“减少动态效果”设置。悬停专辑图标时变成拖动把手，可调整专辑顺序，并保存到曲库；聚焦图标后也可用 ↑↓ 调整。搜索会自动展开匹配的专辑。拖动歌曲左侧把手可在专辑内排序，同一首歌的多个版本一起移动；也支持聚焦把手后用 ↑↓ 调整。顺序写入曲库 `library.json`，刷新、重启和搬迁后保留。歌曲第一排显示曲名和点歌按钮；第二排显示歌手、版本 badge、播放和图标编辑按钮。Button / Input 使用 shadcn/ui 的本地源码方式，界面图标统一使用 Lucide，配置见 `components.json`，可继续按需添加组件，无需引入 Next.js 或 SSR。

## 开发边界

本仓库负责曲库、播放、混音与投屏。歌词制作、分离、时间轴审核和视频烧录由制作工具负责。媒体、曲库、缓存和分发 ZIP 不进入 Git；合成测试不使用真实歌曲。默认曲库为根目录 `songs/`，也可用 `--library` 指定任意可读写曲库目录。

开发依赖审计：已约束 tar 和 tmp 到修复版本。打包工具链间接使用的 extract-zip 当前仍有上游未修复的审计告警；不进入播放器运行依赖。构建仅使用官方发布来源及校验过的媒体压缩包。
