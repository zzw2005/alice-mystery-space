# 桌宠系统 50 次迭代挑刺全记录（2026-11-17 第二轮）

审查方式：五个维度各派一路子代理只读审查（源码实读＋PC 只读实测），协调者逐条复核源码行号与实机数据、跨维度去重后编号 1–50。后半程条目含对抗性复检（挑战前半程结论、复测关键数字）。

全局约定：结论分三类——确认问题（带严重度与修法，修法标注/）、误报排除、量化基线。全局编号与维度编号对应：1–10＝D1 动画流畅度，11–20＝D2 系统稳定性，21–30＝D3 内存优化，31–40＝D4 动作行为逻辑，41–50＝D5 对话链路反应速度。

被审基线：pet.cs 1787 行（VM 部署源与 PC 侧哈希一致）；桌宠 pid 21612（11:50:03Z 启动）、runner pid 23764（11:47:59Z 启动）。

---

## 维度一：动画流畅度（1–10）

### 1（D1-01）帧时钟量化：16ms WinForms 定时器撑不住 60fps
- 怀疑：motion/animTimer 均为消息定时器，受 Windows 默认计时器分辨率（约 15.6ms）量化，实际间隔只能落在约 15.6/31.2ms 两档；帧推进与 dt 又全取自分辨率约 15ms 的 DateTime.Now，anim60 的 16.67ms 目标间隔与量化档几乎重合、最易吞拍。
- 证据：pet.cs:294（motion.Interval=16）、1278（animTimer.Interval=16）、812-815（MotionTick 取 DateTime.Now 算 dt）、490-496（clipNextAt 同源）；PC 实测 anim60 片段 meta 为 60fps。
- 结论：确认问题，中。修法：抽 FrameClock 模块——Stopwatch 单调时钟驱动帧推进，tick 间隔/丢帧计数（min/avg/p95）落盘可观测；间隔收拢为命名配置。备选 timeBeginPeriod(1)，治标且增功耗，不优先。

### 2（D1-02）AdvanceClip 追赶上限 4 步，超限直接丢时间变慢动作
- 怀疑：60fps 时追赶 4 步仅覆盖 66.7ms；任一更长的 UI 阻塞后，clipNextAt 被直接重置为 now+frameMs，欠账一笔勾销——片段整体拉长（慢动作漂移），且与按真实 dt 走的物理（drag/air）脱同步。
- 证据：pet.cs:498（while 循环 steps<4）、506（超限重置截止期行）。
- 结论：确认问题，中。修法：帧推进抽成可独立单测的 FrameAdvancer（输入时间序列→输出帧号），追赶策略（最大步数、超限跳帧对齐墙钟还是重置）做成命名策略并加丢帧计数器。：506 行改为对齐墙钟应播帧号（跳帧不丢时长）。

### 3（D1-03）ClipStream 在 UI 线程同步解码 PNG，圆环窗口一半是无效回头帧
- 怀疑：Get 未命中即在调用线程同步 Image.FromFile＋缩放构造 Bitmap，调用点全在 UI 线程；Evict 对长片段用圆环距离保留 ±8 共 17 帧，但播放单向顺序，后方 8 帧在绕回前永不复用——有效预取深度只有前方 8+3 帧。每前进 1 帧＝1 次新解码＋Evict 全表扫描＋1 次 Dispose，anim60 即 60 次/秒解码 400×462 PNG 全压在渲染线程。
- 证据：pet.cs:193-227（ClipStream）、455-462（Render 内 ClipBitmap）、508-518（预取）；PC 实测 anim60 单帧约 26-33KB（wave 573 帧/17.2MB、celebrate 453 帧/14.8MB、fish 556 帧/15.0MB）。
- 结论：确认问题，高（anim60 播放时）。修法：解码与缓存抽成独立 ClipCache——后台线程预解码、UI 线程只取已备帧；窗口改非对称命名配置（BehindFrames=2、AheadFrames=12），解码耗时/未命中计数入可观测。：Evict 先改单向距离、后方窗口砍到 2。

### 4（D1-04）预取异常善后留下悬空指针：一个坏帧可让片段永久冻结
- 怀疑：预取 catch 做 DisposeClip(name) 后返回 false，但 DisposeClip 只删 clips 字典条目，不清 activeClip/onceClip。此后 AdvanceClip 恒因字典无此键返回 false；SetClip 又因 activeClip==name 提前返回、永不重新 EnsureClip——loop 片段静默死亡；若死的是 onceClip，AdvanceOne 收尾永不触发，sleepstart→doze 接力断裂，睡眠分支与待机池的 onceClip==null 门被永久堵住。
- 证据：pet.cs:407-419（DisposeClip/SetClip）、422-429（PlayOnce）、490-518（AdvanceClip 与 catch）、881、913（两处 onceClip 门）。
- 结论：确认问题，中（低概率、高影响）。修法：catch 里同步清 activeClip/onceClip 并置 clipNextAt=MinValue，下一 tick 重新 EnsureClip。：片段状态收拢为显式状态机（Absent/Ready/Playing/Failed），失败转移统一处理。

### 5（D1-05）Render 每帧全量重绘：新分配整窗 Bitmap＋Bicubic 缩放＋整窗提交
- 怀疑：Render 每次 new Bitmap(346×400×4≈0.53MB)、以 HighQualityBicubic 把 400×462 缓存帧缩放进窗口（squash 时逐帧变尺寸），再 GetHbitmap＋整窗 UpdateLayeredWindow。60fps 下即 60 次/秒「分配＋全帧缩放＋GDI 整窗提交」，成本随帧率线性涨；缓存帧与窗口尺寸不一致，缩放成本本可在解码时一次性付清。
- 证据：pet.cs:558-629（Render）、566（new Bitmap）、600-602（Bicubic 与 drawW/drawH）、632-644（SetLayeredBitmap）；pet-start.log 实测窗口 346×400。
- 结论：确认问题，中。修法：渲染层抽模块——解码时按目标尺寸（含 DPI）落缓存、离屏 Bitmap/DC 跨帧复用、静止元素与角色帧分层合成，加 Render 耗时计数器。：解码尺寸先改窗口尺寸、无 squash 时降 Bilinear。（注：与第 25 条的交叉点是同一 Render 路径，本条计 CPU/帧耗时，第 25 条计分配量与指标口径，不重复计数。）

### 6（D1-06）TrimMemory 每 60 秒在 UI 线程全量 GC＋EmptyWorkingSet：周期性卡点
- 怀疑：trimTimer 每 60s 在 UI 线程 GC.Collect()＋WaitForPendingFinalizers()＋EmptyWorkingSet，把接下来数帧要用的位图/代码页全部换出再逐页 fault 回来，形成每分钟一次的动画顿挫，与第 2 条的追赶上限叠加直接丢时长。
- 证据：pet.cs:296（trimTimer 60000）、302-304（TrimMemory）；旁证：实测 WS 仅约 16MB 的低水位正是周期修剪的形态（见第 10、23 条）。
- 结论：确认问题，中。修法：去掉 WaitForPendingFinalizers，EmptyWorkingSet 改仅睡眠/隐藏时执行。：内存策略收拢为命名配置（TrimInterval、策略枚举 Active/IdleOnly/Never），与帧耗时计数器关联量化取舍。

### 7（D1-07）DPI/尺寸三套口径不一致，命中测试可能在鼠标路径里同步解码
- 怀疑：窗口尺寸由构造时 CreateGraphics().DpiX 一次性算定、聊天布局走另一套 UiS() 缓存（首次算后永不失效）、ClipStream 解码尺寸写死 400×462，三者互不知晓；DisplaySettingsChanged 只更新 wa/groundY/位置，不重算窗口尺寸、不失效 uiScale——换显示器/改缩放后按旧尺寸渲染与命中；每次 WM_NCHITTEST 都走 HitAlpha→CurrentBitmap→cs.Get，帧未缓存时解码被塞进命中测试路径。
- 证据：pet.cs:96-107（UiS/Z）、204（解码尺寸）、250-255（构造尺寸）、281-293（DisplaySettingsChanged）、523-533（CurrentBitmap）、656-679（WndProc/HitAlpha）。
- 结论：确认问题，低（静态单屏不发作，换屏/改缩放/拖动命中时发作）。修法：DisplaySettingsChanged 里失效 uiScale 并按新 DPI 重算尺寸；HitAlpha 改读最近已渲染帧的 alpha 快照。：单一 ScaleContext（DPI、窗口尺寸、解码尺寸同源），渲染与命中共用。

### 8（D1-08）meta 的 mode 字段从未被读：待机池把长片段当 oneshot 整段独占 6–10 秒
- 怀疑：EnsureClip 只读 meta 的 fps，mode 无人消费；播完与否只由「是不是 onceClip」决定。待机池经 PlayOnce 播的成员按实测 meta 换算时长：wave 573帧@60＝9.6s、fish 556@60＝9.3s（meta 明明是 loop）、wiggle 8.0s、celebrate 7.6s、sit 7.0s、water 6.3s；anim-flat 的 yawn 9.6s、startled 8.1s。权重上「不播」仅 4/114≈3.5%，即每 45–95s 几乎必来一段 6–10s 独占，期间呼吸/姿态全被压住；anim-flat 本有短版（celebrate 4.0s、wave 3.6s）却被 anim60>anim-flat 的全局优先级挡住。
- 证据：pet.cs:386-398（EnsureClip 只读 fps）、441-453（PickIdleName 权重）、455-457（ClipBitmap 恒优先 onceClip）、913-921（待机触发）；PC 实测 meta 原文 wave {"frames":573,"fps":60,"mode":"oneshot"}、fish {"frames":556,"fps":60,"mode":"loop"}，帧数与 VM 资产目录互验一致。
- 结论：确认问题，中。修法：片段描述表（name→mode/fps/MaxOneshotMs/可打断性/用途）收拢为命名配置，待机池按用途选短版、loop 片段作 oneshot 时按上限截断。：先给 PlayOnce 加时长上限，超限池成员改走 anim-flat。

### 9（D1-09）聊天动画与桌宠共用单一 UI 线程，滚动缓动非时间制、速度随帧率漂移
- 怀疑：AnimTick 滚动收敛是每 tick 固定比例（scrollCur += d*0.30）无 dt 归一，tick 间隔从 16ms 漂到 31ms 时滚动墙钟速度减半；同文件里气泡/开关动画却用绝对时间求进度，口径不一。更结构性的是 motion（16ms）、animTimer（16ms）、statusTimer（2s，含读文件/JSON 解析/PollOutbox 文件移动）全在同一 UI 线程串行，任一侧忙都会饿死另一侧。
- 证据：pet.cs:294、1278（双 16ms 定时器）、1465-1525（AnimTick 两种口径并存）、1648-1790（StatusTick/PollOutbox 在 UI 线程）。
- 结论：确认问题，低-中。修法：滚动改时间制指数收敛 scrollCur += d*(1-exp(-dt/τ))。：单一调度器合并两个 16ms 定时器、各自耗时计数；StatusTick 的文件 IO 移出 UI 线程或降频分片。

### 10（D1-10）量化基线：当前实例稳态快照（breathe 档）
- 实测（PC 只读，约 20:56 JST）：AlicePetNew pid 21612，probe WS 15.9MB；Get-Process Private 45.7MB、句柄 316、线程 11、CPU 累计 42.4s；pet-start.log「layered ok 2026-11-17T11:50:03Z size 346x400」；pet-error.log 为空。稳态片段 breathe 走 sprites 8 帧@8fps，渲染压力远低于 anim60 档。
- 解读：内存/句柄面无异常；但启动后约 6 分钟累计 CPU 42.4s，粗算单核约 10% 量级，与「8fps 稳态应近乎零载」的直觉有张力，可能含启动加载、TrimMemory 与期间的 anim60/交互，现有数据分不开。
- 结论：量化基线（不下问题判定）。后续按第 1、5 条的帧耗时/tick 计数器分档（breathe/anim60/聊天开）各采 60s 即可拆清；在此之前不要拿该快照当「流畅」或「卡」的证据。

---

## 维度二：系统稳定性（11–20）

### 11（D2-01）特别线索 acltest 失踪：文件从未落地，runner 无罪，缺的是投递回执纪律
- 怀疑（可证伪）：acltest 未进入当前 runner 的任何处理路径，断点在「投递写入 jobs/」或「事后清理」，不在 runner 执行段。
- 证据：①status.json 事件 seq 1–8 为封闭集合（管家上线、墓碑测试启停、崩溃测试启停＋重启），无 acltest 的任务开始/完成，lastEventSeq=8；②`dir /s /b C:\ProgramData\AliceButler\*acl*` 零命中，jobs/、running/ 均空，done/ 仅 shop-web.result.json，logs/ 仅 shop-web.log，无.bad、无.stopped；③决定性证据：jobs/、running/、done/、logs/ 四目录 mtime 全部冻结在 20:49（本地时）＝崩溃测试 finish 落盘时刻（11:49:13Z），此后无任何文件增删——若 acltest 在此后投递成功并被消费，四目录必有 mtime 变化；④协调者补证：投递该任务的执行通道在运行中被中断（工具回执明示 service restarted while running），且 scp 走 alice 的 SSH 身份、对 jobs/ 有 M 权限——「ACL 拒写」假设可排除，「清理误删」假设与 mtime 冻结矛盾（清理发生在 11:49Z 之前/当时，acltest 投递在其后）。
- 结论：确认问题，中高（问题本体是流程而非代码）。定谳：acltest.json 从未写进 jobs/，runner 从未见过它。修法：投递脚本写后立即 dir 回读校验、失败即报错。：建立统一投递回执协议——runner 在 status.json 回执 lastConsumedJobId＋lastResultAt，once 任务以「done 回执出现」为唯一完成判据，投递方等待回执超时即告警。

### 12（D2-02，协调者补入）runner recover() 仅凭 pid 存活接管服务：pid 复用可误接管、误杀无辜进程
- 怀疑：recover() 判断「服务还活着」只看 recording 的 pid 是否存活（process.kill(pid,0)）。runner 停机期间该 pid 若被无关进程复用，重启后会把陌生进程「接管」为该服务：status.json 显示它在跑（实为假象），日后 stop 标志到达时 taskkill /T /F 会杀掉无辜进程树。
- 证据：runner.js:178-208（recover 全段，isAlive 仅 pid 判活、adopted 记录只存 pid）、209-228 附近 scanJobs 的 stop 分支对 adopted 记录同样 taskkill；与第 13 条（锁文件 pid 复用）是不同机制：那条卡的是 runner 自身启动，这条污染的是被管服务的身份。
- 结论：确认问题，中高。修法：接管前双因子核对（pid＋进程名/启动时间与 running 记录的 startedAt 容差）。：服务身份改为 runner 每次启动生成的 boot 代次＋子进程句柄优先，pid 仅作提示；接管失败宁可按「已死重启」处理也不认领陌生进程。
- 备注：本条替换稳定性维度原 D2-02（seq 游标问题）——该问题与第 36 条为同一问题，已合并至第 36 条计数，不重复。

### 13（D2-03）单实例锁 pid 复用陷阱：runner 可能以 exit(0) 静默永退，看门狗拉起也无用
- 怀疑：抢锁失败时仅凭 process.kill(other,0) 判存活，锁文件从不删除（无退出清理）。runner 死亡后其 pid 被无关进程占用时，新 runner 误判「已有实例」以 0 码退出；计划任务显示成功、console.error 无处可去（S4U 启动），watchdog 每 5 分钟 /run 一次、每次同样静默退出——管家可永久离线而表面全绿。
- 证据：runner.js:32-44（抢锁与判活全段，无启动日志落盘）；实机 runner.lock 内容 23764 与在跑 pid 一致（当前健康），但锁的生死完全系于这条脆弱路径。
- 结论：确认问题，高。修法：锁内写 pid＋进程启动时间双因子核对，抢锁/让路/接管一律 append 到 runner-boot.log。：存活真理收拢为 status.json 心跳新鲜度，心跳过期即无条件接管，锁仅作防并发启动的短临界区。

### 14（D2-04）看门狗两处实证盲区：楔死的 runner 拉不动、pet 心跳文件缺失被吞
- 怀疑与证据：①schtasks /xml 实测 AliceButler 任务 MultipleInstancesPolicy=IgnoreNew——runner 进程活着但事件循环楔死（心跳停写）时，watchdog 的 schtasks /run 对 Running 状态任务是 no-op，watchdog 从不 /end 强杀，看护链在此断裂；②watchdog.js:20-26 把「读 pet 心跳文件」与「判过期」包在同一 try/catch，pet-heartbeat.txt 被删/损坏且 pet 已死时异常被吞、永不拉起，与 runner 侧「缺失即重启」的口径相反；③watchdog.log 实机不存在——logLine 仅在 schtasks 失败时写，历次判定/拉起零记录，看门狗自身健康无从审计。
- 证据：watchdog.js:12-14、20-27；计划任务 XML 实测；PC 实查 watchdog.log 不存在。
- 结论：确认问题，高。修法：watchdog 对 runner 改「心跳过期→/end 后再 /run」两段式；pet 心跳读取失败按过期处理；每次运行 append 一行判定结果。：三方（runner/pet/watchdog）统一健康契约——同格式心跳、同阈值表、每次看护决策结构化落盘，纳入部署冒烟清单。

### 15（D2-05）部署残余：运行中 runner 的代码版本不可证，桌宠 exe 无二进制回滚
- 怀疑与证据：①deploy-pet.sh 自注 runner.js/watchdog.js「下次 runner 启动才生效」；实机 runner 启动于 20:47:59（本地时）、磁盘 runner.js mtime 为 20:49（部署 scp 落盘），即当前进程加载的是上一轮推送的代码——本次恰与本地源同为 10646 字节无法证伪差异，但 status.json 无 codeHash/version 字段，任何时刻「在跑代码＝磁盘代码」都不可验证，分叉窗口可长达数周，下一次 watchdog 重启即无冒烟静默换码；②rollback() 只是重新 schtasks 拉起，而新 exe 已 move /y 覆盖 AlicePetNew.exe、旧构建未留副本（实机仅有 12:33 的 AlicePet-v1.exe，是上古 v1）——新构建若「能启动、交互即崩」，probe 的 6 秒 RUNNING 检查放行，回滚拉起的仍是坏 exe。
- 证据：deploy-pet.sh:6（自注）、22-27（rollback 定义）、55-58（swap/launch）；PC 实机文件清单与时间戳。
- 结论：确认问题，中高。修法：swap 前备份当前 exe 为 AlicePetNew.prev.exe，回滚改为还原 prev 再拉起；runner 在 status.json 增加自身 sha256 自报。：部署改版本化 releases/<时间戳>/＋current 指针切换，并把「部署后投 once 自检任务并等 done 回执」（第 11 条回执协议）固化为部署冒烟清单最后一环。

### 16（D2-06）presence 刷新器已死：实机 presence 过期 15 分钟，桌宠状态误报（实测发生中）
- 怀疑与证据：实机 presence.json ts=11:42:18Z，采样时刻 11:57:20Z 已龄 15 分钟，超过 pet 的 12 分钟有效期（pet 侧按期自动清除、行为正确）；alice-presence.sh 的 --refresh-loop 本应每 8 分钟回戳，但其 PID 文件与状态文件同置 /tmp，VM 侧任何扰动即失联且无自愈、无人知晓。本轮审计本身就是长任务，正落在「忙着却显示在岗」的误报窗口里。
- 证据：PC 实查 presence.json 时间戳；alice-presence.sh:9-10（/tmp 路径）、27-37（refresh-loop）；pet.cs StatusTick 的 12 分钟过期逻辑。
- 结论：确认问题，中。修法：刷新器改由 cron 每 4 分钟幂等对账（状态在则回戳、进程不在则重拉），probe 增加 presence 年龄基线项。：presence 并入管家状态通道统一托管（与 runner 心跳同生命周期），不再用独立 nohup＋/tmp 文件拼凑。

### 17（D2-07）pet-inbox 钩子：基础设施失败伪装成「收件箱为空」；并发重复唤醒为未复现怀疑
- 怀疑与证据：①pet-inbox.sh:10 的 SSH/dir 失败（PC 关机、代理断）时 LIST 为空，与真空走同一 silent "pet inbox empty" 出口——通道断裂与无消息不可区分，可无限期静默延迟且零告警；②脚本无 flock/单实例保护，DELIVERED 仅在 wake 成功后才追加，防线位于竞态窗口之外，理论上两实例可双双 wake 同一批消息。
- 对抗性复检：钩子日志 5355 条显示 invocation 启动间隔严格等于「上轮时长＋5s」（调度是串行的），第 47 条实测的 121.8s 最大间隔正是串行等待而非并发——并发重复 wake 在现调度下未复现，此半条降级为低风险未证实。
- 结论：确认问题，中（失败不可见为实证代码路径；并发半条未证实）。修法：LIST 拉取失败与为空分开 log 并计数，连续 N 次失败升级为非 silent 事件；开头加 flock -n 作廉价保险。：钩子统一失败分类与健康上报规范（infra-fail/empty/ok 三态＋连续失败告警阈值）。

### 18（D2-08）jobs 投递非原子＋坏文件约 5 秒即隔离永不重试，与 presence 的原子写口径不一致
- 怀疑与证据：scanJobs 每 1 秒扫盘，解析失败计入 badFiles，5 次（约 5 秒）即 rename 为.json.bad 隔离（noteBadFile），.bad 不匹配 *.json 从此永不重试、仅一条事件；投递侧（scp/直写最终名）无规范，慢写/大文件/网络顿挫跨过 5 秒窗口即被误杀；若 rename 本身失败（文件被占用），计数被清零后会周期性重复隔离尝试与事件。同一系统内 alice-presence.sh 已用「.tmp＋rename」原子投递、pet-inbox 的 move 亦为同卷原子——唯独 jobs 通道没有这条纪律。
- 证据：runner.js:45-54（noteBadFile）、209-244（scanJobs）；alice-presence.sh write_once 的原子写对照。
- 结论：确认问题，中低。修法：隔离阈值改为按文件 mtime 年龄（静置 >10 秒才计数），.bad 每轮重试解析一次。：全系统统一「tmp＋rename」投递协议并写入管家协议规范，jobs/inbox/outbox/presence 四通道同规（与第 49 条同一协议方向）。

### 19（D2-09）验收工具链完整性：run-uishot 可交付旧截图，pc-transfer push 无校验
- 怀疑与证据：run-uishot.sh:17-22 等待循环超时后不设失败出口，径直 scp full.png/chatFinal.png（|| true）——任务未触发时调用方拿到的是上一次的旧图且脚本输出无任何过期警告，UI 验收证据可被静默污染；pc-transfer.sh 的 pull 侧已有落盘验 tar 的加固，push 侧仍是裸管道：流中断时已解压的半套文件留在 PC、无清单无回滚，deploy-pet --assets 正用它推精灵帧目录，半套 f*.png 会被 EnsureClip 照单全收播成残缺动画、无报错。
- 证据：run-uishot.sh:9-24；pc-transfer.sh:29-34（push 分支）；pet.cs EnsureClip 对帧文件无完整性校验。
- 结论：确认问题，中。修法：run-uishot 在 scp 前强制复验 full.png 年龄 <120 秒否则非零退出；push 后回读远端文件数/总字节比对。：传输与验收工具统一「内容哈希清单＋新鲜度断言」收尾，凡交付物必带可校验的生成时间与哈希。

### 20（D2-10）日志与结果无统一轮转/保留：格式四套、done 无限累积、错误日志整表删除
- 怀疑与证据：runner 日志上限是「单文件 20MB 后截断、此后运行再不写 payload」，无按运行轮转；done/*.result.json 全仓无任何清理路径（现存 1 个/206B，基线虽小但只增不减）；pet.cs LogPetError 超 1MB 直接 File.Delete 整表（丢全部历史换一条新错）；watchdog.log 只记失败。四套日志四种格式（时间戳/时区/字段各异），跨组件按时间对账（如第 11 条 acltest 排查）只能靠目录 mtime 推理。
- 证据：runner.js:85-101（日志封顶）、143-160（finish 写 done 无清理）；pet.cs:308-318（LogPetError）；watchdog.js:9-11。
- 结论：确认问题，低中（当前量级无险，属可观测性债）。修法：done 增加 30 天保留（复用 pet-inbox 已有的 forfiles 清理节律顺带处理）。：统一日志规范——全组件同格式（UTC ISO＋组件＋级别＋事件码）、按日/按量轮转＋保留期成表，status.json 之外另设 append-only 事件流水供事后审计。（与第 30 条分工：本条计日志格式与审计流水，第 30 条计按-id 产物文件的保留与 watchdog.log 容量。）

---

## 维度三：内存优化（21–30）

实机基线（PC 只读，两次采样间隔约 45 秒）：桌宠 WS 15.61→15.07MB、Private 43.57→43.42MB、PeakWS 58.0MB、句柄 316→310、线程 11→6；runner WS 18.52→18.56MB、Private 52.67→52.45MB、句柄 180、线程 13→15。注：GDI 对象数跨会话（桌宠 Session 1、SSH Session 0）测不到可信值，下文不以 0 为结论。

### 21（D3-01）双流帧缓存无全局字节预算：常态上限约 24MiB，占 Private 一半以上
- 怀疑：缓存上限按「每流×每方向」计算而非全局，active＋once 两流叠加可吃掉大半 Private。
- 证据：pet.cs:193-226（ClipStream），Get 每帧新建 400×462 Bitmap（32bpp 计 739,200B≈0.705MiB），Evict 保留 ±8 窗口即 17 帧/字典；SetClip/PlayOnce/AdvanceOne 保证常态至多两流并在结束时 Dispose，故单方向上限 ≈2×17×0.705≈24.0MiB，已占实测 Private 43.4MB 的一半以上；帧尺寸或窗口一改即线性放大，无任何总量闸。
- 结论：确认问题，中（不是泄漏——释放路径完整，是预算结构问题）。修法：设集中缓存预算配置（如全进程 Bitmap 缓存 ≤16MiB），ClipStream 改全局 LRU 按字节计账、跨流统一淘汰。备选：窗口 ±8→±4 上限减半，但治标不治本。（与第 3 条分工：那条计解码的 CPU/线程成本，本条计容量预算。）

### 22（D3-02）walk 双向缓存 Cache＋CacheF 同时驻留，小循环淘汰逻辑完全不起作用
- 怀疑：同一流的正/翻转两份缓存都被窗口保留，方向缓存翻倍。
- 证据：pet.cs:199-209 Get 按 flip 分两字典、每次插入对两个字典都 Evict 到同一中心；ClipBitmap 仅 walk 用 flip。walk 实际源是 sprites/walk（仅 8 帧），8≤窗口直径 17，两方向 16 帧全驻留 ≈11.3MiB，淘汰永不触发。
- 结论：确认问题，低-中。修法：方向切换时 Flush 反方向字典，或小循环（Count≤17）只缓存当前方向。：方向纳入第 21 条的全局预算计账，而非每流自带一份。

### 23（D3-03）Render 每帧新分配 Bitmap；WS 好成绩是修剪出来的，Private/Peak 才是真实水位
- 怀疑：WS 的 10-21MB 是 TrimMemory 修剪的假象，真实成本看 Private/Peak，且渲染存在持续分配抖动。
- 证据：pet.cs:558-566 Render 每次 new Bitmap(346×400)＝0.528MiB/帧，walk/air 由 16ms motion 定时器每 tick 渲染，满速约 31.7MiB/s 分配速率；TrimMemory（302-305）每 60 秒全量 GC＋EmptyWorkingSet——与采样吻合：45 秒内 WS 15.61→15.07、句柄 316→310、线程 11→6（线程池收缩），Private 纹丝不动，PeakWS 58.0/PeakPaged 51.9 才是历史水位。另：SetLayeredBitmap（636-650）的 HBitmap 有完整 DeleteObject/DeleteDC/ReleaseDC 收尾，该处泄漏怀疑排除。
- 结论：确认问题，中（危害在 GC 停顿、修剪后缺页重读、耗电，不在泄漏）。修法：渲染位图改双缓冲复用、EmptyWorkingSet 只在隐藏/进睡时触发，并把 Private/PeakWS 作为常态指标输出（见第 29 条）；：先去掉 WaitForPendingFinalizers。（TrimMemory 的帧卡顿面已在第 6 条计数，本条只计分配量与指标口径。）

### 24（D3-04）误报排除：「184MB 素材压内存」不成立；静态帧约 6MiB 为固定底盘
- 怀疑：184MB anim60＋137MB anim-flat 素材是否常驻内存；静态帧是否重复加载。
- 证据：EnsureClip（388-406）只枚举文件名，Get 按需逐帧加载，6340 帧从不全量入内存——磁盘量是误报源。静态帧 LoadFrames（369-377）共 5 张不同 Bitmap（520×600，约 1.19MiB/张，合计约 5.95MiB）终身常驻、从不 Dispose，因进程单例属设计内；tiltR/tiltL 是对 base/baseF 的引用别名，无重复位图。
- 结论：误报排除＋量化基线：静态帧约 6MiB 为 Private 43.4MB 的固定底盘。唯一可挤：静态帧按显示尺寸预缩放加载可省约 2.4MiB，优先级低。

### 25（D3-05）聊天气泡行：200 行上限仍对应约 600 个控件，Font 不随行释放
- 怀疑：第一轮的 200 行上限封住了行数，但单行成本与释放完整性仍有问题。
- 证据：AddBubble（1364-1421）每条消息建 row Panel＋bubble Panel＋Label 共 3 控件，外加每行新建 Font（1376）、新建 Region（1388）和 Paint 闭包；AppendSystemLine 同构。TrimBubbleRows（1423-1440）以 victim.Dispose() 删行——但赋给 Label 的 Font 所有权不随控件 Dispose 释放，代码也未显式 Dispose Font/Region，只能等终结器（现靠每分钟 TrimMemory 的 WaitForPendingFinalizers 兜底）。当前回放约 20 行时全进程句柄 310-316；满 200 行即约 600 控件，可证伪预测：填满后句柄应显著冲高（以「句柄/行」斜率验收）。
- 结论：确认问题，中低（长会话句柄与终结器压力，非当前泄漏）。修法：消息列表改单一自绘控件（owner-draw，无逐条控件/句柄）；：全列表共享一个静态 Font、删行前显式 Dispose 行内 Font/Region、上限 200→80。

### 26（D3-06）Paint 与 Region 替换的原生对象未释放（多处同型）
- 怀疑：多处 Paint 每次重绘新建 GraphicsPath 不 Dispose、Region 替换不释放旧值，聊天窗打开/交互时持续制造待终结的 GDI 包装对象。
- 证据：chat.Paint（1081）、typingBubble.Paint（1207）、bubble.Paint（1393）均 var path = RoundedRect*(...) 用后不 Dispose；inputShell.Paint（1236、1238）每 Paint 造 2 个 path 同样不释放；sendBtn 在 MouseLeave/MouseDown/MouseUp（1260、1266、1268）与 scrollThumb 在 UpdateThumb（1358）均直接赋新 Region、旧 Region 无 Dispose。对照组：bubble 窗 Paint（964）、avatar/emptyState Paint 用了 using，证明是纪律不一致而非框架限制。空闲采样句柄稳定，说明聊天关闭时不发作，发作条件是聊天打开＋频繁重绘/按压。
- 结论：确认问题，低-中（GDI 实数跨会话测不到，定性靠代码、定量待同会话复测）。修法：上述 path 全部加 using、Region 替换走「先存旧值、赋值后 Dispose 旧值」；：定一条资源所有权纪律——RoundedRect* 返回值与 Region/Font 赋值必须经统一 helper 收口，后续审查只查 helper 调用点。

### 27（D3-07）定时器与事件订阅：泄漏怀疑基本排除，仅 bubbleAnims 一处小积压
- 怀疑：5+ 个 Timer 与静态事件订阅是否越积越多。
- 证据：Timer 均为字段单例——motion 16ms（294）、statusTimer 2s（295）、trimTimer 60s（296）、clickTimer（266）、bubbleTimer（984）；animTimer（1278-1279）只建不启、OpenChat 才 Start、关窗动画结束 Stop，无重复创建。SystemEvents.DisplaySettingsChanged（281）与 Program（26-27）的静态订阅从不退订，但进程有 Mutex 单例且 PetForm 与进程同寿，订阅泄漏排除。唯一实积压：bubbleAnims 仅在 AnimTick 里移除，关窗时到达的回复经 AddBubble 登记动画项后、animTimer 未运行，条目滞留到下次开窗才清——每项仅一个引用＋int＋DateTime，量级等于关窗期间回复数。
- 结论：主体误报排除；bubbleAnims 为确认的小问题，低。修法：animTimer 未启用时 AddBubble 不登记动画项（或登记前先清过期项）。另注：motion 在睡觉时仍 62.5 次/秒醒来推进 doze 帧，属 CPU 维度而非内存，不在本条展开。

### 28（D3-08）ReplayHistory 全量加载只用尾 30 条（协调者修正：seen 并非只进不出）
- 怀疑：启动回放的内存与 IO 随历史总量线性增长。
- 证据：ReplayHistory（321-386）把 inbox/seen 全部 msg 解析进 List、outbox/seen 全部 reply 解析进 Dictionary，排序后 skip=Count-30 只展示尾 30 条。PC 现状尚小：inbox/seen 11 文件/1,438B、outbox/seen 9 文件/2,421B。
- 协调者对抗性修正：原报「seen 只进不出、无任何清理」不准确——pet-inbox.sh:76-82 有每日一次的 forfiles 清理，删除双侧 seen 中 30 天前的文件。故 seen 总量被 30 天窗口封顶（按每天 20 条估算上限约 600 文件/侧），问题降级为：回放仍要全量解析这 600 个文件只为用 30 条，且保留策略藏在钩子脚本里、无统一配置。
- 结论：确认问题，低（原报的无界增长不成立）。修法：ReplayHistory 先按文件名排序取尾 30 个文件再解析，启动加载从 O(全量) 降为 O(30)。：seen 保留策略（天数/条数）收拢到统一配置，与第 20、30 条的保留规则共用一套。

### 29（D3-09）runner 内存基线健康（误报排除）；crashLog 为唯一无界 Map
- 怀疑：runner 常驻 52MB Private 是否任务泄漏；其集合是否无界。
- 证据：实测 runner 空闲（status.json jobs 为空、无子服务）即 WS 18.5/Private 52.5-52.7/句柄 180、两采样不变——这是 Node/V8 运行时底盘，不是任务泄漏。集合审查：events 上限 30（73-74）、writeStatus 只输出尾 8（65）；badFiles 在解析成功或隔离时删除；live 受并发任务数约束。仅 crashLog（23-25、121-125）只在同一 id 再次崩溃时才过滤 10 分钟窗口，不同 id 的条目永不清理——若 id 带时间戳式唯一命名且频繁崩溃，此 Map 随任务总数慢速无界增长（每条仅数十字节）。
- 结论：基线确认健康（泄漏误报排除）；crashLog 确认小问题，低。修法：runner 把 process.memoryUsage() 写进已有 status.json（writeStatus 本就每 5 秒落盘），内存成为常态可观测指标；：scheduleRespawn 入口顺手全表清扫过期 id。

### 30（D3-10）按-id 产物文件无保留：单文件有顶、按 id 维度无顶；watchdog.log 完全无顶
- 怀疑：第一轮的「日志 20MB 封顶」是否覆盖全部落盘增长点。
- 证据：runner.js:85-101 的 20MB 是每文件上限且跨运行累计（本身正确，PC logs/ 现仅 shop-web.log 450B）；但 finish 的 done/<id>.result.json（145）、scanJobs 的 running/<id>.stopped 墓碑（207）、logs/<id>.log 都按 id 新建，同 id 覆盖、不同 id 永不回收（PC 现 done 仅 1 文件 206B、running 0 个，基线干净）。watchdog.js:9-11 的 watchdog.log 用 appendFileSync 无任何大小检查（对照 pet-error.log 在 pet.cs:308-317 有 1MB 上限）；watchdog 每 5 分钟一跑，持续失败时约 288 行/天落盘。墓碑堆积还会同步放大 runner 每秒 scanJobs 与启动 recover 的 readdir 成本。
- 结论：确认问题，低。修法：管家侧统一保留模块——done/logs/墓碑/watchdog.log 共用一套「按龄＋按量」保留规则（done 留 30 天、墓碑随对应 result 一起清、watchdog.log 照 pet-error 的 1MB 模式）。：先给 watchdog.log 补上与 pet-error.log 相同的 1MB 检查。

---

## 维度四：各动作行为逻辑（31–40）

### 31（D4-01）双击消歧：原报机制经复核不成立，慢双击变体确认
- 原怀疑：双击后第二次 MouseUp 会重新武装 clickTimer，双击变成「wave＋单击」组合。
- 协调者对抗性复核（推翻原机制）：WinForms 双击事件序为 MouseDown→MouseUp→MouseClick→MouseDoubleClick→MouseUp；第一次 MouseUp 已把 dragging 置 false（pet.cs:738），DoubleClick 消息不产生新的 MouseDown，最终 MouseUp 在 PetMouseUp 开头即因!dragging 提前返回（734-737），不会重新 Start clickTimer。快速双击路径干净。
- 变体确认：clickTimer 间隔 260ms（266）短于 Windows 默认双击间隔约 500ms——两次点击间隔落在 260–500ms 时，第一击的 timer 先到期（开聊天＋单击反应），第二击随后仍被系统判为双击触发 wave，结果仍是组合动作。
- 结论：原机制误报排除；变体确认问题，中。修法：clickTimer 间隔改取 SystemInformation.DoubleClickTime。：手势识别收敛为单一 PointerGesture 状态机，单击/双击/拖拽只从一处消歧后发事件。

### 32（D4-02）wakeup 片段在单击/双击唤醒路径上被同 tick 覆盖，几乎不可见
- 怀疑：睡着时单击或双击桌宠，wakeup 一帧都播不出来；只有聊天回复到达路径（PollOutbox→WakeUp）能真正播 wakeup。
- 证据：pet.cs:267 clickTimer.Tick 在 SpawnHearts（内部先 WakeUp）后紧接 PlayClickReaction，433-439 其 PlayOnce(pick) 立即替换；268 双击 handler 在 WakeUp 后同句 PlayOnce("wave")；422-429 PlayOnce 是单槽：新片段直接 Dispose 旧 onceClip 并重置 clipIdx，全程无渲染帧插入。经 MouseDown 的 WakeUp（718）稍好，也只播约 260ms 即被 clickTimer 的反应片段截断。
- 结论：确认问题，中（唤醒反馈在最常用路径失效）。修法：WakeUp 返回 bool，本次刚唤醒时 PlayClickReaction/双击 wave 跳过或延迟到 wakeup 播完。：one-shot 改优先级队列，wakeup 属高优先级且不可被同级点击片段抢占。

### 33（D4-03）one-shot 单槽无排队：跨定时器抢占静默吞片段，同名重触发被丢弃
- 怀疑：待机片段播放中，StatusTick（2s）的 presence/任务事件可中途换掉它且不补播；某片段播放中同名再触发直接无声消失。
- 证据：pet.cs:422-429 PlayOnce 覆盖时不调用被打断者的 OnOnceDone、无队列；424 行 if (onceClip==name) return，同名重触发既不重启也不排队。MotionTick 待机侧有 onceClip==null 守门（912），但 StatusTick 侧 1659（sigh）、1682（celebrate）、1717（celebrate）均无守门，可随时抢占；被抢的待机片段已在 921 写入 lastIdleClip，本轮不再重抽。
- 结论：确认问题，中。修法：StatusTick 触发前查 onceClip，非空则置 pending 标志待 OnOnceDone 后补播。：所有动作触发统一走一个事件入口（来源、优先级、是否可抢占、被抢策略入表），播放器只消费队列（与第 32、34、35 条同一架构方向）。

### 34（D4-04）presence 的 success/error 边沿在睡觉时被消费且不补发
- 怀疑：睡眠期间 presence 变 success/error，醒来后既不 celebrate 也不 grumpy/sigh，边沿永久丢失——与任务完成事件有 pending 机制不一致。
- 证据：pet.cs:1680-1685 边沿分支内 success/error 都有!sleeping 守门，但 lastPresenceState=pstate 无条件执行，边沿被标记为已处理；1656-1659 pendingSighAt 到期时若 sleeping 直接清零丢弃 sigh。附带边沿：1691 过期分支清 lastPresenceState 却不清 presenceInit，同一 state 在 12 分钟过期后被重写会再次误触发 celebrate/error。
- 结论：确认问题，中。修法：sleeping 时把边沿存入 pendingPresenceEdge，WakeUp 时补播；过期重写同 state 不算新边沿（比较时带 ts 代次）。：presence 边沿与任务事件共用同一事件入口与「睡眠递延」策略。

### 35（D4-05）睡眠期间置下的 pendingCelebrate 只能靠 Land() 冲刷，可能无限滞留
- 怀疑：睡着时任务完成，醒来后不 celebrate，要等下一次被扔/忙碌跳落地才补播，甚至永不播。
- 证据：pet.cs:1715-1718 sleeping 时走 else 置 pendingCelebrate=true；全仓唯一冲刷点是 787-791 的 Land()。睡眠中的桌宠 mode 为 idle 且 Top=groundY，879-885 睡眠分支直接 return、永不进 air/Land；794-802 WakeUp 不检查 pendingCelebrate。
- 结论：确认问题，中。修法：WakeUp 末尾加 if(pendingCelebrate){pendingCelebrate=false;PlayOnce("celebrate");}（与第 32 条的 wakeup 抢占需排优先级）。：递延事件统一在状态转移表里声明「Sleeping→Awake 时冲刷」，而非散落在 Land/WakeUp 各处。

### 36（D4-06）任务事件 seq 游标无初始化、无运行代次：宠物重启误报旧完成，管家重启后漏报新完成
- 怀疑：①桌宠每次重启都会对 status.json 里留存的一条旧「任务完成」再 celebrate 一次；②管家 runner 重启后 seq 从 1 重新计数，桌宠 lastSeq 停在旧高位，其后完成事件在 seq 追平前全部漏报。
- 证据：pet.cs:152 lastSeq 初值且 StatusTick 无首次基线守门（对比 presence 有 presenceInit，1679）；1715-1720 对 events 里任何 seq>lastSeq 的「任务完成」都触发。PC 只读实测 status.json：runnerSince 2026-11-17T11:47:59Z、seq 1–8、lastEventSeq 8，证明 seq 是单次运行内计数、重启即归零，而游标只存内存、不带 runnerPid/runnerSince。
- 结论：确认问题，中。修法：首个 StatusTick 只把 lastSeq 对齐到 lastEventSeq 不触发；检测 runnerSince 变化时重置游标。：事件游标改为 (runId, seq) 复合键并持久化，消费语义明确为 at-most-once。（稳定性维度独立发现同一问题，合并于此计数。）

### 37（D4-07）dragdangle 在松手抛入空中后不清除，下落全程吊挂姿态；dragVx/dragVy 为死字段
- 怀疑：快速拖拽后松手，桌宠在空中飞行/弹跳期间仍播 dragdangle，而不是 FrameKey 设计的倾斜帧。
- 证据：pet.cs:766-777 释放分支中只有「地面低速」支路（769）清 dragClipOn，进入 air 的两条支路（770、776）都不清、也不切 activeClip；526 CurrentBitmap 在 air 下因 dragClipOn && activeClip=="dragdangle" 仍放行片段，遮蔽 547-551 的 drag/air 倾斜帧逻辑；清理只在 784 Land()。另 134 行 dragVx/dragVy 仅在 715 被清零、MouseMove（721-733）从不更新，FrameKey 对它们的判断恒假。
- 结论：确认问题，低中（纯视觉）。修法：两条入 air 支路统一 dragClipOn=false; SetClip("breathe")，并删 dragVx/dragVy 死字段。：Drag/Fall 显式分状态，进入 Fall 的转移动作里集中清理拖拽专属片段。

### 38（D4-08）睡着后从托盘/菜单打开聊天窗不唤醒，与聊天窗共存 Zzz
- 怀疑：「聊天窗开着不睡觉」只有入睡前守门、没有唤醒侧：睡眠中经托盘双击、托盘菜单或右键菜单打开聊天，桌宠继续 doze 并每 20s 冒 Zzz，用户打字也不醒。
- 证据：pet.cs:1618、1623、1626 三个聊天入口都只 ToggleChat、无 WakeUp；1541 起 OpenChat 不调 WakeUp 也不更新 lastInteract；879-885 MotionTick 睡眠分支在检查 chatOpen（911、934）之前 return；打字只在 1271 更新 lastInteract、不清 sleeping。真正能醒的只剩点桌宠本体和回复到达（1777）。
- 结论：确认问题，中。修法：OpenChat 开头调用 WakeUp()。：Sleeping 状态的退出条件在转移表里统一列全（点击、聊天打开、回复到达、菜单操作），入口函数不各自决定。

### 39（D4-09）多显示器不可达：wa 单一工作区钳制一切运动，副屏永远去不了
- 怀疑：桌宠被永久 confined 在主屏工作区，拖拽、散步、空中反弹、聊天窗定位全部以同一 wa 为界。
- 证据：pet.cs:244 初始 wa=Screen.PrimaryScreen.WorkingArea、256 groundY 据此；822-824 拖拽目标钳在 wa 内（横向只许探出 1/3 身位）；空中反弹 847-848、散步目标 945-947、OpenChat 定位 1556 都用 wa。wa 仅在 283-290 DisplaySettingsChanged 时按 Screen.FromControl(this) 刷新——而桌宠根本跨不过屏，该刷新永远拿回同一块屏。
- 结论：确认限制，低中（单屏用户无感，双屏用户桌宠困死主屏）。修法：拖拽时按光标所在屏动态切换 wa/groundY。：运动边界改为「当前屏工作区」运行时查询，状态机每 tick 先定屏再定 groundY，跨屏作为显式转移。

### 40（D4-10）防连抽真实覆盖率与安静权重：量化基线（协调者复算修正）
- 怀疑：单击与待机两套防连抽都只是「重抽一次」，重复率不为零；待机的安静权重会以空抽形式吃掉一整个待机周期。
- 证据与计算：单击 pet.cs:433-439，四选一均匀抽中上次概率 1/4、重抽再中 1/4，P(连播同一片段)=1/16=6.25%/次。待机 441-454 权重总 114：协调者复算修正原报——重抽到 null（4/114）时代码保留原抽选（918-920 仅 nm2 非空才替换），故 P(重复|last=sit)=(28/114)×(32/114)≈6.90%（原报 6.03% 未计 null 保留），wave 约 2.87%、water/fish 各约 1.74%、celebrate 约 1.28%、wiggle 约 0.89%、yawn 约 0.57%、startled 约 0.32%，整体约 2.6%/次。另 912-921 先把 nextOnce 推后 45–95s 再抽，抽中 null（4/114≈3.51%）即本周期无动作。
- 结论：量化基线，低——防连抽是概率压低而非杜绝，数据如上，后续调参以此为对照；若要求零重复属行为变更。修法：重抽改为从池中排除 last 后抽，null 不推后 nextOnce 或只推后短间隔。：动作池与权重、排除策略配置化（池成员/权重/防重复模式成一张表）。

---

## 维度五：对话链路反应速度（41–50）

量化总基线：真实桌宠消息 6 条（19:51–20:29 JST 的实测对话）端到端（msg 建文件→reply 建文件）中位 19.98s、均值 24.18s、最小 13.59s、最大 40.91s，另加 outbox 轮询 0–2s 才显示。其中 worker 生成段中位 10.68s（占 53%）、钩子段中位 2.89s、轮询相位等待中位 5.13s。可压缩段（轮询＋串行 SSH＋回写轮询）合计中位约 9s、占约 45%。样本来源：PC inbox\seen/outbox\seen 文件 CreationTimeUtc 配对＋VM 钩子日志 ~/hooks/logs/pet-inbox.jsonl（n=5330）。

### 41（D5-01）入口轮询相位等待：名义 5s、实测中位 5.13s/最大 8.19s
- 怀疑：5s 轮询使每条消息平均白等 2.5s、最坏 5s，且调度叠加后可超 5s。
- 证据：pet-inbox 定义 poll_interval_secs=5；6 条样本 msg 创建→对应 wake 启动的等待分别为 4.11/7.41/4.33/8.19/4.30/5.93s，中位 5.13s、最大 8.19s；日志 5329 个启动间隔中位 5.00s。超 5s 说明上一轮执行时长（中位 0.71s、消息轮 2.89s）与调度相位叠加。
- 结论：确认问题，中。修法：轮询 5s→2s，期望等待 2.5s→1.0s（省 1.5s/条）、最坏 5s→2s；但空轮成本 0.71s/次，2s 间隔下 SSH 占空比升至约 35%，1s 间隔升至约 70% 有重叠风险，不建议盲降至 1s。：轮询间隔集中配置＋自适应轮询（活跃期短间隔、空闲期长间隔），或由常驻 runner 做文件事件推送替代固定轮询。

### 42（D5-02）钩子内 3 次串行 SSH：消息轮比空轮多花中位 2.18s
- 怀疑：LIST、tar 拉取、move-to-seen 三跳串行，每跳付一次 SSH 建连。
- 证据：pet-inbox.sh:10（ssh dir 名单）、27（ssh tar 拉取，失败再走 pc-transfer 回退）、72（ssh 批量 move）；日志空轮 n=5317 中位 705ms（≈单次 SSH 热连接 0.7s，与已知基线 0.7–1.4s 吻合），消息轮 n=9 中位 2892ms、均值 3180ms、最大 5473ms，差值中位约 2.18s ≈ 2 次额外建连＋tar/解析。
- 结论：确认问题，中。修法：省掉独立 LIST 跳——直接 tar 拉取后本地判空，可省约 0.7s/条（消息轮 2.89s→约 2.2s）；move 与下一轮合并不可行时至少复用 ControlMaster。：PC 侧常驻 runner 维护长连接/本地队列，VM 侧单次会话完成「取件＋确认」两步，消除每跳建连税。

### 43（D5-03）worker 生成段是最大且不可压缩段：中位 10.68s、方差极大、无分阶段反馈
- 怀疑：回复必须等模型全文生成＋scp 落盘后才可见，长尾决定体验。
- 证据：6 条样本 wake 完成→reply 建文件分别为 24.73/30.88/5.58/8.40/10.32/11.04s，中位 10.68s、最大 30.88s，占端到端中位 53%；reply 文件无中间态（outbox 内容仅 {replyTo,text} 全文一次性出现）。合成样本 fixcheck1/mtest1 同样约 40s 级。
- 结论：量化基线（非缺陷）＋感知问题，高（感知层面）。生成本身补丁级无解，不空喊提速。修法：分阶段呈现——wake 后立即回写一条「已收到、处理中」ack（走 presence/ack 通道），正文仍全文落盘；可把「首次有反馈」从中位 20.0s 压到约 7s（轮询 5.1＋钩子 2.9 内），真实完工时间不变。

### 44（D5-04）出口轮询 2s 且与 StatusTick 串行耦合：平均再等 1s、最坏 2s
- 怀疑：reply 落盘后还要等桌宠下一轮 StatusTick 末尾才被 PollOutbox 消费。
- 证据：pet.cs:295 statusTimer.Interval=2000；1647-1740 StatusTick 依次做心跳（每 15 tick）、presence 解析、status.json 解析，最后 1740 才调用 PollOutbox；1743 PollOutbox 本身仅本地目录扫描、成本毫秒级。即出口相位等待均匀分布 0–2s、期望 1.0s。
- 结论：确认问题，低-中。修法：PollOutbox 拆独立 1000ms Timer，期望省 0.5s、最坏省 1s。：outbox 目录 FileSystemWatcher 事件驱动，期望等待→约 0（省期望 1.0s/最坏 2s），并与 status/presence 读取解耦（与第 9 条同一调度架构方向）。

### 45（D5-05）typing 指示与真实等待不匹配：多发必漏计数、超时阈值 120s 远超实测 p100
- 怀疑：连发多条时 typing 点永不正常熄灭；通道真死时用户要等 120s 才得到提示。
- 证据：pet.cs:1285-1287 ShowTyping 每发一条 pendingReplies++ 并重置 typingSince；1299-1303 ReplyArrived 每到一个 reply 文件只 --1；而钩子把同轮多条合并为一个 wake、且钩子定义 prompt 明确只回最后一条 id 生成一个 reply 文件——实证 pair1+pair2 两条仅有 reply-pair2.json 一个文件（另见协调者基线：msg-pair1 无对应回复，其正文实际被并入 pair2 的回复语义，但桌宠侧计数无从知晓）。故连发 2 条后 pendingReplies 恒余 1，只能靠 1527 行 AnimTick 中 120s 超时强清（且 AnimTick 仅聊天窗打开时运行，关窗时连超时提示都不触发）。另实测端到端最大 40.91s，120s 阈值约为其 3 倍。
- 结论：确认问题，中（信任感损伤大于时延本身）。修法：ReplyArrived 改为无条件 HideTyping、typingSince 仅首条待回复时设置、超时 120s→60s（仍高于实测最大 41s，误报风险低，发现死通道提早 60s）。：明确队列/背压语义——reply 携带 replyTo 列表或批次计数，桌宠按批次对账熄灭 typing。

### 46（D5-06）端到端不可观测：reply 无时间戳、delivered 台账为空，归因只能靠法证配对
- 怀疑：链路无逐跳打点，慢了无法定位是哪一跳。
- 证据：msg JSON 有 ts（pet.cs:1603），但 PC 实查全部 reply JSON 仅 {replyTo,text} 无 ts；钩子日志仅记总 duration_ms 不分段；~/hooks/state/pet-delivered-ids.txt 实查 0 字节/0 行（协调者复核一致），而日志已有 9 次 wake 成功——脚本 87-91 行的「wake 后追加 delivered」台账实际未留痕，去重防线状态不可见。本次全部逐跳数字均靠 msg/reply 文件 CreationTimeUtc＋日志 started_at_ms 人工配对才得出。
- 结论：确认问题，中（阻碍一切后续提速验证）。修法：reply JSON 加 ts 字段、钩子日志加分段耗时（list/tar/move 各一段）。：全链路统一 trace id（=msg id）逐跳打时间戳（发送/取件/wake/生成起/回写/显示），端到端时延做成可直接读取的指标。

### 47（D5-07）单轮卡死放大为全队列阻塞：空轮最大时长 121.7s、最大间隔 121.8s
- 怀疑：轮询串行执行，一轮卡住期间所有新消息零拾取。
- 证据：日志 n=5330，空轮 duration 最大 121731ms，启动间隔最大 121.8s，两者吻合（同一卡死事件）；pet-inbox.sh:10 仅 LIST 跳设了 ConnectTimeout=10，27 行 tar 跳与 72 行 move 跳无显式超时，钩子 script_timeout 高达 600s。另有 2 次 outcome=failed（651ms/5ms）。
- 结论：确认问题，高（尾部时延）。修法：tar/move 两跳补 -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=2，把单跳最坏卡死从约 120s 压到约 20s 级。：拾取通道加熔断/看门狗——单轮超时即放弃并让下一轮接管，避免串行队列被一轮独占。

### 48（D5-08）入口侧无死信机制：半截消息每 5s 被反复全量拉取；去重失效时可每轮重复 wake
- 怀疑：解析失败文件永驻 inbox 顶层，每轮 tar 都带上它且无退避；move 失败＋delivered 台账为空时同一消息可被反复唤醒。
- 证据：PC 实查 inbox\seen\msg-broken1.json 内容为被截断的半截 JSON（无闭合）；日志有 2 次 no readable messages（1819/2086ms，比空轮贵约 1.2s——多付了 tar＋解析全程）；pet-inbox.sh:36-57 解析失败仅跳过不计数、不隔离（对比出口侧 PollOutbox 有 5 次失败隔离，入口侧无对应机制）；delivered 文件 0 行（见第 46 条）使 50 行的 id 去重实际无历史可依，仅靠 move 成功兜底。
- 结论：确认问题，中。修法：入口侧加失败计数，同一文件解析失败 ≥5 次移入 inbox\bad\（与出口侧.bad 口径对齐），消除每轮约 1.2s 的无效拉取。：入口队列明确死信队列＋退避语义，坏件不进主队列、不参与批次合并。

### 49（D5-09）reply 回写非原子＋桌宠 5 次失败即丢弃：长回复有被判.bad 永不显示的风险
- 怀疑：worker 按钩子 prompt 直接 scp 到最终文件名，桌宠可能读到半截文件并累计失败次数；写得够慢（>5 个轮询周期）即被隔离丢弃。
- 证据：钩子 definitions 的 prompt 要求 scp 直达 outbox/reply-<id>.json；PC 实测 6 个 reply 文件 Creation→LastWrite 窗口为 1.05/0.51/0.51/0.77/1.34/0.56s（半截可见窗口真实存在）；pet.cs:1757-1764 PollOutbox 解析失败计数，n+1>=5 即 File.Move 到.bad 不再显示——以 2s 轮询计，写入超过约 10s 的 reply 必丢（当前样本最长窗口 1.34s 尚未触发，属未爆雷）。对照 presence 通道已用 tmp+rename 原子写（alice-presence.sh write_once），聊天通道未用。
- 结论：确认问题，高（丢回复比慢更严重）。修法：worker 改 scp 到 reply-<id>.json.tmp 后远程 rename（复用 presence 现成模式），半截窗口→0，同时消除因解析失败白等一轮的 0–2s 附加时延。：回写通道统一采用「临时名＋原子 rename」为协议规范，所有文件桥通道（inbox/outbox/presence/jobs）一致（与第 18 条同一协议方向）。

### 50（D5-10）UI 呈现段成本排除（误报）；多回复排序语义缺失（低）
- 怀疑一（呈现慢）：AddBubble 同步布局可能拖慢显示。证据：pet.cs:1364-1419 AddBubble 单次 PerformLayout，TrimBubbleRows 上限 200 行后每加一条仅移一行（亚毫秒-毫秒级）；气泡入场动画 180ms（AnimTick）。相对中位 20s 端到端占比 <0.5%。结论：误报排除，不立项。
- 怀疑二（多回复乱序）：PollOutbox 按 Directory.GetFiles 文件系统顺序遍历（1750），未按 id/时间排序；桌宠关窗期间积压多条 reply 后重开，将以任意序 AppendChat；且 ReplayHistory（325 起）只按 msg id 排序、reply 靠字典配对回填，实时路径与重放路径排序口径不一致。结论：确认问题，低。修法：PollOutbox 遍历前按文件名排序（真实 id 内嵌 yyyyMMddHHmmss 时间戳，字典序即时间序），零时延成本。：队列语义明确化——reply 携带序号/批次号，呈现层按序号严格排序，实时与重放共用同一排序键。

---

## 协调者复核与裁定记录（摘要）

- 合并去重：第 36 条与稳定性维度原 D2-02 为同一问题（seq 游标），合并计数；第 12 条为协调者补入的独立问题（recover pid 复用），与第 13 条（锁 pid 复用）机制不同、不重复。
- 机制推翻：第 31 条原报「第二次 MouseUp 重新武装 clickTimer」经事件序复核不成立，已改写为慢双击变体，原机制入误报清单。
- 数字修正：第 40 条防连抽概率经复算修正（null 重抽保留原抽选，sit 连播约 6.90% 而非 6.03%）；第 28 条 seen 增长经钩子侧 30 天清理证据降级；第 17 条并发重复 wake 经钩子日志串行性证据降级为未证实。
- 交叉引用不重复计数：第 5/23 条（Render 路径，CPU 与分配两面）、第 3/21 条（ClipStream，解码成本与容量预算两面）、第 20/30 条（日志格式与按-id 保留两面）、第 18/49 条（同一原子投递协议的两个通道）。
