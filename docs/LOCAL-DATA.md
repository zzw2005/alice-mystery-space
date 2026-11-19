# 桌宠与管家的本机数据

Electron 桌宠默认使用 `C:\ProgramData\AliceButler`。测试和开发可以通过 `ALICE_PET_ROOT` 改桌宠数据目录。runner 和 watchdog 在各自脚本目录读写，生产应与桌宠数据目录一致。Electron 动作配置从应用目录读取，展开安装后是 `resources\app\config.json`。下文以 Electron 运行路径为准，标明仍可能留在机器上的旧版文件。

## 数据目录

```text
C:\ProgramData\AliceButler\
  butler-config.json
  resources\app\{config.json,defaults.json}
  config.json.bad-<Unix 毫秒>
  pet-{position,stats,restart-request}.json
  pet-{check-request,decode-check,daily-check}.json
  pet-heartbeat.txt
  pet-disabled.flag
  pet-{start,error}.log
  presence.json[.tmp]
  inbox\{msg-*.json[.tmp],seen\msg-*.json}
  outbox\{.tmp-*.json,reply-*.json[.bad],seen\reply-*.json}
  runner.lock
  status.json[.tmp]
  events.jsonl[.1]
  watchdog.log[.1]
  jobs\{*.json,*.json.bad,stop-*.flag}
  running\{<id>.json,<id>.job.json,<id>.stopped}
  done\<id>.result.json
  logs\<id>.log
  deploy-stage\<部署 ID>\…
  deploy-backups\{.rollback.lock,.pending-<ID>,<ID>\…}
  electron-{deploy,asset-deploy}-result.json
  AlicePetNew.prev.exe                       旧 WinForms 部署留下时存在
```

Electron 的 Chromium 用户配置目录在 Windows 上默认是 `%APPDATA%\alice-butler-pet`，测试通过 `--user-data-dir` 独立指定。Electron 会写缓存、首选项和单实例相关数据，应用没有对这些文件设保留期限。聊天页面通过文件桥加载历史，渲染器没有通过浏览器存储另存一份聊天历史。[应用名](../AliceButler/electron/package.json) · [聊天渲染](../AliceButler/electron/src/renderer/chat.ts)

## 桌宠及聊天通道

| 文件 | 写入点和字段 | 保留 |
| --- | --- | --- |
| `resources/app/config.json`、`defaults.json`、`butler-config.json` | 前两者随包安装，分别为生效配置与恢复源，含片段清单及朝向、动作池及权重、闲置时段、`tuning`、`triggers`、`interaction`。根目录配置随管家安装，含 runner、watchdog、presence、每日自检、部署参数及旧版登记项。Electron 缺少或拒绝生效配置时，从默认文件原子恢复。 | 直到覆盖或卸载。 [配置加载](../AliceButler/electron/src/main/main.ts) · [桌宠默认值](../AliceButler/electron/defaults.json) · [管家配置](../AliceButler/butler-config.json) |
| `config.json.bad-<毫秒>` | `loadConfig` 在配置存在却无法使用时记录时间（文件名）和 `reason`（`invalid-json`、系统错误代码或 `failed`）。旧版本留下的同名文件可能包含被拒绝的配置原文。 | 按次创建，无定时清理。 [配置恢复](../AliceButler/electron/src/main/main.ts) |
| `pet-position.json` | `savePosition` 写 `standing` 和 `desktop`、`position`，后两者均为 `display` ID 与 `x,y` DIP 坐标。位置变化后在闲置维护或退出时保存。 | 单份覆盖。 [位置保存](../AliceButler/electron/src/main/main.ts) · [读取和限制](../AliceButler/electron/src/main/placement.ts) |
| `pet-stats.json` | `writeStats/persistStats` 写当下进程 `pid,ts,runtime,processCount,processes[{type,pid,workingSetMB}]`，资源 `privateSampleMiB,workingSetMB,privateMB,cpuPercent,lastReclaim{beforeMiB,afterMiB,at}`，播放 `diskLoads,decodedFrames,intervalMs,clip,restState,startupMs,suspended,acceleration`，及 `sessionOpen,sessionId,days`。每日项含 `workingSetPeakMiB,privatePeakMiB,plays,crashes,recoveries,chatRoundTripMs,triggers[{ts,source,clip,state:{kind,rest,presence,motion,chatOpen}}]`。回收记录和事件数组可缺省，读数不可用时部分内存字段可为 null。 | 当前快照覆盖，运行时滚动保留含当天在内的 7 个 UTC 自然日。 [快照写入](../AliceButler/electron/src/main/main.ts) · [日统计](../AliceButler/electron/src/main/run-stats.ts) |
| `pet-heartbeat.txt`、`pet-start.log`、`pet-disabled.flag` | 心跳为 UTC 时间。首帧成功时写 `electron video ok <UTC 时间>`，并移除禁用标记。主动退出写 UTC 时间标记，部署和回滚期间可写操作文本。 | 前两项单份覆盖。标记在成功显示或相关部署恢复流程中移除。 [桌宠生命周期](../AliceButler/electron/src/main/main.ts) · [部署](../tools/deploy-electron.ps1) |
| `pet-error.log` | `report` 追加 UTC 时间、操作名、结构化错误类或系统错误代码。位置读失败另在 stderr 输出固定提示。 | Electron 追加，无轮换。管家配置中 `petErrorLogMB` 是旧版桌宠项。 [错误日志](../AliceButler/electron/src/main/main.ts) · [位置失败](../AliceButler/electron/src/main/placement.ts) |
| `presence.json` | `alice-presence.sh` 从虚拟机写入 `state,note,ts`，通过 `.tmp` 覆盖。桌宠读取有效状态给动作和托盘，并把 `note` 截至 200 字供本机 UI。 | 单份覆盖。默认展示有效期 12 分钟，非 idle 默认每 8 分钟续戳。过期文件还可留在盘上。虚拟机另有当前值、上传副本及刷新进程 PID 的本地临时文件。 [状态投递](../tools/alice-presence.sh) · [状态读取](../AliceButler/electron/src/main/main.ts) |
| `inbox/msg-*.json` 和 `inbox/seen/` | `Bridge.send` 写 `id,ts,text`，临时名加 `.tmp`，原子改名后回读存在性。外部消息钩子提取正文并移动到 `seen/`。 | 待消费文件由消费方移动。协议规定钩子每日清理 30 天前的已读项，钩子实现位于本仓库之外。 [文件桥](../AliceButler/electron/src/main/bridge.ts) · [通道协议](../AliceButler/PROTOCOL.md) |
| `outbox/reply-*.json`、`outbox/seen/`、`*.json.bad` | `pet-reply.sh` 上传 `id,text,ts`，收到后 `Bridge.poll` 移入 `seen` 才展示，重复文件删除。解码坏文件默认达到 5 次且超过 90 秒改名隔离，隔离保留文件内容。 | Electron 与 runner 没有对 outbox 已读和坏件定期删除。桌宠启动时最多读取 30 对历史，聊天 UI 默认最多显示最近 200 行。 [回复投递](../tools/pet-reply.sh) · [消费与历史](../AliceButler/electron/src/main/bridge.ts) |

Electron 和每日自检的原子覆盖一般先写 `<目标>.<UUID>.tmp`。写入函数正常结束时会清理临时名。崩溃、被强制结束或投递异常可能留下中间文件。文件桥和状态通道的命名在表中单列。[原子覆盖](../AliceButler/electron/src/main/placement.ts) · [自检覆盖](../AliceButler/daily-check.js)

## 管家、看门狗与产物

| 文件 | 写入点和字段 | 保留 |
| --- | --- | --- |
| `runner.lock`、`status.json` | `grabLock` 写 `pid,since`。`writeStatus` 写 `runnerPid,runnerSince,codeSha256,memoryMB:{rss,heap},heartbeat,jobs:[{id,name,type,pid,startedAt}],events:[{seq,ts,msg}],lastEventSeq,lastConsumedJobId`。 | 锁由新 runner 在判定陈旧后替换。状态单份覆盖，保留最近 8 条事件。 [runner 写入点](../AliceButler/runner.js) |
| `events.jsonl[.1]`、`watchdog.log[.1]` | `event` 追加 `runId,seq,ts,msg`，可含任务名、隔离文件名、退出码、重启/停止说明或自检错误代码。看门狗追加 UTC 时间、两进程状态、调度决定及失败代码。 | 事件日志超过 2 MiB、看门狗日志超过 1 MiB 时轮换，各保留一份 `.1`。 [事件](../AliceButler/runner.js) · [看门狗](../AliceButler/watchdog.js) |
| `jobs/`、`running/` | 投递方写任意 JSON 名的任务和停止标记，例如部署冒烟。任务定义含 `id,name,type,cmd,args,cwd,env,shell`，`running/<id>.job.json` 复制完整定义，`running/<id>.json` 写 `id,name,type,pid,startedAt`，停止墓碑写 UTC 时间。 | 消费时删任务文件，结束时删运行副本。任务坏件反复失败且够龄后改名 `.bad`，无定期清理。停止墓碑覆盖、被后续启动删除或按 mtime 30 天清理。 [任务协议](../AliceButler/PROTOCOL.md) · [runner](../AliceButler/runner.js) · [部署冒烟写入](../tools/write-deploy-smoke.ps1) |
| `done/<id>.result.json`、`logs/<id>.log` | `finish/recover/scanJobs` 写 `id,name,type,exitCode,how,stopped,startedAt,endedAt`，部分失败只写 `id,error` 或省略 `stopped`。日志含开始时间、任务 ID、子进程原始 stdout/stderr、启动失败和截断提示。 | 按 mtime 30 天清理。子进程输出按每文件 20 MiB 限制。 [回执与日志](../AliceButler/runner.js) |
| `pet-restart-request.json` | 看门狗为未关闭的会话写 `previousSession,ts,expiresAt`，均用于确认自愈归属。 | 后续重启请求覆盖，调度失败删除。有效期默认 180 秒，过期文件没有清理计时器。 [凭据写入](../AliceButler/watchdog.js) · [凭据读取](../AliceButler/electron/src/main/run-stats.ts) |
| `pet-check-request.json`、`pet-decode-check.json` | runner 请求写 `day,ts`。Electron 回写 `day,clips`，由配置片段名映射为 `ok/decode-failed/decode-timeout`。 | 每项单份，下一次请求或响应覆盖。 [请求](../AliceButler/daily-check.js) · [响应校验](../AliceButler/electron/src/main/main.ts) · [首帧测量](../AliceButler/electron/src/renderer/decode-probe.ts) |
| `pet-daily-check.json` | 自检写 `day,ts,ok,checks`。各项含 `ok`，进程项另有 `runner,pet` 两 PID，心跳项有 `ageMs`，媒体项有 `clips`，磁盘项有 `freeMiB,minMiB`。错误分支用 `error` 固定提示或错误代码。 | 每 UTC 日最多成功写一次，下一份覆盖。 [每日自检](../AliceButler/daily-check.js) |
| 周报文本 | `pet-weekly.js` 从统计得到 UTC 范围和覆盖天数、内存峰值、片段播放数、触发来源计数、崩溃/自愈次数、聊天样本数/P50/最大往返时间。 | 默认只写 stdout。调用方重定向才生成文本文件，文件名、保留由调用方决定。 [周报脚本](../AliceButler/pet-weekly.js) · [重定向示例](electron-batch4/README.md) |

## 部署和回滚数据

展开包安装在根目录，包含运行时、渲染器、配置、资源和 13 段 WebM。整包部署暂存于 `deploy-stage/<ID>`，并将被替换的旧文件及旧动作子目录副本放入 `deploy-backups/<ID>`。完整清单 `new-package-manifest.json` 含 `relative,hash,bytes`，托盘回滚的逆向包只需 `relative`；定向素材部署的备份只含旧 `idle.webm`。回滚先用 `.rollback.lock` 排他锁和 `.pending-<ID>` 生成逆向备份，再改名。部署脚本和托盘都没有按日删除备份，托盘只显示最新三项。旧 WinForms 脚本会写一个 `AlicePetNew.prev.exe` 并在下一次备份覆盖。旧 WinForms 与 PowerShell 临时桌宠也曾使用同名日志、心跳、统计及聊天通道，历史文件格式可能不同。 [部署写入与旧资产搬运](../tools/deploy-electron.ps1) · [托盘回滚](../AliceButler/electron/rollback.ps1) · [旧 .prev 写入](../tools/archive/deploy-pet-winforms.sh) · [旧日志与统计](../AliceButler/pet.cs)

`electron-deploy-result.json` 与 `electron-asset-deploy-result.json` 默认各保留最新的一份，也可把路径指定到其他位置。公共字段有 `success,exitCode,receipt,backup,deployedAt`，整包成功另有 `packageBytes,legacyAssetsBackedUp`，素材成功另有 `asset,sha256,bytes,otherAssetsUnchanged`，失败时有 `error` 原文。路径和错误内容属于运维数据。部署冒烟会经 `jobs/` 留下相应 `done/` 和 `logs/`。 [部署结果与回执](../tools/deploy-electron.ps1)

## 进程边界和诊断复核

- **有意传输的聊天与状态**。主人投递的聊天正文和消息 ID 由外部钩子交给艾莉丝，回信由虚拟机写回桌宠。presence 标记和说明也由虚拟机传入。这些是功能通道，用户发进聊天的密钥或联系方式会作为消息正文走同一通道。聊天正文、presence 说明不会进入统计、周报和每日自检。
- **留在本机的运行细节**。位置坐标和显示器 ID、完整统计快照中的进程明细和会话 ID、配置与备份、浏览器配置、任务命令/环境和原始任务日志都没有诊断自动外发路径。部署备份为还原服务保留文件原字节，旧版 `config.json.bad-*` 也可能含原文。另有运维脚本按显式调用输出日志尾部和状态，及通用文件传输工具。持有这些权限的人可以人工读出文件。 [运维读取](../tools/health-pet.ps1) · [文件传输](../tools/pc-transfer.sh)
- **可手动转交的报告**。周报的出进程边界是 stdout，自检写入本地 JSON 供托盘和人工读取。若把自检样本放进仓库或转交艾莉丝，字段仍包括采样日、两 PID、心跳年龄、片段名及状态、盘余量/阈值和错误代码。周报转交的是表中的聚合统计。仓库现有两种样例均来自明确运行和手动保存。 [周报样例](electron-batch4/weekly.txt) · [自检样例](electron-batch4/pet-daily-check.json)
- **采集入口**。Electron 有运行数据采集与本地自检反馈，当前托盘没有一键诊断导出。两条种子测试经过实际聊天往返、统计/周报、非法配置恢复、临时目录读写故障、自检失败、旧版解码错误、runner 和 watchdog。基线在损坏配置原文、Electron 错误路径、自检原错误、管家/看门狗日志、周报失败 stderr 和位置失败 stderr 发现种子。复测中上述诊断写出固定状态或错误代码。四类种子在复测诊断产物中为 0 次，聊天通道原文仍可读。 [种子测试](../AliceButler/electron/tests/diagnostics.integration.cjs)

从 `AliceButler/electron` 复跑，显示环境必须可启动 Electron。该测试使用独立的临时数据和用户目录，对看门狗的调度调用使用子进程替身。

```sh
npm run build
node --test tests/diagnostics.integration.cjs
```

核对写入点可从仓库根执行下列搜索，同时检查 Shell 重定向、工具的 SCP 临时名、Chromium 默认目录及归档脚本。

```sh
rg -n 'writeFile|appendFile|createWriteStream|\.write\(|atomicWrite|rename|copyFile|Set-Content|Move-Item|Copy-Item|File\]::Copy|WriteAllText|AppendAllText' AliceButler tools -g '!*.md' -g '!package-lock.json' -g '!**/tests/**'
```
