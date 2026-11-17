#!/usr/bin/env python3
"""Pack pet animation frames into static WebP sprite sheets for the space.
One sheet per action, uniform 300x347 cells, + manifest.json.
Output: ~/workspace/your_files/space-real/sheets/"""
import os, json, math
from PIL import Image

BASE = os.path.expanduser("~/workspace/butler-build")
OUT = os.path.expanduser("~/workspace/your_files/space-real/sheets")
os.makedirs(OUT, exist_ok=True)
CW, CH, COLS = 300, 347, 8
A60 = os.path.join(BASE, "AliceButler/assets/anim60")
AFLAT = os.path.join(BASE, "AliceButler/assets/anim-flat")
SPR = os.path.join(BASE, "sprite-frames")

def load_frames(d, step, limit):
    files = [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.endswith(".png")][::step]
    if limit:
        files = files[:limit]
    out = []
    for f in files:
        im = Image.open(f).convert("RGBA")
        scale = min(CW / im.width, CH / im.height)
        nw, nh = round(im.width * scale), round(im.height * scale)
        im = im.resize((nw, nh), Image.LANCZOS)
        cell = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
        cell.alpha_composite(im, ((CW - nw) // 2, CH - nh))
        out.append(cell)
    return out

def sheet(name, frames, fps, loop):
    n = len(frames)
    rows = math.ceil(n / COLS)
    s = Image.new("RGBA", (CW * COLS, CH * rows), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        s.alpha_composite(fr, ((i % COLS) * CW, (i // COLS) * CH))
    path = os.path.join(OUT, f"sheet-{name}.webp")
    s.save(path, quality=72, method=4)
    print(f"OK {name}: {n} frames, sheet {s.width}x{s.height}, {os.path.getsize(path)//1024} KB")
    return {"file": f"sheet-{name}.webp", "cols": COLS, "rows": rows, "frames": n,
            "cellW": CW, "cellH": CH, "fps": fps, "loop": loop}

M = {}
# anim60 loops: step5 -> 12fps, trimmed
for name, limit in [("breathe", 17), ("walk", 36), ("doze", 36), ("sit", 30),
                    ("wave", 36), ("celebrate", 48), ("water", 42), ("fish", 36),
                    ("wiggle", 36), ("dragdangle", 36)]:
    M[name] = sheet(name, load_frames(os.path.join(A60, name), 5, limit), 12, True)
# anim-flat one-shots
for name, step, limit, fps in [("clickhappy", 2, None, 8), ("clickshy", 2, None, 8),
                               ("clicktsun", 2, None, 8), ("yawn", 2, None, 6),
                               ("startled", 1, 60, 12), ("wakeup", 2, None, 6)]:
    M[name] = sheet(name, load_frames(os.path.join(AFLAT, name), step, limit), fps, False)
# sprite love one-shot
M["love"] = sheet("love", load_frames(os.path.join(SPR, "love"), 1, None), 10, False)

with open(os.path.join(OUT, "manifest.json"), "w") as f:
    json.dump(M, f, ensure_ascii=False, indent=1)
print("DONE", len(M), "actions")
