using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;

namespace AlicePet
{
    public partial class PetForm
    {
        string lastRunnerSince = "";

        void BuildTray()
        {
            tray = new NotifyIcon();
            try { tray.Icon = new Icon(Path.Combine(BaseDir, "assets", "avatar.ico")); } catch { tray.Icon = SystemIcons.Application; }
            tray.Text = "艾莉丝 · 在岗";
            tray.Visible = true;
            var menu = new ContextMenuStrip();
            menu.Items.Add("和艾莉丝说话", null, (s, e) => { if (!chat.Visible) ToggleChat(); });
            menu.Items.Add("隐藏桌宠", null, (s, e) => Hide());
            menu.Items.Add("打开商店预览", null, (s, e) => { try { System.Diagnostics.Process.Start("http://127.0.0.1:8080/apparel/"); } catch { } });
            menu.Items.Add("退出桌宠", null, (s, e) => { try { File.WriteAllText(Path.Combine(BaseDir, "pet-disabled.flag"), DateTime.UtcNow.ToString("o")); } catch { } tray.Visible = false; Application.Exit(); });
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += (s, e) => { if (!chat.Visible) ToggleChat(); };

            var petMenu = new ContextMenuStrip();
            petMenu.Items.Add("和艾莉丝说话", null, (s, e) => { if (!chat.Visible) ToggleChat(); });
            petMenu.Items.Add("睡一会儿", null, (s, e) => { GoToSleep(); Render(true); });
            petMenu.Items.Add("回到原位", null, (s, e) => { mode = "idle"; Top = groundY; Left = wa.Right - Width - 30; Render(true); });
            petMenu.Items.Add("隐藏桌宠", null, (s, e) => Hide());
            ContextMenuStrip = petMenu;
        }

        string PresenceStateText()
        {
            switch (presenceState)
            {
                case "thinking": return "思考中";
                case "result": return "整理中";
                case "waiting": return "等待中";
                case "success": return "已完成";
                case "error": return "出问题了";
                case "working": return "忙碌中";
                default: return (busy || presenceWorking) ? "忙碌中" : "在岗";
            }
        }

        void StatusTick(object sender, EventArgs e)
        {
            motionChecked = false; // re-read the Windows animation preference every couple of seconds
            // pet heartbeat for the watchdog (tray-exit writes pet-disabled.flag so she stays gone)
            if (++hbTickCount >= 15)
            {
                hbTickCount = 0;
                try { File.WriteAllText(Path.Combine(BaseDir, "pet-heartbeat.txt"), DateTime.UtcNow.ToString("o")); } catch { }
            }
            if (pendingSighAt != DateTime.MinValue && DateTime.Now >= pendingSighAt)
            {
                pendingSighAt = DateTime.MinValue;
                if (!sleeping) PlayOnce("sigh");
            }
            // presence: the one Alice's live state, mirrored to this body
            try
            {
                bool fresh = false;
                Dictionary<string, object> p = null;
                DateTime ts;
                if (File.Exists(presencePath))
                {
                    p = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(presencePath, System.Text.Encoding.UTF8));
                    fresh = p.ContainsKey("ts") && DateTime.TryParse(Convert.ToString(p["ts"]), out ts) && (DateTime.UtcNow - ts.ToUniversalTime()).TotalMinutes < 12;
                }
                if (fresh)
                {
                    string pstate = p.ContainsKey("state") ? Convert.ToString(p["state"]) : "";
                    presenceState = pstate;
                    presenceWorking = pstate == "working";
                    presenceNote = p.ContainsKey("note") ? Convert.ToString(p["note"]) : "";
                    presenceClipWanted = pstate == "thinking" ? "thinking" : (pstate == "result" ? "tidying" : (pstate == "waiting" ? "pacing" : null));
                    if (!presenceInit) { presenceInit = true; lastPresenceState = pstate; }
                    else if (pstate != lastPresenceState)
                    {
                        if (!sleeping && pstate == "success") PlayOnce("celebrate");
                        else if (!sleeping && pstate == "error") { grumpyUntil = DateTime.Now.AddSeconds(1.6); pendingSighAt = DateTime.Now.AddSeconds(1.7); }
                        lastPresenceState = pstate;
                    }
                }
                else
                {
                    // expired or deleted: clear everything, including the edge-trigger memory,
                    // or the next success/error after a long idle would be swallowed
                    presenceWorking = false; presenceNote = ""; presenceState = ""; presenceClipWanted = null; lastPresenceState = "";
                }
            }
            catch { }
            try
            {
                if (File.Exists(statusPath))
                {
                    var st = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(statusPath, System.Text.Encoding.UTF8));
                    // event seq restarts with each runner boot: a new runnerSince
                    // resets the cursor, or old completions replay / new ones vanish
                    string runId = st.ContainsKey("runnerSince") ? Convert.ToString(st["runnerSince"]) : "";
                    if (runId != lastRunnerSince) { lastRunnerSince = runId; lastSeq = 0; }
                    DateTime hb;
                    bool alive = st.ContainsKey("heartbeat") && DateTime.TryParse(Convert.ToString(st["heartbeat"]), out hb) && (DateTime.UtcNow - hb.ToUniversalTime()).TotalSeconds < 25;
                    var jobs = st.ContainsKey("jobs") ? st["jobs"] as System.Collections.ArrayList : null;
                    busy = jobs != null && jobs.Count > 0;
                    if (st.ContainsKey("events"))
                    {
                        var evs = st["events"] as System.Collections.ArrayList;
                        if (evs != null)
                        {
                            foreach (var item in evs)
                            {
                                var ev = item as Dictionary<string, object>;
                                if (ev == null || !ev.ContainsKey("seq")) continue;
                                int seq = Convert.ToInt32(ev["seq"]);
                                string msg = ev.ContainsKey("msg") ? Convert.ToString(ev["msg"]) : "";
                                if (seq > lastSeq && msg.StartsWith("任务完成"))
                                {
                                    if ((mode == "idle" || mode == "walk") && !sleeping) { PlayOnce("celebrate"); ShowBubble("搞定了。"); }
                                    else pendingCelebrate = true;
                                }
                                if (seq > lastSeq) lastSeq = seq;
                            }
                        }
                    }
                    Color want;
                    if (hasUnread && chat != null && !chat.Visible) want = Color.FromArgb(239, 91, 91); // unread reply waiting
                    else if (!alive) want = Color.Gray;
                    else if (presenceState == "success") want = Color.FromArgb(60, 190, 90);
                    else if (presenceState == "thinking" || presenceState == "result" || presenceState == "waiting" || presenceState == "working" || presenceState == "error" || busy || presenceWorking) want = Color.FromArgb(240, 150, 30);
                    else want = Color.FromArgb(60, 190, 90);
                    if (want != dotColor) { dotColor = want; Render(true); }
                    if (chatDotColor != want) { chatDotColor = want; if (headerPanel != null) headerPanel.Invalidate(); }
                    string state = !alive ? "管家离线" : PresenceStateText();
                    string note = presenceNote.Length > 0 ? presenceNote : state;
                    tray.Text = "艾莉丝 · " + note + (hasUnread && chat != null && !chat.Visible ? "（有新消息）" : "");
                    string wantSub = "电脑分身 · " + note;
                    if (subText != wantSub) { subText = wantSub; if (headerPanel != null) headerPanel.Invalidate(); }
                }
            }
            catch { }
            EnsureBridgeTimer();
        }
    }
}
