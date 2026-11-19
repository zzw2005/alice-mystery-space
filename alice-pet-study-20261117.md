# dsh-pet 研学笔记（2026-11-17，PC2005-cloud/dsh-pet，6391 星，MIT）

## 动画规格（实测）
- 共 114 个动作，每个动作＝一段 10.04 秒视频，24fps，约 241 帧。
- 播放格式：640×360 VP9-alpha 透明 WebM（逐个文件）；macOS 另备 HEVC-alpha .mov（Release assets-mov）。不是逐帧图，是视频直播（Electron <video>）。
- 抽样实测 5 个文件（待机/奔跑/睡觉循环/点击/拖拽）规格全一致：vp9、640×360、24fps、10.042s。

## 制作管线（MAKE-YOUR-OWN-PET.md）
1. AI 视频工具（该项目用豆包）按 prompts 配方生成 10 秒绿幕视频：16:9、纯绿幕 #00FF00、人物位置大小固定（头顶约 20%、脚底约 85%）、首尾帧为标准正面站立（保循环无缝）、动作按秒分解写提示词。
2. 素材链：watermark_step01 去水印 → 抠像（路线 A 自动 HSV 色度抠像；路线 B PR 手工抠像导出 ProRes 4444 alpha 后导入——该项目全量用 B）→ normalize_step03 归一化 2160×1215 统一站位 → encode_thumbs 转码 640×360 播放变体。
3. 睡觉是三段接力：入睡 start → 循环 loop → 醒来 end；循环段首尾帧必须完全相同；入睡尾帧＝循环首帧＝醒来首帧、醒来尾帧＝入睡首帧，生成后先比对再进素材链；可配多套睡姿（蹲着睡/趴着睡），整套随机、段内随机避刚播过。

## 组织方式（config.jsonc 的 animations，配置驱动）
- 池：idle 待机池、turn 转向池（播完翻朝向，如东张西望）、drag 拖拽池（悬空姿势）、clicks 点击回应池 5 个随机抽、moves 移动池（每动作可设 minDist/maxDist/贴边距/leadSec/tailSec 首尾静止秒数，距离按宠物尺寸缩放）。
- 随机分类池（权重）：小动作 20、玩耍 20、吃什么 16、时节 14、文字 10（noMirror：带文字的镜像时不播）；顶层权重 idle 10 / turn 5 / move 5，合计 100。
- 事件动画（不进随机链）：balance 余额 6 档（按已用百分比 20% 一档）、whisper 碎碎念 3、workStatus 工作状态 6 档（思考/工作/整理/等待/成功/出错，成功与出错只播一遍）。
- 防重复：同档位多候选时不连抽同一个。

## 已搬到咱们桌宠（2026-11-17 已部署）
- 点击回应池：love/clickhappy/clickshy/clicktsun 四选一、防连抽（新片段按其配方生成：绿幕→HSV 抠像→归一，24fps 源、12/16fps 播放帧序列存 anim-flat）。
- 待机池新增 yawn（哈欠＋伸懒腰）、startled（被吓一跳）；待机抽选防重复。
- 醒来动画 wakeup（睡觉醒来时播，先揉眼伸懒腰再站好）——三段接力先落了 end 段。
- 尚未搬（候选下一批）：拖拽悬空专用姿势、入睡 start 段、工作状态 6 档联动（咱们 presence 现为 working/idle 两档）、移动 leadSec/tailSec 参数化、余额档位类事件动画（无对应业务，暂不需要）。
