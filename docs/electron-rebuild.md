# Electron 桌宠重建

本文件按主人 2026-11-17 的最终指令执行，取代此前黑底、旧帧转码和 WinForms 视频补丁方案。`AliceButler/pet*.cs` 保留归档，不删除。管家 runner、watchdog、计划任务与 ACL 不改。

## 结构与对接

- `AliceButler/electron/`：TypeScript 主进程、受限 preload、video 播放器、配置驱动状态机、聊天窗；原生透明无边框窗口，Chromium 解码 VP9-alpha。
- 唯一生产入口仍为 `C:\ProgramData\AliceButler\AlicePetNew.exe`，由既有 AlicePetLaunch 拉起。
- 桌宠原子写 `inbox/msg-*.json`；读 `outbox/reply-*.json`，先移至 seen 再显示，重投去重；与原 PROTOCOL 方向相同。聊天钩子负责读 inbox、写 outbox。
- presence 的 thinking/working/result/waiting 循环，success/error 每次状态进入仅播一次；idle 为无工作状态。12 分钟过期，状态轮询 2 秒；聊天回复轮询 1 秒；heartbeat 每 30 秒；主动托盘退出写 disabled flag。
- 动作五池采用权重抽选，候选多于一个时排除上一项；单候选自然无法防连抽。睡觉使用一套 start/loop/end，睡眠优先于 presence，醒来后恢复工作状态。
- 物理保留弹簧 k=200/c=30、重力 1400、抛掷限速、落地挤压；非移动动作期间不漫游。DIP 处理屏幕位置，视频 alpha 决定命中，阴影不参与命中。
- 聊天窗复用旧版尺寸 372×500、微软雅黑、奶油底、珊瑚红主人气泡、薰衣草边艾莉丝气泡、圆形头像裁剪 (80,30,360,360)、Esc 关闭。键盘焦点可见。

## 正式素材与待确认重产清单

只加工 `clips-green/`。v2 sleepstart/doze/wakeup 与 anchor-stand/anchor-sleep 是正式睡眠套；第一批竖幅 idle/walk/wave 仅过渡，第一批 doze 禁用。不自行生成视频。参考仓素材虽获准作占位，本轮优先复用本角色已交付新视频，避免混入其他形象。

| 动作 | 当前处理 | 交给艾莉丝确认后生产 |
|---|---|---|
| breathe / idle | 第一批 idle 过渡 | 16:9 正式待机，标准站立首尾同帧 |
| walk | 第一批 walk 过渡 | 朝右原地走/跑，首尾站立，移动段与静止头尾标记 |
| wave | 第一批 wave 过渡 | 16:9 挥手，首尾标准站立 |
| sleepstart / doze / wakeup | v2 三段正式套 | 无新增生成需求；加工后核验接缝 |
| turn | 暂借 wave 表达，完成后转向 | 正面→左/右→正面，明确翻转时点 |
| dragdangle | 暂借 idle 保持本角色 | 悬空下垂循环，首尾同帧 |
| love / clickhappy / clickshy / clicktsun | 暂借 wave 回应 | 爱心/开心/害羞/傲娇四段独立回应 |
| thinking / working / tidying / pacing | 暂借 idle 循环 | 思考/工作/整理/等待四段循环 |
| celebrate / sigh | 暂借 wave 单次 | 成功庆祝/出错叹气各一次 |
| sit / water / fish / wiggle / yawn / startled | 待机池暂不启用 | 坐下/喝水/摸鱼/扭动/哈欠/受惊 |

旧动作只用于以上清单，不引用旧 22 段帧。缺素材的配置显式标记 provisional，不能报告为动作素材全部完成。

## 素材生产约定

生成归艾莉丝：纯绿 #00FF00、16:9、固定画布与镜头；头顶约 20%、脚底约 85%，红发大呆毛/白衬衫红领结/棕色背带格裙不变；动作逐秒分解。普通动作首尾标准正面站立；睡眠 start 站立→睡姿、loop 睡姿→同一睡姿、end 睡姿→站立；使用两个批准锚图，start 尾=loop 首=loop 尾=end 首，end 尾=start 首。

加工：HSV 绿幕抠像与去绿溢色→同套固定缩放平移归一到 640×360→VP9-alpha WebM。禁止黑底重抠旧帧。本轮不要求把低帧率源伪称源生 60fps，保留源帧率。入仓校验解码 alpha 存在、角色未出框、不透明纯黑占比逐帧 <5%、站位与首尾接缝；不达标写入报告，不擅自生成或替换。

## 里程碑与验收

1. 本说明与重产清单独立提交：已阅读现有 README/四份架构文档，核对 bridge/watchdog/task 接口；尚未部署。
2. 绿幕加工管线与 WebM：逐段解码量化验收、接缝报告、保留源视频与锚图。
3. Electron 播放/动作/聊天/物理：类型检查、状态机与协议测试、Electron 集成验证；如实测量各进程总内存和打包体积。
4. 部署脚本与上线：只走 deploy-pet.sh；保留旧 WinForms 程序及运行资源用于回滚；不改 runner/watchdog/任务。要求新启动日志、heartbeat 和 runner 冒烟 done 回执 exitCode=0，权限或素材阻塞照实报告。
