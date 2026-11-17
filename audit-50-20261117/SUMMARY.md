# 桌宠系统 50 次迭代挑刺 · 汇总（2026-11-17 第二轮）

全记录见同目录 ITERATIONS.md（编号 1–50 与本文件出处号一致）。审查全程只读，未改 PC 任何文件、未动任何进程。

**总账**：50 条中，含确认问题的条目 45（高 5、中高 3、中 22、中低/低中 9、低 6），纯量化基线 3（第 10、40、43 条，其中 43 另计感知高），整条误报排除 1（第 24 条），另有 3 条含误报部分（第 27 条主体、第 31 条原机制、第 50 条呈现半条）。后半程对抗性复检推翻/修正了 4 处前半程结论（第 17、28、31、40 条），均已在全记录中改写并标注。

---

## 一、确认问题清单（按严重度排序）

### 高（5 条，另 1 条感知高）

- **第 49 条｜reply 回写非原子，桌宠 5 次解析失败即判 .bad，长回复可能永不显示**——修法：worker 改 scp 到 .tmp 后远程 rename（复用 presence 现成原子写模式），回写协议统一为「临时名＋原子 rename」。
- **第 14 条｜看门狗两处盲区：runner 楔死时 schtasks /run 是 no-op 拉不动、pet 心跳文件缺失被 try/catch 吞掉永不拉起，且看门狗零判定日志**——修法：心跳过期改「/end 后再 /run」两段式、心跳读取失败按过期处理、每次运行落一行判定。
- **第 13 条｜runner 单实例锁只凭 pid 判活，pid 被复用时会以 exit(0) 静默永退，看门狗反复拉起反复退出，管家永久离线而表面全绿**——修法：锁内加进程启动时间双因子核对并落 runner-boot.log；存活真理收拢为心跳新鲜度。
- **第 3 条｜ClipStream 在 UI 线程同步解码 PNG（anim60 时 60 次/秒），圆环窗口一半是永不复用的回头帧**——修法：解码抽成后台线程 ClipCache、UI 只取已备帧，窗口改非对称（后 2/前 12）并加解码计数器。
- **第 47 条｜钩子单轮卡死放大为全队列阻塞：实测空轮最大时长 121.7s，期间所有新消息零拾取**——修法：tar/move 两跳补 ConnectTimeout＋ServerAlive 探活，把单跳最坏卡死压到约 20s 级；拾取通道加单轮超时熔断。
- **第 43 条｜（感知高，非缺陷）worker 生成段中位 10.68s 占端到端 53% 且无分阶段反馈，用户在中位 20s 里全程无感知**——修法：wake 后立即回写 ack 状态，首次反馈压到约 7s，完工时间不变。

### 中高（3 条）

- **第 11 条｜acltest 失踪定谳：文件从未落地（四目录 mtime 冻结在投递前一刻为决定性证据），runner 无罪；缺的是投递回执纪律**——修法：投递写后回读校验；runner 在 status.json 回执 lastConsumedJobId，once 任务以 done 回执为唯一完成判据。
- **第 12 条｜runner recover() 仅凭 pid 存活接管服务，pid 复用时会认领陌生进程、日后停服还会误杀其进程树**——修法：接管前双因子核对（pid＋进程名/启动时间），宁可按已死重启也不认领陌生进程。
- **第 15 条｜运行中 runner 的代码版本不可证（status 无哈希字段、分叉窗口可达数周）；桌宠 exe 部署无二进制回滚（rollback 拉起的仍是已覆盖的坏 exe）**——修法：swap 前备份 AlicePetNew.prev.exe、回滚还原 prev；status.json 加代码 sha256 自报；长远改版本化 releases＋current 指针。

### 中（22 条）

- **第 1 条｜16ms WinForms 定时器受系统计时器分辨率量化，撑不住 anim60 的 60fps**——修法：抽 FrameClock（Stopwatch 单调时钟＋tick/丢帧计数器落盘）。
- **第 2 条｜AdvanceClip 追赶上限 4 步，超限直接重置截止期，卡顿后变慢动作且与物理脱同步**——修法：帧推进抽成可单测的 FrameAdvancer，超限改跳帧对齐墙钟并记丢帧数。
- **第 4 条｜预取异常后 DisposeClip 不清 activeClip/onceClip，一个坏帧可让片段（乃至入睡接力）永久冻结**——修法：catch 同步清指针并重置 clipNextAt；片段状态收拢为显式状态机。
- **第 5 条｜Render 每帧全量重绘：新分配整窗 Bitmap＋Bicubic 缩放 400×462 源帧＋整窗提交**——修法：解码时按目标尺寸落缓存、离屏缓冲跨帧复用、加 Render 耗时计数器。
- **第 6 条｜TrimMemory 每 60 秒在 UI 线程全量 GC＋WaitForPendingFinalizers＋EmptyWorkingSet，制造周期性卡点**——修法：去 WaitForPendingFinalizers，修剪改仅睡眠/隐藏时；内存策略配置化。
- **第 8 条｜meta 的 mode 从未被读，待机池把 6–10 秒长片段当 oneshot 整段独占，呼吸/姿态被长时间压住**——修法：片段描述表配置化（mode/时长上限/用途），待机池选短版或截断。
- **第 16 条｜presence 刷新器已死（实测过期 15 分钟），长任务期间桌宠状态误报「在岗」且无自愈**——修法：刷新器改 cron 幂等对账；presence 并入管家状态通道统一托管。
- **第 17 条｜pet-inbox 钩子把基础设施失败伪装成「收件箱为空」，通道断裂可无限期静默**——修法：失败与为空分开计数上报、连续 N 次升级告警；并发重复 wake 半条经日志复检未证实（调度为串行）。
- **第 19 条｜run-uishot 超时后照样交付旧截图、pc-transfer push 无完整性校验，验收证据可被静默污染**——修法：交付前强制新鲜度断言（<120s）否则非零退出；push 后回读文件数/字节比对。
- **第 21 条｜双流帧缓存无全局字节预算，常态上限约 24MiB 占 Private 一半以上，参数一改即线性放大**——修法：集中缓存预算＋全局 LRU 按字节计账、跨流统一淘汰。
- **第 23 条｜WS 低水位是每分钟修剪出来的假象（Private 43.4/PeakWS 58.0 才是水位），Render 满速约 31.7MiB/s 分配抖动**——修法：渲染位图双缓冲复用，Private/PeakWS 进 status 常态输出。
- **第 32 条｜wakeup 片段在单击/双击唤醒路径被同 tick 的反应片段覆盖，唤醒反馈在最常用路径失效**——修法：one-shot 改优先级队列，wakeup 高优先级不可被同级抢占。
- **第 33 条｜one-shot 单槽无排队：StatusTick 事件可随时抢占待机片段且不补播，同名重触发被静默丢弃**——修法：全部动作触发统一走事件入口（优先级/可抢占/被抢策略入表），播放器只消费队列。
- **第 34 条｜presence 的 success/error 边沿在睡觉时被消费不补发；过期重写同 state 还会误触发第二次**——修法：睡眠边沿存 pending、WakeUp 补播；边沿比较带 ts 代次。
- **第 35 条｜睡眠期置下的 pendingCelebrate 只能靠 Land() 冲刷，醒来不补播、可能无限滞留**——修法：递延事件在状态转移表声明「Sleeping→Awake 时冲刷」，WakeUp 统一执行。
- **第 36 条｜任务事件 seq 游标无初始化、无运行代次：桌宠重启误报旧完成、runner 重启后新完成被旧游标吞掉**——修法：游标改 (runId, seq) 复合键并持久化；短期先做首 tick 对齐＋runnerSince 变化重置。
- **第 38 条｜睡着后从托盘/菜单打开聊天窗不唤醒，聊天窗与 Zzz 共存、打字也不醒**——修法：OpenChat 开头 WakeUp；Sleeping 退出条件在转移表统一列全。
- **第 41 条｜入口轮询相位等待实测中位 5.13s/最大 8.19s（名义 5s）**——修法：轮询降至 2s 省期望 1.5s/条（1s 间隔 SSH 占空比约 70% 不可取）；长远自适应轮询或事件推送。
- **第 42 条｜钩子内 3 次串行 SSH，消息轮比空轮多花中位 2.18s（每跳一次建连税）**——修法：省掉独立 LIST 跳省约 0.7s/条；长远由常驻 runner 长连接完成取件＋确认。
- **第 45 条｜typing 指示与桥的批次语义不匹配：连发多条后计数恒余 1、只能等 120s 超时强清，且关窗时连超时提示都不触发**——修法：ReplyArrived 无条件熄灭、超时降 60s；长远 reply 携带批次计数对账。
- **第 46 条｜链路端到端不可观测：reply 无时间戳、钩子日志不分段、delivered 台账实查 0 字节（9 次 wake 成功却未留痕）**——修法：reply 加 ts、钩子日志分段耗时；全链路统一 trace id 逐跳打点。
- **第 48 条｜入口侧无死信机制：半截消息每 5s 被反复全量拉取（每轮多付约 1.2s），去重实际只靠 move 成功兜底**——修法：入口加失败计数、≥5 次移入 inbox\bad\ 与出口侧口径对齐；队列明确死信＋退避语义。

### 中低 / 低中（9 条）

- **第 9 条｜聊天滚动缓动非时间制、速度随帧率漂移，且两个 16ms 定时器与 2s StatusTick 共用单一 UI 线程互相饿死**——修法：滚动改时间制收敛；单一调度器合并推进、IO 移出 UI 线程。
- **第 18 条｜jobs 投递非原子，坏文件约 5 秒即隔离永不重试，与 presence 的原子写口径不一致**——修法：隔离改为按 mtime 年龄判定；四通道统一「tmp＋rename」投递协议。
- **第 20 条｜四套日志四种格式、done 无限累积、pet-error 超限整表删除，跨组件对账只能靠目录 mtime**——修法：统一日志规范（UTC ISO＋组件＋级别＋事件码）＋轮转保留成表＋append-only 事件流水。
- **第 22 条｜walk 双向缓存同时驻留约 11.3MiB，小循环（8 帧）淘汰逻辑完全不起作用**——修法：方向切换 Flush 反向字典；方向纳入全局缓存预算计账。
- **第 25 条｜气泡行 200 上限仍约 600 个控件，Font 不随行 Dispose、靠每分钟强制 GC 兜底回收**——修法：消息列表改单一自绘控件；短期共享静态 Font＋删行显式 Dispose＋上限降 80。
- **第 26 条｜多处 Paint 的 GraphicsPath 不 Dispose、Region 替换不释放旧值，聊天打开交互时持续制造待终结 GDI 对象**——修法：path 全加 using、Region 走旧值 Dispose helper；定统一资源所有权纪律。
- **第 37 条｜dragdangle 松手入空后不清除，下落全程吊挂姿态；dragVx/dragVy 为恒假死字段**——修法：入 air 支路统一清 dragClipOn 并切 breathe、删死字段；Drag/Fall 显式分状态。
- **第 39 条｜桌宠被单一主屏工作区钳制，副屏永远不可达（确认限制，双屏用户受影响）**——修法：运动边界改「当前屏工作区」运行时查询，跨屏作为显式转移。
- **第 44 条｜出口轮询 2s 且串在 StatusTick 末尾，reply 落盘后平均再等 1s、最坏 2s**——修法：PollOutbox 拆独立 1s Timer；长远 FileSystemWatcher 事件驱动并与 status 读取解耦。

### 低（6 条）

- **第 7 条｜DPI/尺寸三套口径（构造 DpiX、UiS 缓存、写死 400×462）互不知晓，换屏/改缩放后按旧尺寸渲染与命中；命中测试可能在鼠标路径同步解码**——修法：单一 ScaleContext 同源；HitAlpha 改读已渲染帧 alpha 快照。
- **第 27 条｜bubbleAnims 在关窗期间登记后滞留到下次开窗才清（小积压）**——修法：animTimer 未启用时不登记动画项。（本条主体为误报排除，见下。）
- **第 28 条｜ReplayHistory 全量解析双侧 seen（30 天窗口上限约 600 文件/侧）只用尾 30 条**——修法：先按文件名排序取尾 30 个文件再解析，启动加载降为 O(30)。
- **第 29 条｜runner 的 crashLog 跨 id 永不清理，唯一命名的崩溃任务多时会慢速无界增长**——修法：scheduleRespawn 入口全表清扫过期 id；内存指标进 status.json。（本条主体为基线健康确认。）
- **第 30 条｜done/墓碑/日志按 id 新建、不同 id 永不回收；watchdog.log 完全无大小上限**——修法：统一保留模块（按龄＋按量），watchdog.log 先补 1MB 上限。
- **第 50 条｜PollOutbox 按文件系统顺序消费、多回复可能乱序，实时与重放两条路径排序口径不一致**——修法：遍历前按文件名排序（字典序即时间序），零成本；长远 reply 带序号、两路共用排序键。（本条另一半为误报排除，见下。）

---

## 二、被排除的误报清单

- **第 24 条（整条）｜「184MB＋137MB 素材压在内存里」不成立**：EnsureClip 只枚举文件名、Get 按需逐帧加载，6340 帧从不全量入内存；静态帧 5 张约 6MiB 为设计内常驻，tilt 是别名引用无重复加载。
- **第 27 条（主体）｜「Timer 与静态事件订阅越积越多」不成立**：Timer 全为字段单例、无重复创建；静态订阅与进程同寿且有 Mutex 单例，不构成泄漏。仅 bubbleAnims 关窗积压为真（已列低）。
- **第 29 条（主体）｜「runner 52MB Private 是任务泄漏」不成立**：空闲两采样纹丝不动，是 Node/V8 运行时底盘；events/badFiles/live 均有界，仅 crashLog 跨 id 清理缺失为真（已列低）。
- **第 31 条（原机制）｜「双击的第二次 MouseUp 重新武装 clickTimer」不成立**：第一次 MouseUp 已置 dragging=false，最终 MouseUp 在处理函数开头提前返回。真问题是 260ms 计时短于系统双击间隔约 500ms 的慢双击变体（已列中）。
- **第 50 条（呈现半条）｜「AddBubble 同步布局拖慢回复显示」不成立**：单次布局亚毫秒-毫秒级、入场动画 180ms，占中位 20s 端到端 <0.5%，不立项。
- **附带排除**：SetLayeredBitmap 的 HBitmap/DC 收尾完整、无 GDI 泄漏（第 23 条内排除）；HitAlpha 与 Render 共用 CurrentBitmap 同一取图源、第一轮的「命中用静图帧」旧报不成立（沿用第一轮裁定）；钩子并发双 wake 在串行调度下未复现（第 17 条内降级）。

---

## 三、五维量化基线汇总

| 维度 | 基线（2026-11-17 晚实测） |
|---|---|
| 动画流畅度 | 窗口 346×400（200% DPI）；稳态 breathe＝sprites 8 帧@8fps；anim60 片段 meta 60fps、单帧 26–33KB；待机 oneshot 时长 6.3–9.6s；桌宠启动后约 6 分钟累计 CPU 42.4s（约单核 10%，分档构成未拆清，待帧计数器上线后复测） |
| 系统稳定性 | runner pid 23764 心跳新鲜、事件 seq 1–8、锁文件与 pid 一致；pet 心跳新鲜（约 30s 一写）；pet-error.log 与 watchdog.log 均不存在（＝零记录）；presence 实测过期 15 分钟（刷新器失联样本）；四目录 mtime 冻结法证可复用 |
| 内存优化 | 桌宠 WS 15.1–15.6MB／Private 43.4–43.6MB／PeakWS 58.0MB／句柄 310–316／线程 6–11；runner WS 18.5MB／Private 52.5MB／句柄 180；静态帧底盘约 6MiB；双流缓存上限约 24MiB；磁盘素材 anim60 172.3MB/6361 文件、anim-flat 135.1MB/707 文件、sprites 1.9MB/36 文件（磁盘量≠内存量） |
| 动作行为逻辑 | 待机池权重总 114、安静（null）3.51%/周期；单击连播同一片段 6.25%/次；待机连播 sit 约 6.90%、整体约 2.6%/次（复算修正后）；单击计时 260ms vs 系统双击约 500ms；睡眠阈值 3 分钟、Zzz 周期 20s |
| 对话链路速度 | 端到端中位 19.98s／均值 24.18s／最大 40.91s（真实消息 n=6）；分段中位：轮询相位 5.13s＋钩子 2.89s＋worker 生成 10.68s（占 53%）＋出口轮询 0–2s；钩子日志 n=5330：空轮中位 0.705s、最大单轮 121.7s；可压缩约 3.2s（约 16%）＋尾部卡死上限 121s→约 20s |

---

## 四、可维护性架构蓝图

总原则：先让系统「可拆、可测、可观测」，再在护栏内修行为问题。以下均为方案，未动手。

### 1. pet.cs 拆分方案（1787 行 → partial class 多文件）

现行编译是 deploy 脚本在 PC 上单条 csc 命令编一个文件。拆分后仍是一个类（`public partial class PetForm`）、一个入口（Program.Main 不动），csc 命令改为列全文件或用通配 `pet*.cs`（csc 自行展开通配参数），deploy 脚本只改编译命令一行、哈希校验改为对全部源文件做清单哈希。

| 文件 | 职责 | 预计行数 | 主要内容（现行行号） |
|---|---|---|---|
| pet.cs | 入口＋字段＋构造＋生命周期 | 约 300 | Program/ChatWindow（13–48）、字段与 P/Invoke（49–241）、构造与 Shown/DisplaySettingsChanged（242–301）、TrimMemory/LogPetError（302–320） |
| pet.Config.cs | 全部命名常量与配置加载 | 约 120 | 新增（见第 2 节），各 partial 只读引用 |
| pet.Clips.cs | 动画播放引擎 | 约 330 | ClipStream（193–227）、Ensure/Set/PlayOnce/Advance/PickIdle（380–522）、片段描述表 |
| pet.Render.cs | 渲染与命中 | 约 300 | CurrentBitmap/FrameKey（523–557）、Render/SetLayeredBitmap（558–654）、WndProc/HitAlpha（655–683）、挤压曲线（684–705） |
| pet.Physics.cs | 物理与手势状态机 | 约 330 | 鼠标三件套（706–780）、Land/WakeUp/GoToSleep（781–811）、MotionTick（812–950）、SpawnHearts（166–175） |
| pet.ChatUi.cs | 聊天窗 UI | 约 590 | 气泡窗（951–998）、绘图 helper 与 MotionOk（999–1065）、BuildChat（1066–1282）、打字指示/滚动（1283–1363）、AddBubble/Trim/系统行（1364–1463）、AnimTick（1464–1540）、Open/Close/Toggle（1541–1591） |
| pet.Bridge.cs | 聊天桥（文件 IO） | 约 200 | ReplayHistory（321–367）、SendChat（1592–1610）、PollOutbox（1743–1787） |
| pet.Presence.cs | presence/状态点/托盘 | 约 190 | BuildTray（1611–1632）、PresenceStateText（1633–1646）、StatusTick（1647–1742） |

依赖关系：字段集中在 pet.cs、同一 partial 类内全可见，无跨类引用成本；逻辑调用方向为 Physics→Clips（SetClip/PlayOnce）、Physics→Render（AdvanceClip/Render 在 tick 内）、Presence→Clips（PlayOnce celebrate/sigh）、Bridge→ChatUi（AddBubble）、Bridge→Physics（WakeUp）、ChatUi→Bridge（发送事件挂 SendChat）。循环只存在于同类内部，不构成工程障碍，但后续若要再进化为独立类，以 Bridge 与 Clips 为最先可剥离的两块（IO 与纯策略）。

拆分顺序（每步只移动、不改一行逻辑，逐步部署验证）：①pet.Config.cs（常量先行、零行为面）→②pet.Bridge.cs（叶子 IO、调用面最窄）→③pet.Clips.cs→④pet.Render.cs→⑤pet.Presence.cs→⑥pet.ChatUi.cs（最大块、单独一步）→⑦pet.Physics.cs（牵连最广、最后）。

风险点：csc 通配会把目录里任何 pet*.cs 都编进去，部署源目录须保持干净（旧分片 src/pet1-3.cs 等历史文件不得混入部署清单——现行 deploy 只推 pet.cs 一个文件，拆分后改为按清单推 pet*.cs 并在 PC 侧先清旧 pet*.cs 再推）；字段重复声明是唯一编译期高频错误，靠编译门拦截；partial 拆分不改变任何时序，行为风险接近零，主要风险在部署清单遗漏文件导致 PC 侧编出旧代码——用「源文件清单哈希」校验（本地与 PC 两侧文件集合＋逐个哈希比对）堵住。

### 2. 配置与常量：收拢成一份 butler-config，边界按「谁会调」划

载体：`butler-config.json` 放 AliceButler 根目录。C# 用已引用的 JavaScriptSerializer 读、Node 原生读、shell 钩子只读自己需要的两三个键（或保留脚本内默认值兜底）；任何组件读不到配置时回退到代码内默认值（默认值与现行值逐一相同），配置损坏不能让系统起不来。

应该收拢（跨组件共享、或运维/调参会动、或多处重复出现）：
- 定时与轮询：motion 16ms、statusTimer 2000ms、animTimer 16ms、钩子轮询 5s、PollOutbox 目标间隔、心跳写入周期。
- 看护阈值：runner 心跳过期 90s、pet 心跳过期 180s、管家存活判定 25s、presence 有效期 12 分钟/刷新 8 分钟（现在散在 pet.cs、watchdog.js、alice-presence.sh 三处，口径靠人肉一致）。
- 缓存与上限：ClipStream 窗口（Behind/Ahead）、预取帧数 3、全局缓存预算 MiB、气泡行上限 200、日志上限 20MB/1MB、保留期 30 天、typing 超时。
- 动作表：待机池权重（现行硬编码区间 28/18/12/14/14/10/8/6/4）、单击池成员、片段描述（mode/fps/MaxOneshotMs/可打断性）——调参最高频的一块，现在改权重必须动代码重部署。
- runner 策略：respawn 退避 [5s,20s,60s] 与 10 分钟 3 次预算、坏文件隔离阈值。
- 路径：BaseDir 下各子目录与文件名（inbox/outbox/jobs/running/done/logs、presence.json、status.json），现行在 C#、Node、shell 三侧各写一份。

留在代码（不进配置）：物理手感常数（弹簧 k=200/c=30、重力 1400、恢复 0.78、切向摩擦 2.5/s、挤压曲线参数）——与渲染/物理代码结构耦合，调参必然伴随发版验证，进配置只增加误改面；在 pet.Physics.cs 顶部集中为命名常量即可。协议常量（msg-/reply-/stop- 前缀、.stopped/.bad 后缀、JSON 字段名）属四方协议，进 PROTOCOL.md 与各组件的常量区，不做运行时可写。安全相关（ACL、锁文件路径、计划任务名）不入可写配置，防止配置被改即绕过看护。

### 3. 日志与可观测性：统一格式与轮转，终结「临时写探针破案」

现状四套日志四种格式：pet-error.log（UTC ISO、超 1MB 整表删）、pet-start.log（单行覆写）、pet-heartbeat.txt（单行时间戳）、runner status.json（快照＋尾 8 事件）＋logs/<id>.log（每文件 20MB 截断）、watchdog.log（只记失败、现不存在）、钩子 jsonl（有总时长无分段）。本次 acltest 排查靠目录 mtime 法证，说明可观测性欠账已实际产生工时。

统一方案：
- 行格式统一：`UTC ISO | component(pet/runner/watchdog/hook) | level | event-code | msg | 关键字段`，文本行即可，不上数据库。
- pet-error.log 改滚动保留：当前文件＋.1 各 1MB，替代整表删除（保住故障前史）。
- runner 新增 append-only 的 events.jsonl（bootId＋seq＋ts＋code＋msg），status.json 继续做快照但补三个字段：codeSha256（自身代码自报，堵第 15 条）、memoryUsage（rss/heapUsed，第 29 条）、counters（任务总数/崩溃重启数/坏文件数）。
- pet 侧计数器落盘到 pet-stats.json（每分钟覆写）：tick 间隔 p95、Render 耗时 p95、解码未命中数、当前缓存 MiB——第 1、3、5、10 条的验收都依赖它。
- watchdog 每次运行必落一行判定（action=none/run/end-run＋原因＋心跳龄），不再只记失败。
- 钩子日志加分段耗时（list/tar/move/wake 各一段）与三态 outcome（ok/empty/infra-fail），承接第 17、46 条。
- probe-v3.ps1 升级为常驻 health.ps1：一键输出进程存否、双心跳龄、presence 龄、锁一致性、jobs/inbox 积压数、最近 3 条错误、磁盘积压（done/seen/logs 文件数与总量）——下次排障先跑它，不再临时拼命令。
- 轮转与保留成一张表（组件×上限×保留期×清理执行者），清理统一由 runner 的日常节律顺带执行，不再散落在钩子 forfiles 里。

### 4. 测试与验证：可离线自检的逻辑与固化进 deploy 的冒烟清单

适合抽出做离线自检的逻辑（均为纯函数或文件集语义，不依赖真实 UI/进程）：
- FrameAdvancer：帧推进抽成纯逻辑（输入时间序列＋fps＋策略→输出帧号序列），断言追赶/跳帧/重置三种策略（覆盖第 1、2 条）。
- ClipStream 窗口策略：Evict 的距离计算抽成纯策略函数，断言非对称窗口与全局预算淘汰（第 3、21、22 条）。
- PickIdle/防连抽： RNG 注入种子，断言权重分布与排除-last 策略的重复率（第 40 条基线可直接当断言值）。
- PollOutbox 消费语义：对临时目录构造 reply 文件集（正常/半截/重复/乱序），断言去重、隔离、排序结果（第 49、50 条）。
- runner 墓碑/退避/接管：HOME 改为环境变量注入（现行写死 __dirname，是唯一需要的重构），在临时目录跑 node 自检：投 job→stop→同 id 旧文件不得复活；崩溃退避次数与间隔；pid 复用时不认领（第 11、12、13 条）。
- 钩子解析段：python 解析块喂样本 JSON（正常/半截/重复 id），断言 names/newids 分拣（第 48 条）。
- presence 过期判定：纯时间函数，断言 12 分钟边界与代次比较（第 34 条）。

自检形态：一键脚本 selfcheck（VM 侧跑 C# 纯逻辑需把被测类单独 csc 成小 exe，或先以 Node/python 复刻断言关键表——优先前者，避免双实现漂移）；全部自检纳入部署前置，任一红灯不部署。

部署冒烟清单（固化为 deploy-pet.sh 的第 7 步，任一失败走现有回滚）：①编译门（已有）②源清单哈希一致（已有单文件版，扩为清单版）③probe RUNNING＋pet-start.log 新鲜（已有）④投 once 自检任务（cmd /c echo）并等 done 回执 ≤15s（新增，顺带永久堵住第 11 条这类无声丢失）⑤presence 写一次＋读回校验（新增）⑥uishot 一次性截图并断言 full.png 年龄 <120s（新增，堵第 19 条）⑦watchdog 手跑一次并断言判定日志新增一行（新增）。另需先补第 15 条的 prev exe 备份，回滚才有真东西可回。

### 5. 文档与交接：部署源目录常驻四份文档

放在 ~/workspace/butler-build/AliceButler/ 随源同行（不进 PC 运行目录亦可，但须随部署源版本管理）：
- ARCHITECTURE.md：组件图（pet/runner/watchdog/钩子/四个文件通道）、各自生命周期与看护关系、关键阈值表（与 butler-config 对应）。
- MODULE-MAP.md：pet*.cs 各文件职责与调用方向（本蓝图第 1 节的表即初稿）、runner.js/watchdog.js 职责与关键函数索引——接手者先读它，不必通读 1787 行。
- PROTOCOL.md：四条文件通道（jobs/inbox/outbox/presence）的报文格式、原子写规范（tmp＋rename）、回执语义（done/lastConsumedJobId）、死信与保留规则、事件游标 (runId, seq) 语义。
- CHANGE-DISCIPLINE.md：改版纪律——改 VM 部署源不改 PC 副本；一切部署走 deploy-pet.sh 且冒烟全绿才算完成；配置与代码的边界（第 2 节）；新动作片段的入池流程（meta 必填 mode/时长、权重改配置不改代码）；测试先行项清单（动哪块必跑哪组自检）。

### 6. 分阶段落地路线

- **阶段 0（零行为变化，随时可做）**：补四份文档；butler-config.json 抽取（值逐一照抄现行、双读校验一致后才切换读取方）；日志只增不改（runner events.jsonl 新增、watchdog 落判定行、status 加 codeSha256/memoryUsage 字段）；health.ps1 落地。回滚：还原文件＋重部署旧源，无状态迁移。
- **阶段 1（零行为变化）**：pet.cs 按第 1 节顺序拆 partial（一次一个文件、每步完整部署＋冒烟）、deploy 的 csc 改清单/通配并加源清单哈希校验、先补 prev exe 备份让回滚成真。回滚：单步 revert 该次移动提交并重部署。
- **阶段 2（行为修复，等阶段 0/1 的护栏就绪后做）**：协议类修复打包落地——统一原子投递＋投递回执（第 11、18、48、49 条）、事件游标复合键（第 36 条）、看护契约统一（第 13、14 条）、presence 托管（第 16 条）。每条先补对应离线自检再改实现。回滚：协议留双读过渡（新旧格式并认一个版本周期），开关回退旧路径。
- **阶段 3（体验与性能，靠计数器数据验收）**：ClipCache 后台解码＋非对称窗口（第 3、21 条）、FrameClock＋FrameAdvancer（第 1、2 条）、自绘消息列表（第 25 条）、动作事件队列与状态机显式化（第 32–35、38 条）、链路 ack 分阶段＋轮询自适应（第 41、43 条）。回滚：每项保留旧路径功能开关，数据不达标即切回。
- 排序理由：阶段 0/1 不改行为、风险最低，却把后面所有修复的验证成本降下来；第 49、14、13、47 条这类高优先问题若等不及完整阶段 2，可在阶段 1 完成后以补丁级先行（原子 rename、watchdog 两段式、ssh 超时），再在阶段 2 收编进协议——蓝图不阻塞救火，但救火项必须回头入册。
