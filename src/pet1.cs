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
        [STAThread]
        static void Main()
        {
            bool fresh;
            Mutex mtx = new Mutex(true, "AlicePetMutex", out fresh);
            if (!fresh) return;
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

        const string BaseDir = @"C:\ProgramData\AliceButler";
        string statusPath = Path.Combine(BaseDir, "status.json");
        string inboxDir = Path.Combine(BaseDir, "inbox");
        string outboxDir = Path.Combine(BaseDir, "outbox");

        PictureBox pic;
        Label nameLbl, dotLbl;
        Form bubble; Label bubbleLbl; System.Windows.Forms.Timer bubbleTimer;
        Form chat; RichTextBox rtb; TextBox inputBox;
        NotifyIcon tray;
        System.Windows.Forms.Timer motion, statusTimer, trimTimer;

        Dictionary<string, Image> frames = new Dictionary<string, Image>();
        Rectangle wa;
        int groundY;
        Random rnd = new Random();

        // behaviour state
        string mode = "idle"; // idle | walk | air | drag
        int dir = 1;
        double vy = 0;
        int walkTarget = 0;
        DateTime idleUntil = DateTime.Now.AddSeconds(5);
        double bobPhase = 0;
        bool dragging = false, dragMoved = false;
        Point dragStart;
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
        bool sleeping = false;
        int lastSeq = -1;
        int walkTiltPhase = 0;

        static readonly string[] Lines = { "在的。", "交给我吧。", "嗯，我在。", "有事喊我。" };

        public PetForm()
        {
            wa = Screen.PrimaryScreen.WorkingArea;
            LoadFrames();
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            BackColor = Color.Magenta;
            TransparencyKey = Color.Magenta;
            StartPosition = FormStartPosition.Manual;
            Width = 190; Height = 233;
            groundY = wa.Bottom - Height - 2;
            Location = new Point(wa.Right - Width - 30, groundY);

            pic = new PictureBox();
            pic.Dock = DockStyle.Fill;
            pic.SizeMode = PictureBoxSizeMode.StretchImage;
            pic.BackColor = Color.Magenta;
            pic.Image = frames["base"];
            Controls.Add(pic);

            nameLbl = new Label();
            nameLbl.Text = "艾莉丝";
            nameLbl.Font = new Font("Microsoft YaHei UI", 10, FontStyle.Bold);
            nameLbl.ForeColor = Color.FromArgb(60, 60, 60);
            nameLbl.BackColor = Color.Transparent;
            nameLbl.AutoSize = true;
            pic.Controls.Add(nameLbl);

            dotLbl = new Label();
            dotLbl.Text = "●";
            dotLbl.Font = new Font("Microsoft YaHei UI", 11);
            dotLbl.ForeColor = Color.Gray;
            dotLbl.BackColor = Color.Transparent;
            dotLbl.AutoSize = true;
            pic.Controls.Add(dotLbl);

            BuildBubble();
            BuildChat();
            BuildTray();

            pic.MouseDown += PicMouseDown;
            pic.MouseMove += PicMouseMove;
            pic.MouseUp += PicMouseUp;
            pic.DoubleClick += (s, e) => { vy = -11; mode = "air"; WakeUp(); ShowBubble(Lines[rnd.Next(Lines.Length)]); };
            Shown += (s, e) =>
            {
                LayoutLabels();
                AppendChat("艾莉丝", "在这里留言就行，我看到就回。", Color.FromArgb(0, 105, 110));
                ShowBubble("我来了，管家在岗。");
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
            frames["base"] = Image.FromFile(Path.Combine(a, "pet.png"));
            frames["baseF"] = Image.FromFile(Path.Combine(a, "pet-flip.png"));
            frames["blink"] = Image.FromFile(Path.Combine(a, "pet-blink.png"));
            frames["blinkF"] = Image.FromFile(Path.Combine(a, "pet-blink-flip.png"));
            frames["tiltR"] = Image.FromFile(Path.Combine(a, "pet-tiltr.png"));
            frames["tiltL"] = Image.FromFile(Path.Combine(a, "pet-tiltl.png"));
            frames["tiltRF"] = Image.FromFile(Path.Combine(a, "pet-tiltr-flip.png"));
            frames["tiltLF"] = Image.FromFile(Path.Combine(a, "pet-tiltl-flip.png"));
        }

        void LayoutLabels()
        {
            nameLbl.Location = new Point(16, pic.Height - 26);
            dotLbl.Location = new Point(pic.Width - 30, pic.Height - 27);
        }

        static Region RoundedRegion(int w, int h, int r)
        {
            GraphicsPath gp = new GraphicsPath();
            gp.AddArc(0, 0, r, r, 180, 90);
            gp.AddArc(w - r - 1, 0, r, r, 270, 90);
            gp.AddArc(w - r - 1, h - r - 1, r, r, 0, 90);
            gp.AddArc(0, h - r - 1, r, r, 90, 90);
            gp.CloseFigure();
            return new Region(gp);
        }
