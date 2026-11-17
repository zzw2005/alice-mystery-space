#!/usr/bin/env python3
"""Build animated WebPs for the Alice space from local frame sequences.
Output: ~/workspace/your_files/space-real/anim/act-<name>.webp (320px wide)."""
import os, sys
from PIL import Image

BASE = os.path.expanduser("~/workspace/butler-build")
OUT = os.path.expanduser("~/workspace/your_files/space-real/anim")
os.makedirs(OUT, exist_ok=True)
W = 320

def frames_of(d):
    return [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.endswith(".png")]

def build(name, srcdir, step, dur_ms):
    files = frames_of(srcdir)[::step]
    if not files:
        print(f"SKIP {name}: no frames in {srcdir}")
        return
    imgs = []
    for f in files:
        im = Image.open(f).convert("RGBA")
        h = round(im.height * W / im.width)
        imgs.append(im.resize((W, h), Image.LANCZOS))
    out = os.path.join(OUT, f"act-{name}.webp")
    imgs[0].save(out, save_all=True, append_images=imgs[1:], duration=dur_ms,
                 loop=0, quality=62, method=4)
    print(f"OK {name}: {len(imgs)} frames -> {os.path.getsize(out)//1024} KB")

A60 = os.path.join(BASE, "AliceButler/assets/anim60")
AFLAT = os.path.join(BASE, "AliceButler/assets/anim-flat")
SPR = os.path.join(BASE, "sprite-frames")

# anim60: 60fps source. breathe step2=30fps, others step4=15fps.
build("breathe", os.path.join(A60, "breathe"), 2, 33)
for n in ["walk", "doze", "sit", "wave", "celebrate", "water", "fish", "wiggle", "dragdangle",
          "sleepstart", "thinking", "pacing", "tidying", "sigh"]:
    d = os.path.join(A60, n)
    if os.path.isdir(d):
        build(n, d, 4, 66)
    else:
        print(f"MISS {n}: not processed yet")

# anim-flat: click* at 16fps, others 12fps.
for n, dur in [("clickhappy", 62), ("clickshy", 62), ("clicktsun", 62),
               ("yawn", 83), ("startled", 83), ("wakeup", 83)]:
    build(n, os.path.join(AFLAT, n), 1, dur)

# sprite love row: 8 frames at 10fps.
build("love", os.path.join(SPR, "love"), 1, 100)
print("DONE")
