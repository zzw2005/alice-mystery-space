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
    static class Program
    {
        [DllImport("user32.dll")]
        static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [STAThread]
        static void Main()
        {
            bool fresh;
            Mutex mtx = new Mutex(true, "AlicePetMutex", out fresh);
            if (!fresh) return;
            try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
            // global safety net: log instead of dying silently or hanging on a .NET error box
            Application.ThreadException += (s, e) => PetForm.LogPetError("ui: " + e.Exception.Message);
            AppDomain.CurrentDomain.UnhandledException += (s, e) => PetForm.LogPetError("fatal: " + e.ExceptionObject);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new PetForm());
            GC.KeepAlive(mtx);
        }
    }

    // borderless chat window with a real drop shadow for elevation
    public class ChatWindow : Form
    {
        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ClassStyle |= 0x00020000; // CS_DROPSHADOW
                return cp;
            }
        }
    }

    public partial class PetForm : Form
    {
        [DllImport("psapi.dll")]
        static extern bool EmptyWorkingSet(IntPtr hProcess);
        [DllImport("kernel32.dll")]
        static extern IntPtr GetCurrentProcess();
        [DllImport("user32.dll")]
        static extern IntPtr GetDC(IntPtr hWnd);
        [DllImport("user32.dll")]
        static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
        [DllImport("gdi32.dll")]
        static extern IntPtr CreateCompatibleDC(IntPtr hDC);
        [DllImport("gdi32.dll")]
        static extern bool DeleteDC(IntPtr hDC);
        [DllImport("gdi32.dll")]
        static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);
        [DllImport("gdi32.dll")]
        static extern bool DeleteObject(IntPtr hObject);
        [DllImport("user32.dll")]
        static extern bool UpdateLayeredWindow(IntPtr hWnd, IntPtr hdcDst, ref Point pptDst, ref Size psize, IntPtr hdcSrc, ref Point pptSrc, int crKey, ref BLENDFUNCTION pblend, int dwFlags);

        [StructLayout(LayoutKind.Sequential)]
        struct BLENDFUNCTION
        {
            public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat;
        }

        const string BaseDir = @"C:\ProgramData\AliceButler";
        string statusPath = Path.Combine(BaseDir, "status.json");
        string presencePath = Path.Combine(BaseDir, "presence.json");
        string inboxDir = Path.Combine(BaseDir, "inbox");
        string outboxDir = Path.Combine(BaseDir, "outbox");

        Form bubble; Label bubbleLbl; System.Windows.Forms.Timer bubbleTimer;
        Form chat; Panel msgFlow; TableLayoutPanel msgTable; TextBox inputBox;
        Panel headerPanel; Panel scrollThumb; Button sendBtn;
        string subText = "电脑分身 · 在岗";
        Color chatDotColor = Color.FromArgb(60, 190, 90);
        bool inputFocused = false;
        System.Windows.Forms.Timer animTimer;
        int chatAnimDir = 0; DateTime chatAnimT0 = DateTime.MinValue; int chatTargetTop = 0; int chatAnimFromTop = 0; double chatAnimFromOp = 0;
        double scrollCur = -1, scrollTarget = 0;
        DateTime thumbShowUntil = DateTime.MinValue; bool thumbDrag = false, thumbHot = false;
        class BubbleAnim { public Panel Bubble; public int FinalY; public DateTime T0; }
        readonly System.Collections.Generic.List<BubbleAnim> bubbleAnims = new System.Collections.Generic.List<BubbleAnim>();
        Panel emptyState; Panel typingBubble; readonly Panel[] typingDots = new Panel[3];
        float uiScale = 0; // chat layout scale: fonts follow the display DPI on their own, layout must scale to match
        float UiS()
        {
            if (uiScale <= 0)
            {
                try { using (var g = Graphics.FromHwnd(IntPtr.Zero)) uiScale = g.DpiX / 96f; }
                catch { uiScale = 1; }
                if (uiScale < 1) uiScale = 1;
                if (uiScale > 3) uiScale = 3;
            }
            return uiScale;
        }
        int Z(int v) { return (int)Math.Round(v * UiS()); }
        bool typingActive = false; DateTime typingSince = DateTime.MinValue;
        int pendingReplies = 0; // sent messages still awaiting a reply (drives the typing dots)
        bool hasUnread = false; // a reply arrived while the chat window was closed
        DateTime pendingSighAt = DateTime.MinValue; // error feedback: grumpy face first, sigh after it clears
        readonly Dictionary<string, int> replyFailCounts = new Dictionary<string, int>();
        int hbTickCount = 0;
        Rectangle sendBtnHome;
        NotifyIcon tray;
        System.Windows.Forms.Timer motion, statusTimer, trimTimer;

        Dictionary<string, Bitmap> frames = new Dictionary<string, Bitmap>();
        Rectangle wa;
        int groundY;
        int baseW = 174, baseH = 200;
        Random rnd = new Random();

        string mode = "idle"; // idle | walk | air | drag
        int dir = 1;
        double vx = 0, vy = 0;
        int walkTarget = 0;
        DateTime idleUntil = DateTime.Now.AddSeconds(5);
        double bobPhase = 0;
        bool dragging = false, dragMoved = false;
        Point grabOffset;
        Point lastCursor;
        DateTime lastMoveAt = DateTime.MinValue;
        double dragVx = 0, dragVy = 0;
        DateTime downAt = DateTime.MinValue;
        DateTime lastInteract = DateTime.Now;
        DateTime nextBlink = DateTime.Now.AddSeconds(3);
        DateTime blinkUntil = DateTime.MinValue;
        DateTime nextLook = DateTime.Now.AddSeconds(8);
        DateTime lookUntil = DateTime.MinValue;
        int lookDir = 1;
        DateTime nextStretch = DateTime.Now.AddSeconds(40);
        int stretchTick = -1;
        double stretchAcc = 0;
        double walkAcc = 0;
        DateTime lastMotion = DateTime.MinValue;
        DateTime nextHop = DateTime.Now.AddSeconds(4);
        DateTime nextZzz = DateTime.Now.AddSeconds(10);
        bool busy = false;
        bool pendingCelebrate = false;
        bool sleeping = false;
        int lastSeq = -1;
        int walkTiltPhase = 0;
        string presenceNote = "";
        bool presenceWorking = false;
        bool dragClipOn = false;
        bool sleepEntry = false;
        string presenceState = "";
        string presenceClipWanted = null;
        string lastPresenceState = "";
        bool presenceInit = false;
        Color dotColor = Color.Gray;
        System.Windows.Forms.Timer clickTimer;
        class HeartP { public float X, Y, Drift; public DateTime Born; }
        List<HeartP> hearts = new List<HeartP>();
        string lastFrameKey = "";
        string lastClickClip = "";
        string lastIdleClip = "";
        int rapidClicks = 0; DateTime lastClickAt = DateTime.MinValue; DateTime grumpyUntil = DateTime.MinValue;
        double squashAmp = 0; DateTime squashUntil = DateTime.MinValue;
        internal static int DiskLoads = 0; // clip frames read from disk (pet-stats)
        // ---- v3: flat-style animation clips (lazy-loaded, one loop + one one-shot resident) ----
        class ClipStream
        {
            public string[] Files;
            public Dictionary<int, Bitmap> Cache = new Dictionary<int, Bitmap>();
            public Dictionary<int, Bitmap> CacheF = new Dictionary<int, Bitmap>();
            public readonly object Gate = new object();
            public volatile bool Dead = false;
            public int Count { get { return Files.Length; } }

            Bitmap LoadFrame(int idx, bool flip)
            {
                Bitmap b;
                using (var srcImg = Image.FromFile(Files[idx])) b = new Bitmap(srcImg, new Size(400, 462));
                DiskLoads++;
                if (flip) b.RotateFlip(RotateFlipType.RotateNoneFlipX);
                return b;
            }

            public Bitmap Get(int idx, bool flip)
            {
                var map = flip ? CacheF : Cache;
                lock (Gate) { Bitmap hit; if (map.TryGetValue(idx, out hit)) return hit; }
                Bitmap b = LoadFrame(idx, flip); // synchronous fallback: needed this frame
                lock (Gate)
                {
                    Bitmap raced;
                    if (map.TryGetValue(idx, out raced)) { b.Dispose(); return raced; }
                    map[idx] = b;
                    Evict(Cache, idx); Evict(CacheF, idx);
                    return b;
                }
            }

            // background decode fills the cache ahead of the playhead so Get
            // hits; eviction stays on the UI path (Get) so a bitmap being
            // drawn is never disposed from the worker thread
            public void Prime(int idx, bool flip)
            {
                if (Dead) return;
                var map = flip ? CacheF : Cache;
                lock (Gate) { if (map.ContainsKey(idx)) return; }
                Bitmap b = LoadFrame(idx, flip);
                lock (Gate)
                {
                    if (Dead || map.ContainsKey(idx)) { b.Dispose(); return; }
                    map[idx] = b;
                }
            }

            void Evict(Dictionary<int, Bitmap> m, int center)
            {
                // asymmetric window: frames just played are useless, frames
                // ahead are precious — keep behind 2 / ahead 14 (wrap-aware)
                var dead = new List<int>();
                foreach (var k in m.Keys)
                {
                    int fd = Count > 0 ? ((k - center) % Count + Count) % Count : Math.Abs(k - center);
                    int bd = Count > 0 ? ((center - k) % Count + Count) % Count : Math.Abs(k - center);
                    if (fd > 14 && bd > 2) dead.Add(k);
                }
                foreach (var k in dead) { m[k].Dispose(); m.Remove(k); }
            }

            public void DisposeAll()
            {
                Dead = true;
                lock (Gate)
                {
                    foreach (var b in Cache.Values) b.Dispose();
                    foreach (var b in CacheF.Values) b.Dispose();
                    Cache.Clear(); CacheF.Clear();
                }
            }
        }

        // ---- background decode worker: PNG decoding never blocks the UI ----
        static readonly Queue<object[]> decodeQueue = new Queue<object[]>();
        static Thread decodeThread = null;
        static void EnqueueDecode(ClipStream cs, int idx, bool flip)
        {
            lock (decodeQueue)
            {
                if (decodeQueue.Count > 240) return;
                decodeQueue.Enqueue(new object[] { cs, idx, flip });
                System.Threading.Monitor.Pulse(decodeQueue);
            }
        }
        static void DecodeLoop()
        {
            while (true)
            {
                object[] job;
                lock (decodeQueue)
                {
                    while (decodeQueue.Count == 0) System.Threading.Monitor.Wait(decodeQueue);
                    job = decodeQueue.Dequeue();
                }
                try { ((ClipStream)job[0]).Prime((int)job[1], (bool)job[2]); } catch { }
            }
        }
        static void EnsureDecodeThread()
        {
            if (decodeThread != null) return;
            decodeThread = new Thread(DecodeLoop);
            decodeThread.IsBackground = true;
            decodeThread.Name = "ClipDecode";
            decodeThread.Start();
        }
        Dictionary<string, ClipStream> clips = new Dictionary<string, ClipStream>();
        Dictionary<string, int> clipFps = new Dictionary<string, int>();
        string activeClip = null;
        string onceClip = null;
        int clipIdx = 0; DateTime clipNextAt = DateTime.MinValue;
        DateTime nextOnce = DateTime.Now.AddSeconds(50);

        static readonly string[] Lines = { "在的。", "交给我吧。", "嗯，我在。", "有事喊我。" };

        protected override CreateParams CreateParams
        {
            get { CreateParams cp = base.CreateParams; cp.ExStyle |= 0x80000; return cp; }
        }

        public PetForm()
        {
            wa = Screen.PrimaryScreen.WorkingArea;
            LoadFrames();
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            float dpiScale = 1f;
            try { using (Graphics g = CreateGraphics()) dpiScale = g.DpiX / 96f; } catch { }
            var img0 = frames["base"];
            baseH = (int)(200 * dpiScale);
            baseW = (int)(baseH * (double)img0.Width / img0.Height);
            Width = baseW; Height = baseH;
            groundY = wa.Bottom - Height - 2;
            Location = new Point(wa.Right - Width - 30, groundY);

            BuildBubble();
            BuildChat();
            BuildTray();

            MouseDown += PetMouseDown;
            MouseMove += PetMouseMove;
            MouseUp += PetMouseUp;
            clickTimer = new System.Windows.Forms.Timer(); clickTimer.Interval = 260;
            clickTimer.Tick += (s, e) => { clickTimer.Stop(); SpawnHearts(); PlayClickReaction(); ToggleChat(); };
            DoubleClick += (s, e) => { clickTimer.Stop(); WakeUp(); PlayOnce("wave"); ShowBubble(Lines[rnd.Next(Lines.Length)]); };
            Shown += (s, e) =>
            {
                SetClip("breathe");
                Render(true);
                ShowBubble("我来了，管家在岗。");
                try { File.WriteAllText(Path.Combine(BaseDir, "pet-start.log"), "layered ok " + DateTime.UtcNow.ToString("o") + " size " + Width + "x" + Height); } catch { }
                try { string df = Path.Combine(BaseDir, "pet-disabled.flag"); if (File.Exists(df)) File.Delete(df); } catch { }
                if (ReplayHistory() == 0)
                    AppendChat("艾莉丝", "在这里留言就行，我看到就回。", Color.FromArgb(0, 105, 110));
            };

            // follow display changes (monitor switch, resolution/scale change, taskbar move)
            Microsoft.Win32.SystemEvents.DisplaySettingsChanged += (s, e) =>
            {
                try
                {
                    wa = Screen.FromControl(this).WorkingArea;
                    groundY = wa.Bottom - Height - 2;
                    Left = Math.Max(wa.Left, Math.Min(wa.Right - Width, Left));
                    if (mode == "idle" || mode == "walk") Top = groundY;
                    else Top = Math.Min(Top, groundY);
                }
                catch { }
            };

            EnsureDecodeThread();
            motion = new System.Windows.Forms.Timer(); motion.Interval = 16;
            motion.Tick += (s, e) => { var t0 = System.Diagnostics.Stopwatch.StartNew(); MotionTick(s, e); t0.Stop(); statTickCount++; statTickMs += t0.Elapsed.TotalMilliseconds; if (t0.Elapsed.TotalMilliseconds > statTickMax) statTickMax = t0.Elapsed.TotalMilliseconds; };
            motion.Start();
            statusTimer = new System.Windows.Forms.Timer(); statusTimer.Interval = 2000; statusTimer.Tick += StatusTick; statusTimer.Start();
            trimTimer = new System.Windows.Forms.Timer(); trimTimer.Interval = 60000; trimTimer.Tick += (s, e) => TrimMemory(); trimTimer.Start();
            var once = new System.Windows.Forms.Timer(); once.Interval = 5000;
            once.Tick += (s, e) => { TrimMemory(); once.Stop(); };
            once.Start();
        }

        void TrimMemory()
        {
            // no WaitForPendingFinalizers (it stalls the UI thread every minute);
            // working-set trimming only while asleep or hidden, when nobody can
            // feel the page-in cost — the low WS number is not worth a live hitch
            try { GC.Collect(); if (sleeping || !Visible) EmptyWorkingSet(GetCurrentProcess()); } catch { }
            WritePetStats();
        }

        int statRenderCount = 0; double statRenderMs = 0; double statRenderMax = 0; int statDiskBase = 0;
        int statTickCount = 0; double statTickMs = 0; double statTickMax = 0;
        void WritePetStats()
        {
            // one line of truth per minute for animation/memory work: without
            // counters, every performance claim is a guess (audit stage 3 gate)
            try
            {
                int frames = 0;
                foreach (var cs in clips.Values) frames += cs.Cache.Count + cs.CacheF.Count;
                int loads = DiskLoads - statDiskBase; statDiskBase = DiskLoads;
                double avg = statRenderCount > 0 ? statRenderMs / statRenderCount : 0;
                double tavg = statTickCount > 0 ? statTickMs / statTickCount : 0;
                string json = "{\"ts\":\"" + DateTime.UtcNow.ToString("o") + "\",\"renders\":" + statRenderCount
                    + ",\"renderAvgMs\":" + avg.ToString("F2", System.Globalization.CultureInfo.InvariantCulture)
                    + ",\"renderMaxMs\":" + statRenderMax.ToString("F1", System.Globalization.CultureInfo.InvariantCulture)
                    + ",\"tickAvgMs\":" + tavg.ToString("F2", System.Globalization.CultureInfo.InvariantCulture)
                    + ",\"tickMaxMs\":" + statTickMax.ToString("F1", System.Globalization.CultureInfo.InvariantCulture)
                    + ",\"diskLoads\":" + loads + ",\"cachedFrames\":" + frames
                    + ",\"mode\":\"" + mode + "\",\"sleeping\":" + (sleeping ? "true" : "false") + "}";
                statRenderCount = 0; statRenderMs = 0; statRenderMax = 0;
                statTickCount = 0; statTickMs = 0; statTickMax = 0;
                File.WriteAllText(Path.Combine(BaseDir, "pet-stats.json"), json);
            }
            catch { }
        }

        // capped error log (UTC, matching the runner's clock) so a persistent fault can't fill the disk
        internal static void LogPetError(string msg)
        {
            try
            {
                string p = Path.Combine(BaseDir, "pet-error.log");
                if (File.Exists(p) && new FileInfo(p).Length > 1024 * 1024) File.Delete(p);
                File.AppendAllText(p, DateTime.UtcNow.ToString("o") + " " + msg + "\n");
            }
            catch { }
        }

        // replay the tail of the real conversation from the bridge's seen folders,
        // so a pet restart (every deploy does one) no longer wipes the chat history

        void LoadFrames()
        {
            string a = Path.Combine(BaseDir, "assets");
            frames["base"] = (Bitmap)Image.FromFile(Path.Combine(a, "pet-flat.png"));
            frames["baseF"] = (Bitmap)Image.FromFile(Path.Combine(a, "pet-flat-flip.png"));
            frames["blink"] = (Bitmap)Image.FromFile(Path.Combine(a, "pet-flat-blink.png"));
            frames["blinkF"] = (Bitmap)Image.FromFile(Path.Combine(a, "pet-flat-blink-flip.png"));
            frames["tiltR"] = frames["base"]; frames["tiltL"] = frames["base"];
            frames["tiltRF"] = frames["baseF"]; frames["tiltLF"] = frames["baseF"];
            try { frames["grumpy"] = (Bitmap)Image.FromFile(Path.Combine(a, "pet-flat-grumpy.png")); } catch { }
        }







    }
}
