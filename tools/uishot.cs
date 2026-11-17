using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

class UiShot
{
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lp);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr value);
    delegate bool EnumProc(IntPtr h, IntPtr lp);
    struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public UIntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KEYBDINPUT ki; [FieldOffset(8)] public MOUSEINPUT mi; }
    const uint LEFTDOWN = 0x02, LEFTUP = 0x04, KEYUP = 0x0002, UNICODE = 0x0004;

    static StreamWriter log;

    static void Click(int x, int y)
    {
        SetCursorPos(x, y);
        Thread.Sleep(150);
        mouse_event(LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(90);
        mouse_event(LEFTUP, 0, 0, 0, UIntPtr.Zero);
    }

    static void TypeText(string s)
    {
        foreach (char c in s)
        {
            var down = new INPUT { type = 1, ki = new KEYBDINPUT { wScan = c, dwFlags = UNICODE } };
            var up = new INPUT { type = 1, ki = new KEYBDINPUT { wScan = c, dwFlags = UNICODE | KEYUP } };
            SendInput(1, new[] { down }, Marshal.SizeOf(typeof(INPUT)));
            SendInput(1, new[] { up }, Marshal.SizeOf(typeof(INPUT)));
            Thread.Sleep(25);
        }
    }

    static void Enter()
    {
        var down = new INPUT { type = 1, ki = new KEYBDINPUT { wVk = 0x0D } };
        var up = new INPUT { type = 1, ki = new KEYBDINPUT { wVk = 0x0D, dwFlags = KEYUP } };
        SendInput(1, new[] { down }, Marshal.SizeOf(typeof(INPUT)));
        SendInput(1, new[] { up }, Marshal.SizeOf(typeof(INPUT)));
    }

    static List<KeyValuePair<IntPtr, RECT>> VisibleWindows(uint targetPid, string tag)
    {
        var wins = new List<KeyValuePair<IntPtr, RECT>>();
        EnumWindows((h, lp) =>
        {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pid == targetPid)
            {
                RECT r; GetWindowRect(h, out r);
                bool vis = IsWindowVisible(h);
                log.WriteLine(tag + " win " + h + " vis=" + vis + " rect " + r.Left + "," + r.Top + " " + (r.Right - r.Left) + "x" + (r.Bottom - r.Top));
                if (vis && r.Right > r.Left && r.Bottom > r.Top) wins.Add(new KeyValuePair<IntPtr, RECT>(h, r));
            }
            return true;
        }, IntPtr.Zero);
        log.Flush();
        return wins;
    }

    static void CaptureWindow(IntPtr h, RECT r, string path)
    {
        // screen-copy instead of PrintWindow: the chat window's drop shadow makes PrintWindow return black
        int w = r.Right - r.Left, ht = r.Bottom - r.Top;
        if (w <= 0 || ht <= 0) { log.WriteLine("capture skip " + path); return; }
        using (var bmp = new Bitmap(w, ht))
        using (var g = Graphics.FromImage(bmp))
        {
            g.CopyFromScreen(new Point(r.Left, r.Top), Point.Empty, new Size(w, ht));
            log.WriteLine("capture " + Path.GetFileName(path) + " screencopy " + w + "x" + ht);
            bmp.Save(path, ImageFormat.Png);
        }
        log.Flush();
    }

    static void Main()
    {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { try { SetProcessDPIAware(); } catch { } }
        string dir = @"C:\ProgramData\AliceButler\tools";
        Directory.CreateDirectory(dir);
        log = new StreamWriter(Path.Combine(dir, "uishot.log"), false);
        try
        {
            var procs = Process.GetProcessesByName("AlicePetNew");
            log.WriteLine("procs=" + procs.Length);
            if (procs.Length == 0) { log.Flush(); return; }
            uint targetPid = (uint)procs[0].Id;
            var wins = VisibleWindows(targetPid, "pre");
            IntPtr petH = IntPtr.Zero; RECT pr = new RECT(); int bestScore = int.MaxValue;
            foreach (var kv in wins)
            {
                int w = kv.Value.Right - kv.Value.Left, hgt = kv.Value.Bottom - kv.Value.Top;
                int score = Math.Abs(w - 346) + Math.Abs(hgt - 400);
                if (score < bestScore) { bestScore = score; petH = kv.Key; pr = kv.Value; }
            }
            if (petH == IntPtr.Zero) { log.WriteLine("pet not found"); log.Flush(); return; }
            log.WriteLine("pet " + petH + " rect " + pr.Left + "," + pr.Top);
            Click((pr.Left + pr.Right) / 2, (pr.Top + pr.Bottom) / 2);
            Thread.Sleep(1400);
            var wins2 = VisibleWindows(targetPid, "post");
            IntPtr chatH = IntPtr.Zero; RECT chatR = new RECT();
            foreach (var kv in wins2) { if (kv.Key != petH) { chatH = kv.Key; chatR = kv.Value; break; } }
            if (chatH == IntPtr.Zero) { log.WriteLine("chat not opened"); log.Flush(); return; }
            CaptureWindow(chatH, chatR, Path.Combine(dir, "chatA.png"));
            TypeText("新对话框测试：这条是我发的，看看珊瑚红气泡");
            Thread.Sleep(600);
            CaptureWindow(chatH, chatR, Path.Combine(dir, "chatB.png"));
            Enter();
            Thread.Sleep(1800);
            CaptureWindow(chatH, chatR, Path.Combine(dir, "chatC.png"));
            Thread.Sleep(75000);
            CaptureWindow(chatH, chatR, Path.Combine(dir, "chatD.png"));
            log.WriteLine("done");
        }
        catch (Exception ex) { log.WriteLine("ERR " + ex.Message); }
        log.Flush(); log.Close();
    }
}
