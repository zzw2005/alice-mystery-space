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
        void EnsureClip(string name)
        {
            if (clips.ContainsKey(name)) return;
            try
            {
                string d = Path.Combine(BaseDir, "assets", "sprites", name);
                if (!Directory.Exists(d)) d = Path.Combine(BaseDir, "assets", "anim60", name);
                if (!Directory.Exists(d)) d = Path.Combine(BaseDir, "assets", "anim-flat", name);
                if (!Directory.Exists(d)) return;
                int fps = 10;
                string metaPath = Path.Combine(d, "meta.json");
                if (File.Exists(metaPath))
                {
                    var meta = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(metaPath));
                    if (meta.ContainsKey("fps")) fps = Convert.ToInt32(meta["fps"]);
                }
                var files = new List<string>(Directory.GetFiles(d, "f*.png"));
                files.Sort();
                if (files.Count > 0)
                {
                    var cs = new ClipStream(); cs.Files = files.ToArray();
                    clips[name] = cs; clipFps[name] = fps;
                }
            }
            catch { }
        }

        void DisposeClip(string name)
        {
            if (name == null) return;
            if (clips.ContainsKey(name)) { clips[name].DisposeAll(); clips.Remove(name); }
        }

        void SetClip(string name)
        {
            if (activeClip == name) return;
            if (activeClip != null && activeClip != onceClip) DisposeClip(activeClip);
            activeClip = name;
            if (name != null) EnsureClip(name);
            clipIdx = 0; clipNextAt = DateTime.MinValue;
        }

        void PlayOnce(string name)
        {
            if (onceClip == name) return;
            EnsureClip(name);
            if (!clips.ContainsKey(name)) return;
            // release the interrupted one-shot's stream, or its frame cache stays resident forever
            if (onceClip != null && onceClip != activeClip) DisposeClip(onceClip);
            onceClip = name; clipIdx = 0; clipNextAt = DateTime.MinValue;
        }

        string[] clickPool = { "love", "clickhappy", "clickshy", "clicktsun" };
        void PlayClickReaction()
        {
            string pick = clickPool[rnd.Next(clickPool.Length)];
            if (pick == lastClickClip) pick = clickPool[rnd.Next(clickPool.Length)];
            lastClickClip = pick;
            PlayOnce(pick);
        }

        string PickIdleName()
        {
            int pick = rnd.Next(114);
            if (pick < 28) return "sit";
            if (pick < 46) return "wave";
            if (pick < 58) return "celebrate";
            if (pick < 72) return "water";
            if (pick < 86) return "fish";
            if (pick < 96) return "wiggle";
            if (pick < 104) return "yawn";
            if (pick < 110) return "startled";
            return null;
        }

        Bitmap ClipBitmap()
        {
            string name = onceClip != null ? onceClip : activeClip;
            if (name == null || !clips.ContainsKey(name)) return null;
            var cs = clips[name];
            if (clipIdx >= cs.Count) clipIdx = 0;
            // walk sprite faces LEFT in its source frames (hair trails right):
            // flip only when running right, never when running left
            return cs.Get(clipIdx, dir > 0 && name == "walk");
        }

        bool AdvanceOne(string name)
        {
            clipIdx++;
            if (clipIdx >= clips[name].Count)
            {
                clipIdx = 0;
                if (onceClip != null)
                {
                    string done = onceClip; onceClip = null;
                    if (done != activeClip) DisposeClip(done);
                    OnOnceDone(done);
                    return true;
                }
            }
            return false;
        }

        void OnOnceDone(string done)
        {
            if (done == "sleepstart" && sleepEntry)
            {
                sleepEntry = false;
                if (sleeping) SetClip("doze");
            }
            // a completion that landed while she slept is celebrated right after
            // the wake-up clip, instead of waiting for a landing that may not come
            if (done == "wakeup" && pendingCelebrate)
            {
                pendingCelebrate = false;
                PlayOnce("celebrate");
            }
        }

        bool AdvanceClip(DateTime now)
        {
            string name = onceClip != null ? onceClip : activeClip;
            if (name == null || !clips.ContainsKey(name)) return false;
            double frameMs = 1000.0 / (clipFps.ContainsKey(name) ? clipFps[name] : 10);
            if (clipNextAt == DateTime.MinValue) { clipNextAt = now.AddMilliseconds(frameMs); Render(true); return true; }
            if (now < clipNextAt) return false;
            int steps = 0;
            while (now >= clipNextAt && steps < 4)
            {
                if (AdvanceOne(name)) break;
                clipNextAt = clipNextAt.AddMilliseconds(frameMs);
                steps++;
                name = onceClip != null ? onceClip : activeClip;
                if (name == null || !clips.ContainsKey(name)) break;
            }
            if (name != null && clips.ContainsKey(name) && now >= clipNextAt) clipNextAt = now.AddMilliseconds(frameMs);
            // prefetch runs on the background decode thread now: the UI thread
            // never waits on disk; Get() remains as the synchronous fallback
            if (name != null && clips.ContainsKey(name))
            {
                var cs = clips[name];
                bool fl = dir > 0 && name == "walk";
                for (int k = 1; k <= 12; k++) EnqueueDecode(cs, (clipIdx + k) % cs.Count, fl);
            }
            Render(true);
            return true;
        }
    }
}
