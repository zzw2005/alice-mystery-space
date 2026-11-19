# 艾莉丝 Electron 桌宠

最终重建目标见 [重建说明](../../docs/electron-rebuild.md)。旧 `../pet*.cs` 是保留归档，不是本播放器的源码，也不再生成旧 22 段帧的转码副本。

## 本地构建

Node.js 24：`npm ci`（如环境全局禁止安装脚本，再执行 `node node_modules/electron/install.js`）→ `npm test` → `npm run start`。运行时默认对接 `C:\ProgramData\AliceButler`。隔离验收设置 `ALICE_PET_ROOT` 为专用测试目录，`ALICE_PET_TEST=1` 保持窗口隐藏；不要对真实通道发测试消息。

`npm run package` 输出 `release/AlicePetNew-win32-x64/`，包含 Chromium/Electron，完整安装体积会明显大于旧 WinForms；视频体积与程序体积分别统计，内存按 Electron 所有进程合计。生产不使用 node_modules 或 TS 编译器。

部署后生产包点播检查：

```powershell
$env:ALICE_PET_EXECUTABLE = 'C:\ProgramData\AliceButler\AlicePetNew.exe'
node tests/deployed-nine-clip-smoke.cjs
```

该检查用隔离的 `ALICE_PET_ROOT` 和隐藏窗口启动生产包，不会读写正式聊天通道。

单段素材更新使用 `tools/deploy-pet.sh --asset idle`：脚本只替换生产包中的
`resources/app/media/idle.webm`，在部署前后校验其余八段哈希不变，并执行
新实例启动、心跳和 runner 冒烟。

## 动作与素材

`config.json` 是运行时动作配置，`defaults.json` 是恢复副本。保存后约 2 秒重载。随机链先按 `animationWeights` 抽池，再按池内权重抽动作，有多项时排除上次抽中的动作。当前 `moves` 为空，`walk.webm` 留档。进入工作状态播放 `coding`，任务成功播放 `events.done`。聊天回复可通过 `tools/pet-reply.sh <msg-id> <text> [animation-category]` 选用 `categories` 中的单次动作。点击可抢占在播和待换源的单次动作，回报 `cancelled` / `superseded`。右键和托盘菜单的「点击音效」开关保存在运行根目录的 `pet-settings.json`，音效每 100 ms 最多播放一次。

2026-11-19 批次按 [动作清单](../../new-clips-20261119/actions-manifest-20261119.json) 和 [着装规则](../../SKINS.md) 接入。未指定 `skin` 的动作使用制服。常规换装先播当前着装的 `blink-uniform` 或 `blink-wafuku`，在已呈现的 2.50 秒闭眼帧暂停。目标着装从自己的闭眼帧接入，播到睁眼后进入目标动作。和风版 `afterimage` 自带闭眼收势，播完可直接接制服闭眼帧。点击等交互抢占时加快播至闭眼帧，再接新动作。常驻待机使用制服。

基础动作的加工流程见 [绿幕素材验收](../../docs/green-assets-validation.md)。睡眠按 `sleepstart → doze → wakeup` 接力。运行 `python3 tools/check-electron-media.py AliceButler/electron --sleep-only` 可复核睡眠 RGBA 接缝。

播放由两个原生 video 按需交替加载，等待 `requestVideoFrameCallback` 确认首帧后再切换；普通切换保留 180ms 淡化，随后移除旧 video 的 src。换源代号 `swapGen` 阻止已被抢占的请求提交。额外用固定 RGBA 缓冲＋显式关闭的 VideoFrame 更新一张最近帧 canvas，在循环 seek/waiting 时覆盖视频，等可用新帧恢复后撤下；正常视频仍由原生 video 播放，不用散帧替代。稳定播放只有一个带源 video，加载下一段时至多两个。重复请求相同循环片不会重新加载。睡着或主动隐藏连续超过两分钟后保留静态画面并释放所有视频源，向 Chromium 发送内存压力通知；显示或唤醒时恢复。隐藏期间的状态变化不会重新打开解码器。聊天窗口第一次打开时才创建。

透明 alpha 读取只用于命中，不把视频改成散帧播放；指针离开窗口或拖拽期间跳过像素读取与连通域计算。透明区与脚下阴影穿透；角色可抓。DIP 坐标跟随 Electron DPI，镜像/挤压使用同一逆变换命中。拖拽使用解析临界阻尼弹簧，慢帧下也不发生数值发散。

命中角色后，按下左键立即压扁并在 200 ms 内回弹。再次按下可重新触发，超过拖拽起手距离时取消回弹。点击池媒体在启动时预加载，按下即请求反应，并从各段的 `startOffset`（秒）开始。同皮肤点击直接进入反应，跨皮肤点击仍经过闭眼换装。双击挥手，松手后的双击判定窗口只影响聊天的打开时机。

清醒时可以在桌宠右键或托盘菜单的「选择动作」里按制服和和风点播。动作从头播放一次，结束后回到当前待机或工作状态。桌宠隐藏时，从托盘点播会显示角色。睡着时可先用同一菜单的「起来」唤醒。

## 特效

右键与托盘菜单的「特效」总开关默认开启。「氛围粒子」可选择关闭、浮光或落雪，首次使用配置值 `effects.atmosphere`（默认 `off`）。开启氛围后，`doze` 使用低密度梦境微光。菜单选项保存到运行根目录的 `pet-settings.json`。`effects.actions` 按动作名设置 `type`、`anchor` 和 0–1 的 `intensity`，在动作首帧呈现时触发。锚点 `head`、`front`、`sides` 以舞台横向 51%、脚底 85% 为基准。

透明 PixiJS 画布在首次需要特效时创建，使用 WebGL2 实例绘制。全层最多 120 个粒子，最高渲染倍率 1.5。氛围以 12 FPS 为目标，反应特效以 20 FPS 为目标。粒子清空或桌宠隐藏时停止绘制，关闭总开关时释放画布及渲染资源。

运行 `npm run test:effects` 验证配置、粒子预算和设置。播放回归可用 `ALICE_TEST_EFFECTS_MODE=on` 或 `off` 指定开关。没有硬件 WebGL 的 Linux 测试环境可用 `ALICE_TEST_SWIFTSHADER=1`。

## 优化验收（只在开发副本运行）

`npm test` 检查类型、动作/物理与文件桥；`npm run test:electron` 验证已配置动作、透明通道、睡眠与聊天回归；`npm run test:playback` 验证切换、快速抢占、画面连续性、解码器释放和恢复。全部使用隔离 `ALICE_PET_ROOT`。测试额外指定独立 user-data-dir，避免与生产或另一开发实例竞争单实例锁。测试环境如需 `ALICE_TEST_NO_SANDBOX=1`，仅测试启动器会带 `--no-sandbox`，产品启动不改变沙盒。

构建后运行 `node --test tests/interaction.integration.cjs` 验证按压、拖拽、换装和点击首帧。

`ALICE_PLAYBACK_SOAK=1 npm run test:playback` 等待真实两分钟睡眠阈值；默认通过老化测试时间戳验证同一个维护定时器。隐藏路径也测试同一阈值与恢复。测试采样 actor 的 160×90 合成画面来检测黑帧/透明空帧，不代替 Windows 上的可见画面验收。

`npm run bench` 默认每种加速模式各测三轮，输出 `test-results/performance.json`，含全进程工作集、Windows 私有字节合计、CPU、九段稳态帧率/掉帧、进程冷启动到首帧与释放/恢复后的采样。`ALICE_BENCH_APP` 可指向已构建的基线 worktree，`ALICE_BENCH_OUTPUT` 指定报告位置；`ALICE_BENCH_RUNS` 控制轮数。Linux 不支持 Windows privateBytes，明确返回 null，并另列 /proc 私有驻留内存，二者不可直接比较。首帧外部计时包含 Playwright 启动与检测开销，文件缓存未清空；`pet-stats.json.startupMs` 是主入口到首个已提交视频帧的内部计时。

硬件加速通过启动环境变量 `ALICE_PET_ACCELERATION=off` 禁用，`on` 或省略保持 Chromium 默认。Linux 软件显示结果不足以决定 Windows 默认，须在目标 Windows 开发副本完成 A/B 后再调整。基线、实验结果和未达标项见 [第一批报告](../../docs/electron-optimization-20261118.md)。

## 聊天与进程

桌宠写 inbox，外部钩子读；外部钩子写 outbox，桌宠读，格式与旧 PROTOCOL 一致。所有渲染器 Node 禁用、contextIsolation/sandbox 开启，只暴露固定 IPC；新窗口和导航禁止，文本以 textContent 显示。

presence 文件每 2 秒读取，12 分钟过期。thinking/working/result/waiting 循环；success/error 每次进入仅一次。睡眠期间不受 presence 打断，提前叫醒先完成入睡段再播醒来段。heartbeat 每 30 秒；托盘主动退出写 pet-disabled.flag；自启沿用 AlicePetLaunch。

waiting 档按加倍间隔参与随机链。自动入睡要求聊天窗关闭且 presence 为 idle。互动冷却、困意、唤醒保护和连点彩蛋由两份 JSON 的 `triggers` 控制，默认值见 [参数清单](../../docs/electron-tuning-inventory.md#第五批触发参数)。

动作切换以 `ts`、`source`、`clip` 和 `state` 记录在 `pet-stats.json` 的 `days[UTC 日期].triggers`。每个事件独立于 `plays` 的播放启动计数。`node AliceButler/pet-weekly.js <运行目录>` 按最近七个 UTC 自然日输出触发来源分布。

生产部署只能执行仓库 `tools/deploy-pet.sh`，需要打包结果。管家、看门狗、计划任务和既有 ACL 保持不变。以新的 video 启动日志、heartbeat、runner 的 done 冒烟回执 exitCode=0 为成功标准。
