# Quantize new anim60 clips in place (256-color FASTOCTREE palette + dither),
# backing up raw RGBA frames to anim60-raw first. Matches existing anim60 pipeline.
import os, shutil, sys
from PIL import Image

BB = os.path.expanduser('~/workspace/butler-build/AliceButler/assets')
NAMES = ['dragdangle', 'sleepstart', 'thinking', 'pacing', 'tidying', 'sigh']

def dir_size(d):
    total = 0
    for f in os.listdir(d):
        total += os.path.getsize(os.path.join(d, f))
    return total

for name in NAMES:
    src = os.path.join(BB, 'anim60', name)
    raw = os.path.join(BB, 'anim60-raw', name)
    if os.path.exists(raw):
        shutil.rmtree(raw)
    shutil.copytree(src, raw)
    before = dir_size(src)
    for f in sorted(os.listdir(src)):
        if not f.endswith('.png'):
            continue
        p = os.path.join(src, f)
        im = Image.open(p)
        q = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
        q.save(p, optimize=True)
    after = dir_size(src)
    print('%s raw backup done; quantized %d -> %d bytes' % (name, before, after), flush=True)

total = sum(dir_size(os.path.join(BB, 'anim60', n)) for n in NAMES)
print('TOTAL quantized 6 dirs: %d bytes (%.1f MB)' % (total, total / 1048576.0))
