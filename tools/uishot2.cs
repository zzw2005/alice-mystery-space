using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

class UiShot2
{
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lp);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr value);
    delegate bool EnumProc(IntPtr h, IntPtr lp);
    struct RECT { public int Left, Top, Right, Bottom; }
    const uint LEFTDOWN = 0x02, LEFTUP = 0x04;

    static void Main()
    {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
        string dir = @"C:\ProgramData\AliceButler\tools";
        var log = new StreamWriter(Path.Combine(dir, "uishot2.log"), false);
        try
        {
            var procs = Process.GetProcessesByName("AlicePetNew");
            if (procs.Length == 0) { log.WriteLine("no pet"); log.Flush(); return; }
            uint targetPid = (uint)procs[0].Id;
            IntPtr petH = IntPtr.Zero; RECT pr = new RECT(); int best = int.MaxValue;
            EnumWindows((h, lp) =>
            {
                uint pid; GetWindowThreadProcessId(h, out pid);
                if (pid == targetPid && IsWindowVisible(h))
                {
                    RECT r; GetWindowRect(h, out r);
                    int score = Math.Abs((r.Right - r.Left) - 346) + Math.Abs((r.Bottom - r.Top) - 400);
                    if (score < best) { best = score; petH = h; pr = r; }
                }
                return true;
            }, IntPtr.Zero);
            if (petH == IntPtr.Zero) { log.WriteLine("pet window not found"); log.Flush(); return; }
            SetCursorPos((pr.Left + pr.Right) / 2, (pr.Top + pr.Bottom) / 2);
            Thread.Sleep(150);
            mouse_event(LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(90);
            mouse_event(LEFTUP, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(1400);
            IntPtr chatH = IntPtr.Zero; RECT cr = new RECT();
            EnumWindows((h, lp) =>
            {
                uint pid; GetWindowThreadProcessId(h, out pid);
                if (pid == targetPid && h != petH && IsWindowVisible(h))
                {
                    RECT r; GetWindowRect(h, out r);
                    if (r.Right > r.Left && r.Bottom > r.Top) { chatH = h; cr = r; }
                }
                return true;
            }, IntPtr.Zero);
            if (chatH == IntPtr.Zero) { log.WriteLine("chat not opened"); log.Flush(); return; }
            try
            {
                var b = System.Windows.Forms.Screen.PrimaryScreen.Bounds;
                using (var bmp = new Bitmap(b.Width, b.Height))
                using (var g = Graphics.FromImage(bmp))
                {
                    g.CopyFromScreen(b.Location, Point.Empty, b.Size);
                    bmp.Save(Path.Combine(dir, "full.png"), ImageFormat.Png);
                }
                log.WriteLine("full shot " + b.Width + "x" + b.Height);
            }
            catch (Exception ex2) { log.WriteLine("full shot ERR " + ex2.Message); }
            int w = cr.Right - cr.Left, ht = cr.Bottom - cr.Top;
            using (var bmp = new Bitmap(w, ht))
            using (var g = Graphics.FromImage(bmp))
            {
                IntPtr hdc = g.GetHdc();
                bool ok = PrintWindow(chatH, hdc, 0x00000002);
                g.ReleaseHdc(hdc);
                log.WriteLine("capture ok=" + ok + " " + w + "x" + ht);
                bmp.Save(Path.Combine(dir, "chatFinal.png"), ImageFormat.Png);
            }
            log.WriteLine("done");
        }
        catch (Exception ex) { log.WriteLine("ERR " + ex.Message); }
        log.Flush(); log.Close();
    }
}
