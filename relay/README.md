# 桌宠聊天中继（pet-relay）

2026-11-19 上线，替代 SSH 文件轮询成为桌宠聊天的主通道；原文件桥保留作自动回退。

## 架构

```
桌宠(PC) → AliceButler/inbox → relay-client.js(PC, 管家服务)
   → WSS 长连接 → 中继 relay-server.js（gzmaoxing 服务器, 127.0.0.1:7311, nginx /pet-relay 反代）
   → WSS 长连接 → vm-client.js（艾莉丝 VM, systemd alice-relay-client）
   → ~/hooks/state/relay-spool/ → pet-inbox 钩子（5 秒轮询本地 spool）唤醒回复
回复原路返回：pet-reply.sh → ~/hooks/state/relay-outbox/ → vm-client 推送 → 中继 → relay-client 落 PC outbox（原子 rename）→ 桌宠显示
```

- 内容全程端到端加密（AES-256-GCM，crypto.js）；中继只转发密文，只做令牌鉴权与离线队列（queue.json，上限 200 条、24 小时）。
- 中继鉴权令牌在服务器 /opt/alice-relay/relay.env（600）；端到端密钥只存两端：VM ~/workspace/pet-relay/（config.json，600）、PC 的 AliceButler/relay-key.txt。**密钥与令牌永不入仓**（仓为公开仓）。
- VM 出口走平台代理：vm-client 用 https-proxy-agent 读 HTTPS_PROXY（systemd 经 EnvironmentFile ~/workspace/pet-relay/proxy.env 注入）。

## 回退与自愈

- vm-client 每 20 秒刷 ~/hooks/state/relay-heartbeat，并把 PC 端在中继上的在线状态记入 relay-pc-status；钩子只在「心跳新鲜＋PC 在线」时静默，其余情况（中继挂、或 PC 端还没接上中继）自动 exec 旧脚本 pet-inbox.sh 走 SSH 拉取——任何一环没接上，聊天都不耽误，只是变慢。
- pet-reply.sh 同理：心跳新鲜走 spool，过期直接走旧 SSH 原子投递。两条路同 id、桌宠按 id 去重，双投无害。
- 三端均自动重连（退避 1s→30s）；中继离线队列在任一端重连后按序补投；PC 端收到 ack 才把 inbox 原件移入 seen，未 ack 的消息一直留在 inbox，钩子回退路径也能捞到。

## 部署与恢复

- 服务器：/opt/alice-relay（relay-server.js + node_modules），系统用户 petrelay，服务 alice-pet-relay.service；nginx 改动记 SERVER-FIXES 第 32 条。重部署＝把本目录 relay-server.js 与 node_modules 同步过去后 systemctl restart alice-pet-relay。
- VM：服务 alice-relay-client.service（unit 副本在 ~/workspace/pet-relay/）；VM 被替换后重装：cp unit 到 /etc/systemd/system、daemon-reload、enable --now（proxy.env 与 config.json 在持久主目录里，不会丢）。
- PC：AliceButler/relay-client.js 以管家 service 任务运行（id relay-client）；同目录需 relay-client-config.json 与 relay-key.txt（部署时经 SSH 直接写入，不入仓，见 .gitignore）。

## 实测（2026-11-19）

模拟 PC 全链路：发送→VM 落 spool 并回 ack 1.5 秒（含新建连接）；钩子唤醒 worker 回复→PC 收到，全程 11.9 秒，其中绝大部分是钩子轮询（≤5 秒）与 worker 生成时间，纯传输约 2 秒。旧 SSH 路径同类往返通常 15–30 秒以上。
