# 绿幕新素材验收

2026-11-18（东京时间）。来源仅为本仓正式 v2 九段，未转换旧 22 段，未自行生成视频，未使用参考仓素材。原文件与两张批准锚图原样保留。

管线：HSV 绿色抠像、边缘去绿溢色、预乘 alpha 缩放、每段固定变换归一、VP9-alpha 640×360 / 原 24fps。睡眠循环和醒来按入睡尾姿的坐姿高度/脚底对齐，未逐帧重新居中。OpenCV 的中文路径图片读取改用 Pillow，视频由 ffmpeg 后端读取。

逐帧数值见 `green-assets-validation.json`：每段 240 帧，libvpx-vp9 强制解码 alpha 后检测（ffmpeg 默认原生 VP9 解码可能丢 alpha，不能用它判断黑框）。不透明纯黑按 RGB<5 且 alpha≥250 统计，逐帧均 <5%；合成透明背景存在。

## 不能声明通过的项目

- 睡眠三段源视频虽已获准使用，但解码后「入睡尾→循环首」「循环尾→循环首」「循环尾→醒来首」「醒来尾→入睡首」均非逐像素相等。数值如实记录，视频播放器的 180ms 交叠只减轻可见跳变，不改变此结论。
- 入睡段坐下后轮廓较宽；doze/wakeup 与入睡来自不同缩放。固定归一后可对齐脚底和睡姿高度，但醒来末尾的站立高度仍小于标准待机，属于源视频内部比例变化。若要求完全一致，需要艾莉丝确认后重做 wakeup 及睡眠接缝，当前不自行重产。
- idle 首尾有轻微姿态差，walk 原片有漂移且为半侧面，尾姿与开头不同；clickhappy 包含小跳，脚底变化是动作内容。保留原动作，不扭曲人物去伪造端点一致。
- 所有普通动作首尾均不保证逐像素一致；入仓报告列出 first/last bbox、整段顶/脚范围及端点差。达到 alpha/黑框门，不等于达到最终美术无缝门。

重产清单更新：v2 idle/walk/wave/clickhappy/clickshy/clicktsun 已交付，不再列为缺失；尚缺专用 turn、dragdangle、love、thinking/working/tidying/pacing、celebrate/sigh、sit/water/fish/wiggle/yawn/startled。配置中暂借新角色视频的项标为 provisional，待确认后由艾莉丝生产。

验证：`py -m unittest discover -s tests -p test_green_pipeline.py` 2 项通过；九段完整编码与逐帧解码检查通过。不包含生产部署结论。
