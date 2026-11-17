
        void WakeUp()
        {
            lastInteract = DateTime.Now;
            if (sleeping) { sleeping = false; nextBlink = DateTime.Now.AddSeconds(2); }
        }

        void PicMouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                dragging = true; dragMoved = false;
                dragStart = e.Location;
                downAt = DateTime.Now;
                WakeUp();
            }
        }

        void PicMouseMove(object sender, MouseEventArgs e)
        {
            if (!dragging) return;
            int dx = e.X - dragStart.X, dy = e.Y - dragStart.Y;
            if (Math.Abs(dx) + Math.Abs(dy) > 4) dragMoved = true;
            if (dragMoved)
            {
                Location = new Point(Left + dx, Top + dy);
                mode = "drag";
                if (dx > 3) pic.Image = frames[dir >= 0 ? "tiltR" : "tiltRF"];
                else if (dx < -3) pic.Image = frames[dir >= 0 ? "tiltL" : "tiltLF"];
            }
        }

        void PicMouseUp(object sender, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left || !dragging) return;
            dragging = false;
            WakeUp();
            if (!dragMoved && (DateTime.Now - downAt).TotalMilliseconds < 350)
            {
                vy = -6; if (mode != "air") mode = "air";
                ToggleChat();
            }
            else if (mode == "drag") { vy = 0; mode = "air"; }
        }

        Image CurrentFrame()
        {
            bool eyes = sleeping || DateTime.Now < blinkUntil;
            bool flip = dir < 0;
            if (mode == "walk")
            {
                bool tilt = (walkTiltPhase / 8) % 2 == 0;
                if (tilt) return frames[flip ? (dir < 0 ? "tiltRF" : "tiltR") : "base"];
                return frames[flip ? "baseF" : "base"];
            }
            if (DateTime.Now < lookUntil && mode == "idle")
            {
                return frames[lookDir > 0 ? (flip ? "tiltRF" : "tiltR") : (flip ? "tiltLF" : "tiltL")];
            }
            if (eyes) return frames[flip ? "blinkF" : "blink"];
            return frames[flip ? "baseF" : "base"];
        }

        void MotionTick(object sender, EventArgs e)
        {
            DateTime now = DateTime.Now;
            // blink scheduling
            if (!sleeping && now >= nextBlink)
            {
                blinkUntil = now.AddMilliseconds(130);
                nextBlink = now.AddSeconds(2.8 + rnd.NextDouble() * 3.7);
            }
            // sleep entry: 3 min untouched, not busy, on the ground
            if (!sleeping && !busy && mode == "idle" && (now - lastInteract).TotalSeconds > 180)
            {
                sleeping = true;
                nextZzz = now.AddSeconds(6);
            }
            if (sleeping)
            {
                bobPhase += 0.02;
                Top = groundY + (int)(Math.Sin(bobPhase) * 1);
                if (now >= nextZzz) { ShowBubble("Z z z"); nextZzz = now.AddSeconds(18 + rnd.Next(14)); }
                pic.Image = CurrentFrame();
                if (bubble.Visible) PlaceBubble();
                return;
            }

            if (mode == "air")
            {
                vy += 1.3;
                int nt = Top + (int)vy;
                if (nt >= groundY) { Top = groundY; vy = 0; mode = "idle"; idleUntil = now.AddSeconds(rnd.Next(6, 14)); }
                else Top = nt;
            }
            else if (mode == "walk")
            {
                int nx = Left + 2 * dir;
                if ((dir > 0 && nx >= walkTarget) || (dir < 0 && nx <= walkTarget))
                {
                    Left = walkTarget; mode = "idle"; idleUntil = now.AddSeconds(rnd.Next(7, 16));
                }
                else Left = nx;
                bobPhase += 0.35;
                Top = groundY + (int)(Math.Sin(bobPhase) * 1.5);
                walkTiltPhase++;
            }
            else if (mode == "idle")
            {
                // stretch sequence: 14 ticks of squash and recover
                if (stretchTick >= 0)
                {
                    double[] seq = { 0.97, 0.94, 0.94, 0.97, 1.02, 1.03, 1.02, 1.0, 1.0 };
                    int idx = Math.Min(stretchTick, seq.Length - 1);
                    Height = (int)(233 * seq[idx]);
                    Top = groundY + (233 - Height);
                    stretchTick++;
                    if (stretchTick >= seq.Length) { stretchTick = -1; Height = 233; Top = groundY; LayoutLabels(); }
                }
                else
                {
                    bobPhase += 0.06;
                    Top = groundY + (int)(Math.Sin(bobPhase) * 2);
                }
                if (busy && now >= nextHop) { vy = -5; mode = "air"; nextHop = now.AddSeconds(3.5 + rnd.NextDouble() * 2); }
                else if (now >= nextStretch) { stretchTick = 0; nextStretch = now.AddSeconds(45 + rnd.Next(50)); }
                else if (now >= nextLook && now >= idleUntil.AddSeconds(-2))
                {
                    lookDir = rnd.Next(0, 2) == 0 ? -1 : 1;
                    lookUntil = now.AddMilliseconds(900);
                    nextLook = now.AddSeconds(9 + rnd.Next(8));
                }
                else if (now >= idleUntil)
                {
                    if (rnd.Next(0, 2) == 0)
                    {
                        dir = rnd.Next(0, 2) == 0 ? -1 : 1;
                        int dist = rnd.Next(60, 240);
                        int t = Left + dir * dist;
                        if (t < wa.Left) t = wa.Left;
                        if (t > wa.Right - Width) t = wa.Right - Width;
                        walkTarget = t;
                        walkTiltPhase = 0;
                        mode = "walk";
                    }
                    else idleUntil = now.AddSeconds(rnd.Next(6, 12));
                }
            }
            if (mode != "drag") pic.Image = CurrentFrame();
            if (bubble.Visible) PlaceBubble();
            if (chat.Visible) PlaceChat();
        }

        void StatusTick(object sender, EventArgs e)
        {
            try
            {
                string json = File.ReadAllText(statusPath, System.Text.Encoding.UTF8);
                var ser = new JavaScriptSerializer();
                var s = ser.Deserialize<Dictionary<string, object>>(json);
                DateTime hb = DateTime.Parse(Convert.ToString(s["heartbeat"]), null, System.Globalization.DateTimeStyles.AdjustToUniversal);
                double age = (DateTime.UtcNow - hb).TotalSeconds;
                object[] jobs = s["jobs"] as object[];
                busy = jobs != null && jobs.Length > 0;
                if (age > 25) { dotLbl.ForeColor = Color.Gray; tray.Text = "艾莉丝 - 管家离线"; }
                else if (busy) { dotLbl.ForeColor = Color.Orange; tray.Text = "艾莉丝 - 忙碌中"; }
                else { dotLbl.ForeColor = Color.MediumSeaGreen; tray.Text = "艾莉丝 - 在岗"; }
                if (busy) WakeUpSilent();
                int seq = Convert.ToInt32(s["lastEventSeq"]);
                if (lastSeq < 0) lastSeq = seq;
                else if (seq > lastSeq)
                {
                    lastSeq = seq;
                    object[] evs = s["events"] as object[];
                    if (evs != null && evs.Length > 0)
                    {
                        var last = evs[evs.Length - 1] as Dictionary<string, object>;
                        string msg = last != null ? Convert.ToString(last["msg"]) : "";
                        if (msg.Length > 0)
                        {
                            WakeUp();
                            if (msg.Contains("任务完成")) { vy = -11; mode = "air"; }
                            if (!chat.Visible) ShowBubble(msg);
                        }
                    }
                }
            }
            catch { dotLbl.ForeColor = Color.Gray; }
            try
            {
                foreach (string f in Directory.GetFiles(outboxDir, "reply-*.json"))
                {
                    try
                    {
                        string json = File.ReadAllText(f, System.Text.Encoding.UTF8);
                        var ser = new JavaScriptSerializer();
                        var r = ser.Deserialize<Dictionary<string, object>>(json);
                        AppendChat("艾莉丝", Convert.ToString(r["text"]), Color.FromArgb(0, 105, 110));
                        string dest = Path.Combine(outboxDir, "seen", Path.GetFileName(f));
                        if (File.Exists(dest)) File.Delete(dest);
                        File.Move(f, dest);
                        WakeUp();
                        if (!chat.Visible) ShowBubble("回你了。");
                    }
                    catch { }
                }
            }
            catch { }
        }

        void WakeUpSilent()
        {
            lastInteract = DateTime.Now;
            sleeping = false;
        }
    }
}
