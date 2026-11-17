# 艾莉丝 Electron 桌宠

最终重建目标见 [重建说明](../../docs/electron-rebuild.md)。旧 `../pet*.cs` 是保留归档，不是本播放器的源码，也不再生成旧 22 段帧的转码副本。

## 本地构建

Node.js 24：`npm ci`（如环境全局禁止安装脚本，再执行 `node node_modules/electron/install.js`）→ `npm test` → `npm run start`。运行时默认对接 `C:\ProgramData\AliceButler`。隔离验收设置 `ALICE_PET_ROOT` 为专用测试目录，`ALICE_PET_TEST=1` 保持窗口隐藏；不要对真实通道发测试消息。

`npm run package` 输出 `release/AlicePetNew-win32-x64/`，包含 Chromium/Electron，完整安装体积会明显大于旧 WinForms；视频体积与程序体积分别统计，内存按 Electron 所有进程合计。生产不使用 node_modules 或 TS 编译器。

## 动作与素材

`config.json` 是运行时动作配置，保存后约 2 秒重载；坏配置保留上一份有效配置并记录错误。idle/turn/drag/clicks/moves 各自权重抽选，多候选排除上次动作。待机池中的 `idle` 标为循环、`wave` 标为单次；三段点击共用 `clicks` 池。`provisional:true` 明确标注借用动作，尚不等于正式对应素材。

`media/*.webm` 仅由仓内 `clips-green/v2/*.mp4` 加工。重跑 `py tools/process-green.py --ffmpeg <ffmpeg.exe> --clip <name>`（在仓库根目录），输出 640×360 VP9-alpha、保留源 24fps，不生成视频、不用旧帧。管线依赖 numpy、opencv-python、Pillow，ffmpeg 需要 libvpx-vp9。人物主连通域按站立 17%–85% 高 68%、睡姿 33%–85% 高 52%、中心 51% 固定对齐；Zzz 等分离特效保留但不参与身体包围盒。每帧检测透明通道与不透明纯黑 <5%；`idle`、`walk`、`doze` 还要求解码首尾 RGBA 完全一致。逐段数据见 `docs/green-assets-validation/<clip>.json` 与总表 `docs/green-assets-validation.md`。

播放由两个原生 video 交替预载，收到首个可用帧后再切换，180ms 交叠；透明 alpha 读取只用于命中，不把视频改成散帧播放。透明区与脚下阴影穿透；角色可抓。DIP 坐标跟随 Electron DPI，镜像/挤压使用同一逆变换命中。

## 聊天与进程

桌宠写 inbox，外部钩子读；外部钩子写 outbox，桌宠读，格式与旧 PROTOCOL 一致。所有渲染器 Node 禁用、contextIsolation/sandbox 开启，只暴露固定 IPC；新窗口和导航禁止，文本以 textContent 显示。

presence 文件每 2 秒读取，12 分钟过期。thinking/working/result/waiting 循环；success/error 每次进入仅一次。睡眠期间不受 presence 打断，提前叫醒先完成入睡段再播醒来段。heartbeat 每 30 秒；托盘主动退出写 pet-disabled.flag；自启沿用 AlicePetLaunch。

生产部署只能执行仓库 `tools/deploy-pet.sh`，需要打包结果。管家、看门狗、计划任务和既有 ACL 保持不变。以新的 video 启动日志、heartbeat、runner 的 done 冒烟回执 exitCode=0 为成功标准。
