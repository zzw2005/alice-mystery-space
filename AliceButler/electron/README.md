# 艾莉丝 Electron 桌宠

最终重建目标见 [重建说明](../../docs/electron-rebuild.md)。旧 `../pet*.cs` 是保留归档，不是本播放器的源码，也不再生成旧 22 段帧的转码副本。

## 本地构建

Node.js 24：`npm ci`（如环境全局禁止安装脚本，再执行 `node node_modules/electron/install.js`）→ `npm test` → `npm run start`。运行时默认对接 `C:\ProgramData\AliceButler`。隔离验收设置 `ALICE_PET_ROOT` 为专用测试目录，`ALICE_PET_TEST=1` 保持窗口隐藏；不要对真实通道发测试消息。

`npm run package` 输出 `release/AlicePetNew-win32-x64/`，包含 Chromium/Electron，完整安装体积会明显大于旧 WinForms；视频体积与程序体积分别统计，内存按 Electron 所有进程合计。生产不使用 node_modules 或 TS 编译器。

部署后九段生产包点播检查：

```powershell
$env:ALICE_PET_EXECUTABLE = 'C:\ProgramData\AliceButler\AlicePetNew.exe'
node tests/deployed-nine-clip-smoke.cjs
```

该检查用隔离的 `ALICE_PET_ROOT` 和隐藏窗口启动生产包，不会读写正式聊天通道。

单段素材更新使用 `tools/deploy-pet.sh --asset idle`：脚本只替换生产包中的
`resources/app/media/idle.webm`，在部署前后校验其余八段哈希不变，并执行
新实例启动、心跳和 runner 冒烟。

## 动作与素材

`config.json` 是运行时动作配置，保存后约 2 秒重载；坏配置保留上一份有效配置并记录错误。idle/turn/drag/clicks/moves 各自权重抽选，多候选排除上次动作。待机池中的 `idle` 标为循环、`wave` 标为单次；三段点击共用 `clicks` 池。`provisional:true` 明确标注借用动作，尚不等于正式对应素材。

`media/*.webm` 仅由仓内 `clips-green/v2/*.mp4` 加工。重跑 `py tools/process-green.py --ffmpeg <ffmpeg.exe> --clip <name>`（在仓库根目录），输出 640×360 VP9-alpha、保留源 24fps，不生成视频、不用旧帧。管线依赖 numpy、opencv-python、Pillow，ffmpeg 需要 libvpx-vp9。人物主连通域按站立 17%–85% 高 68%、睡姿 33%–85% 高 52%、中心 51% 固定对齐；Zzz 等分离特效保留但不参与身体包围盒。每帧检测透明通道与不透明纯黑 <5%；`idle`、`walk`、`doze` 使用无损 VP9 并要求解码首尾 RGBA 完全一致。睡眠过渡两段在加工域使用 24 帧接缝锚定、CRF 24 双端关键帧，目标单段约 1MB且三处 MAE <0.5。逐段数据见 `docs/green-assets-validation/<clip>.json` 与总表 `docs/green-assets-validation.md`。

播放由两个原生 video 按需交替加载，等待 `requestVideoFrameCallback` 确认首帧后再切换；冻结的上一帧 canvas 保留 180ms 交叠，旧 video 立即移除 src 并 load 以释放解码器。额外用固定 RGBA 缓冲＋显式关闭的 VideoFrame 更新一张最近帧 canvas，在循环 seek/waiting 时覆盖视频，等可用新帧恢复后撤下；正常视频仍由原生 video 播放，不用散帧替代。稳定播放只有一个带源 video，加载下一段时至多两个。重复请求相同循环片不会重新加载。睡着或主动隐藏连续超过两分钟后保留静态画面并释放所有视频源，向 Chromium 发送内存压力通知；显示或唤醒时恢复。隐藏期间的状态变化不会重新打开解码器。聊天窗口第一次打开时才创建。

透明 alpha 读取只用于命中，不把视频改成散帧播放；指针离开窗口或拖拽期间跳过像素读取与连通域计算。透明区与脚下阴影穿透；角色可抓。DIP 坐标跟随 Electron DPI，镜像/挤压使用同一逆变换命中。拖拽使用解析临界阻尼弹簧，慢帧下也不发生数值发散。

## 优化验收（只在开发副本运行）

`npm test` 检查类型、动作/物理与文件桥；`npm run test:electron` 验证九段、透明通道、睡眠与聊天回归；`npm run test:playback` 验证切换、快速抢占、画面连续性、解码器释放和恢复。全部使用隔离 `ALICE_PET_ROOT`。测试额外指定独立 user-data-dir，避免与生产或另一开发实例竞争单实例锁。测试环境如需 `ALICE_TEST_NO_SANDBOX=1`，仅测试启动器会带 `--no-sandbox`，产品启动不改变沙盒。

`ALICE_PLAYBACK_SOAK=1 npm run test:playback` 等待真实两分钟睡眠阈值；默认通过老化测试时间戳验证同一个维护定时器。隐藏路径也测试同一阈值与恢复。测试采样 actor 的 160×90 合成画面来检测黑帧/透明空帧，不代替 Windows 上的可见画面验收。

`npm run bench` 默认每种加速模式各测三轮，输出 `test-results/performance.json`，含全进程工作集、Windows 私有字节合计、CPU、九段稳态帧率/掉帧、进程冷启动到首帧与释放/恢复后的采样。`ALICE_BENCH_APP` 可指向已构建的基线 worktree，`ALICE_BENCH_OUTPUT` 指定报告位置；`ALICE_BENCH_RUNS` 控制轮数。Linux 不支持 Windows privateBytes，明确返回 null，并另列 /proc 私有驻留内存，二者不可直接比较。首帧外部计时包含 Playwright 启动与检测开销，文件缓存未清空；`pet-stats.json.startupMs` 是主入口到首个已提交视频帧的内部计时。

硬件加速通过启动环境变量 `ALICE_PET_ACCELERATION=off` 禁用，`on` 或省略保持 Chromium 默认。Linux 软件显示结果不足以决定 Windows 默认，须在目标 Windows 开发副本完成 A/B 后再调整。基线、实验结果和未达标项见 [第一批报告](../../docs/electron-optimization-20261118.md)。

## 聊天与进程

桌宠写 inbox，外部钩子读；外部钩子写 outbox，桌宠读，格式与旧 PROTOCOL 一致。所有渲染器 Node 禁用、contextIsolation/sandbox 开启，只暴露固定 IPC；新窗口和导航禁止，文本以 textContent 显示。

presence 文件每 2 秒读取，12 分钟过期。thinking/working/result/waiting 循环；success/error 每次进入仅一次。睡眠期间不受 presence 打断，提前叫醒先完成入睡段再播醒来段。heartbeat 每 30 秒；托盘主动退出写 pet-disabled.flag；自启沿用 AlicePetLaunch。

生产部署只能执行仓库 `tools/deploy-pet.sh`，需要打包结果。管家、看门狗、计划任务和既有 ACL 保持不变。以新的 video 启动日志、heartbeat、runner 的 done 冒烟回执 exitCode=0 为成功标准。
