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
        void SpawnHearts()
        {
            WakeUp();
            float[] xs = { 0.36f, 0.52f, 0.66f };
            foreach (float fx in xs)
                hearts.Add(new HeartP { X = Width * fx + rnd.Next(-6, 7), Y = Height * (0.10f + rnd.Next(0, 6) / 100f), Drift = rnd.Next(-10, 11) / 10f, Born = DateTime.Now });
        }
        static GraphicsPath HeartPath(float cx, float cy, float s)
        {
            var p = new GraphicsPath();
            var pts = new PointF[36];
            for (int i = 0; i < 36; i++)
            {
                double t = Math.PI * 2 * i / 36;
                double x = 16 * Math.Pow(Math.Sin(t), 3);
                double y = 13 * Math.Cos(t) - 5 * Math.Cos(2 * t) - 2 * Math.Cos(3 * t) - Math.Cos(4 * t);
                pts[i] = new PointF(cx + (float)(x * s / 17), cy - (float)(y * s / 17));
            }
            p.AddPolygon(pts);
            return p;
        }
        void PetMouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            clickTimer.Stop(); // a pending single-click must not fire mid-drag
            dragging = true; dragMoved = false; dragClipOn = false;
            downAt = DateTime.Now;
            lastCursor = Cursor.Position;
            lastMoveAt = DateTime.Now;
            grabOffset = new Point(Cursor.Position.X - Left, Cursor.Position.Y - Top);
            dragVx = 0; dragVy = 0; vx = 0; vy = 0;
            mode = "drag";
            WakeUp();
        }

        void PetMouseMove(object sender, MouseEventArgs e)
        {
            if (!dragging) return;
            Point cur = Cursor.Position;
            if (!dragMoved && Math.Abs(cur.X - (Left + grabOffset.X)) + Math.Abs(cur.Y - (Top + grabOffset.Y)) > 4)
            {
                dragMoved = true;
                dragClipOn = true;
                SetClip("dragdangle");
            }
            lastCursor = cur;
            lastMoveAt = DateTime.Now;
        }

        void PetMouseUp(object sender, MouseEventArgs e)
        {
            if (!dragging) return;
            dragging = false;
            lastInteract = DateTime.Now;
            if (!dragMoved && (DateTime.Now - downAt).TotalMilliseconds < 400)
            {
                // rapid-click counting: four quick pokes and she gets annoyed (his grumpy figurine shot)
                if ((DateTime.Now - lastClickAt).TotalSeconds < 2.2) rapidClicks++; else rapidClicks = 1;
                lastClickAt = DateTime.Now;
                if (rapidClicks >= 4 && frames.ContainsKey("grumpy"))
                {
                    rapidClicks = 0;
                    grumpyUntil = DateTime.Now.AddSeconds(1.6);
                    clickTimer.Stop();
                    mode = Top >= groundY ? "idle" : "air"; // never leave mode stuck on "drag"
                    StartSquash(0.6);
                    ShowBubble("哼，戳够了没。");
                    Render(true);
                    return;
                }
                // plain click: Q-bounce + open chat (delayed slightly so a double-click can pre-empt)
                StartSquash(0.55);
                if (Top >= groundY) { vy = -270; vx = 0; mode = "air"; }
                else { vx = 0; vy = 0; mode = "air"; } // clicked mid-air: just fall, never stay in "drag"
                clickTimer.Stop(); clickTimer.Start();
                return;
            }
            // release: spring velocity becomes throw velocity, dsh-pet style
            double sx = vx, sy = vy;
            if ((DateTime.Now - lastMoveAt).TotalMilliseconds > 150) { sx = 0; sy = 0; }
            double speed = Math.Sqrt(sx * sx + sy * sy);
            if (speed < 500)
            {
                vx = 0; vy = 0;
                if (Top >= groundY) { mode = "idle"; dragClipOn = false; idleUntil = DateTime.Now.AddSeconds(3); }
                else mode = "air";
            }
            else
            {
                double capped = 3600 * (1 - Math.Exp(-speed / 3600.0));
                vx = sx / speed * capped; vy = sy / speed * capped;
                mode = "air";
            }
            Render(true);
        }

        void Land()
        {
            mode = "idle";
            dragClipOn = false;
            vx = 0; vy = 0;
            idleUntil = DateTime.Now.AddSeconds(2 + rnd.Next(4));
            if (pendingCelebrate)
            {
                pendingCelebrate = false;
                PlayOnce("celebrate");
            }
        }

        void WakeUp()
        {
            if (!sleeping) return;
            sleeping = false; lastInteract = DateTime.Now;
            sleepEntry = false;
            if (onceClip == "sleepstart") { onceClip = null; DisposeClip("sleepstart"); }
            SetClip("breathe");
            PlayOnce("wakeup");
        }

        void GoToSleep()
        {
            if (sleeping) return;
            sleeping = true;
            sleepEntry = true;
            PlayOnce("sleepstart");
        }

        void MotionTick(object sender, EventArgs e)
        {
            DateTime now = DateTime.Now;
            double dt = lastMotion == DateTime.MinValue ? 0.016 : Math.Min(0.05, Math.Max(0.001, (now - lastMotion).TotalSeconds));
            lastMotion = now;

            if (mode == "drag")
            {
                // spring follow (dsh-pet: k=200, c=30, slightly overdamped) — smooth, never rigid
                int tx = lastCursor.X - grabOffset.X;
                int ty = Math.Min(lastCursor.Y - grabOffset.Y, groundY);
                tx = Math.Max(wa.Left - Width / 3, Math.Min(wa.Right - Width * 2 / 3, tx));
                ty = Math.Max(wa.Top, ty);
                vx += (200 * (tx - Left) - 30 * vx) * dt;
                vy += (200 * (ty - Top) - 30 * vy) * dt;
                Left += (int)(vx * dt);
                Top += (int)(vy * dt);
                dir = vx > 20 ? 1 : (vx < -20 ? -1 : dir);
                if (!AdvanceClip(now)) Render(false); // advance+render once, at the new position
                return;
            }

            if (mode == "air")
            {
                int steps = 3;
                double sdt = dt / steps;
                bool landed = false;
                for (int i = 0; i < steps && !landed; i++)
                {
                    vy += 1400 * sdt;
                    Left += (int)(vx * sdt);
                    Top += (int)(vy * sdt);
                    if (Left < wa.Left) { Left = wa.Left; vx = -vx * 0.78; vy *= (1 - Math.Min(1, 2.5 * sdt)); }
                    if (Left > wa.Right - Width) { Left = wa.Right - Width; vx = -vx * 0.78; vy *= (1 - Math.Min(1, 2.5 * sdt)); }
                    if (Top < wa.Top) { Top = wa.Top; vy = -vy * 0.78; }
                    if (Top >= groundY)
                    {
                        Top = groundY;
                        double impact = vy;
                        if (impact < 40)
                        {
                            vy = 0;
                            vx *= (1 - Math.Min(1, 2.5 * sdt * 3));
                            if (Math.Abs(vx) < 30) { Land(); landed = true; }
                        }
                        else
                        {
                            StartSquash(LandingSquash(impact));
                            vy = -impact * 0.78;
                            vx *= (1 - Math.Min(1, 2.5 * sdt));
                            if (Math.Abs(vy) < 120 && Math.Abs(vx) < 30) { Land(); landed = true; }
                        }
                    }
                }
                dir = vx > 20 ? 1 : (vx < -20 ? -1 : dir);
                if (!AdvanceClip(now)) Render(true); // advance+render once, at the new position
                return;
            }

            bool clipMoved = AdvanceClip(now);

            // blink scheduling
            if (!sleeping && now >= nextBlink) { blinkUntil = now.AddMilliseconds(130); nextBlink = now.AddSeconds(2.8 + rnd.NextDouble() * 3.7); Render(true); }
            if (now == blinkUntil.AddMilliseconds(130)) { }
            if (!sleeping && now >= nextLook && mode == "idle") { lookDir = rnd.Next(2) == 0 ? -1 : 1; lookUntil = now.AddMilliseconds(900); nextLook = now.AddSeconds(7 + rnd.Next(9)); Render(true); }

            bool isBusy = busy || presenceWorking;
            if (sleeping)
            {
                if (onceClip == null) SetClip("doze");
                Top = groundY;
                if (now >= nextZzz) { ShowBubble("Z z z"); nextZzz = now.AddSeconds(20); }
                return;
            }

            if (mode == "walk")
            {
                SetClip("walk");
                walkAcc += dir * 55 * dt;
                int step = (int)walkAcc;
                walkAcc -= step;
                Left += step;
                walkTiltPhase++;
                bobPhase += 7 * dt;
                Top = groundY + (int)(Math.Sin(bobPhase) * 2);
                if ((dir > 0 && Left >= walkTarget) || (dir < 0 && Left <= walkTarget) || Left <= wa.Left || Left >= wa.Right - Width)
                {
                    mode = "idle"; Top = groundY;
                    idleUntil = now.AddSeconds(3 + rnd.Next(6));
                }
                Render(false);
                return;
            }

            // idle: presence work-state loops (thinking/result/waiting) take over the base loop;
            // the loop stays resident under one-shots (ClipBitmap already prefers the one-shot)
            string baseClip = presenceClipWanted != null ? presenceClipWanted : "breathe";
            SetClip(baseClip);
            Top = activeClip != null ? groundY : groundY + (int)(Math.Sin(now.TimeOfDay.TotalSeconds * 1.6) * 2);
            bool chatOpen = chat != null && chat.Visible;
            if (onceClip == null && now >= nextOnce)
            {
                nextOnce = now.AddSeconds(45 + rnd.Next(50));
                string nm = PickIdleName();
                if (nm != null && nm == lastIdleClip)
                {
                    string nm2 = PickIdleName();
                    if (nm2 != null) nm = nm2; // re-roll once, but never let a null re-roll cancel the pick
                }
                if (nm != null) { lastIdleClip = nm; PlayOnce(nm); }
            }
            if (isBusy && now >= nextHop) { vy = -330; vx = 0; mode = "air"; nextHop = now.AddSeconds(4); return; }
            if (stretchTick >= 0)
            {
                stretchAcc += dt / 0.05;
                while (stretchAcc >= 1) { stretchTick++; stretchAcc -= 1; }
                double[] seq = { 0.97, 0.94, 0.94, 0.97, 1.02, 1.03, 1.02, 1.0, 1.0 };
                if (stretchTick >= seq.Length) stretchTick = -1;
                Render(true);
                return;
            }
            if (now >= nextStretch) { stretchTick = 0; nextStretch = now.AddSeconds(35 + rnd.Next(40)); Render(true); return; }
            if (!chatOpen && now - lastInteract > TimeSpan.FromMinutes(3)) { GoToSleep(); Render(true); return; }
            if (now >= idleUntil)
            {
                if (chatOpen) idleUntil = now.AddSeconds(4); // stay put while he's chatting with her
                else if (rnd.Next(100) < 55)
                {
                    dir = rnd.Next(2) == 0 ? -1 : 1;
                    int dist = 60 + rnd.Next(220);
                    walkTarget = Math.Max(wa.Left, Math.Min(wa.Right - Width, Left + dir * dist));
                    if (Math.Abs(walkTarget - Left) > 20) { mode = "walk"; walkTiltPhase = 0; }
                    else idleUntil = now.AddSeconds(4);
                }
                else idleUntil = now.AddSeconds(3 + rnd.Next(5));
            }
            if (!clipMoved && (hearts.Count > 0 || DateTime.Now < squashUntil)) Render(false);
        }
    }
}
