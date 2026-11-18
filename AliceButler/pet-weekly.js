"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2] || process.env.ALICE_PET_ROOT || __dirname;
const stats = JSON.parse(fs.readFileSync(path.join(root, "pet-stats.json"), "utf8"));
const today = new Date(), start = new Date(today.getTime() - 6 * 86400000).toISOString().slice(0, 10);
const end = today.toISOString().slice(0, 10);
const days = Object.entries(stats.days || {}).filter(([key]) => start <= key && key <= end).map(([, day]) => day);
const plays = {}, rtt = [], sources = Object.create(null);
let crashes = 0, recoveries = 0, workingSet = 0, privatePeak = null;
for (const day of days) {
  workingSet = Math.max(workingSet, day.workingSetPeakMiB);
  if (day.privatePeakMiB !== null) privatePeak = Math.max(privatePeak || 0, day.privatePeakMiB);
  crashes += day.crashes; recoveries += day.recoveries;
  for (const ms of day.chatRoundTripMs) rtt.push(ms);
  for (const [clip, count] of Object.entries(day.plays)) plays[clip] = (plays[clip] || 0) + count;
  for (const { source } of day.triggers ?? []) sources[source] = (sources[source] ?? 0) + 1;
}
rtt.sort((a, b) => a - b);
console.log(`桌宠运行周报　${start} 至 ${end}（UTC，覆盖 ${days.length}/7 天）`);
if (days.length) {
  console.log(`内存峰值　私有 ${privatePeak?.toFixed(2) ?? "无读数"} MiB　工作集 ${workingSet.toFixed(2)} MiB`);
  console.log("动作播放　" + Object.entries(plays).map(([name, n]) => name + " × " + n).join("，"));
  const distribution = Object.entries(sources).sort(([a, n], [b, m]) => m - n || a.localeCompare(b));
  console.log("触发来源　" + (distribution.map(([name, n]) => name + " × " + n).join("，") || "无记录"));
  console.log(`异常结束 ${crashes} 次　看门狗自愈 ${recoveries} 次`);
  console.log(`聊天往返　${rtt.length} 个样本` + (rtt.length ? `　P50 ${rtt[Math.ceil(rtt.length / 2) - 1]} ms　最大 ${rtt[rtt.length - 1]} ms` : ""));
}
