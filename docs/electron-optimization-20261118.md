# Electron 优化第一批审计报告

范围来自《艾莉丝桌宠优化方案-20261118》第四节：只做 Electron 内的 P0 内存、P1 跟手与播放、P2 启动。基线为 `41fa4421bd078988914ace8483c21ffe6518e5a5`，分支为 `feat/electron-optimize`。未部署、未连接生产目录，未修改 runner、看门狗、计划任务、聊天桥协议、presence 文件格式和九段正式素材。本批结果需要艾莉丝审计和 Windows 开发副本验收后才能部署。

## 实现

- 把播放器拆为有界双槽：当前段＋一个正在加载的段；稳定时只有一个带 src 的 video。新段收到首个 video frame callback 后才提交显示，冻结的旧画面覆盖 180ms 交叠，旧段立即 pause、removeAttribute('src')、load，释放解码器。快速请求用 AbortController 取消旧加载及监听器；同一循环段复用解码器和播放位置。额外保留一张最近的已呈现帧，使用 CPU 画布、预分配的 640×360 RGBA 缓冲与 ImageData；逐帧用 VideoFrame.copyTo 复用同一缓冲并在 finally 显式 close，不为每帧分配 RGBA 数组，也不积累画布的已转换源帧缓存，覆盖循环 seek/waiting 期间的暂时无帧状态；缓冲时继续让原生 video 参与合成，以确保帧回调能继续，直到确认 readyState≥2 且 seeking=false 后撤下覆盖层。
- 睡眠/主动隐藏持续 120 秒后冻结画面、取消视频帧回调、释放全部源，并向 Chromium 发送 critical memory pressure 通知，促使缓存回收。显示或唤醒按同一首帧路径恢复，隐藏期间收到状态变化不重新加载。没有通过强制压缩 Windows 工作集来美化私有内存数据。
- 聊天窗口延迟到第一次打开才创建，聊天历史读取移出首帧关键路径；聊天打开之后保留其状态与未发送草稿。基准中的常驻进程数从 5 变为 4，打开聊天后仍为 5。
- 命中图只在指针处于窗口、确实需要命中时更新；拖拽期间跳过 RGBA 回读与连通域计算，命中改变时才发 IPC。保留逐像素主体命中、透明区/分离特效穿透及镜像逆变换。
- 去掉物理 tick 内的 getBounds 轮询，合并同 tick 的工作区计算；解析临界阻尼弹簧缩短跟随时间，保持抛掷速度限幅、重力和着陆规则。
- 增加全进程 CPU、首帧时间、解码器休眠状态与加速模式诊断；不支持 Windows privateBytes 的平台输出 null，避免原先“0 MB 私有内存”的误导。

## 测试环境与计量口径

Debian 13 x64、Electron 45.3.3、Node 24.22.1、Xorg dummy 1280×800；Electron 窗口可见，聊天未打开，通道与 Chromium profile 均隔离。云桌面工具启动失败，因此用已安装的 Xorg dummy 和项目 Playwright 启动器验证。最终一轮在后台进程中断后重启相同配置的 Xorg dummy 完成，工作集还可能受共享页驻留状态影响。该软件显示不代表目标 Windows GPU。

同一个 `tests/performance.cjs` 对基线与本分支分别运行：on/off 各三次，每次新进程、新 profile；先待机五个一秒采样，再顺序播放全部九段，每段切换后等待 250ms 并记录一秒稳态帧率，最后测九段之后及休眠/恢复。工作集按 `app.getAppMetrics()` 列出的进程直接相加，与原桌宠 stats 采用同一 API 口径，会重复计入共享页。Linux 的 zygote 未由该 API 枚举，不纳入这里的进程集合；Linux 结果仅用于本环境内比较。CPU 是所有进程之和，100% 为一个逻辑核。Linux 的 `/proc/<pid>/smaps_rollup` 私有驻留内存仅作单独参考，不能作为 Windows privateBytes 的达标证据。

首帧外部计时从 Playwright 启动前到检测到已播放的可见视频帧，含自动化开销。每次是进程冷启动，但未清空 OS 文件缓存。内部 startupMs 从主入口到收到首个呈现帧通知，不能与外部计时混比。三次样本报告中位数，不外推 P95。

## 同环境性能结果

以下均为三次运行的中位数，内存单位 MiB。待机汇总每次五个一秒样本；九段之后、冻结/恢复每次各一个样本。证据：[汇总](electron-optimization-20261118/summary.json)、[基线原始值](electron-optimization-20261118/baseline-performance.json)、[优化后原始值](electron-optimization-20261118/optimized-performance.json)。

| 指标 | 加速 on 基线→优化 | 加速 off 基线→优化 |
|---|---:|---:|
| 待机进程数 | 5 → 4 | 5 → 4 |
| 待机全进程工作集 | 735.82 → 456.88（−37.9%） | 689.10 → 411.82（−40.2%） |
| 九段之后全进程工作集 | 1099.48 → 508.02（−53.8%） | 1061.01 → 462.98（−56.4%） |
| 待机私有驻留内存（Linux 专用参考） | 277.73 → 152.20 | 261.13 → 135.58 |
| 九段之后私有驻留内存（Linux 专用参考） | 635.70 → 192.70 | 623.48 → 177.66 |
| 待机全进程 CPU | 9.15% → 6.25% | 9.23% → 5.93% |
| 九段点播期间全进程 CPU（间隔均值） | 11.77% → 7.42% | 11.73% → 7.39% |
| 进程启动到首帧（外部 ms） | 391.45 → 312.64 | 350.30 → 300.40 |
| 九段稳态帧率中位数（源 24fps，一秒计数窗） | 23.70 → 23.91 | 23.82 → 23.90 |
| 27 个九段稳态样本累计掉帧 | 0 → 0 | 1 → 0 |
| page error | 0 → 0 | 0 → 0 |

优化后冻结的全进程工作集（on/off）为 **483.73/436.38**；私有驻留内存 **170.85/152.69**，CPU **0.98/0.66%**。恢复后工作集 **504.43/457.01**，私有驻留内存 **185.69/167.68**，均无错误。冻结前后比较均在九段点播之后采样，不与刚启动的待机内存混比。CPU 包含文件桥、托盘和主进程定时器；正常待机视频仍使用源 24fps。

启动三次区间：基线 on 371.59–462.43ms；off 315.37–391.32ms；优化后 on 302.16–341.07ms；off 275.73–307.61ms。样本少且缓存未清空，只能报告本次中位数，不能保证每次更快。

原始 video quality 计数汇总 optimized on=9、off=0，稳态窗内分别为 0/0。idle 保留了进程启动以来的计数，而基线重播 idle 会重置计数，故不把原始汇总直接作前后差值。全部原始计数均保留。**“全程绝对零掉帧”尚未关闭。** 稳态掉帧为零和未检测到空帧，不能代表启动/切换阶段绝对没有遗漏呈现帧；需在目标 Windows 连续可见录制及长采样审计。

Linux 软件显示结果不足以选择 Windows 的硬件加速默认值，本批保留原默认。

## 素材评估与接缝

使用 `python tools/evaluate-electron-media.py --output <临时候选目录>` 对 idle/walk/doze 做 CRF 12 高质量有损实验，保持 24fps、640×360、VP9 alpha、双端关键帧。逐帧比较 240 帧，正式素材完全未替换。机器证据：[media-crf12.json](electron-optimization-20261118/media-crf12.json)。

| 素材 | 原字节 | 候选字节 | 循环 MAE 原→候选 | 全帧平均 RGBA MAE |
|---|---:|---:|---:|---:|
| idle | 2,292,670 | 648,154 | 0 → 0 | 0.18414 |
| walk | 5,760,282 | 2,300,837 | 0 → 0 | 0.20205 |
| doze | 4,271,743 | 1,692,129 | 0 → 0 | 0.14255 |

| 睡眠接缝 | 当前实测 MAE | 候选 MAE | 不劣化 |
|---|---:|---:|---|
| sleepstart→doze | 0.132885 | 0.139852 | 否 |
| doze→wakeup | 0.132885 | 0.139852 | 否 |
| wakeup→idle | 1.316980 | 1.318486 | 否 |

有损候选未通过第一道接缝门槛，不能进入正式素材，三段保留无损。脸/呆毛区域也存在数值差异，未给予“画质无可见下降”的批准；无需用主观画质判断覆盖已失败的接缝门槛。

旧 `green-assets-validation/sleep-relay.json` 中 wakeup→idle 记录为 0.194609，但当前基线解码实际为 **1.316980**。本次如实记录该差异，不在优化任务中重新锚定主人定版 idle 或改动素材。所有九段哈希与基线一致，因此交付的循环与睡眠接缝 MAE 相对当前基线均不劣化；当前素材并不满足旧报告的全部接缝 <0.5 描述。

## 跟手与连续性

同样的 500×300 像素目标阶跃，从起点达到 95%：

| 物理 tick | 基线 | 优化后 |
|---|---:|---:|
| 8ms | 376ms | 120ms |
| 16ms | 384ms | 128ms |
| 50ms | 450ms | 150ms |

这是物理响应模拟，不是目标 Windows 鼠标到像素的端到端延迟。三个 tick 速率均无过冲，抛掷/着陆测试继续通过。

可见窗口的逐显示帧 160×90 actor 合成采样覆盖九段、30 次快速抢占、同段复用、冻结、睡眠与唤醒、隐藏与显示。记录的黑帧与透明空帧均为 0，源数最大为 2，稳定为 1、休眠为 0。证据见本目录机器结果。

## 最终回归检查

- `npm test`：TypeScript 构建通过，9 个单元/文件桥测试通过。
- `tests/electron.integration.cjs`：九段点播、alpha、循环、镜像、睡眠接力、六种 presence、原子聊天与文本安全检查通过，page error=0。
- `ALICE_PLAYBACK_SOAK=1 tests/playback.integration.cjs`：真实睡眠超过 120 秒后释放全部视频源；唤醒、隐藏/显示恢复及释放请求与立即显示交错均通过。可见窗口合成检查共 **8,976 帧**，透明空帧 **0**、黑帧 **0**、page error **0**，源数最大 **2**；覆盖三段循环回卷、30 次快速动作抢占与同循环复用。
- [playback.json](electron-optimization-20261118/playback.json) 保存最终长测试结果；[integration.json](electron-optimization-20261118/integration.json) 保存功能回归结果。截图在对应的本地 test-results 隔离目录，已回读检查角色画面。
- 固定缓冲复制的 idle 抽样帧与原生 video 绘制逐像素一致：RGBA MAE=0、最大通道差=0，196,700 个全透明像素保留。见 [poster-parity.json](electron-optimization-20261118/poster-parity.json)。这是一帧的复制验证，不冒充全部素材的人工逐帧画质审查。
- `git diff --check`、素材与桥/runner/看门狗/部署脚本的基线差异检查通过；九段素材全部 SHA-256 与基线相同。

## Windows 审计复跑

在单独的开发 checkout 运行，不在生产目录或生产包中运行：

```powershell
cd AliceButler/electron
npm ci
npm test
npm run test:electron
$env:ALICE_PLAYBACK_SOAK = '1'
npm run test:playback
Remove-Item Env:ALICE_PLAYBACK_SOAK
npm run bench
```

对基线另建 worktree、安装依赖并 build。仍从本分支运行相同的 bench，先设置 `ALICE_BENCH_APP` 指向基线 Electron 目录、`ALICE_BENCH_OUTPUT` 指向 baseline.json，再清除 `ALICE_BENCH_APP`、将输出改为 optimized.json。需同时比较 on/off 的全进程 privateMB、workingSetMB、CPU、稳态掉帧、首次打开聊天后及长期交互后的内存。`ALICE_PET_ACCELERATION=off` 仅改变开发实例，生产默认保留原值。

## 未关闭的验收项

- **切换与启动全程零掉帧：尚未达标。** 稳态为零，但原始 quality 计数仍有非零值，见上文；不能把透明空帧为零当作零掉帧。
- **Windows 全进程私有内存 <200MB：尚未验证，不能宣称达标。** 云环境无目标 Windows 内存计数器，Linux privateResidentMB 不能代替。
- **硬件加速默认值：待目标 Windows A/B 决定。** 已实现开关与采样；云软件显示的结果不足以选择 Windows 默认，本批保持原默认。
- **Windows 真实拖拽手感、DPI、多屏及可见合成：仍需本机审计。** 本批不扩展多屏规则。
- **长时间内存爬升：短期九段压力与两分钟休眠不能代替多小时浸泡。** 已释放旧源并覆盖恢复路径，没有宣称完全消除长期增长。
- 安装包裁剪、交互细项、聊天文案/断线提示、崩溃自愈、更新/诊断包、素材位置修正、图鉴同步和完整参数外置均按方案留后续批次。未触碰需主人另行确认的旧 WinForms 备份清理。
