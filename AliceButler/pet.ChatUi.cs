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
            if (!Visible) return; // no orphan bubbles while the pet herself is hidden
            bubbleLbl.Text = text;
            int x = Left + Width / 2 - bubble.Width / 2;
            x = Math.Max(wa.Left, Math.Min(wa.Right - bubble.Width, x));
            bubble.Location = new Point(x, Math.Max(wa.Top, Top - bubble.Height - 8));
            bubble.Show();
            bubbleTimer.Stop(); bubbleTimer.Start();
        }

        static GraphicsPath RoundedRect(Rectangle r, int radius)
        {
            var p = new GraphicsPath();
            int d = radius * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        // rounded rect with one small "tail" corner: bottom-right for mine, bottom-left for hers
        static GraphicsPath RoundedRectTail(Rectangle r, int radius, int tail, bool mine)
        {
            var p = new GraphicsPath();
            int d = radius * 2, t = tail * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            if (mine) p.AddArc(r.Right - t, r.Bottom - t, t, t, 0, 90);
            else p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            if (mine) p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            else p.AddArc(r.X, r.Bottom - t, t, t, 90, 90);
            p.CloseFigure();
            return p;
        }

        static double EaseOutCubic(double t)
        {
            if (t < 0) t = 0; if (t > 1) t = 1;
            return 1 - Math.Pow(1 - t, 3);
        }

        // strong ease-out, cubic-bezier(0.23, 1, 0.32, 1): snappier than the built-in curves
        static double EaseOutStrong(double t)
        {
            if (t < 0) t = 0; if (t > 1) t = 1;
            double x1 = 0.23, y1 = 1.0, x2 = 0.32, y2 = 1.0;
            double lo = 0, hi = 1, u = t;
            for (int i = 0; i < 24; i++)
            {
                u = (lo + hi) / 2;
                double v = 1 - u;
                double x = 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u;
                if (x < t) lo = u; else hi = u;
            }
            double w = 1 - u;
            return 3 * w * w * u * y1 + 3 * w * u * u * y2 + u * u * u;
        }

        [DllImport("user32.dll")]
        static extern bool SystemParametersInfo(uint action, uint param, ref bool value, uint winIni);
        static bool cachedMotionOk = true; static bool motionChecked = false;
        // honour the Windows "show animations" preference: reduced motion keeps fades, drops movement
        static bool MotionOk()
        {
            if (motionChecked) return cachedMotionOk;
            motionChecked = true;
            try
            {
                bool enabled = true;
                if (SystemParametersInfo(0x1042, 0, ref enabled, 0)) cachedMotionOk = enabled;
            }
            catch { }
            return cachedMotionOk;
        }

        void BuildChat()
        {
            chat = new ChatWindow();
            chat.Text = "和艾莉丝说话";
            chat.FormBorderStyle = FormBorderStyle.None;
            chat.ShowInTaskbar = false;
            chat.TopMost = true;
            chat.Size = new Size(Z(372), Z(500));
            chat.StartPosition = FormStartPosition.Manual;
            chat.BackColor = Color.FromArgb(255, 251, 245);
            chat.Region = new Region(RoundedRect(new Rectangle(0, 0, chat.Width, chat.Height), Z(16)));
            chat.Paint += (s, e) =>
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                using (var pen = new Pen(Color.FromArgb(226, 218, 240), 1.5f * UiS()))
                    e.Graphics.DrawPath(pen, RoundedRect(new Rectangle(0, 0, chat.Width - 1, chat.Height - 1), Z(16)));
            };

            // header: gradient band, avatar, name + status line drawn in Paint (labels clip at this render scale), close button; drags the window
            headerPanel = new Panel();
            headerPanel.Location = new Point(0, 0);
            headerPanel.Size = new Size(Z(372), Z(64));
            headerPanel.BackColor = Color.FromArgb(246, 240, 255);
            headerPanel.Paint += (s, e) =>
            {
                var g = e.Graphics;
                using (var br = new System.Drawing.Drawing2D.LinearGradientBrush(new Rectangle(0, 0, headerPanel.Width, headerPanel.Height), Color.FromArgb(255, 252, 246), Color.FromArgb(243, 238, 252), 90f))
                    g.FillRectangle(br, 0, 0, headerPanel.Width, headerPanel.Height);
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
                using (var tf = new Font("Microsoft YaHei UI", 12.5f, FontStyle.Bold))
                using (var tb = new SolidBrush(Color.FromArgb(52, 44, 84)))
                    g.DrawString("艾莉丝", tf, tb, Z(67), Z(7));
                using (var db = new SolidBrush(chatDotColor)) g.FillEllipse(db, Z(70), Z(45), Z(8), Z(8));
                using (var sf = new Font("Microsoft YaHei UI", 8.5f))
                using (var sb = new SolidBrush(Color.FromArgb(133, 124, 165)))
                    g.DrawString(subText, sf, sb, Z(83), Z(40));
            };
            chat.Controls.Add(headerPanel);
            var avatar = new Panel();
            avatar.Location = new Point(Z(14), Z(10));
            avatar.Size = new Size(Z(44), Z(44));
            avatar.BackColor = Color.Transparent;
            avatar.Paint += (s, e) =>
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                using (var path = new GraphicsPath()) { path.AddEllipse(0, 0, avatar.Width - 1, avatar.Height - 1); e.Graphics.SetClip(path); }
                try { e.Graphics.DrawImage(frames["base"], new Rectangle(0, 0, avatar.Width, avatar.Height), new Rectangle(80, 30, 360, 360), GraphicsUnit.Pixel); } catch { }
                e.Graphics.ResetClip();
                using (var pen = new Pen(Color.FromArgb(239, 91, 91), 2f * UiS())) e.Graphics.DrawEllipse(pen, 1, 1, avatar.Width - 3, avatar.Height - 3);
            };
            headerPanel.Controls.Add(avatar);
            var closeBtn = new Label();
            closeBtn.Text = "✕";
            closeBtn.Font = new Font("Microsoft YaHei UI", 11);
            closeBtn.ForeColor = Color.FromArgb(133, 124, 165);
            closeBtn.AutoSize = true;
            closeBtn.BackColor = Color.Transparent;
            closeBtn.Location = new Point(Z(338), Z(8));
            closeBtn.Cursor = Cursors.Hand;
            closeBtn.Click += (s, e) => CloseChat();
            closeBtn.MouseEnter += (s, e) => closeBtn.ForeColor = Color.FromArgb(239, 91, 91);
            closeBtn.MouseLeave += (s, e) => closeBtn.ForeColor = Color.FromArgb(133, 124, 165);
            headerPanel.Controls.Add(closeBtn);
            Point dragStart = Point.Empty;
            headerPanel.MouseDown += (s, e) => { dragStart = e.Location; };
            headerPanel.MouseMove += (s, e) => { if (e.Button == MouseButtons.Left) chat.Location = new Point(chat.Left + e.X - dragStart.X, chat.Top + e.Y - dragStart.Y); };

            // message stream: custom smooth scrolling (no native scrollbar)
            msgFlow = new Panel();
            msgFlow.Location = new Point(0, Z(64));
            msgFlow.Size = new Size(Z(372), Z(372));
            msgFlow.BackColor = Color.FromArgb(255, 251, 245);
            msgFlow.AutoScroll = false;
            chat.Controls.Add(msgFlow);
            msgTable = new TableLayoutPanel();
            msgTable.ColumnCount = 1;
            msgTable.Location = new Point(0, 0);
            msgTable.Width = Z(356);
            msgTable.AutoSize = true;
            msgTable.BackColor = Color.Transparent;
            msgTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            msgFlow.Controls.Add(msgTable);
            msgFlow.MouseWheel += ChatWheel;
            msgTable.MouseWheel += ChatWheel;
            msgFlow.MouseEnter += (s, e) => { thumbHot = true; };
            msgFlow.MouseLeave += (s, e) => { thumbHot = false; };

            // slim custom scrollbar thumb, floats over the stream's right edge
            scrollThumb = new Panel();
            scrollThumb.Size = new Size(Z(6), Z(60));
            scrollThumb.Location = new Point(Z(362), Z(70));
            scrollThumb.BackColor = Color.FromArgb(199, 186, 235);
            scrollThumb.Region = new Region(RoundedRect(new Rectangle(0, 0, Z(6), Z(60)), Z(3)));
            scrollThumb.Visible = false;
            scrollThumb.Cursor = Cursors.Hand;
            scrollThumb.MouseDown += (s, e) => { thumbDrag = true; ThumbDragTo(e); };
            scrollThumb.MouseMove += (s, e) => { if (thumbDrag) ThumbDragTo(e); };
            scrollThumb.MouseUp += (s, e) => { thumbDrag = false; };
            scrollThumb.MouseWheel += ChatWheel;
            chat.Controls.Add(scrollThumb);
            scrollThumb.BringToFront();

            // empty state: her portrait + a gentle prompt, hidden by the first message
            emptyState = new Panel();
            emptyState.Location = new Point(0, Z(64));
            emptyState.Size = new Size(Z(372), Z(372));
            emptyState.BackColor = Color.FromArgb(255, 251, 245);
            emptyState.Paint += (s, e) =>
            {
                var g = e.Graphics;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                using (var path = new GraphicsPath()) { path.AddEllipse(Z(154), Z(96), Z(63), Z(63)); g.SetClip(path); }
                try { g.DrawImage(frames["base"], new Rectangle(Z(154), Z(96), Z(64), Z(64)), new Rectangle(80, 30, 360, 360), GraphicsUnit.Pixel); } catch { }
                g.ResetClip();
                using (var pen = new Pen(Color.FromArgb(239, 91, 91), 2f * UiS())) g.DrawEllipse(pen, Z(155), Z(97), Z(61), Z(61));
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
                var fmt = new StringFormat { Alignment = StringAlignment.Center };
                using (var f = new Font("Microsoft YaHei UI", 10.5f))
                using (var b = new SolidBrush(Color.FromArgb(90, 80, 120)))
                    g.DrawString("和艾莉丝说点什么吧", f, b, new RectangleF(0, Z(178), emptyState.Width, Z(26)), fmt);
                using (var f2 = new Font("Microsoft YaHei UI", 9f))
                using (var b2 = new SolidBrush(Color.FromArgb(150, 140, 175)))
                    g.DrawString("她看到就回", f2, b2, new RectangleF(0, Z(204), emptyState.Width, Z(22)), fmt);
            };
            chat.Controls.Add(emptyState);
            emptyState.BringToFront();

            // typing indicator: her bubble with three bouncing dots while a reply is pending
            typingBubble = new Panel();
            typingBubble.Size = new Size(Z(58), Z(34));
            typingBubble.Location = new Point(Z(10), Z(406));
            typingBubble.BackColor = Color.Transparent;
            typingBubble.Visible = false;
            typingBubble.Region = new Region(RoundedRectTail(new Rectangle(0, 0, Z(58), Z(34)), Z(14), Z(5), false));
            typingBubble.Paint += (s, e) =>
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                var rect = new Rectangle(0, 0, typingBubble.Width, typingBubble.Height);
                var path = RoundedRectTail(rect, Z(14), Z(5), false);
                using (var br = new SolidBrush(Color.White)) e.Graphics.FillPath(br, path);
                using (var pen = new Pen(Color.FromArgb(226, 218, 240), 1.2f * UiS())) e.Graphics.DrawPath(pen, path);
            };
            for (int i = 0; i < 3; i++)
            {
                var dot = new Panel();
                dot.Size = new Size(Z(7), Z(7));
                dot.Location = new Point(Z(14) + i * Z(12), Z(14));
                dot.BackColor = Color.Transparent;
                dot.Paint += (s, e) =>
                {
                    e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    using (var br = new SolidBrush(Color.FromArgb(160, 148, 195))) e.Graphics.FillEllipse(br, 0, 0, dot.Width - 1, dot.Height - 1);
                };
                typingDots[i] = dot;
                typingBubble.Controls.Add(dot);
            }
            chat.Controls.Add(typingBubble);
            typingBubble.BringToFront();

            // input row: capsule field + pill send button
            var inputShell = new Panel();
            inputShell.Location = new Point(Z(12), Z(448));
            inputShell.Size = new Size(Z(272), Z(38));
            inputShell.BackColor = Color.White;
            inputShell.Paint += (s, e) =>
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                using (var br = new SolidBrush(Color.White)) e.Graphics.FillPath(br, RoundedRect(new Rectangle(0, 0, inputShell.Width - 1, inputShell.Height - 1), Z(19)));
                Color bc = inputFocused ? Color.FromArgb(239, 91, 91) : Color.FromArgb(226, 218, 240);
                using (var pen = new Pen(bc, (inputFocused ? 1.5f : 1.2f) * UiS())) e.Graphics.DrawPath(pen, RoundedRect(new Rectangle(0, 0, inputShell.Width - 1, inputShell.Height - 1), Z(19)));
            };
            chat.Controls.Add(inputShell);
            inputBox = new TextBox();
            inputBox.BorderStyle = BorderStyle.None;
            inputBox.Location = new Point(Z(12), Z(10));
            inputBox.Size = new Size(Z(248), Z(20));
            inputBox.Font = new Font("Microsoft YaHei UI", 10);
            inputBox.BackColor = Color.White;
            inputShell.Controls.Add(inputBox);
            sendBtn = new Button();
            sendBtn.Text = "发送";
            sendBtn.FlatStyle = FlatStyle.Flat;
            sendBtn.FlatAppearance.BorderSize = 0;
            sendBtn.BackColor = Color.FromArgb(216, 208, 235);
            sendBtn.ForeColor = Color.White;
            sendBtn.Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Bold);
            sendBtn.Location = new Point(Z(292), Z(448));
            sendBtn.Size = new Size(Z(66), Z(38));
            sendBtn.Region = new Region(RoundedRect(new Rectangle(0, 0, Z(66), Z(38)), Z(19)));
            sendBtn.Click += (s, e) => SendChat();
            sendBtn.MouseEnter += (s, e) => { if (inputBox.Text.Trim().Length > 0) sendBtn.BackColor = Color.FromArgb(227, 70, 70); };
            sendBtn.MouseLeave += (s, e) => { sendBtn.Bounds = sendBtnHome; sendBtn.Region = new Region(RoundedRect(new Rectangle(0, 0, sendBtnHome.Width, sendBtnHome.Height), Z(19))); RefreshSendBtn(); };
            sendBtn.MouseDown += (s, e) =>
            {
                if (inputBox.Text.Trim().Length > 0) sendBtn.BackColor = Color.FromArgb(205, 55, 55);
                // press feedback: settle to 0.96 like a real button being pressed
                sendBtn.Bounds = new Rectangle(sendBtnHome.X + Z(1), sendBtnHome.Y + Z(1), sendBtnHome.Width - Z(3), sendBtnHome.Height - Z(2));
                sendBtn.Region = new Region(RoundedRect(new Rectangle(0, 0, sendBtn.Width, sendBtn.Height), Z(18)));
            };
            sendBtn.MouseUp += (s, e) => { sendBtn.Bounds = sendBtnHome; sendBtn.Region = new Region(RoundedRect(new Rectangle(0, 0, sendBtnHome.Width, sendBtnHome.Height), Z(19))); RefreshSendBtn(); };
            chat.Controls.Add(sendBtn);
            sendBtnHome = sendBtn.Bounds;
            inputBox.TextChanged += (s, e) => { RefreshSendBtn(); lastInteract = DateTime.Now; }; // typing counts as interaction: she won't fall asleep mid-thought
            inputBox.GotFocus += (s, e) => { inputFocused = true; inputShell.Invalidate(); };
            inputBox.LostFocus += (s, e) => { inputFocused = false; inputShell.Invalidate(); };
            inputBox.KeyDown += (s, e) => { if (e.KeyCode == Keys.Enter) { SendChat(); e.SuppressKeyPress = true; } };
            chat.FormClosing += (s, e) => { e.Cancel = true; CloseChat(); };
            chat.KeyPreview = true;
            chat.KeyDown += (s, e) => { if (e.KeyCode == Keys.Escape) { CloseChat(); e.SuppressKeyPress = true; } };
            animTimer = new System.Windows.Forms.Timer(); animTimer.Interval = 16;
            animTimer.Tick += AnimTick;
            // not started here: OpenChat starts it, the close animation stops it — no 16ms idle spin
        }

        void ShowTyping()
        {
            pendingReplies++;
            typingActive = true; typingSince = DateTime.Now;
            if (typingBubble != null) typingBubble.Visible = true;
        }

        void HideTyping()
        {
            pendingReplies = 0;
            typingActive = false;
            if (typingBubble != null) typingBubble.Visible = false;
        }

        void ReplyArrived()
        {
            // one reply can answer a whole batch of sent messages, so any
            // arrival settles the wait; counting down per message left the
            // indicator stuck until the timeout whenever several were sent
            pendingReplies = 0;
            typingActive = false;
            if (typingBubble != null) typingBubble.Visible = false;
        }

        void RefreshSendBtn()
        {
            if (sendBtn == null || inputBox == null) return;
            sendBtn.BackColor = inputBox.Text.Trim().Length > 0 ? Color.FromArgb(239, 91, 91) : Color.FromArgb(216, 208, 235);
        }

        int MaxScroll()
        {
            return Math.Max(0, msgTable.Height - msgFlow.Height);
        }

        void ScrollToBottom()
        {
            scrollTarget = MaxScroll();
            thumbShowUntil = DateTime.Now.AddMilliseconds(900);
        }

        void ChatWheel(object sender, MouseEventArgs e)
        {
            scrollTarget = Math.Max(0, Math.Min(MaxScroll(), scrollTarget - Math.Sign(e.Delta) * Z(52)));
            thumbShowUntil = DateTime.Now.AddMilliseconds(900);
        }

        void HookWheel(Control c)
        {
            c.MouseWheel += ChatWheel;
            foreach (Control ch in c.Controls) HookWheel(ch);
        }

        void ThumbDragTo(MouseEventArgs e)
        {
            int trackTop = Z(70), trackH = Z(360);
            double frac = (double)(scrollThumb.Top + e.Y - trackTop) / Math.Max(1, trackH - scrollThumb.Height);
            frac = Math.Max(0, Math.Min(1, frac));
            scrollTarget = frac * MaxScroll();
            scrollCur = scrollTarget;
            thumbShowUntil = DateTime.Now.AddMilliseconds(900);
        }

        void UpdateThumb()
        {
            int max = MaxScroll();
            bool show = max > 0 && (thumbDrag || thumbHot || DateTime.Now < thumbShowUntil);
            scrollThumb.Visible = show;
            if (!show) return;
            int trackTop = Z(70), trackH = Z(360);
            int th = Math.Max(Z(36), (int)((double)msgFlow.Height / Math.Max(1, msgTable.Height) * trackH));
            th = Math.Min(trackH, th);
            if (scrollThumb.Height != th)
            {
                scrollThumb.Size = new Size(Z(6), th);
                scrollThumb.Region = new Region(RoundedRect(new Rectangle(0, 0, Z(6), th), Z(3)));
            }
            int ty = trackTop + (int)((trackH - th) * (max == 0 ? 0 : scrollCur / max));
            scrollThumb.Location = new Point(msgFlow.Width - Z(10), ty);
        }

        void AddBubble(string text, bool mine)
        {
            if (emptyState != null && emptyState.Visible) emptyState.Visible = false;
            // follow the tail only if he's already there (or it's his own message);
            // a reply must not yank him away from history he's scrolled up to read
            bool follow = mine || scrollTarget >= MaxScroll() - Z(60);
            var row = new Panel();
            row.BackColor = Color.Transparent;
            row.Margin = new Padding(0);
            row.Padding = new Padding(Z(10), Z(3), Z(10), Z(3));
            var lbl = new Label();
            lbl.Text = text;
            lbl.Font = new Font("Microsoft YaHei UI", 9.8f);
            lbl.ForeColor = mine ? Color.White : Color.FromArgb(52, 48, 66);
            lbl.AutoSize = true;
            lbl.MaximumSize = new Size(Z(238), 0);
            lbl.BackColor = Color.Transparent;
            row.Width = Z(356);
            var bubble = new Panel();
            bubble.BackColor = Color.Transparent;
            bubble.Padding = new Padding(Z(12), Z(8), Z(12), Z(8));
            bubble.Controls.Add(lbl);
            lbl.Location = new Point(Z(12), Z(8));
            bubble.Size = new Size(lbl.PreferredWidth + Z(24), lbl.PreferredHeight + Z(16));
            bubble.Region = new Region(RoundedRectTail(new Rectangle(0, 0, bubble.Width, bubble.Height), Z(14), Z(5), mine));
            bubble.Paint += (s, e) =>
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                var rect = new Rectangle(0, 0, bubble.Width, bubble.Height);
                var path = RoundedRectTail(rect, Z(14), Z(5), mine);
                if (mine)
                {
                    using (var br = new System.Drawing.Drawing2D.LinearGradientBrush(rect, Color.FromArgb(242, 96, 94), Color.FromArgb(225, 75, 75), 45f))
                        e.Graphics.FillPath(br, path);
                }
                else
                {
                    using (var br = new SolidBrush(Color.White)) e.Graphics.FillPath(br, path);
                    using (var pen = new Pen(Color.FromArgb(226, 218, 240), 1.2f * UiS())) e.Graphics.DrawPath(pen, path);
                }
            };
            int finalY = Z(3);
            bubble.Location = new Point(mine ? row.Width - bubble.Width - Z(10) : Z(10), finalY + (MotionOk() ? Z(10) : 0));
            bubble.Anchor = mine ? AnchorStyles.Top | AnchorStyles.Right : AnchorStyles.Top | AnchorStyles.Left;
            row.Controls.Add(bubble);
            row.Height = bubble.Height + Z(6);
            int ri = msgTable.RowCount++;
            msgTable.RowStyles.Add(new RowStyle(SizeType.Absolute, row.Height));
            msgTable.Controls.Add(row, 0, ri);
            HookWheel(row);
            if (MotionOk()) bubbleAnims.Add(new BubbleAnim { Bubble = bubble, FinalY = finalY, T0 = DateTime.Now });
            msgTable.PerformLayout();
            if (scrollCur < 0) scrollCur = MaxScroll();
            if (follow) ScrollToBottom(); else thumbShowUntil = DateTime.Now.AddMilliseconds(900);
            TrimBubbleRows();
        }

        // the message list only ever grew: cap it so a long session can't pile up
        // thousands of controls (layout is O(n) per add, handles are finite)
        void TrimBubbleRows()
        {
            while (msgTable.RowCount > 200)
            {
                Control victim = null;
                foreach (Control c in msgTable.Controls) if (msgTable.GetRow(c) == 0) { victim = c; break; }
                if (victim == null) break;
                msgTable.Controls.Remove(victim);
                victim.Dispose();
                foreach (Control c in msgTable.Controls) msgTable.SetRow(c, msgTable.GetRow(c) - 1);
                if (msgTable.RowStyles.Count > 0) msgTable.RowStyles.RemoveAt(0);
                msgTable.RowCount--;
            }
        }

        // system note (send failure, reply timeout): centred grey text, never in her voice
        void AppendSystemLine(string text)
        {
            if (emptyState != null && emptyState.Visible) emptyState.Visible = false;
            var row = new Panel();
            row.BackColor = Color.Transparent;
            row.Margin = new Padding(0);
            row.Width = Z(356);
            var lbl = new Label();
            lbl.Text = text;
            lbl.Font = new Font("Microsoft YaHei UI", 8.5f);
            lbl.ForeColor = Color.FromArgb(150, 140, 175);
            lbl.AutoSize = false;
            lbl.TextAlign = ContentAlignment.MiddleCenter;
            lbl.Location = new Point(0, Z(2));
            lbl.Size = new Size(Z(356), Z(18));
            row.Controls.Add(lbl);
            row.Height = Z(22);
            int ri = msgTable.RowCount++;
            msgTable.RowStyles.Add(new RowStyle(SizeType.Absolute, row.Height));
            msgTable.Controls.Add(row, 0, ri);
            HookWheel(row);
            msgTable.PerformLayout();
            TrimBubbleRows();
        }

        void AnimTick(object sender, EventArgs e)
        {
            if (chatAnimDir != 0 && chat != null)
            {
                double dur = chatAnimDir > 0 ? 200 : 140;
                double p = (DateTime.Now - chatAnimT0).TotalMilliseconds / dur;
                if (p >= 1)
                {
                    if (chatAnimDir > 0) { chat.Opacity = 1; chat.Top = chatTargetTop; }
                    else { chat.Hide(); chat.Opacity = 1; if (animTimer != null) animTimer.Stop(); }
                    chatAnimDir = 0;
                }
                else
                {
                    if (chatAnimDir > 0)
                    {
                        double ez = EaseOutStrong(p);
                        chat.Opacity = chatAnimFromOp + (1 - chatAnimFromOp) * ez;
                        chat.Top = MotionOk() ? chatAnimFromTop + (int)((chatTargetTop - chatAnimFromTop) * ez) : chatTargetTop;
                    }
                    else
                    {
                        double ez = EaseOutCubic(p);
                        chat.Opacity = chatAnimFromOp * (1 - ez);
                        chat.Top = MotionOk() ? chatAnimFromTop + (int)(ez * Z(8)) : chatAnimFromTop;
                    }
                }
            }
            if (msgFlow != null && msgTable != null && chat != null && chat.Visible)
            {
                if (scrollCur < 0) scrollCur = scrollTarget;
                if (!MotionOk()) scrollCur = scrollTarget;
                double d = scrollTarget - scrollCur;
                if (Math.Abs(d) > 0.4)
                {
                    scrollCur += d * 0.30;
                    msgTable.Location = new Point(0, -(int)Math.Round(scrollCur));
                }
                else if ((int)Math.Round(scrollCur) != -msgTable.Location.Y)
                {
                    scrollCur = scrollTarget;
                    msgTable.Location = new Point(0, -(int)Math.Round(scrollCur));
                }
                UpdateThumb();
            }
            if (bubbleAnims.Count > 0)
            {
                var now = DateTime.Now;
                for (int i = bubbleAnims.Count - 1; i >= 0; i--)
                {
                    var a = bubbleAnims[i];
                    double p = (now - a.T0).TotalMilliseconds / 180;
                    if (p >= 1)
                    {
                        if (a.Bubble != null) a.Bubble.Top = a.FinalY;
                        bubbleAnims.RemoveAt(i);
                        continue;
                    }
                    if (a.Bubble != null) a.Bubble.Top = a.FinalY + (int)((1 - EaseOutStrong(p)) * Z(10));
                }
            }
            if (typingActive)
            {
                if ((DateTime.Now - typingSince).TotalSeconds > 60) { HideTyping(); AppendSystemLine("还没等到回复，可能通道慢了。"); }
                else if (typingBubble != null && typingBubble.Visible && MotionOk())
                {
                    double phase = (DateTime.Now - typingSince).TotalMilliseconds;
                    for (int i = 0; i < 3; i++)
                    {
                        if (typingDots[i] == null) continue;
                        double s = Math.Abs(Math.Sin(phase / 300.0 + i * 0.65));
                        typingDots[i].Top = Z(14) - (int)(s * Z(4));
                    }
                }
            }
        }

        void OpenChat()
        {
            hasUnread = false;
            WakeUp(); // opening the chat always wakes her — no typing next to a sleeping pet
            if (chat.Visible && chatAnimDir < 0)
            {
                // clicked again mid-close: reverse smoothly from the current state
                chatAnimFromTop = chat.Top;
                chatAnimFromOp = chat.Opacity;
                chatAnimDir = 1; chatAnimT0 = DateTime.Now;
                if (animTimer != null && !animTimer.Enabled) animTimer.Start();
                chat.Activate();
                inputBox.Focus();
                return;
            }
            int x = Left + Width / 2 - chat.Width / 2;
            x = Math.Max(wa.Left, Math.Min(wa.Right - chat.Width, x));
            int y = Top - chat.Height - Z(10);
            if (y < wa.Top) y = Top + Z(10);
            chatTargetTop = y;
            scrollCur = scrollTarget = MaxScroll();
            msgTable.Location = new Point(0, -(int)Math.Round(scrollCur));
            chatAnimFromTop = MotionOk() ? y + Z(14) : y;
            chatAnimFromOp = 0;
            chat.Location = new Point(x, chatAnimFromTop);
            chat.Opacity = 0;
            chat.Show();
            chat.Activate();
            inputBox.Focus();
            if (animTimer != null && !animTimer.Enabled) animTimer.Start();
            chatAnimDir = 1; chatAnimT0 = DateTime.Now;
        }

        void CloseChat()
        {
            if (chat == null || !chat.Visible || chatAnimDir < 0) return;
            if (animTimer != null && !animTimer.Enabled) animTimer.Start();
            chatAnimFromTop = chat.Top;
            chatAnimFromOp = chat.Opacity;
            chatAnimDir = -1; chatAnimT0 = DateTime.Now;
        }

        void ToggleChat()
        {
            if (chat.Visible && chatAnimDir >= 0) CloseChat(); else OpenChat();
        }

        void AppendChat(string who, string text, Color color)
        {
            AddBubble(text, who == "主人");
        }
    }
}
