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
        int ReplayHistory()
        {
            try
            {
                string iSeen = Path.Combine(inboxDir, "seen");
                string oSeen = Path.Combine(outboxDir, "seen");
                if (!Directory.Exists(iSeen)) return 0;
                // only the newest 30 exchanges are replayed, so only those files
                // are read — file names sort chronologically, no full-archive parse
                var msgFiles = Directory.GetFiles(iSeen, "msg-*.json");
                Array.Sort(msgFiles, StringComparer.Ordinal);
                int from = Math.Max(0, msgFiles.Length - 30);
                var msgs = new List<string[]>();
                for (int i = from; i < msgFiles.Length; i++)
                {
                    try
                    {
                        var o = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(msgFiles[i], System.Text.Encoding.UTF8));
                        string t = o.ContainsKey("text") ? Convert.ToString(o["text"]) : "";
                        string id = o.ContainsKey("id") ? Convert.ToString(o["id"]) : Path.GetFileNameWithoutExtension(msgFiles[i]);
                        if (t.Length > 0) msgs.Add(new string[] { id, t });
                    }
                    catch { }
                }
                foreach (var m in msgs)
                {
                    AddBubble(m[1], true);
                    string rp = Path.Combine(oSeen, "reply-" + m[0] + ".json");
                    if (File.Exists(rp))
                    {
                        try
                        {
                            var o = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(rp, System.Text.Encoding.UTF8));
                            string t = o.ContainsKey("text") ? Convert.ToString(o["text"]) : "";
                            if (t.Length > 0) AddBubble(t, false);
                        }
                        catch { }
                    }
                }
                return msgs.Count;
            }
            catch { return 0; }
        }
        void SendChat()
        {
            string text = inputBox.Text.Trim();
            if (text.Length == 0) return;
            inputBox.Text = "";
            AppendChat("主人", text, Color.FromArgb(90, 90, 90));
            lastInteract = DateTime.Now;
            try
            {
                Directory.CreateDirectory(inboxDir);
                string id = "msg-" + DateTime.Now.ToString("yyyyMMddHHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 6);
                var obj = new Dictionary<string, object> { { "id", id }, { "ts", DateTime.UtcNow.ToString("o") }, { "text", text } };
                string json = new JavaScriptSerializer().Serialize(obj);
                File.WriteAllText(Path.Combine(inboxDir, id + ".json"), json, new System.Text.UTF8Encoding(false));
                ShowTyping();
            }
            catch { AppendSystemLine("这条没发出去，通道好像断了。"); }
        }
        System.Windows.Forms.Timer bridgeTimer;

        void EnsureBridgeTimer()
        {
            if (bridgeTimer != null) return;
            bridgeTimer = new System.Windows.Forms.Timer();
            bridgeTimer.Interval = 1000;
            bridgeTimer.Tick += delegate { PollOutbox(); };
            bridgeTimer.Start();
        }

        void PollOutbox()
        {
            try
            {
                if (!Directory.Exists(outboxDir)) return;
                string seenDir = Path.Combine(outboxDir, "seen");
                Directory.CreateDirectory(seenDir);
                var replyFiles = Directory.GetFiles(outboxDir, "reply-*.json");
                Array.Sort(replyFiles, StringComparer.Ordinal); // filename order is chronological: consume in send order
                foreach (string f in replyFiles)
                {
                    // per-file isolation: one bad or duplicate file must never block
                    // or duplicate the replies queued behind it
                    try
                    {
                        Dictionary<string, object> o;
                        try { o = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(f, System.Text.Encoding.UTF8)); }
                        catch
                        {
                            // possibly caught mid-write; quarantine only a file that has
                            // been failing for a while AND is old — a long reply still
                            // being written must never be thrown away as "bad"
                            int n;
                            replyFailCounts.TryGetValue(f, out n);
                            replyFailCounts[f] = n + 1;
                            double fileAgeSec = (DateTime.UtcNow - File.GetLastWriteTimeUtc(f)).TotalSeconds;
                            if (n + 1 >= 5 && fileAgeSec > 90) { try { File.Move(f, f + ".bad"); } catch { } replyFailCounts.Remove(f); }
                            continue;
                        }
                        replyFailCounts.Remove(f);
                        string text = o.ContainsKey("text") ? Convert.ToString(o["text"]) : "";
                        string dest = Path.Combine(seenDir, Path.GetFileName(f));
                        if (File.Exists(dest)) { File.Delete(f); continue; } // duplicate delivery: already shown once
                        File.Move(f, dest); // consume first; only display what was successfully consumed
                        if (text.Length > 0)
                        {
                            ReplyArrived();
                            AppendChat("艾莉丝", text, Color.FromArgb(0, 105, 110));
                            lastInteract = DateTime.Now;
                            WakeUp();
                            if (!chat.Visible) { hasUnread = true; ShowBubble("回你了。"); }
                        }
                    }
                    catch { }
                }
            }
            catch { }
        }
    }
}
