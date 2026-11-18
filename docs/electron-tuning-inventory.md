# 桌宠与管家参数清单

Electron 以 `AliceButler/electron/config.json` 为准，`defaults.json` 保存同值的内置恢复配置。两个文件均采用标准 JSON，说明放在 `_notes`。老配置保留已有权重，新字段按内置值逐项补齐。重载配置会重新设置轮询定时器；首次随机动作等待时间在启动时读取。

## Electron 运行参数

下表消费文件均相对于 `AliceButler/electron/src/`。以 Ms 结尾的值以毫秒计，Px 表示逻辑像素。

| config.json 参数 | 默认值 | 作用 | 消费文件 |
|---|---:|---|---|
| `tuning.tickMs` | 16 | 物理与命中采样间隔 | main/main.ts |
| `tuning.maintenanceMs` | 1000 | 位置保存与低活跃检查间隔 | main/main.ts |
| `tuning.replyPollMs` | 1000 | 回复目录轮询间隔 | main/main.ts |
| `tuning.statusPollMs` | 2000 | 在岗状态与配置重载检查间隔 | main/main.ts |
| `tuning.heartbeatMs` | 30000 | 桌宠心跳间隔 | main/main.ts |
| `tuning.memoryHighMiB` | 220 | 进程树私有内存触发阈值（MiB） | main/main.ts |
| `tuning.memoryPollMs` | 15000 | 进程树私有内存采样间隔 | main/main.ts |
| `tuning.reclaimCooldownMs` | 60000 | 水位回收冷却间隔 | main/main.ts |
| `tuning.statsMs` | 60000 | 性能记录间隔 | main/main.ts |
| `tuning.decoderReleaseMs` | 120000 | 低活跃后释放解码器的等待时间 | main/main.ts |
| `tuning.idleSleepMs` | 180000 | 无交互进入睡眠的等待时间 | main/main.ts |
| `tuning.firstRandomMs` | 50000 | 启动至首次随机动作的等待时间 | main/main.ts |
| `tuning.pendingThinkMs` | 2000 | 已收到切到思考中的等待时间 | main/main.ts |
| `tuning.replyTimeoutMs` | 120000 | 待回复状态过期时间 | main/main.ts |
| `tuning.presenceValidMs` | 720000 | 在岗状态有效期 | main/main.ts |
| `tuning.futureToleranceMs` | 60000 | 在岗时间戳允许的时钟超前量 | main/main.ts |
| `tuning.chatRows` | 200 | 聊天窗口显示的最近消息条数 | main/main.ts |
| `tuning.historyPairs` | 30 | 启动时回放的对话对数 | main/bridge.ts |
| `tuning.replyBadCount` | 5 | 隔离回复所需连续失败次数 | main/bridge.ts |
| `tuning.replyBadAgeMs` | 90000 | 隔离回复所需最小文件年龄 | main/bridge.ts |
| `tuning.maxReplyBytes` | 1048576 | 单个回复文件读取上限 | main/bridge.ts |
| `tuning.maxMessageChars` | 20000 | 单次发送文本长度上限 | main/bridge.ts、renderer/chat.ts |
| `tuning.clickHoldMs` | 400 | 单击按住时长上限 | main/main.ts |
| `tuning.doubleClickMs` | 260 | 单击等待双击的时间 | main/main.ts |
| `tuning.dragDistancePx` | 4 | 拖动起手与活动判定距离 | main/main.ts |
| `tuning.releaseStaleMs` | 150 | 停止移动后清零抛掷速度的等待时间 | main/main.ts |
| `tuning.walkMinPx` | 60 | 单次散步基础距离 | main/main.ts |
| `tuning.walkExtraPx` | 220 | 单次散步随机增量上限 | main/main.ts |
| `tuning.walkSpeed` | 55 | 散步速度（逻辑像素每秒） | main/engine.ts |
| `tuning.throwMinSpeed` | 500 | 触发抛掷的最低速度（逻辑像素每秒） | main/engine.ts |
| `tuning.snapDistancePx` | 18 | 屏幕边缘吸附距离 | main/placement.ts |
| `tuning.snapGapPx` | 4 | 吸附后边缘间隙 | main/placement.ts |
| `tuning.homeInsetPx` | 30 | 回到原位相对右边界的间隙 | main/placement.ts、main/main.ts |
| `tuning.frameReportMs` | 1000 | 渲染进程回报帧数的间隔 | renderer/player.ts |
| `tuning.firstFrameMs` | 15000 | 等待片段首帧的超时 | renderer/player.ts |
| `tuning.fadeMs` | 180 | 动作交叉淡化时长 | renderer/player.ts |
| `tuning.bubbleMs` | 2100 | 每条气泡的停留时间（最短2000毫秒） | renderer/pet.ts |
| `tuning.chatScrollPx` | 48 | 聊天自动滚到底部的距离阈值 | renderer/chat.ts |
| `tuning.hitAlpha` | 12 | 人物命中蒙版的 alpha 阈值（0–254） | renderer/pet.ts、renderer/hit-mask.ts |
| `tuning.loopCoverMs` | 90 | 循环末尾提前显示已解码画布的时间，跨过浏览器重新定位首帧的间隙 | renderer/player.ts |
| `interaction.hoverMs` | 800 | 悬停触发时长 | main/gestures.ts |
| `interaction.peekCooldownMs` | 10000 | 张望冷却时长 | main/gestures.ts |
| `interaction.gazeSpeed` | 650 | 横划追视最低速度 | main/gestures.ts |
| `interaction.approachSpeed` | 1050 | 受惊接近最低速度 | main/gestures.ts |
| `interaction.approachWindowMs` | 220 | 接近后点击有效时间 | main/gestures.ts |
| `interaction.startleLimit` | 3 | 限频窗口内最多受惊次数 | main/gestures.ts |
| `interaction.startleWindowMs` | 60000 | 受惊滚动窗口 | main/gestures.ts |
| `interaction.landingHeight` | 95 | 落地坐倒下降高度 | main/engine.ts |
| `interaction.landingSpeed` | 590 | 落地坐倒冲击速度 | main/engine.ts |
| `interaction.awayMs` | 600000 | 返回问候的离开时长 | main/gestures.ts |
| `interaction.dragTiltSpeed` | 1200 | 达到最大倾角的拖速 | main/main.ts、renderer/pet.ts |
| `interaction.dragTiltDegrees` | 7 | 拖拽最大倾角 | main/main.ts、renderer/pet.ts |

## 已有动作权重与间隔

参数仍由 `main/engine.ts` 的 Director 与 `main/main.ts` 的随机动作定时器读取。clip、facing、loop 和 provisional 分别表示素材标识、原始朝向、循环属性、临时标记。

| 参数 | 现值 | 作用 |
|---|---|---|
| `idleSeconds` | [45, 95] | 随机动作间隔范围（秒） |
| `animationWeights` | {'idle': 10, 'turn': 2, 'moves': 3} | 大类相对权重 |
| `animations.idle` | idle × 10, wave × 1 | 池内各片段的相对权重 |
| `animations.turn` | wave × 1 | 池内各片段的相对权重 |
| `animations.drag` | dangle × 1 | 池内各片段的相对权重 |
| `animations.clicks` | clickhappy × 3, clickshy × 2, clicktsun × 2 | 池内各片段的相对权重 |
| `animations.moves` | walk × 1 | 池内各片段的相对权重 |
| `animations.sleep.start` | sleepstart × 1 | 池内各片段的相对权重 |
| `animations.sleep.loop` | doze × 1 | 池内各片段的相对权重 |
| `animations.sleep.end` | wakeup × 1 | 池内各片段的相对权重 |
| `animations.workStatus.thinking` | idle × 1 | 池内各片段的相对权重 |
| `animations.workStatus.working` | idle × 1 | 池内各片段的相对权重 |
| `animations.workStatus.result` | idle × 1 | 池内各片段的相对权重 |
| `animations.workStatus.waiting` | idle × 1 | 池内各片段的相对权重 |
| `animations.workStatus.success` | wave × 1 | 池内各片段的相对权重 |
| `animations.workStatus.error` | wave × 1 | 池内各片段的相对权重 |

## 管家与部署工具

下列字段位于 `AliceButler/butler-config.json`。runner 随进程启动读取，watchdog 与部署工具每次执行时读取，presence 刷新循环在启动时读取。更新 runner/watchdog 源码副本时也须带上同版配置。

| 参数 | 现值 | 含义 | 消费文件 |
|---|---:|---|---|
| `runner.scanMs` | 1000 | 任务目录扫描间隔 | AliceButler/runner.js |
| `runner.heartbeatMs` | 5000 | 心跳写入间隔 | AliceButler/runner.js |
| `runner.initialSweepMs` | 60000 | 开机首次清理延迟 | AliceButler/runner.js |
| `runner.sweepMs` | 86400000 | 定期清理间隔 | AliceButler/runner.js |
| `runner.stopConfirmMs` | 800 | 停止接管进程后确认延迟 | AliceButler/runner.js |
| `runner.jobBadAgeMs` | 60000 | 坏任务隔离最小年龄 | AliceButler/runner.js |
| `runner.retentionDays` | 30 | 完成记录、日志和停止标记保留天数 | AliceButler/runner.js |
| `runner.statusEvents` | 8 | 状态文件事件条数 | AliceButler/runner.js |
| `runner.memoryEvents` | 30 | 内存最近事件条数 | AliceButler/runner.js |
| `runner.eventLogMiB` | 2 | 事件日志轮换大小 | AliceButler/runner.js |
| `deployChecks.stopWaitMs` | 5000 | 进程退出等待上限 | tools/deploy-electron.ps1 |
| `deployChecks.pollMs` | 500 | 冒烟检查轮询间隔 | tools/deploy-electron.ps1 |
| `deployChecks.videoAttempts` | 90 | 新视频心跳最多尝试次数 | tools/deploy-electron.ps1 |
| `deployChecks.receiptAttempts` | 60 | 任务回执最多尝试次数 | tools/deploy-electron.ps1 |
| `watchdogRestartMs` | 2500 | 结束陈旧任务后再次启动的延迟 | AliceButler/watchdog.js |
| `runnerRespawn.backoffSec` | [5, 20, 60] | 分次重试退避秒数 | runner.js |
| `runnerRespawn.budgetCount` | 3 | 每窗口最多重试次数 | runner.js |
| `runnerRespawn.budgetWindowMin` | 10 | 重试窗口分钟数 | runner.js |
| `watchThresholds.runnerHeartbeatStaleSec` | 90 | 管家判活秒数 | runner.js、watchdog.js |
| `watchThresholds.petHeartbeatStaleSec` | 180 | 桌宠心跳判活秒数 | watchdog.js |
| `watchThresholds.presenceRefreshMin` | 8 | 在岗状态重发间隔（分钟） | tools/alice-presence.sh |
| `limits.jobBadFileFails` | 5 | 坏任务隔离失败次数 | runner.js |
| `limits.runnerLogFileMB` | 20 | 单任务日志上限（MiB） | runner.js |
| `limits.watchdogLogMB` | 1 | 看护日志轮换阈值（MiB） | watchdog.js |

## 清点边界

现行桌宠使用 Electron 运行参数。butler-config 中的 idlePoolWeights、sleep、timersMs 和其余旧桌宠 limits 属于历史登记；仓外钩子的轮询与保留天数由钩子安装侧维护。src 下的 WinForms 快照、旧素材转换器和归档部署脚本保留历史口径。

固定画布 640×360、窗口几何、85% 脚位、协议文件名和 IPC 消息格式属于接口或校准值。弹簧、重力、碰撞恢复、数值积分步长与抛掷饱和系数按改版纪律保留在物理实现。输入校验上限、备份菜单的三项契约、平台托盘长度限制、诊断输出行数和测试超时不作为运行时调参项。

本批新配置键共 52 个：Electron 37 个，管家 10 个，看护 1 个，部署检查 4 个。另有上表 9 个原有管家键接到实际消费点。interaction 原有 12 项和既有动作权重未计入新增。
