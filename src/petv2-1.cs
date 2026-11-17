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
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new PetForm());
            GC.KeepAlive(mtx);
        }
    }

    public class PetForm : Form
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
        Form chat; RichTextBox rtb; TextBox inputBox; Label subLbl;
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
        DateTime nextHop = DateTime.Now.AddSeconds(4);
        DateTime nextZzz = DateTime.Now.AddSeconds(10);
        bool busy = false;
        bool pendingCelebrate = false;
        bool sleeping = false;
        int lastSeq = -1;
        int walkTiltPhase = 0;
        string presenceNote = "";
        bool presenceWorking = false;
        Color dotColor = Color.Gray;
        string lastFrameKey = "";
        double squashAmp = 0; DateTime squashUntil = DateTime.MinValue;

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
            DoubleClick += (s, e) => { vy = -11; vx = 0; mode = "air"; WakeUp(); ShowBubble(Lines[rnd.Next(Lines.Length)]); };
            Shown += (s, e) =>
            {
                Render(true);
                AppendChat("艾莉丝", "在这里留言就行，我看到就回。", Color.FromArgb(0, 105, 110));
                ShowBubble("我来了，管家在岗。");
                try { File.WriteAllText(Path.Combine(BaseDir, "pet-start.log"), "layered ok " + DateTime.Now.ToString("o") + " size " + Width + "x" + Height); } catch { }
            };

            motion = new System.Windows.Forms.Timer(); motion.Interval = 50; motion.Tick += MotionTick; motion.Start();
            statusTimer = new System.Windows.Forms.Timer(); statusTimer.Interval = 2000; statusTimer.Tick += StatusTick; statusTimer.Start();
            trimTimer = new System.Windows.Forms.Timer(); trimTimer.Interval = 60000; trimTimer.Tick += (s, e) => TrimMemory(); trimTimer.Start();
            var once = new System.Windows.Forms.Timer(); once.Interval = 5000;
            once.Tick += (s, e) => { TrimMemory(); once.Stop(); };
            once.Start();
        }

        void TrimMemory()
        {
            try { GC.Collect(); GC.WaitForPendingFinalizers(); EmptyWorkingSet(GetCurrentProcess()); } catch { }
        }

        void LoadFrames()
        {
            string a = Path.Combine(BaseDir, "assets");
            frames["base"] = (Bitmap)Image.FromFile(Path.Combine(a, "pet.png"));
            frames["baseF"] = (Bitmap)Image.FromFile(Path.Combine(a, "pet-flip.png"));
            frames["blink"] = (Bitmap)Image.FromFile(Path.Combine(a, "pet-blink.png"));
            frames["blinkF"] = (Bitmap)Image.FromFile(Path.Combine(a, "pet-blink-flip.png"));
            frames["tiltR"] = (Bitmap)Image.FromFile(Path.Combine(a, "pet-tiltr.png"));
            frames["tiltL"] = (Bitmap)Image.FromFile(Path.Combine(a, "pet-tiltl.png"));
            frames["tiltRF"] = (Bitmap)Image.FromFile(Path.Combine(a, "pet-tiltr-flip.png"));
            frames["tiltLF"] = (Bitmap)Image.FromFile(Path.Combine(a, "pet-tiltl-flip.png"));
        }

        string FrameKey()
        {
            bool eyes = sleeping || DateTime.Now < blinkUntil;
            bool flip = dir < 0;
            if (mode == "walk")
            {
                bool tilt = (walkTiltPhase / 8) % 2 == 0;
                if (tilt) return flip ? "tiltRF" : "tiltR";
                return flip ? "baseF" : "base";
            }
            if (mode == "drag" || mode == "air")
            {
                if (vx > 2.5 || dragVx > 2.5) return flip ? "tiltRF" : "tiltR";
                if (vx < -2.5 || dragVx < -2.5) return flip ? "tiltLF" : "tiltL";
                return flip ? "baseF" : "base";
            }
            if (DateTime.Now < lookUntil && mode == "idle")
                return lookDir > 0 ? (flip ? "tiltRF" : "tiltR") : (flip ? "tiltLF" : "tiltL");
            if (eyes) return flip ? "blinkF" : "blink";
            return flip ? "baseF" : "base";
        }

        void Render(bool force)
        {
            string key = FrameKey();
            bool squashActive = DateTime.Now < squashUntil || stretchTick >= 0;
            if (!force && key == lastFrameKey && !squashActive && mode != "air") return;
            lastFrameKey = key;
            try
            {
                using (Bitmap bmp = new Bitmap(Width, Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.CompositingMode = CompositingMode.SourceOver;
                    // ground shadow: grounds the pet on the surface below
                    int hAbove = Math.Max(0, groundY - Top);
                    double shScale = mode == "air" ? Math.Max(0.45, 1 - hAbove / 500.0) : 1.0;
                    int shW = (int)(Width * 0.62 * shScale);
                    int shH = (int)(Height * 0.055 * shScale) + 3;
                    int shA = (int)(95 * shScale);
                    using (GraphicsPath path = new GraphicsPath())
                    {
                        path.AddEllipse((Width - shW) / 2, Height - shH - 1, shW, shH);
                        using (PathGradientBrush pgb = new PathGradientBrush(path))
                        {
                            pgb.CenterColor = Color.FromArgb(shA, 0, 0, 0);
                            pgb.SurroundColors = new Color[] { Color.FromArgb(0, 0, 0, 0) };
                            g.FillEllipse(pgb, (Width - shW) / 2, Height - shH - 1, shW, shH);
                        }
                    }
                    // squash & stretch factor
                    double sy = 1.0;
                    if (stretchTick >= 0)
                    {
                        double[] seq = { 0.97, 0.94, 0.94, 0.97, 1.02, 1.03, 1.02, 1.0, 1.0 };
                        sy = seq[Math.Min(stretchTick, seq.Length - 1)];
                    }
                    else if (DateTime.Now < squashUntil)
                    {
                        double u = 1 - (squashUntil - DateTime.Now).TotalMilliseconds / 220.0;
                        sy = SquashScale(Math.Max(0, Math.Min(1, u)), squashAmp);
                    }
                    int drawH = (int)(Height * sy);
                    int drawW = (int)(Width * (1 + (1 - sy) * 0.55));
                    g.InterpolationMode = InterpolationMode.NearestNeighbor;
                    g.PixelOffsetMode = PixelOffsetMode.Half;
                    g.DrawImage(frames[key], new Rectangle((Width - drawW) / 2, Height - drawH, drawW, drawH));
                    // status dot, baked into the corner by her feet
                    int r = Math.Max(5, Width / 34);
                    int cx = Width - r - 5, cy = Height - r - 5;
                    using (SolidBrush b = new SolidBrush(dotColor)) g.FillEllipse(b, cx - r, cy - r, r * 2, r * 2);
                    using (Pen p = new Pen(Color.FromArgb(220, 255, 255, 255), 2)) g.DrawEllipse(p, cx - r, cy - r, r * 2, r * 2);
                    SetLayeredBitmap(bmp);
                }
            }
            catch (Exception ex) { try { File.AppendAllText(Path.Combine(BaseDir, "pet-error.log"), DateTime.Now.ToString("o") + " render: " + ex.Message + "\n"); } catch { } }
        }

        void SetLayeredBitmap(Bitmap bmp)
        {
            IntPtr screenDc = GetDC(IntPtr.Zero);
            IntPtr memDc = CreateCompatibleDC(screenDc);
            IntPtr hBmp = bmp.GetHbitmap(Color.FromArgb(0));
            IntPtr old = SelectObject(memDc, hBmp);
            try
            {
                Size size = new Size(bmp.Width, bmp.Height);
                Point src = new Point(0, 0);
                Point dst = new Point(Left, Top);
                BLENDFUNCTION blend = new BLENDFUNCTION { BlendOp = 0, BlendFlags = 0, SourceConstantAlpha = 255, AlphaFormat = 1 };
                UpdateLayeredWindow(Handle, screenDc, ref dst, ref size, memDc, ref src, 0, ref blend, 2);
            }
            finally
            {
                SelectObject(memDc, old);
                DeleteObject(hBmp);
                DeleteDC(memDc);
                ReleaseDC(IntPtr.Zero, screenDc);
            }
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == 0x0084) // WM_NCHITTEST: only the visible character is grabbable
            {
                int lx = (short)((long)m.LParam & 0xFFFF);
                int ly = (short)(((long)m.LParam >> 16) & 0xFFFF);
                Point pt = PointToClient(new Point(lx, ly));
                m.Result = HitAlpha(pt) ? (IntPtr)1 : (IntPtr)(-1);
                return;
            }
            base.WndProc(ref m);
        }

        bool HitAlpha(Point pt)
        {
            try
            {
                if (pt.X < 0 || pt.Y < 0 || pt.X >= Width || pt.Y >= Height) return false;
                // status dot corner always counts
                int r = Math.Max(5, Width / 34);
                if (pt.X > Width - 2 * r - 10 && pt.Y > Height - 2 * r - 10) return true;
                Bitmap f = frames[lastFrameKey.Length > 0 ? lastFrameKey : "base"];
                int fx = pt.X * f.Width / Width;
                int fy = pt.Y * f.Height / Height;
                return f.GetPixel(fx, fy).A > 12;
            }
            catch { return true; }
        }
