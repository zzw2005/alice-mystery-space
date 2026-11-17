# 艾莉丝的神秘空间

桌宠「艾莉丝」（AliceButler）的完整仓库：程序源码、全部动画素材、动画制作流程与部署工具都在这里。后续开发（GPT / Codex）直接在本仓进行。

## 她是谁

- 扁平 2D 红发少女：珊瑚红蓬松微卷长发、头顶大呆毛、侧发小翘角；白衬衫＋红领结＋棕色背带格裙、白袜棕鞋；大红眼睛、腮红。
- **形象红线：别改脸、别改配色、别丢呆毛。** 定版标准图在部署源素材里（pet-flat.png 系列）。
- 她是 Windows 桌面宠物：分层透明窗口、逐像素点击命中、弹簧物理拖拽、待机随机动作、单击反馈、聊天窗（与主人的主聊天打通）、工作状态同步。

## 目录地图

| 路径 | 内容 |
|---|---|
| `AliceButler/` | **部署源（唯一权威）**：桌宠 C# 源码（pet.cs ＋ 6 个 partial）、runner.js、watchdog.js、四份架构文档（ARCHITECTURE / MODULE-MAP / PROTOCOL / CHANGE-DISCIPLINE）、butler-config.json、assets/ 全部动画帧 |
| `AliceButler/assets/anim60/` | 60 帧动画 15 段（视频管线产物，400×462） |
| `AliceButler/assets/anim-flat/` | 扁平风动画 12 段（520×600 / 400×462） |
| `AliceButler/assets/sprites/` | 精灵图动画 4 段（呼吸/走路/打盹/爱心） |
| `clips-flat2/` | anim60 的源视频（黑底） |
| `clips/`、`clips-flat/`、`clips60/` | 其余各批动画源视频 |
| `sprite-frames/` | 精灵图源帧 |
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

1. 按 `docs/动作视频提示词配方.md` 生成源视频（黑底、角色居中、动作完整）。
2. 跑对应管线脚本抽帧、插帧、归一化到 400×462（或 520×600）。
3. **抠像红线**：源视频是黑底，必须用黑底抠像（`rekey_all.py` 的做法：边缘连通域洪泛＋光晕羽化）。历史上管线误用了绿幕抠像，黑底整块残留成「黑框」，2026-11-17 已全量重抠修复——新素材入仓前逐段验：不透明纯黑像素占比应 <5%。
4. 量化（`quantize60b.py` 同款参数）后放入 `AliceButler/assets/` 对应分组，在 pet.Clips.cs 的片段表里登记（名字、帧率、循环/单次、接线点）。

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
