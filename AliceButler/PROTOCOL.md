# 文件通道协议

四条通道都遵循同一投递规范：**临时名写入 → 原子 rename 到正式名**；消费方只认正式名；完成以回执文件为准，不以「命令没报错」为准。

## jobs/（任务投递，消费方 runner）

- 投递：jobs/<任意名>.json，内容 {id, name, type:"once"|"service", cmd, args:[], cwd, env:{}, shell:bool}。投递方写后必须回读校验文件存在（2026-11-17 acltest 教训：命令被打断时文件可能根本没落地）。
- runner 消费后删除 jobs/ 里的任务文件，service 定义转存 running/<id>.job.json。
- 停止 service：先放 jobs/stop-<id>.flag；runner 写 running/<id>.stopped 墓碑，mtime 不晚于墓碑的同 id 任务文件会被清掉不复活；更新的投递（mtime 更新）视为新任务正常启动。
- 回执：once 完成看 done/<id>.result.json；service 状态看 status.json 的 jobs 列表与 events。
- 坏文件：解析失败累计 5 次改名 .bad 隔离。

## inbox/（主人 → 艾莉丝，消费方钩子）

- 桌宠写 inbox/msg-<id>.json（{id, ts, text}，UTF-8 无 BOM），id = msg-yyyyMMddHHmmss-xxxxxx。
- 钩子每 5 秒拉取（排除 seen/），只把解析成功且有 text 的文件移入 inbox/seen/；解析失败留在原地重试。
- 已交付 id 记在 VM ~/hooks/state/pet-delivered-ids.txt（最近 500 条），重复投递只搬运不重复唤醒。
- seen/ 保留 30 天，钩子每日顺带清理。

## outbox/（艾莉丝 → 主人，消费方桌宠）

- 回复必须经 ~/workspace/tools/pet-reply.sh 投递：上传 outbox/.tmp-<id>.json 后 rename 为 reply-<msg-id>.json（{id, text, ts}）。禁止直接 scp 正式名——桌宠每 2 秒轮询，半截文件会被误判损坏。
- 桌宠消费：先 move 到 outbox/seen/ 成功才显示；seen 已有同名 = 重复投递，直接删源文件不重复显示；解析失败累计 ≥5 次且文件龄 >90 秒才改名 .bad 隔离。
- 历史回放：桌宠启动时合并 inbox/seen 与 outbox/seen 按 id 回放最近 30 组。

## presence.json（状态，消费方桌宠）

- 写入经 alice-presence.sh：scp 到 presence.json.tmp 后远程 move 覆盖（原子）。
- 格式 {state, note, ts(UTC)}；桌宠按 UTC 差判 12 分钟有效；非 idle 状态由续戳器每 8 分钟重盖；idle 时续戳器退出。
- state 取值：idle / working / thinking / result / waiting / success / error（桌宠映射到动作与状态点颜色）。

## 事件游标

status.json 的 events 带 seq 与 runnerSince；桌宠以 (runnerSince, seq) 复合语义对齐，runner 重启后游标自动重置，不误报旧完成、不吞新完成。

## 中继快路径（2026-11-19 加，细节见 relay/README.md）

- inbox/ 与 outbox/ 的文件协议不变；新增 relay-client.js（管家 service）把 inbox 新消息经服务器中继（WSS＋端到端加密）即时推给艾莉丝，收到 ack 后把原件移入 inbox/seen/（与钩子消费的终态一致）。中继不可达时文件留 inbox/，旧钩子 SSH 拉取自动接管。
- outbox/ 回复多一条来源：relay-client 收到中继回复后按同样的临时名→rename 规范落 reply-<id>.json 并回 ack；桌宠消费逻辑与去重不变。
