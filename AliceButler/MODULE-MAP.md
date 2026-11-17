# 模块地图

接手先读本文件，不必通读全部源码。桌宠是一个 partial class PetForm 拆成多文件，字段集中在 pet.cs，同一类内全可见。

## 桌宠（C#，csc 多文件一次编译）

| 文件 | 职责 | 关键成员 |
|---|---|---|
| pet.cs | 入口＋字段＋生命周期 | Program.Main、ChatWindow、PetForm 字段与 P/Invoke、嵌套类（ClipStream/BubbleAnim/HeartP）、构造与 Shown、TrimMemory、LogPetError、LoadFrames |
| pet.Config.cs（阶段 2 落地，尚未建） | 命名常量与配置加载 | 定时/阈值/上限常量（与 butler-config.json 对应，读不到配置回退默认值）；现阶段常量仍在各文件内，值以 butler-config.json 登记为准 |
| pet.Clips.cs | 动画播放引擎 | EnsureClip/DisposeClip/SetClip/PlayOnce/AdvanceClip/PickIdleName/PlayClickReaction/OnOnceDone |
| pet.Render.cs | 渲染与命中 | CurrentBitmap/FrameKey/Render/SetLayeredBitmap/WndProc/HitAlpha/挤压曲线 |
| pet.Physics.cs | 物理与手势状态机 | PetMouseDown/Move/Up、Land/WakeUp/GoToSleep、MotionTick、SpawnHearts/HeartPath |
| pet.ChatUi.cs | 聊天窗 UI | BuildChat/AddBubble/TrimBubbleRows/AppendSystemLine/AnimTick/OpenChat/CloseChat/ToggleChat、绘图 helper、滚动与打字指示 |
| pet.Bridge.cs | 聊天桥文件 IO | ReplayHistory/SendChat/PollOutbox |
| pet.Presence.cs | presence/状态/托盘 | BuildTray/PresenceStateText/StatusTick（含任务完成事件、presence 边沿、心跳写入） |

调用方向：Physics→Clips（SetClip/PlayOnce）、Physics→Render（tick 内 AdvanceClip/Render）、Presence→Clips（celebrate/sigh）、Bridge→ChatUi（AppendChat→AddBubble）、Bridge→Physics（WakeUp）、ChatUi→Bridge（发送按钮挂 SendChat）。

## 管家（Node）

| 文件 | 职责 | 关键点 |
|---|---|---|
| runner.js | 任务执行器 | scanJobs/startJob/finish、墓碑 .stopped、scheduleRespawn 退避、单实例锁（pid＋心跳双判）、writeStatus（带 codeSha256/memoryMB） |
| watchdog.js | 看护 | runner 心跳过期→/end 后 /run；pet 心跳过期或缺失→/run AlicePetLaunch；pet-disabled.flag 豁免；每次运行落判定行 |

## 通道与工具

- 钩子 ~/hooks/scripts/pet-inbox.sh：拉 inbox、解析分拣、去重台账、唤醒 worker、seen 30 天清理。
- ~/workspace/tools/pet-reply.sh：回复原子投递（唯一允许的回复写入口）。
- ~/workspace/tools/alice-presence.sh：presence 原子写＋续戳器。
- ~/workspace/tools/deploy-pet.sh：推源清单→哈希校验→编译门→备份 prev→换版→probe，失败回滚。
- ~/workspace/tools/run-uishot.sh：一次性截图验证（任务自删，不留每日任务）。
- PC 侧探针 C:\Users\alice.DESKTOP-4Q8GMO4\scripts\probe-v3.ps1（源在 ~/workspace/tools/）。
