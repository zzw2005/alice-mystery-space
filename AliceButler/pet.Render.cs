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
        Bitmap CurrentBitmap(string key)
        {
            if (DateTime.Now < grumpyUntil && mode != "drag" && frames.ContainsKey("grumpy")) return frames["grumpy"];
            bool clipAllowed = (mode != "drag" && mode != "air") || (dragClipOn && activeClip == "dragdangle");
            if (clipAllowed)
            {
                Bitmap cb = ClipBitmap();
                if (cb != null) return cb;
            }
            return frames[key];
        }

        string FrameKey()
        {
            if (DateTime.Now < grumpyUntil && mode != "drag" && frames.ContainsKey("grumpy")) return "grumpy";
            bool eyes = sleeping || DateTime.Now < blinkUntil;
            bool flip = dir < 0;
            if (mode == "walk")
            {
                // static fallback follows the walk sprite's facing: source faces
                // left, so the flipped still is the right-facing one
                bool wf = dir > 0;
                bool tilt = (walkTiltPhase / 8) % 2 == 0;
                if (tilt) return wf ? "tiltRF" : "tiltR";
                return wf ? "baseF" : "base";
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
            if (!force && key == lastFrameKey && !squashActive && mode != "air" && activeClip == null && onceClip == null && hearts.Count == 0 && fadeFromBmp == null) return;
            lastFrameKey = key;
            var sw = System.Diagnostics.Stopwatch.StartNew();
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
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = PixelOffsetMode.Half;
                    g.DrawImage(CurrentBitmap(key), new Rectangle((Width - drawW) / 2, Height - drawH, drawW, drawH));
                    // status dot, baked into the corner by her feet
                    int r = Math.Max(5, Width / 34);
                    int cx = Width - r - 5, cy = Height - r - 5;
                    using (SolidBrush b = new SolidBrush(dotColor)) g.FillEllipse(b, cx - r, cy - r, r * 2, r * 2);
                    using (Pen p = new Pen(Color.FromArgb(220, 255, 255, 255), 2)) g.DrawEllipse(p, cx - r, cy - r, r * 2, r * 2);
                    // click hearts: rise, sway and fade over ~0.95s
                    if (hearts.Count > 0)
                    {
                        DateTime nowH = DateTime.Now;
                        hearts.RemoveAll(hh => (nowH - hh.Born).TotalSeconds > 0.95);
                        foreach (var hh in hearts)
                        {
                            double age = (nowH - hh.Born).TotalSeconds;
                            float hy = hh.Y - (float)(age * 58);
                            float hx = hh.X + (float)(Math.Sin(age * 6 + hh.Drift * 3) * 4 + hh.Drift * age * 9);
                            double fade = age < 0.15 ? age / 0.15 : 1 - (age - 0.15) / 0.8;
                            int ha = (int)(235 * Math.Max(0, Math.Min(1, fade)));
                            float hs = (float)(8 + age * 4.5);
                            using (GraphicsPath hp = HeartPath(hx, hy, hs))
                            using (SolidBrush hb = new SolidBrush(Color.FromArgb(ha, 232, 106, 144)))
                                g.FillPath(hb, hp);
                        }
                    }
                    PresentFrame(bmp);
                }
            }
            catch (Exception ex) { LogPetError("render: " + ex.Message); }
            finally
            {
                sw.Stop();
                statRenderCount++; statRenderMs += sw.Elapsed.TotalMilliseconds;
                if (sw.Elapsed.TotalMilliseconds > statRenderMax) statRenderMax = sw.Elapsed.TotalMilliseconds;
            }
        }

        // ---- clip crossfade: switching actions used to hard-cut; now the old
        // frame dissolves into the new one over ~180ms (Emil rule: UI motion
        // stays under 300ms, transform/opacity only — this is pure opacity) ----
        Bitmap lastFullBmp = null;
        Bitmap fadeFromBmp = null;
        DateTime fadeStart = DateTime.MinValue;
        string lastVisualId = "static";
        const int FadeMs = 180;

        void PresentFrame(Bitmap bmp)
        {
            string vid = onceClip != null ? onceClip : (activeClip != null ? activeClip : "static");
            if (vid != lastVisualId)
            {
                if (lastFullBmp != null) { fadeFromBmp = lastFullBmp; lastFullBmp = null; fadeStart = DateTime.Now; }
                lastVisualId = vid;
            }
            Bitmap present = bmp;
            if (fadeFromBmp != null)
            {
                double ft = MotionOk() ? (DateTime.Now - fadeStart).TotalMilliseconds / FadeMs : 1;
                if (ft < 1)
                {
                    var blend = new Bitmap(Width, Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
                    using (Graphics g2 = Graphics.FromImage(blend))
                    {
                        g2.DrawImage(fadeFromBmp, 0, 0, Width, Height);
                        var cm = new System.Drawing.Imaging.ColorMatrix();
                        cm.Matrix33 = (float)ft;
                        using (var ia = new System.Drawing.Imaging.ImageAttributes())
                        {
                            ia.SetColorMatrix(cm);
                            g2.DrawImage(bmp, new Rectangle(0, 0, Width, Height), 0, 0, Width, Height, GraphicsUnit.Pixel, ia);
                        }
                    }
                    present = blend;
                }
                else { fadeFromBmp.Dispose(); fadeFromBmp = null; }
            }
            SetLayeredBitmap(present);
            if (lastFullBmp != null) lastFullBmp.Dispose();
            lastFullBmp = (Bitmap)present.Clone();
            if (present != bmp) present.Dispose();
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
                Bitmap f = CurrentBitmap(lastFrameKey.Length > 0 ? lastFrameKey : "base");
                int fx = pt.X * f.Width / Width;
                int fy = pt.Y * f.Height / Height;
                return f.GetPixel(fx, fy).A > 12;
            }
            catch { return true; }
        }

        void StartSquash(double minScale)
        {
            squashAmp = minScale;
            squashUntil = DateTime.Now.AddMilliseconds(220);
            Render(true);
        }

        static double SquashScale(double u, double squash)
        {
            if (u < 0.45) { double p = u / 0.45; return 1 - (1 - squash) * p * p; }
            double q = (u - 0.45) / 0.55;
            double c1 = 1.70158, c3 = c1 + 1;
            double f = 1 + c3 * Math.Pow(q - 1, 3) + c1 * Math.Pow(q - 1, 2);
            return Math.Min(1.12, squash + (1 - squash) * Math.Max(f, 0));
        }

        static double LandingSquash(double impact)
        {
            double t = Math.Min(Math.Max((Math.Abs(impact) - 300) / 1200.0, 0), 1);
            return Math.Min(0.8, 1 - t * 0.45);
        }
    }
}
