# 艾莉丝的神秘空间

## 最高准则

### Alice-pet 动画生成必须遵守的强制规则

（原文摘自 prompts/桌面宠物 10 秒动作提示词.md，未作任何改动）

#### 【绝对空间与边界约束强制命令】

视频比例 16:9，背景必须为纯粹的绿幕色（标准 Chroma Key Green，颜色严格统一为 #00FF00），无任何阴影、杂物、渐变或边框，背景本身即为单一纯色块。

人物位置与大小强制固定：人物必须完完全全处于画面正中心偏下位置。人物头顶始终处于画面垂直方向约 20% 的位置，脚底始终处于画面垂直方向约 85% 的位置，最左和最右边缘始终处于画面水平方向约 25% 和 75% 的位置。不同视频之间的人物大小、位置、比例必须完全一致，不允许有任何偏差。

人物周围缓冲区（防裁切）：人物头顶距离画幅顶边至少保留 15% 画幅高度的绿色空间，脚底距离画幅底边至少保留 10% 画幅高度的绿色空间，身体左右两侧距离画幅边缘至少保留 10% 画幅宽度的绿色空间。

#### 【画幅安全红线（统一数值，全程强制）】

全库安全缓冲统一为画幅任意一边的 10%。动作全程任何一帧，角色任何身体部位（顶部的呆毛、耳侧的鳍饰、底部的裙摆与鲸鱼尾巴、手脚与指尖）以及所有道具与特效对象，在最高点/最外点都必须与画幅对应边缘保持 ≥10% 画幅宽/高的安全间距；绝对禁止任何部位或对象接触、触碰、超出或被裁剪（剪切）。动作全程必须在画幅内部完成。

#### 【绝对居中锚点（强制）】

人物双脚落点坐标恒定为屏幕正中央，全程不允许产生 X 轴或 Y 轴平移位移（仅允许轴心旋转、原地跳跃、脚尖原地点地）。无论出现多大体积的道具或场景对象，角色与对象的组合视觉重心必须始终保持在画面水平正中；严禁为了容纳道具或对象而把角色整体向左右移动、向后移动或靠向画幅边缘。

#### 【大物件构图规则（强制）】

出现较大体积物件（如圣诞树、木马、烟花、雪人、孔明灯等，高度＞画幅 30% 时）——① 物件必须位于角色正前方 / 正上方 / 环绕角色轴线，并与角色共用画面水平中心线，禁止放成“身侧/一侧偏左偏右”导致画面重心偏移；② 若物件受画幅所限放不下，宁可把物件 Q 版缩小以整体入画并保持在安全区内，绝不移动人物来腾空间；③ 角色与物件必须同框，人物始终占据画面中心主干位置，双脚与原点静止。

#### 【“无→有→无”道具闭环（强制）】

所有含道具/特效/交互对象的视频，入场第一帧必须是与参考图完全一致的标准正面站立、画面干净——无任何道具、无任何特效、无任何对象（仅纯绿幕背景 + 角色本体）；道具与对象一律由角色以魔法手势从无到有、由虚到实地渐进凝聚生成（先出现半透明虚影轮廓，约 0.5~1 秒后凝实为实体），绝不直接出现在起始帧；并在动作结束前从有到无、由实到虚地渐次消散（约 0.5~1 秒化为光点淡去），使画面回到无任何道具的标准正面站立。任何一帧都不得凭空直接出现未经生成过程的道具，最终帧不得残留任何道具或特效。

#### 【侧身互动 ≠ 构图横移（强制）】

需要侧身/转身面向物件的互动，一律指角色原地轴心转动上身、头部或脚尖原地点地转向来面向物件，双脚与画面中心原点始终保持静止、不横移、不后移、不靠边；凡“退后、后退、后移、走到一侧、挪到旁边、偏右/偏左站位”等会造成整体位移的描述一律视为违规，应改写为原地轴转或原地重心微调。

#### 首尾帧强制要求

所有视频必须以参考图最左侧的标准正面图为第一起始帧（此帧画面干净、无任何道具或特效），并在视频最后一秒（第 10 秒结束时）彻底恢复到与第一帧完全一致、无道具残留的标准正面站立姿态。

不同视频之间的绿色背景色值必须完全一致，不允许有色差。


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
| `alice-pet-study-20261117.md` | Alice-pet 开源桌宠研学笔记（物理与动作设计参考） |

## 动画制作流程

1. 正式新动作以 `clips-green/v2/<name>.mp4` 入仓，源规范为纯绿幕、固定站位、动作分段；不再从黑底旧素材转码。
2. 运行 `py tools/process-green.py --ffmpeg <ffmpeg.exe> --clip <name>`。处理器执行 HSV 绿幕抠像、去绿溢色、固定仿射归一化，并编码 640×360 VP9-alpha WebM 到 `AliceButler/electron/media/`。
3. 站姿按人物宽约 33%、头顶 17%、脚底 85%、中心 51% 对齐；睡姿按头顶 33%、脚底 85%、中心 51% 对齐。人物宽度由原图比例决定，不横向拉伸。doze 的 Zzz 等分离特效必须保留。
4. `idle`、`walk`、`doze` 循环片必须通过解码后首尾 RGBA 完全一致检查；每段还必须通过逐帧 alpha 存在、不透明纯黑 <5% 和 640×360/24fps 检查。逐段结果写入 `docs/green-assets-validation/<name>.json`。
5. 睡眠接缝按主线 `4b1a5da` 的源片锚定：`sleepstart` 尾 24 帧拉向 `doze` 首帧，`wakeup` 首 24 帧拉向 `doze` 末帧、尾 24 帧拉向 `idle` 首帧；两段过渡片使用 CRF 24 高码率有损 VP9 和双端关键帧，目标单段约 1MB，三处接缝 MAE 必须 <0.5。
6. 动作池、权重和点击防连抽只在 `AliceButler/electron/config.json` 接线；缺动作等待艾莉丝后续入仓，不自行生成视频。

旧动画目录及黑底源视频目录已经删除，不再从本仓恢复。文末遗留的 WinForms/黑底说明只记录历史，不是当前动作来源。

## 维护流程：加入新动作

加入大量新动作后的维护流程如下：

### 1. 素材层（必做）

| 步骤 | 操作 |
|------|------|
| 源视频 | 新生成的 mp4 放到 `video/`（不进 Git） |
| 跑素材链 | `watermark → chroma → normalize → encode` |
| 最终产物 | 把 `step04/*.webm` 复制到对应目录：<br>• 主宠物：`Alice-pet/assets/webm/` 或 `$ALICE_HOME/Alice-pet/main-animation/webm/`<br>• 自定义种类：`pet/<种类名>-animation/webm/` |
| macOS | 额外生成 HEVC `.mov` 放到对应 `mov/` 目录 |

### 2. 配置层（必做）

编辑 `config.jsonc`（或你的 `pet/<种类>-config.json`）里的 `animations` 字段，把新动作名加进去：

```jsonc
"animations": {
  "idle": ["待机呼吸休闲", "你的新待机"],
  "clicks": ["点击回应-开心跃动", "你的新点击动作"],
  "moves": {
    "actions": [
      { "name": "螃蟹走路" },
      { "name": "你的新移动动作" }
    ]
  },
  "categories": {
    // AI 对话时可选的动作分类
    "happy": ["你的开心动作"],
    "work": ["你的工作动作"]
  },
  "events": {
    "balance": ["余额-钱袋满溢", "你的新余额动作"]
  },
  "sleep": {
    "start": ["入睡动作"],
    "loop": ["循环动作"],
    "end": ["醒来动作"]
  }
}
```

动作名必须和 `.webm` 文件名一致（不含扩展名）。

### 3. 权重与分类（建议做）

- `animationWeights`：调整 idle / turn / move 的出现概率
- `categories`：给 AI 对话时选动作用，按情绪/场景分类
- 睡觉动作单独维护 `start / loop / end` 三段，注意帧衔接

### 4. 维护建议

| 场景 | 做法 |
|------|------|
| 少量新增 | 直接改 `config.jsonc` + 丢 webm 进去 |
| 大量新增 | 建议自己做一个动作清单（JSON/表格），记录：动作名、分类、权重、是否需要特殊处理（移动/睡觉/事件） |
| 自定义宠物种类 | 用 pet pack，动画和配置完全隔离，不影响主宠物 |
| 版本管理 | 源视频不进 Git；webm 和 config.jsonc 进 Git 或单独打包 |

### 推荐工作流

1. 新动作生成 → 命名规范统一
2. 跑素材链 → 得到 webm
3. 更新 `config.jsonc` 的对应池子
4. 测试播放与衔接
5. 按需调整权重 / 分类

## 部署

- 目标机：主人 Windows 电脑，运行目录 `C:\ProgramData\AliceButler\`，计划任务 AliceButler（管家）＋ AlicePetLaunch（桌宠）＋ AliceButlerWatchdog（看门狗）。
- 先运行 `npm run package`，再执行 `tools/deploy-pet.sh`。脚本会逐文件暂存并校验 → 写暂停标记并停止旧 WinForms → 把旧 `anim/anim-flat/anim60/sprites` 原子移入本次备份 → 换入 Electron → 通过既有 AlicePetLaunch 拉起 → 检查新 video 启动日志/心跳和 runner 冒烟回执 `exitCode=0`；失败自动恢复文件与旧素材。
- 单段素材替换使用 `tools/deploy-pet.sh --asset idle`；脚本只修改目标段并校验其余八段哈希不变。
- 生产二进制名是 **AlicePetNew.exe**（原名 AlicePet.exe 被杀软按文件名拦截，别改回去）。
- Electron 生产包包含 Chromium/Electron 与全部九段 WebM，不再依赖 `.NET Framework` 编译。
- **部署源只在本仓维护，禁止直接改目标机上的副本。**

## 架构与纪律

先读 `AliceButler/ARCHITECTURE.md`、`MODULE-MAP.md`、`PROTOCOL.md`、`CHANGE-DISCIPLINE.md` 四份，再动代码。要点：

- 动画纪律：UI 动效 ≤300ms、只用 transform/opacity 类手段；动作切换有 180ms 交叉淡化（pet.Render.cs 的 PresentFrame），别退回硬切。
- 帧解码走后台线程＋环形缓存（ClipCache），别在 UI 线程同步解码整段。
- 聊天桥：桌宠写 inbox → 外部钩子唤醒回复 → 回复必须经 `tools/pet-reply.sh` 原子投递到 outbox。
- 改完必验：部署冒烟回执 exitCode 0 才算数；动画素材改动后回读 pet-stats.json 对比 tickMax / diskLoads。
