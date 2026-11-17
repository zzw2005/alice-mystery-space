
        void BuildBubble()
        {
            bubble = new Form();
            bubble.FormBorderStyle = FormBorderStyle.None;
            bubble.ShowInTaskbar = false;
            bubble.TopMost = true;
            bubble.BackColor = Color.White;
            bubble.Width = 250; bubble.Height = 66;
            bubble.Region = RoundedRegion(bubble.Width, bubble.Height, 24);
            bubbleLbl = new Label();
            bubbleLbl.Dock = DockStyle.Fill;
            bubbleLbl.TextAlign = ContentAlignment.MiddleCenter;
            bubbleLbl.Font = new Font("Microsoft YaHei UI", 10);
            bubbleLbl.ForeColor = Color.FromArgb(40, 40, 40);
            bubbleLbl.Padding = new Padding(10, 4, 10, 4);
            bubble.Controls.Add(bubbleLbl);
            bubbleTimer = new System.Windows.Forms.Timer();
            bubbleTimer.Interval = 4200;
            bubbleTimer.Tick += (s, e) => { bubble.Hide(); bubbleTimer.Stop(); };
        }

        void PlaceBubble()
        {
            int bx = Left + (Width - bubble.Width) / 2;
            if (bx < wa.Left) bx = wa.Left + 4;
            if (bx + bubble.Width > wa.Right) bx = wa.Right - bubble.Width - 4;
            int by = Top - bubble.Height - 10;
            if (by < wa.Top) by = Top + 10;
            bubble.Location = new Point(bx, by);
        }

        void ShowBubble(string text)
        {
            bubbleLbl.Text = text;
            PlaceBubble();
            bubble.Show();
            bubbleTimer.Stop(); bubbleTimer.Start();
        }

        void BuildChat()
        {
            chat = new Form();
            chat.FormBorderStyle = FormBorderStyle.None;
            chat.ShowInTaskbar = false;
            chat.TopMost = true;
            chat.BackColor = Color.White;
            chat.Width = 336; chat.Height = 440;
            chat.Region = RoundedRegion(chat.Width, chat.Height, 24);

            Label title = new Label();
            title.Text = "和艾莉丝说话";
            title.Font = new Font("Microsoft YaHei UI", 11, FontStyle.Bold);
            title.ForeColor = Color.FromArgb(45, 45, 45);
            title.Location = new Point(14, 10);
            title.AutoSize = true;
            chat.Controls.Add(title);

            Label close = new Label();
            close.Text = "✕";
            close.Font = new Font("Microsoft YaHei UI", 11);
            close.ForeColor = Color.FromArgb(140, 140, 140);
            close.Location = new Point(306, 8);
            close.AutoSize = true;
            close.Click += (s, e) => chat.Hide();
            chat.Controls.Add(close);

            rtb = new RichTextBox();
            rtb.Location = new Point(10, 40);
            rtb.Size = new Size(316, 336);
            rtb.ReadOnly = true;
            rtb.BorderStyle = BorderStyle.None;
            rtb.BackColor = Color.FromArgb(250, 250, 248);
            rtb.Font = new Font("Microsoft YaHei UI", 10);
            rtb.DetectUrls = false;
            chat.Controls.Add(rtb);

            inputBox = new TextBox();
            inputBox.Location = new Point(10, 388);
            inputBox.Size = new Size(252, 30);
            inputBox.Font = new Font("Microsoft YaHei UI", 10.5f);
            inputBox.KeyDown += (s, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; SendChat(); } };
            chat.Controls.Add(inputBox);

            Button send = new Button();
            send.Text = "发送";
            send.Location = new Point(270, 386);
            send.Size = new Size(56, 34);
            send.Font = new Font("Microsoft YaHei UI", 10);
            send.FlatStyle = FlatStyle.Flat;
            send.BackColor = Color.FromArgb(0, 105, 110);
            send.ForeColor = Color.White;
            send.Click += (s, e) => SendChat();
            chat.Controls.Add(send);
        }

        void AppendChat(string who, string text, Color color)
        {
            rtb.SelectionStart = rtb.TextLength;
            rtb.SelectionColor = color;
            rtb.SelectionFont = new Font("Microsoft YaHei UI", 10, FontStyle.Bold);
            rtb.AppendText(who + "\r\n");
            rtb.SelectionColor = Color.FromArgb(35, 35, 35);
            rtb.SelectionFont = new Font("Microsoft YaHei UI", 10);
            rtb.AppendText(text + "\r\n\r\n");
            rtb.SelectionStart = rtb.TextLength;
            rtb.ScrollToCaret();
            if (rtb.TextLength > 60000)
            {
                rtb.Select(0, 20000);
                rtb.SelectedText = "";
            }
        }

        static string JsonEscape(string s)
        {
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n").Replace("\t", "\\t");
        }

        void SendChat()
        {
            string text = inputBox.Text.Trim();
            if (text.Length == 0) return;
            inputBox.Clear();
            WakeUp();
            AppendChat("主人", text, Color.FromArgb(30, 110, 140));
            string id = "m" + DateTime.Now.ToString("yyyyMMddHHmmss") + rnd.Next(9999).ToString();
            string json = "{\"id\":\"" + id + "\",\"ts\":\"" + DateTime.Now.ToString("o") + "\",\"text\":\"" + JsonEscape(text) + "\"}";
            try { File.WriteAllText(Path.Combine(inboxDir, "msg-" + id + ".json"), json, new System.Text.UTF8Encoding(false)); } catch { }
        }

        void ToggleChat()
        {
            if (chat.Visible) { chat.Hide(); return; }
            PlaceChat();
            chat.Show();
            inputBox.Focus();
        }

        void PlaceChat()
        {
            int cx = Left + Width - chat.Width;
            if (cx < wa.Left) cx = wa.Left + 4;
            int cy = Top - chat.Height - 8;
            if (cy < wa.Top) { cy = wa.Top + 4; cx = Left - chat.Width - 8; if (cx < wa.Left) cx = wa.Left + 4; }
            chat.Location = new Point(cx, cy);
        }

        void BuildTray()
        {
            tray = new NotifyIcon();
            tray.Icon = new Icon(Path.Combine(BaseDir, "assets", "avatar.ico"));
            tray.Visible = true;
            tray.Text = "Alice";
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("和艾莉丝说话").Click += (s, e) => ToggleChat();
            menu.Items.Add("显示 / 隐藏").Click += (s, e) => { if (Visible) Hide(); else Show(); };
            menu.Items.Add("打开商店预览").Click += (s, e) => { try { System.Diagnostics.Process.Start("http://127.0.0.1:8080/apparel/"); } catch { } };
            menu.Items.Add("退出桌宠").Click += (s, e) => { tray.Visible = false; Application.Exit(); };
            tray.ContextMenuStrip = menu;
            pic.ContextMenuStrip = menu;
            tray.DoubleClick += (s, e) => { if (Visible) Hide(); else Show(); };
        }
