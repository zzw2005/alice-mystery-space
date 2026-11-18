# 工程瘦身与提交前自检

## Windows x64 生产包构成

基线为 15b45a3，前后使用相同的 Electron 45.3.3 win32-x64 官方 ZIP 与 packager 20.3.0。统计 release/AlicePetNew-win32-x64 中所有普通文件的逻辑字节数，覆盖运行时与应用。计量对象是部署脚本实际复制的展开目录。

| 构成 | 基线字节 | 本批字节 |
|---|---:|---:|
| Electron 可执行文件 | 250,093,056 | 250,093,056 |
| 媒体、GPU、崩溃报告等 DLL | 40,467,400 | 40,467,400 |
| Chromium 资源、ICU、快照及其余运行时数据 | 26,821,374 | 26,821,374 |
| 语言包 | 51,195,034 | 2,369,469 |
| 13 段 WebM | 20,761,452 | 20,761,452 |
| 应用代码、UI、配置与回滚脚本 | 276,478 | 288,069 |
| 生产 npm 依赖文件 | 0 | 0 |
| 许可证 | 5,707,031 | 5,707,031 |
| 合计 | 395,321,825 | 346,507,851 |

总量由 377.01 降至 330.46 MiB，净减少 48,813,974 字节（46.55 MiB，12.35%）。应用 UI 是中文，保留 zh-CN、zh-TW、en-US、en-GB 四个 Chromium 语言包，裁去其余 51 个。生产 JS 仅引用 Electron、Node 内置模块及本地编译产物。五个开发依赖仍用于构建或测试，原打包器已排除，生产依赖的节省为 0 字节。

保留全部 DLL、ICU、双 DPI 资源、V8 快照、SwiftShader、Vulkan 与许可证。不同显卡、远程桌面、软件渲染和崩溃处理路径需要 PC 侧覆盖；未以单台云端机器的运行表现推断这些文件可删。部署脚本按清单复制，更新已有安装时旧语言文件可能仍占磁盘。上述体积按干净输出目录计算。

## 一条命令

在 `AliceButler/electron` 下安装锁文件依赖（`npm ci`），准备可用桌面、FFmpeg（含 libvpx-vp9）、Python 3 和 numpy，然后运行 `npm run precheck`。默认从源码构建并启动，可设置 `ALICE_PET_EXECUTABLE` 指向已打包的可执行文件，检查该包实际加载的 config 和媒体。设置 `PYTHON` 可指定 Python；传入 `-- --audit 文件路径` 时另需 OpenCV 与 Pillow。

每段输出首个有效采样的视频时间、透明像素数、不透明纯黑像素比例；另验尺寸、解码就绪、page error、聊天往返、托盘菜单与既有接缝上限。失败返回非零退出码。测试用临时用户配置和文件通道。

## 本次全量自检输出

云端以 Linux x64 原生打包程序实跑，Windows 与 Linux 两个裁剪包的 resources/app 已逐文件比较相同。托盘测试调用同一菜单项打开聊天并切换任务栏模式两次。Windows EXE 启动、原生托盘弹出和 PC 部署后冒烟需在部署侧验收。

```text
idle: PLAY 640x360 t=1.041s transparent=196689 black=0.000009
walk: PLAY 640x360 t=0.962s transparent=197668 black=0.000161
wave: PLAY 640x360 t=1.000s transparent=195701 black=0.000009
sleepstart: PLAY 640x360 t=0.998s transparent=196808 black=0.000239
doze: PLAY 640x360 t=0.964s transparent=207838 black=0.000000
wakeup: PLAY 640x360 t=1.001s transparent=207118 black=0.000000
clickhappy: PLAY 640x360 t=0.998s transparent=196240 black=0.000030
clickshy: PLAY 640x360 t=1.008s transparent=196872 black=0.000000
clicktsun: PLAY 640x360 t=1.005s transparent=196527 black=0.000013
dangle: PLAY 640x360 t=0.995s transparent=197238 black=0.000048
sitdown: PLAY 640x360 t=0.978s transparent=209622 black=0.000104
peek: PLAY 640x360 t=1.006s transparent=196604 black=0.000017
startled: PLAY 640x360 t=1.005s transparent=196955 black=0.000004
chat=PASS tray=PASS pageErrors=[]
idle->idle MAE=0.000000 limit=0.000000
walk->walk MAE=0.000000 limit=0.000000
doze->doze MAE=0.000000 limit=0.000000
dangle->dangle MAE=0.000000 limit=0.000000
peek->peek MAE=0.000000 limit=0.000000
sleepstart->doze MAE=0.132885 limit=0.132886
doze->wakeup MAE=0.132885 limit=0.132886
wakeup->idle MAE=1.316980 limit=1.316981
PASS
```

## 内存

云端 Linux 虚拟桌面、默认硬件加速，空闲四个进程的五次采样中位数。私有驻留内存 163.14 → 163.67 MiB（+0.52 MiB），工作集 456.22 → 457.14 MiB。Windows 私有字节及实机包占用待 PC 侧复测。

开发期间运行新配置、文件桥的定向单测、独立 runner/watchdog 临时目录测试，以及裁剪包的单段点播和聊天/托盘冒烟。收尾运行一次 13 段自检、全套单测、Electron 集成及播放稳定性检查。构建输出剔除 npm 隐藏锁文件后又做了一次单段最小冒烟。

全量结果为 13 段点播通过、page error 为 0、18 项 Node 单测及 5 项 Python 单测通过，Electron 集成通过。首次长时播放采样 9,068 帧，其中 doze 循环重新定位时出现 1 帧空画面，未通过零空帧要求。修正为循环末尾提前 90 ms 显示正在刷新的已解码画布。针对四个运行时循环动作重新执行播放测试，再次实等 122 秒，采样 8,949 帧，空帧 0、黑帧 0，视频源峰值 2。最终打包产物再验四段循环、聊天收发与托盘开关，均通过。
