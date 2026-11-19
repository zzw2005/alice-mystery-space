# AliceButler 架构说明

电脑端常驻系统：让艾莉丝在主人 Windows 电脑上有一个常驻执行体（管家）、一个可见形象（桌宠）和一条聊天通道（桌宠聊天窗 ↔ 主聊天）。

## 组件

| 组件 | 载体 | 进程/触发 | 职责 |
|---|---|---|---|
| runner（管家） | runner.js | 计划任务 AliceButler（S4U alice，开机自启） | 轮询 jobs/ 执行 once/service 任务；写 status.json 心跳（5s）；崩溃退避重启；单实例锁 |
| watchdog（看门狗） | watchdog.js | 计划任务 AliceButlerWatchdog（每 5 分钟） | 按心跳新鲜度看护 runner 与桌宠；每次运行在 watchdog.log 落一行判定 |
| 桌宠 | AlicePetNew.exe（pet*.cs 编译） | 计划任务 AlicePetLaunch（mikasan 交互登录） | 桌面形象、22 个动作、聊天窗 UI、每约 30s 写 pet-heartbeat.txt |
| 聊天钩子 | ~/hooks/scripts/pet-inbox.sh | 运行时钩子 pet-inbox（5 秒轮询） | ssh 拉 inbox 新消息 → 唤醒 worker 回复 → 回复经 pet-reply.sh 原子投递 outbox |
| presence | ~/workspace/tools/alice-presence.sh | 艾莉丝在主聊天手动/续戳器（8 分钟） | 写 presence.json（原子），桌宠据此显示工作状态（12 分钟有效） |
| 部署 | ~/workspace/tools/deploy-pet.sh | 艾莉丝手动 | 推源码清单 → 哈希校验 → 编译门 → 备份 prev → 换版 → probe 验证，失败自动回滚 |

## 文件通道（都在 C:\ProgramData\AliceButler\）

- jobs/：任务投递（见 PROTOCOL.md）；inbox/、outbox/：聊天桥；presence.json：状态；status.json：管家快照；pet-heartbeat.txt：桌宠心跳。
- 权限：inbox/outbox 只允许 alice、mikasan（M）与 SYSTEM（F）；jobs 只允许 alice 与 SYSTEM。根目录保持 Users 可读（桌宠读 status.json）。

## 存活判定真理

- runner 活着 = status.json 心跳 <90 秒且 runnerPid 与锁文件一致（pid 本身不作数，防复用）。
- 桌宠活着 = pet-heartbeat.txt <180 秒；文件缺失按过期处理；pet-disabled.flag 存在时不拉起（主人主动退出）。

## 关键阈值（与 butler-config.json 对应）

motion/anim 定时器 16ms；StatusTick 2s；钩子轮询 5s；桌宠 outbox 轮询 1s（独立 bridgeTimer）；runner 心跳过期 90s；pet 心跳过期 180s；presence 有效 12 分钟/续戳 8 分钟；runner 崩溃退避 5s/20s/60s、10 分钟内最多 3 次；坏文件隔离阈值 5 次（回复文件另加文件龄 >90s）。

Electron 桌宠从 `electron/config.json` 的 `interaction` 读取交互阈值。速度和高度使用 Electron 屏幕逻辑像素。

| 动作 | 默认触发条件 |
|---|---|
| 悬空被拎 | 拖拽超过现有 4 px 起手距离。横向速度 1200 px/s 时倾角达 7° |
| 落地坐倒 | 下降高度超过 95 px，或撞地垂直速度超过 590 px/s |
| 张望与视线追逐 | 身体命中持续 800 ms，或在命中区横划速度达到 650 px/s。一次悬停触发一次，冷却 10 s |
| 受惊 | 接近速度达到 1050 px/s 后 220 ms 内按下。滚动 60 s 内限 3 次 |
| 回来挥手 | 锁屏或最小化超过 600 s，两者都解除后挥手一次。双击也可直接挥手 |

Electron 剩余可调时间、手势阈值、聊天上限及播放参数集中在 `electron/config.json` 的 `tuning`。旧配置缺少的字段从内置默认值补齐。runner、watchdog 读取同目录的 `butler-config.json`，部署工具从源码目录读取其中的 `deployChecks`。逐项默认值、消费位置和生效时间见 [参数清单](../docs/electron-tuning-inventory.md)。

## 部署源与运行副本

仓库中的 `AliceButler/` 是源码唯一权威；PC 上的同名文件是运行副本，禁止直接改 PC 副本。旧 WinForms/黑底动画目录已删除，当前正式动作位于 `AliceButler/electron/media/`，部署只走 `tools/deploy-pet.sh`。
