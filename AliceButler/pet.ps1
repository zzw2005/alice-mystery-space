# Alice desktop pet v2: butler status, wandering, click reactions, chat window.
$ErrorActionPreference = 'SilentlyContinue'
$mtx = New-Object System.Threading.Mutex($false, 'AlicePetMutex')
if (-not $mtx.WaitOne(0)) { exit 0 }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

function U([int[]]$codes) { -join ($codes | ForEach-Object { [char]$_ }) }
$ZH_ALICE = U @(0x827E, 0x8389, 0x4E1D)
$ZH_MASTER = U @(0x4E3B, 0x4EBA)

$base = 'C:\ProgramData\AliceButler'
$statusPath = Join-Path $base 'status.json'
$inboxDir = Join-Path $base 'inbox'
$outboxDir = Join-Path $base 'outbox'
$imgR = [System.Drawing.Image]::FromFile((Join-Path $base 'assets\pet.png'))
$imgL = [System.Drawing.Image]::FromFile((Join-Path $base 'assets\pet-flip.png'))

$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::Magenta
$form.TransparencyKey = [System.Drawing.Color]::Magenta
$form.StartPosition = 'Manual'
$form.Width = 190
$form.Height = 233
$script:groundY = $wa.Bottom - $form.Height - 2
$form.Location = New-Object System.Drawing.Point(($wa.Right - $form.Width - 30), $script:groundY)

$pic = New-Object System.Windows.Forms.PictureBox
$pic.Dock = 'Fill'
$pic.SizeMode = 'StretchImage'
$pic.BackColor = [System.Drawing.Color]::Magenta
$pic.Image = $imgR
$form.Controls.Add($pic)

$nameLbl = New-Object System.Windows.Forms.Label
$nameLbl.Text = $ZH_ALICE
$nameLbl.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10, [System.Drawing.FontStyle]::Bold)
$nameLbl.ForeColor = [System.Drawing.Color]::FromArgb(60, 60, 60)
$nameLbl.BackColor = [System.Drawing.Color]::Transparent
$nameLbl.AutoSize = $true
$pic.Controls.Add($nameLbl)

$dotLbl = New-Object System.Windows.Forms.Label
$dotLbl.Text = [char]0x25CF
$dotLbl.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 11)
$dotLbl.ForeColor = [System.Drawing.Color]::Gray
$dotLbl.BackColor = [System.Drawing.Color]::Transparent
$dotLbl.AutoSize = $true
$pic.Controls.Add($dotLbl)

function Layout-Labels {
  $nameLbl.Location = New-Object System.Drawing.Point(16, ($pic.Height - 26))
  $dotLbl.Location = New-Object System.Drawing.Point(($pic.Width - 30), ($pic.Height - 27))
}
$form.Add_Shown({ Layout-Labels })

function Rounded-Region([int]$w, [int]$h, [int]$r) {
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $gp.AddArc(0, 0, $r, $r, 180, 90); $gp.AddArc(($w - $r - 1), 0, $r, $r, 270, 90)
  $gp.AddArc(($w - $r - 1), ($h - $r - 1), $r, $r, 0, 90); $gp.AddArc(0, ($h - $r - 1), $r, $r, 90, 90)
  $gp.CloseFigure()
  return New-Object System.Drawing.Region($gp)
}

# ---- speech bubble ----
$bubble = New-Object System.Windows.Forms.Form
$bubble.FormBorderStyle = 'None'
$bubble.ShowInTaskbar = $false
$bubble.TopMost = $true
$bubble.BackColor = [System.Drawing.Color]::White
$bubble.Width = 250
$bubble.Height = 66
$bubble.Region = Rounded-Region $bubble.Width $bubble.Height 24
$blbl = New-Object System.Windows.Forms.Label
$blbl.Dock = 'Fill'
$blbl.TextAlign = 'MiddleCenter'
$blbl.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
$blbl.ForeColor = [System.Drawing.Color]::FromArgb(40, 40, 40)
$blbl.Padding = New-Object System.Windows.Forms.Padding(10, 4, 10, 4)
$bubble.Controls.Add($blbl)

$bubbleTimer = New-Object System.Windows.Forms.Timer
$bubbleTimer.Interval = 4200
$bubbleTimer.Add_Tick({ $bubble.Hide(); $bubbleTimer.Stop() })

function Place-Bubble {
  $bx = $form.Left + ($form.Width - $bubble.Width) / 2
  if ($bx -lt $wa.Left) { $bx = $wa.Left + 4 }
  if ($bx + $bubble.Width -gt $wa.Right) { $bx = $wa.Right - $bubble.Width - 4 }
  $by = $form.Top - $bubble.Height - 10
  if ($by -lt $wa.Top) { $by = $form.Top + 10 }
  $bubble.Location = New-Object System.Drawing.Point([int]$bx, [int]$by)
}
function Show-Bubble([string]$text) {
  $blbl.Text = $text
  Place-Bubble
  $bubble.Show()
  $bubbleTimer.Stop(); $bubbleTimer.Start()
}

# ---- chat window ----
$chat = New-Object System.Windows.Forms.Form
$chat.FormBorderStyle = 'None'
$chat.ShowInTaskbar = $false
$chat.TopMost = $true
$chat.BackColor = [System.Drawing.Color]::White
$chat.Width = 336
$chat.Height = 440
$chat.Region = Rounded-Region $chat.Width $chat.Height 24

$chatTitle = New-Object System.Windows.Forms.Label
$chatTitle.Text = (U @(0x548C)) + $ZH_ALICE + (U @(0x8BF4, 0x8BDD))
$chatTitle.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 11, [System.Drawing.FontStyle]::Bold)
$chatTitle.ForeColor = [System.Drawing.Color]::FromArgb(45, 45, 45)
$chatTitle.Location = New-Object System.Drawing.Point(14, 10)
$chatTitle.AutoSize = $true
$chat.Controls.Add($chatTitle)

$chatClose = New-Object System.Windows.Forms.Label
$chatClose.Text = [char]0x2715
$chatClose.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 11)
$chatClose.ForeColor = [System.Drawing.Color]::FromArgb(140, 140, 140)
$chatClose.Location = New-Object System.Drawing.Point(306, 8)
$chatClose.AutoSize = $true
$chatClose.Add_Click({ $chat.Hide() })
$chat.Controls.Add($chatClose)

$rtb = New-Object System.Windows.Forms.RichTextBox
$rtb.Location = New-Object System.Drawing.Point(10, 40)
$rtb.Size = New-Object System.Drawing.Size(316, 336)
$rtb.ReadOnly = $true
$rtb.BorderStyle = 'None'
$rtb.BackColor = [System.Drawing.Color]::FromArgb(250, 250, 248)
$rtb.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
$rtb.DetectUrls = $false
$chat.Controls.Add($rtb)

$input = New-Object System.Windows.Forms.TextBox
$input.Location = New-Object System.Drawing.Point(10, 388)
$input.Size = New-Object System.Drawing.Size(252, 30)
$input.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10.5)
$chat.Controls.Add($input)

$sendBtn = New-Object System.Windows.Forms.Button
$sendBtn.Text = U @(0x53D1, 0x9001)
$sendBtn.Location = New-Object System.Drawing.Point(270, 386)
$sendBtn.Size = New-Object System.Drawing.Size(56, 34)
$sendBtn.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
$sendBtn.FlatStyle = 'Flat'
$sendBtn.BackColor = [System.Drawing.Color]::FromArgb(0, 105, 110)
$sendBtn.ForeColor = [System.Drawing.Color]::White
$chat.Controls.Add($sendBtn)

function Append-Chat([string]$who, [string]$text, [System.Drawing.Color]$color) {
  $rtb.SelectionStart = $rtb.TextLength
  $rtb.SelectionColor = $color
  $rtb.SelectionFont = New-Object System.Drawing.Font('Microsoft YaHei UI', 10, [System.Drawing.FontStyle]::Bold)
  $rtb.AppendText($who + "`r`n")
  $rtb.SelectionColor = [System.Drawing.Color]::FromArgb(35, 35, 35)
  $rtb.SelectionFont = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
  $rtb.AppendText($text + "`r`n`r`n")
  $rtb.SelectionStart = $rtb.TextLength
  $rtb.ScrollToCaret()
}

function Send-Chat {
  $text = $input.Text.Trim()
  if (-not $text) { return }
  $input.Clear()
  Append-Chat $ZH_MASTER $text ([System.Drawing.Color]::FromArgb(30, 110, 140))
  $id = 'm' + [DateTime]::Now.ToString('yyyyMMddHHmmss') + (Get-Random -Maximum 9999)
  $obj = [ordered]@{ id = $id; ts = [DateTime]::Now.ToString('o'); text = $text }
  $json = $obj | ConvertTo-Json -Compress
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Join-Path $inboxDir ('msg-' + $id + '.json')), $json, $enc)
}
$sendBtn.Add_Click({ Send-Chat })
$input.Add_KeyDown({ if ($_.KeyCode -eq 'Enter') { $_.SuppressKeyPress = $true; Send-Chat } })

function Toggle-Chat {
  if ($chat.Visible) { $chat.Hide(); return }
  $cx = $form.Left + $form.Width - $chat.Width
  if ($cx -lt $wa.Left) { $cx = $wa.Left + 4 }
  $cy = $form.Top - $chat.Height - 8
  if ($cy -lt $wa.Top) { $cy = $wa.Top + 4; $cx = $form.Left - $chat.Width - 8; if ($cx -lt $wa.Left) { $cx = $wa.Left + 4 } }
  $chat.Location = New-Object System.Drawing.Point([int]$cx, [int]$cy)
  $chat.Show()
  $input.Focus()
}

# ---- tray icon ----
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = New-Object System.Drawing.Icon((Join-Path $base 'assets\avatar.ico'))
$tray.Visible = $true
$tray.Text = 'Alice'
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miChat = $menu.Items.Add((U @(0x548C)) + $ZH_ALICE + (U @(0x8BF4, 0x8BDD)))
$miChat.Add_Click({ Toggle-Chat })
$miShow = $menu.Items.Add('Show / Hide')
$miShow.Add_Click({ if ($form.Visible) { $form.Hide() } else { $form.Show() } })
$miPreview = $menu.Items.Add('Open shop preview')
$miPreview.Add_Click({ Start-Process 'http://127.0.0.1:8080/apparel/' })
$miExit = $menu.Items.Add('Exit pet')
$miExit.Add_Click({ $tray.Visible = $false; [System.Windows.Forms.Application]::Exit() })
$tray.ContextMenuStrip = $menu
$pic.ContextMenuStrip = $menu
$tray.Add_DoubleClick({ if ($form.Visible) { $form.Hide() } else { $form.Show() } })

# ---- behaviour ----
$script:mode = 'idle'
$script:dir = 1
$script:vy = 0.0
$script:walkTarget = 0
$script:idleUntil = [DateTime]::Now.AddSeconds(5)
$script:bobPhase = 0.0
$script:dragging = $false
$script:dragMoved = $false
$script:dragStart = $null
$script:downAt = [DateTime]::MinValue
$rnd = New-Object System.Random
$lines = @(
  (U @(0x5728, 0x7684, 0x3002)),
  (U @(0x4EA4, 0x7ED9, 0x6211, 0x5427, 0x3002)),
  (U @(0x55EF, 0xFF0C, 0x6211, 0x5728, 0x3002)),
  (U @(0x6709, 0x4E8B, 0x558A, 0x6211, 0x3002))
)

$pic.Add_MouseDown({
  if ($_.Button -eq 'Left') {
    $script:dragging = $true; $script:dragMoved = $false
    $script:dragStart = New-Object System.Drawing.Point($_.X, $_.Y)
    $script:downAt = [DateTime]::Now
  }
})
$pic.Add_MouseMove({
  if ($script:dragging) {
    $dx = $_.X - $script:dragStart.X; $dy = $_.Y - $script:dragStart.Y
    if ([Math]::Abs($dx) + [Math]::Abs($dy) -gt 4) { $script:dragMoved = $true }
    if ($script:dragMoved) {
      $form.Location = New-Object System.Drawing.Point(($form.Left + $dx), ($form.Top + $dy))
      $script:mode = 'drag'
    }
  }
})
$pic.Add_MouseUp({
  if ($_.Button -eq 'Left' -and $script:dragging) {
    $script:dragging = $false
    if (-not $script:dragMoved -and (([DateTime]::Now - $script:downAt).TotalMilliseconds -lt 350)) {
      $script:vy = -6; if ($script:mode -ne 'air') { $script:mode = 'air' }
      Toggle-Chat
    } elseif ($script:mode -eq 'drag') {
      $script:vy = 0; $script:mode = 'air'
    }
  }
})
$pic.Add_DoubleClick({
  $script:vy = -11; $script:mode = 'air'
  Show-Bubble $lines[$rnd.Next($lines.Count)]
})

$motion = New-Object System.Windows.Forms.Timer
$motion.Interval = 50
$motion.Add_Tick({
  $now = [DateTime]::Now
  if ($script:mode -eq 'air') {
    $script:vy += 1.3
    $nt = $form.Top + [int]$script:vy
    if ($nt -ge $script:groundY) { $form.Top = $script:groundY; $script:vy = 0; $script:mode = 'idle'; $script:idleUntil = $now.AddSeconds($rnd.Next(6, 14)) }
    else { $form.Top = $nt }
  } elseif ($script:mode -eq 'walk') {
    $step = 2 * $script:dir
    $nx = $form.Left + $step
    if (($script:dir -gt 0 -and $nx -ge $script:walkTarget) -or ($script:dir -lt 0 -and $nx -le $script:walkTarget)) {
      $form.Left = $script:walkTarget; $script:mode = 'idle'; $script:idleUntil = $now.AddSeconds($rnd.Next(7, 16))
    } else { $form.Left = $nx }
    $script:bobPhase += 0.35
    $form.Top = $script:groundY + [int]([Math]::Sin($script:bobPhase) * 1.5)
  } elseif ($script:mode -eq 'idle') {
    $script:bobPhase += 0.06
    $form.Top = $script:groundY + [int]([Math]::Sin($script:bobPhase) * 2)
    if ($now -gt $script:idleUntil) {
      if ($rnd.Next(0, 2) -eq 0) {
        $script:dir = if ($rnd.Next(0, 2) -eq 0) { -1 } else { 1 }
        $dist = $rnd.Next(60, 240)
        $t = $form.Left + $script:dir * $dist
        if ($t -lt $wa.Left) { $t = $wa.Left }
        if ($t -gt $wa.Right - $form.Width) { $t = $wa.Right - $form.Width }
        $script:walkTarget = $t
        $pic.Image = if ($script:dir -lt 0) { $imgL } else { $imgR }
        $script:mode = 'walk'
      } else { $script:idleUntil = $now.AddSeconds($rnd.Next(6, 12)) }
    }
  }
  if ($bubble.Visible) { Place-Bubble }
  if ($chat.Visible) {
    $cx = $form.Left + $form.Width - $chat.Width
    if ($cx -lt $wa.Left) { $cx = $wa.Left + 4 }
    $cy = $form.Top - $chat.Height - 8
    if ($cy -ge $wa.Top) { $chat.Location = New-Object System.Drawing.Point([int]$cx, [int]$cy) }
  }
})
$motion.Start()

# ---- status + replies polling ----
$script:lastSeq = -1
$status = New-Object System.Windows.Forms.Timer
$status.Interval = 2000
$status.Add_Tick({
  try {
    $s = Get-Content -Raw -Encoding UTF8 -Path $statusPath | ConvertFrom-Json
    $age = ([DateTime]::UtcNow - [DateTime]::Parse($s.heartbeat)).TotalSeconds
    $busy = $s.jobs -and $s.jobs.Count -gt 0
    if ($age -gt 25) { $dotLbl.ForeColor = [System.Drawing.Color]::Gray; $tray.Text = 'Alice - butler offline' }
    elseif ($busy) { $dotLbl.ForeColor = [System.Drawing.Color]::Orange; $tray.Text = 'Alice - busy' }
    else { $dotLbl.ForeColor = [System.Drawing.Color]::MediumSeaGreen; $tray.Text = 'Alice - on duty' }
    if ($script:lastSeq -lt 0) { $script:lastSeq = $s.lastEventSeq }
    elseif ($s.lastEventSeq -gt $script:lastSeq) {
      $script:lastSeq = $s.lastEventSeq
      $ev = $s.events | Select-Object -Last 1
      if ($ev -and -not $chat.Visible) { Show-Bubble $ev.msg }
    }
  } catch { $dotLbl.ForeColor = [System.Drawing.Color]::Gray }
  try {
    Get-ChildItem (Join-Path $outboxDir 'reply-*.json') | ForEach-Object {
      try {
        $r = Get-Content -Raw -Encoding UTF8 $_.FullName | ConvertFrom-Json
        Append-Chat $ZH_ALICE ([string]$r.text) ([System.Drawing.Color]::FromArgb(0, 105, 110))
        Move-Item $_.FullName (Join-Path $outboxDir ('seen\' + $_.Name)) -Force
        if (-not $chat.Visible) { Show-Bubble (U @(0x56DE, 0x4F60, 0x4E86, 0x3002)) }
      } catch {}
    }
  } catch {}
})
$status.Start()

$form.Add_Shown({
  Append-Chat $ZH_ALICE (U @(0x5728, 0x8FD9, 0x513F, 0x7559, 0x8A00, 0x5C31, 0x884C, 0xFF0C, 0x6211, 0x770B, 0x5230, 0x5C31, 0x56DE, 0x3002)) ([System.Drawing.Color]::FromArgb(0, 105, 110))
  Show-Bubble (U @(0x6211, 0x6765, 0x4E86, 0xFF0C, 0x7BA1, 0x5BB6, 0x5728, 0x5C97, 0x3002))
})
[System.Windows.Forms.Application]::Run($form)
