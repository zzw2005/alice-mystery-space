
        void BuildBubble()
        {
            bubble = new Form();
            bubble.FormBorderStyle = FormBorderStyle.None;
            bubble.ShowInTaskbar = false;
            bubble.TopMost = true;
            bubble.BackColor = Color.White;
            bubble.StartPosition = FormStartPosition.Manual;
            bubble.Size = new Size(190, 44);
            bubble.Paint += (s, e) =>
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                var rect = new Rectangle(0, 0, bubble.Width - 1, bubble.Height - 1);
                using (var path = new GraphicsPath())
                {
                    int r = 12;
                    path.AddArc(rect.X, rect.Y, r, r, 180, 90);
                    path.AddArc(rect.Right - r, rect.Y, r, r, 270, 90);
                    path.AddArc(rect.Right - r, rect.Bottom - r, r, r, 0, 90);
                    path.AddArc(rect.X, rect.Bottom - r, r, r, 90, 90);
                    path.CloseFigure();
                    using (var br = new SolidBrush(Color.White)) e.Graphics.FillPath(br, path);
                    using (var pen = new Pen(Color.FromArgb(225, 225, 225))) e.Graphics.DrawPath(pen, path);
                }
            };
            bubbleLbl = new Label();
            bubbleLbl.AutoSize = false;
            bubbleLbl.Size = new Size(178, 32);
            bubbleLbl.Location = new Point(6, 6);
            bubbleLbl.Font = new Font("Microsoft YaHei UI", 9.5f);
            bubbleLbl.ForeColor = Color.FromArgb(50, 50, 50);
            bubbleLbl.TextAlign = ContentAlignment.MiddleCenter;
            bubble.Controls.Add(bubbleLbl);
            bubbleTimer = new System.Windows.Forms.Timer(); bubbleTimer.Interval = 2600;
            bubbleTimer.Tick += (s, e) => { bubble.Hide(); bubbleTimer.Stop(); };
        }

        void ShowBubble(string text)
        {
            bubbleLbl.Text = text;
            int x = Left + Width / 2 - bubble.Width / 2;
            x = Math.Max(wa.Left, Math.Min(wa.Right - bubble.Width, x));
            bubble.Location = new Point(x, Math.Max(wa.Top, Top - bubble.Height - 8));
            bubble.Show();
            bubbleTimer.Stop(); bubbleTimer.Start();
        }

        void BuildChat()
        {
            chat = new Form();
            chat.Text = "和艾莉丝说话";
            chat.FormBorderStyle = FormBorderStyle.SizableToolWindow;
            chat.ShowInTaskbar = false;
            chat.TopMost = true;
            chat.Size = new Size(360, 470);
            chat.StartPosition = FormStartPosition.Manual;
            chat.BackColor = Color.White;
            var title = new Label();
            title.Text = "艾莉丝";
            title.Font = new Font("Microsoft YaHei UI", 12, FontStyle.Bold);
            title.ForeColor = Color.FromArgb(40, 40, 40);
            title.AutoSize = true;
            title.Location = new Point(14, 10);
            chat.Controls.Add(title);
            subLbl = new Label();
            subLbl.Text = "电脑分身 · 在岗";
            subLbl.Font = new Font("Microsoft YaHei UI", 9);
            subLbl.ForeColor = Color.FromArgb(130, 130, 130);
            subLbl.AutoSize = true;
            subLbl.Location = new Point(14, 38);
            chat.Controls.Add(subLbl);
            rtb = new RichTextBox();
            rtb.ReadOnly = true;
            rtb.BorderStyle = BorderStyle.None;
            rtb.BackColor = Color.FromArgb(248, 248, 248);
            rtb.Location = new Point(10, 62);
            rtb.Size = new Size(332, 330);
            rtb.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            rtb.Font = new Font("Microsoft YaHei UI", 10);
            chat.Controls.Add(rtb);
            inputBox = new TextBox();
            inputBox.Location = new Point(10, 404);
            inputBox.Size = new Size(258, 26);
            inputBox.Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            inputBox.Font = new Font("Microsoft YaHei UI", 10);
            chat.Controls.Add(inputBox);
            var send = new Button();
            send.Text = "发送";
            send.Location = new Point(274, 403);
            send.Size = new Size(68, 28);
            send.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
            send.Click += (s, e) => SendChat();
            chat.Controls.Add(send);
            inputBox.KeyDown += (s, e) => { if (e.KeyCode == Keys.Enter) { SendChat(); e.SuppressKeyPress = true; } };
            chat.FormClosing += (s, e) => { e.Cancel = true; chat.Hide(); };
        }

        void ToggleChat()
        {
            if (chat.Visible) { chat.Hide(); return; }
            int x = Left + Width / 2 - chat.Width / 2;
            x = Math.Max(wa.Left, Math.Min(wa.Right - chat.Width, x));
            int y = Top - chat.Height - 10;
            if (y < wa.Top) y = Top + 10;
            chat.Location = new Point(x, y);
            chat.Show();
            chat.Activate();
            inputBox.Focus();
        }

        void AppendChat(string who, string text, Color color)
        {
            if (rtb.TextLength > 60000) rtb.Text = rtb.Text.Substring(rtb.TextLength - 30000);
            rtb.SelectionStart = rtb.TextLength;
            rtb.SelectionColor = color;
            rtb.SelectionFont = new Font(rtb.Font, FontStyle.Bold);
            rtb.AppendText(who + "\n");
            rtb.SelectionColor = Color.FromArgb(40, 40, 40);
            rtb.SelectionFont = rtb.Font;
            rtb.AppendText(text + "\n\n");
            rtb.ScrollToCaret();
        }

        void SendChat()
        {
            string text = inputBox.Text.Trim();
            if (text.Length == 0) return;
            inputBox.Text = "";
            AppendChat("主人", text, Color.FromArgb(90, 90, 90));
            lastInteract = DateTime.Now;
            try
            {
                Directory.CreateDirectory(inboxDir);
                string id = "msg-" + DateTime.Now.ToString("yyyyMMddHHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 6);
                var obj = new Dictionary<string, object> { { "id", id }, { "ts", DateTime.UtcNow.ToString("o") }, { "text", text } };
                string json = new JavaScriptSerializer().Serialize(obj);
                File.WriteAllText(Path.Combine(inboxDir, id + ".json"), json, new System.Text.UTF8Encoding(false));
            }
            catch { AppendChat("艾莉丝", "（这条没发出去，通道好像断了。）", Color.FromArgb(0, 105, 110)); }
        }

        void BuildTray()
        {
            tray = new NotifyIcon();
            try { tray.Icon = new Icon(Path.Combine(BaseDir, "assets", "avatar.ico")); } catch { tray.Icon = SystemIcons.Application; }
            tray.Text = "艾莉丝 · 在岗";
            tray.Visible = true;
            var menu = new ContextMenuStrip();
            menu.Items.Add("和艾莉丝说话", null, (s, e) => { if (!chat.Visible) ToggleChat(); });
            menu.Items.Add("隐藏桌宠", null, (s, e) => Hide());
            menu.Items.Add("打开商店预览", null, (s, e) => { try { System.Diagnostics.Process.Start("http://127.0.0.1:8080/apparel/"); } catch { } });
            menu.Items.Add("退出桌宠", null, (s, e) => { tray.Visible = false; Application.Exit(); });
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += (s, e) => { if (!chat.Visible) ToggleChat(); };

            var petMenu = new ContextMenuStrip();
            petMenu.Items.Add("和艾莉丝说话", null, (s, e) => { if (!chat.Visible) ToggleChat(); });
            petMenu.Items.Add("睡一会儿", null, (s, e) => { sleeping = true; Render(true); });
            petMenu.Items.Add("回到原位", null, (s, e) => { mode = "idle"; Top = groundY; Left = wa.Right - Width - 30; Render(true); });
            petMenu.Items.Add("隐藏桌宠", null, (s, e) => Hide());
            ContextMenuStrip = petMenu;
        }

        void StatusTick(object sender, EventArgs e)
        {
            // presence: the one Alice's live state, mirrored to this body
            try
            {
                if (File.Exists(presencePath))
                {
                    var p = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(presencePath, System.Text.Encoding.UTF8));
                    DateTime ts;
                    if (p.ContainsKey("ts") && DateTime.TryParse(Convert.ToString(p["ts"]), out ts) && (DateTime.UtcNow - ts.ToUniversalTime()).TotalMinutes < 12)
                    {
                        presenceWorking = Convert.ToString(p["state"]) == "working";
                        presenceNote = p.ContainsKey("note") ? Convert.ToString(p["note"]) : "";
                    }
                    else { presenceWorking = false; presenceNote = ""; }
                }
            }
            catch { }
            try
            {
                if (File.Exists(statusPath))
                {
                    var st = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(statusPath, System.Text.Encoding.UTF8));
                    DateTime hb;
                    bool alive = st.ContainsKey("heartbeat") && DateTime.TryParse(Convert.ToString(st["heartbeat"]), out hb) && (DateTime.UtcNow - hb.ToUniversalTime()).TotalSeconds < 25;
                    var jobs = st.ContainsKey("jobs") ? st["jobs"] as System.Collections.ArrayList : null;
                    busy = jobs != null && jobs.Count > 0;
                    if (st.ContainsKey("events"))
                    {
                        var evs = st["events"] as System.Collections.ArrayList;
                        if (evs != null)
                        {
                            foreach (var item in evs)
                            {
                                var ev = item as Dictionary<string, object>;
                                if (ev == null || !ev.ContainsKey("seq")) continue;
                                int seq = Convert.ToInt32(ev["seq"]);
                                string msg = ev.ContainsKey("msg") ? Convert.ToString(ev["msg"]) : "";
                                if (seq > lastSeq && msg.StartsWith("任务完成"))
                                {
                                    if (mode == "idle" || mode == "walk") { mode = "air"; vy = -560; vx = 0; ShowBubble("搞定了。"); }
                                    else pendingCelebrate = true;
                                }
                                if (seq > lastSeq) lastSeq = seq;
                            }
                        }
                    }
                    Color want = !alive ? Color.Gray : ((busy || presenceWorking) ? Color.FromArgb(240, 150, 30) : Color.FromArgb(60, 190, 90));
                    if (want != dotColor) { dotColor = want; Render(true); }
                    string state = !alive ? "管家离线" : ((busy || presenceWorking) ? "忙碌中" : "在岗");
                    string note = presenceNote.Length > 0 ? presenceNote : state;
                    tray.Text = "艾莉丝 · " + note;
                    if (subLbl != null) subLbl.Text = "电脑分身 · " + note;
                }
            }
            catch { }
            PollOutbox();
        }

        void PollOutbox()
        {
            try
            {
                if (!Directory.Exists(outboxDir)) return;
                string seenDir = Path.Combine(outboxDir, "seen");
                Directory.CreateDirectory(seenDir);
                foreach (string f in Directory.GetFiles(outboxDir, "reply-*.json"))
                {
                    var o = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(f, System.Text.Encoding.UTF8));
                    string text = o.ContainsKey("text") ? Convert.ToString(o["text"]) : "";
                    if (text.Length > 0)
                    {
                        AppendChat("艾莉丝", text, Color.FromArgb(0, 105, 110));
                        lastInteract = DateTime.Now;
                        WakeUp();
                        if (!chat.Visible) ShowBubble("回你了。");
                    }
                    File.Move(f, Path.Combine(seenDir, Path.GetFileName(f)));
                }
            }
            catch { }
        }
    }
}
