# Electron 桌宠交互与动作仲裁

Director 在物理节拍内汇集动作申请，长按到点定时器也会结算当时已经收到的申请。同一拍按 **用户直接操作 > presence 事件 > 单击反应 > 随机链** 处理，同级按提交顺序。有效申请返回已播、已排队或已拒绝。只有选出新动作才按原来源写入 `pet-stats.json`。播放完成、启动、解码失败和恢复是生命周期事件，走同一个入口。恢复重发当前动作，沿用已有时间线与触发记录。解码失败回调只处理当前播放令牌。

拖拽、双击、长按、聊天和菜单属于直接操作。落地坐倒、走完回到基线、桌面返回问候和已触发张望的退出由物理或窗口事件驱动。受惊与单击同档，悬停张望的进入也在此档。第五批自动触发参数见[参数清单](electron-tuning-inventory.md)。

## 三机交叉真值表

优先应用靠前的限制。表中的「在岗循环」涵盖 `thinking`、`working`、`result`、`waiting` 四档；`success` 和 `error` 的常态基线是 `idle`。

| 规则 | rest | presence | physics / 手势 | 允许与阻挡行为 | 验证 |
|---|---|---|---|---|---|
| R1 | `entering`、`waking` | 任意 | 任意 | `sleepstart`、`wakeup` 播放期间拒绝 presence、单击、随机链、长按以及普通动作切换。`entering` 接受并排队一次唤醒，先到睡姿锚点再接 `wakeup`。无排队时进入 `doze`。`waking` 重复唤醒不重播，播完回 `idle` 或在岗循环并开始唤醒保护。 | 睡眠接力的逐源拦截与唤醒排队 |
| R2 | `asleep` | 任意 | 任意 | `doze` 循环。指针按下、聊天和菜单可申请唤醒。睡眠期间开始的按压仅用于唤醒，直到松手都不参与长按、拖拽和单击。presence 可更新档位，睡眠期间不播其动作。符合离开时长的桌面返回事件可从稳定 `doze` 播问候。 | 睡眠接力的逐源拦截与唤醒排队；睡眠按压只唤醒 |
| R3 | `awake` | 任意 | `drag`，已拖动或仍按住满拖拽保护时间 | 移动超过阈值转 `dangle`。随机链在物理拖拽期间停掷。播放 `dangle` 或达到拖拽保护时间时屏蔽 presence 动作，仍接收新档位；松手回对应基线，由现行吸附或抛掷规则处理位置。 | 长时拖拽屏蔽与恢复；长按转拖拽 |
| R4 | `awake` | 任意 | 按住且移动未越界，进入长按 | 到点进入慢速 `clicktsun` 循环，立即屏蔽 presence、随机链和单击。跨过拖动阈值取消长按并请求 `dangle`。长按松手解除屏蔽，概率接常速 `clicktsun` 单次或回当前基线。长按松手不走聊天与拖拽释放。松手记 `long-press-release`，移动越界切换记 `drag`。 | 长按阈值、互斥和两个概率出口；Electron 长按循环与松手 |
| R5 | `awake` | 任意 | `drag`，尚未移动、未长按、未到拖拽保护时间 | 随机链与自动入睡暂停，presence 可以更新动作。短于单击时长上限的松手进入单击确认，长按阈值前的其他静止松手结束按压。确认双击只请求 `wave`。 | 长时拖拽屏蔽与恢复；长按阈值、互斥和两个概率出口；Electron 双击 |
| R6 | `awake` | 任意 | `air`、`walk` | 暂停随机链和自动入睡。拖拽、点击和可播放的 presence 事件可中止走路；在空中保留落地物理。重落地请求 `sitdown`，走完回最新的在岗基线。 | 物理弹簧与落地测试；空中与走路仲裁 |
| R7 | `awake` | `success`、`error` | 无更高优先级或保护段 | 合法的进入事件播一次 `wave`，重复读取不重播；处于受保护的交互中时只更新档位。正在播的 `success` 或 `error` 动作优先于单击，结束回常态。 | 同拍竞争与一次性在岗反馈 |
| R8 | `awake` | `idle`、`waiting` | `idle` | 检查第五批随机链资格，包含冷却、走路降权、困意和 waiting 间隔。`idle` 且聊天窗关闭才有困意及自动入睡资格，唤醒保护只限制自动入睡。 | 第五批随机链、困意、唤醒保护与 waiting 单测；默认时长观察 |
| R9 | `awake` | `thinking`、`working`、`result`、`success`、`error` | `idle` | 停掷随机链、顺延困意和自动入睡。确认单击处理按同拍优先级，正常的在岗循环不封锁点击。 | 同拍竞争与一次性在岗反馈；第五批 waiting 单测 |
| R10 | `awake` | 任意 | `idle`、`air`、`walk` | 保留张望与受惊的触发条件。可见的待机动作在物理 idle 时可触发张望；离开或按下可以结束张望。已播出的 `sitdown`、`peek`、`startled`、直接 `wave` 保留原有的 presence 打断保护。 | 悬停、受惊、一次性手势回基线单测 |

## 判定阈值

现值同时登记在 `AliceButler/electron/config.json` 和 `defaults.json`。

| 阈值 | 现值 | 配置键 | 消费位置 |
|---|---:|---|---|
| 拖动起手、长按位移取消 | 4 逻辑像素，曼哈顿距离，超过才触发 | `tuning.dragDistancePx` | `gestures.ts`、`main.ts` |
| 物理与手势采样间隔 | 16 ms | `tuning.tickMs` | `main.ts` |
| 单击判定上限 | 400 ms，不含 | `tuning.clickHoldMs` | `gestures.ts` |
| 单击等待双击 | 260 ms | `tuning.doubleClickMs` | `main.ts` |
| 长按到点 | 500 ms，独立按压计时 | `triggers.longPressMs` | `gestures.ts`、`main.ts` |
| 长按循环速率、松手反应概率 | 0.75、0.5 | `triggers.longPressRate`、`triggers.longPressReleaseChance` | `engine.ts` |
| 拖拽保护 | 2000 ms，独立的仲裁计时 | `triggers.dragProtectionMs` | `engine.ts` |
| 拖拽释放静止判定、抛掷最低速度、吸附距离 | 150 ms、500 px/s、18 px | `tuning.releaseStaleMs`、`tuning.throwMinSpeed`、`tuning.snapDistancePx` | `main.ts`、`engine.ts`、`placement.ts` |
| 悬停与冷却 | 800 ms、10000 ms | `interaction.hoverMs`、`interaction.peekCooldownMs` | `gestures.ts` |
| 追视横划、受惊接近速度与有效窗 | 650 px/s、1050 px/s、220 ms | `interaction.gazeSpeed`、`interaction.approachSpeed`、`interaction.approachWindowMs` | `gestures.ts` |
| 受惊限频 | 60000 ms 内最多 3 次 | `interaction.startleWindowMs`、`interaction.startleLimit` | `gestures.ts` |
| 重落地 | 下降高度超过 95 px 或速度超过 590 px/s | `interaction.landingHeight`、`interaction.landingSpeed` | `engine.ts` |
| 桌面返回问候 | 离开超过 600000 ms | `interaction.awayMs` | `main.ts`、`gestures.ts` |
| 连点彩蛋 | 开启、间隔小于 600 ms、连续 3 次 | `triggers.clickComboEnabled`、`triggers.clickComboGapMs`、`triggers.clickComboCount` | `gestures.ts` |
| 回复交付间隔 | 800 ms | `tuning.replyStaggerMs` | `bridge.ts`、`main.ts` |

## 降级与恢复

| 条件 | 行为 | 恢复 | 验证 |
|---|---|---|---|
| 当前素材无法解码或首帧超时 | 当前素材记为不可用，退到可用 `idle` 或首个可用段，后续选择跳过损坏段。渲染器保留已显示的画面直到可用片段呈现。 | 修复素材后重载配置或重启，清空不可用集合。 | Electron 损坏素材、回退与跳过 |
| 动作配置缺失、JSON 损坏或校验失败 | 有坏文件则备份，启用内置默认，允许写入时恢复 `config.json`，托盘每会话提示一次。 | 将修正后的配置保存并重载。 | Electron 坏配置备份、默认恢复与提示 |
| presence 文件缺失、JSON 损坏、状态值非法或时间戳无效 | 使用 `idle` 在岗值与文案。已播放动作继续，无额外错误日志；下一次合格动作按 `idle` 决策。 | 下一次读到有效状态时按状态切换处理。 | Electron 缺失、损坏及非法 presence |

回复按文件桥已有的批内顺序入队，新批次追加到队尾。队列空闲时第一条立即交付；后续每条交付的消息、气泡、往返统计与唤醒在同一时点执行。等待交付的回执保留同一条 pending 超时截止时间。验证见「回复 FIFO 时间边界」与「Electron 跨批回复间隔」。

## 规则与测试对应

| 规则 | 测试名称 |
|---|---|
| R1–R2 | `sleep relay rejects each interrupt source and queues one wake during entry`、`sleep-origin press can only wake regardless of duration and pointer distance`、`desktop return greets from doze while both sleep transitions remain protected` |
| R3 | `long-held drags defer presence and random actions until released`、`Electron long press holds and loops, releases without chat or throw, and converts to drag` |
| R4–R5 | `long press starts at 500 ms while held, then yields to movement beyond 4 px`、`long press blocks presence immediately and both release outcomes restore normal rate`、上述 Electron 长按用例中的双击和按住后切拖拽断言 |
| R6 | `air and walk block auto actions; landing and walk completion return to baseline`、`hard impact selects sitdown and suppresses squash; small drop still squashes` |
| R7、R9 | `same-tick arbitration: direct > presence > click > random; wave plays once per edge`、`waiting draws at double interval while thinking, working and result never draw` |
| R8 | `interactive cooldown blocks all chain draws until 60 seconds have elapsed`、`moves weight halves during the two draws after a walk, then returns to full weight`、`drowsiness doubles the pending interval without a clip, and chat defers drowsiness and sleep`、`wake protection begins at the end of wakeup and leaves manual actions available`、`waiting draws at double interval while thinking, working and result never draw` |
| R10 | `hover fires once per visit, after dwell and cooldown; swipes choose facing`、`approach must be inward, fast and recent; three starts per rolling minute`、`one-shots return to idle and dragging supersedes any one-shot immediately` |
| 降级 | `Electron missing, malformed and invalid presence uses idle without changing playback`、`Electron skips damaged media and restores a broken config with one notification` |
| 回复与统计 | `reply FIFO delivers immediately when idle and spaces replies across batches`、`Electron replies are delivered one at a time in across-poll order`、`trigger events live in the seven-day stats and appear independently in the weekly report` |

单测用 `npm test`。专项 Electron 测试在 `AliceButler/electron` 目录先执行 `npm run build`，再执行 `node --test tests/interaction.integration.cjs`。损坏样本只写入隔离副本。
