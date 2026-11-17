# 艾莉丝的神秘空间

> 当前重建线：Electron＋TypeScript＋原生 video VP9-alpha，正式源位于 `AliceButler/electron/`。旧 WinForms `pet*.cs` 保留为归档源码；旧动作帧与黑底源视频已按主线 `4c43f67` 全量删除。新素材只加工 `clips-green/v2/` 的绿幕视频；素材与接缝限制见 `docs/green-assets-validation.md`，开发/打包见 `AliceButler/electron/README.md`。下方旧 WinForms 架构和黑底流程为历史记录，不再用于当前动作。

新部署入口仍为 `tools/deploy-pet.sh`，调用 `deploy-electron.ps1` 校验完整包、备份覆盖文件、启动既有 AlicePetLaunch 并检查冒烟 done 回执。exe 沿用 AlicePetNew.exe；runner/watchdog/计划任务与 ACL 不变。旧部署脚本归档于 `tools/archive/deploy-pet-winforms.sh`。

桌宠「艾莉丝」（AliceButler）的完整仓库：程序源码、全部动画素材、动画制作流程与部署工具都在这里。后续开发（GPT / Codex）直接在本仓进行。

## 她是谁

- 扁平 2D 红发少女：珊瑚红蓬松微卷长发、头顶大呆毛、侧发小翘角；白衬衫＋红领结＋棕色背带格裙、白袜棕鞋；大红眼睛、腮红。
- **形象红线：别改脸、别改配色、别丢呆毛。** 定版标准图在部署源素材里（pet-flat.png 系列）。
- 她是 Windows 桌面宠物：分层透明窗口、逐像素点击命中、弹簧物理拖拽、待机随机动作、单击反馈、聊天窗（与主人的主聊天打通）、工作状态同步。

## 目录地图

| 路径 | 内容 |
|---|---|
| `AliceButler/electron/` | **当前播放器**：Electron/TypeScript 源码、九段正式动作配置、测试与 640×360 VP9-alpha WebM |
| `AliceButler/` | 管家、看门狗、部署兼容文件；旧 WinForms `pet*.cs` 保留为归档源码 |
| `AliceButler/assets/` | 仅保留头像与静态形象图；旧 `anim/`、`anim-flat/`、`anim60/`、`sprites/` 已删除 |
| `clips-green/v2/` | 九段正式绿幕源视频与锚图 |
| `process60.py`、`process60b.py` | 60 帧管线：抽帧→minterpolate 插帧→抠像→归一化 |
| `process_clips.py`、`process_clips_flat.py`、`process_clips_flat2.py` | 扁平风动画管线 |
| `rekey_all.py` | **黑底重抠像**（见下方红线） |
| `quantize60b.py` | 帧量化（256 色 FASTOCTREE＋抖动，与管线一致） |
| `make_*.py`、`slice_sheet.py`、`split-pet.py` | 素材制作/源码拆分辅助脚本 |
| `docs/动作视频提示词配方.md` | 生成新动画视频的提示词配方 |
| `tools/` | 部署与运维：deploy-pet.sh（一键部署）、pet-reply.sh、alice-presence.sh、run-uishot.sh、pc-transfer.sh、health-pet.ps1、uishot*.cs |
| `audit-50-20261117/` | 2026-11-17 第二轮 50 次迭代审计报告（ITERATIONS.md / SUMMARY.md） |
| `dsh-pet-study-20261117.md` | dsh-pet 开源桌宠研学笔记（物理与动作设计参考） |

## 动画制作流程

1. 正式新动作以 `clips-green/v2/<name>.mp4` 入仓，源规范为纯绿幕、固定站位、动作分段；不再从黑底旧素材转码。
2. 运行 `py tools/process-green.py --ffmpeg <ffmpeg.exe> --clip <name>`。处理器执行 HSV 绿幕抠像、去绿溢色、固定仿射归一化，并编码 640×360 VP9-alpha WebM 到 `AliceButler/electron/media/`。
3. 站姿按人物宽约 33%、头顶 17%、脚底 85%、中心 51% 对齐；睡姿按头顶 33%、脚底 85%、中心 51% 对齐。人物宽度由原图比例决定，不横向拉伸。doze 的 Zzz 等分离特效必须保留。
4. `idle`、`walk`、`doze` 循环片必须通过解码后首尾 RGBA 完全一致检查；每段还必须通过逐帧 alpha 存在、不透明纯黑 <5% 和 640×360/24fps 检查。逐段结果写入 `docs/green-assets-validation/<name>.json`。
5. 动作池、权重和点击防连抽只在 `AliceButler/electron/config.json` 接线；缺动作等待艾莉丝后续入仓，不自行生成视频。

旧动画目录及黑底源视频目录已经删除，不再从本仓恢复。文末遗留的 WinForms/黑底说明只记录历史，不是当前动作来源。

## 部署

- 目标机：主人 Windows 电脑，运行目录 `C:\ProgramData\AliceButler\`，计划任务 AliceButler（管家）＋ AlicePetLaunch（桌宠）＋ AliceButlerWatchdog（看门狗）。
- 一键部署：`tools/deploy-pet.sh`（素材变更加 `--assets`）；它会推源码→逐文件哈希校验→编译到临时 exe→验新鲜→换版→拉起→冒烟自检，失败自动回滚上一版。
- 生产二进制名是 **AlicePetNew.exe**（原名 AlicePet.exe 被杀软按文件名拦截，别改回去）。
- 编译器：`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`，引用 System / System.Drawing / System.Windows.Forms / System.Web.Extensions，多文件清单见 deploy-pet.sh。
- **部署源只在本仓维护，禁止直接改目标机上的副本。**

## 架构与纪律

先读 `AliceButler/ARCHITECTURE.md`、`MODULE-MAP.md`、`PROTOCOL.md`、`CHANGE-DISCIPLINE.md` 四份，再动代码。要点：

- 动画纪律：UI 动效 ≤300ms、只用 transform/opacity 类手段；动作切换有 180ms 交叉淡化（pet.Render.cs 的 PresentFrame），别退回硬切。
- 帧解码走后台线程＋环形缓存（ClipCache），别在 UI 线程同步解码整段。
- 聊天桥：桌宠写 inbox → 外部钩子唤醒回复 → 回复必须经 `tools/pet-reply.sh` 原子投递到 outbox。
- 改完必验：部署冒烟回执 exitCode 0 才算数；动画素材改动后回读 pet-stats.json 对比 tickMax / diskLoads。
