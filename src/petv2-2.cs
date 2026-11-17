
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

        void PetMouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            dragging = true; dragMoved = false;
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
            if (Math.Abs(cur.X - (Left + grabOffset.X)) + Math.Abs(cur.Y - (Top + grabOffset.Y)) > 4) dragMoved = true;
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
                // plain click: Q-bounce + open chat
                StartSquash(0.55);
                if (Top >= groundY) { vy = -270; vx = 0; mode = "air"; }
                ToggleChat();
                return;
            }
            // release: spring velocity becomes throw velocity, dsh-pet style
            double sx = vx, sy = vy;
            if ((DateTime.Now - lastMoveAt).TotalMilliseconds > 150) { sx = 0; sy = 0; }
            double speed = Math.Sqrt(sx * sx + sy * sy);
            if (speed < 500)
            {
                vx = 0; vy = 0;
                if (Top >= groundY) { mode = "idle"; idleUntil = DateTime.Now.AddSeconds(3); }
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
            vx = 0; vy = 0;
            idleUntil = DateTime.Now.AddSeconds(2 + rnd.Next(4));
            if (pendingCelebrate)
            {
                pendingCelebrate = false;
                vy = -560; mode = "air";
            }
        }

        void WakeUp() { if (sleeping) { sleeping = false; lastInteract = DateTime.Now; } }

        void MotionTick(object sender, EventArgs e)
        {
            DateTime now = DateTime.Now;
            double dt = 0.05;

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
                Render(false);
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
                Render(true);
                return;
            }

            // blink scheduling
            if (!sleeping && now >= nextBlink) { blinkUntil = now.AddMilliseconds(130); nextBlink = now.AddSeconds(2.8 + rnd.NextDouble() * 3.7); Render(true); }
            if (now == blinkUntil.AddMilliseconds(130)) { }
            if (!sleeping && now >= nextLook && mode == "idle") { lookDir = rnd.Next(2) == 0 ? -1 : 1; lookUntil = now.AddMilliseconds(900); nextLook = now.AddSeconds(7 + rnd.Next(9)); Render(true); }

            bool isBusy = busy || presenceWorking;
            if (sleeping)
            {
                Top = groundY;
                if (now >= nextZzz) { ShowBubble("Z z z"); nextZzz = now.AddSeconds(20); }
                Render(false);
                return;
            }

            if (mode == "walk")
            {
                int step = 2;
                Left += dir * step;
                walkTiltPhase++;
                bobPhase += 0.35;
                Top = groundY + (int)(Math.Sin(bobPhase) * 2);
                if ((dir > 0 && Left >= walkTarget) || (dir < 0 && Left <= walkTarget) || Left <= wa.Left || Left >= wa.Right - Width)
                {
                    mode = "idle"; Top = groundY;
                    idleUntil = now.AddSeconds(3 + rnd.Next(6));
                }
                Render(false);
                return;
            }

            // idle
            Top = groundY + (int)(Math.Sin(now.TimeOfDay.TotalSeconds * 1.6) * 2);
            if (isBusy && now >= nextHop) { vy = -330; vx = 0; mode = "air"; nextHop = now.AddSeconds(4); return; }
            if (stretchTick >= 0)
            {
                stretchTick++;
                double[] seq = { 0.97, 0.94, 0.94, 0.97, 1.02, 1.03, 1.02, 1.0, 1.0 };
                if (stretchTick >= seq.Length) stretchTick = -1;
                Render(true);
                return;
            }
            if (now >= nextStretch) { stretchTick = 0; nextStretch = now.AddSeconds(35 + rnd.Next(40)); Render(true); return; }
            if (now - lastInteract > TimeSpan.FromMinutes(3)) { sleeping = true; Render(true); return; }
            if (now >= idleUntil)
            {
                if (rnd.Next(100) < 55)
                {
                    dir = rnd.Next(2) == 0 ? -1 : 1;
                    int dist = 60 + rnd.Next(220);
                    walkTarget = Math.Max(wa.Left, Math.Min(wa.Right - Width, Left + dir * dist));
                    if (Math.Abs(walkTarget - Left) > 20) { mode = "walk"; walkTiltPhase = 0; }
                    else idleUntil = now.AddSeconds(4);
                }
                else idleUntil = now.AddSeconds(3 + rnd.Next(5));
            }
            Render(false);
        }
