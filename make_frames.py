from PIL import Image, ImageDraw, ImageFilter
from collections import deque
import numpy as np

B = '/home/hatch/workspace/butler-build/'
src = Image.open(B + 'avatar.png').convert('RGB')
w, h = src.size
arr = np.asarray(src).astype(int)
bg = arr[0, 0].copy()
dist = np.abs(arr - bg).sum(axis=2)
cand = dist < 60
mask = np.zeros((h, w), dtype=bool)
dq = deque()
for x in range(w):
    for y in (0, h - 1):
        if cand[y, x] and not mask[y, x]: mask[y, x] = True; dq.append((y, x))
for y in range(h):
    for x in (0, w - 1):
        if cand[y, x] and not mask[y, x]: mask[y, x] = True; dq.append((y, x))
while dq:
    y, x = dq.popleft()
    for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
        ny, nx = y+dy, x+dx
        if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not mask[ny, nx]:
            mask[ny, nx] = True; dq.append((ny, nx))
alpha = np.where(mask, 0, 255).astype(np.uint8)
aimg = Image.fromarray(alpha, 'L').filter(ImageFilter.GaussianBlur(1.2))
char = src.convert('RGBA'); char.putalpha(aimg)
char = char.crop(aimg.getbbox())

# --- blink variant: find eyes on the ORIGINAL avatar, paint lids, then same cutout pipeline
arr2 = np.asarray(src)
dark = (arr2[:,:,0] < 110) & (arr2[:,:,1] < 90) & (arr2[:,:,2] < 80)
ys, xs = np.where(dark)
pts = [(x, y) for x, y in zip(xs, ys) if 120 < x < 400 and 120 < y < 280]
xs2 = sorted(set(p[0] for p in pts))
# split into two clusters by x gap
clusters = []
cur = [xs2[0]]
for x in xs2[1:]:
    if x - cur[-1] > 25: clusters.append(cur); cur = [x]
    else: cur.append(x)
clusters.append(cur)
blink = src.copy()
d = ImageDraw.Draw(blink)
for c in clusters:
    cx0, cx1 = min(c), max(c)
    col = [p for p in pts if cx0 <= p[0] <= cx1]
    cy0, cy1 = min(p[1] for p in col), max(p[1] for p in col)
    cx, cy = (cx0+cx1)//2, (cy0+cy1)//2
    ew, eh = (cx1-cx0)//2 + 12, (cy1-cy0)//2 + 10
    skin = tuple(int(v) for v in arr2[max(0, cy-eh-16), cx][:3])
    d.ellipse([cx-ew, cy-eh, cx+ew, cy+eh], fill=skin)
    d.arc([cx-ew+3, cy-eh+2, cx+ew-3, cy+eh+6], start=15, end=165, fill=(70, 48, 38), width=4)
blink_rgba = blink.convert('RGBA'); blink_rgba.putalpha(aimg)
blink_char = blink_rgba.crop(aimg.getbbox())

def sticker(im):
    cw, chh = im.size
    padX, padTop, strip = 26, 20, 40
    W, H = cw + padX*2, chh + padTop + strip
    canvas = Image.new('RGBA', (W, H), (255, 0, 255, 255))
    dr = ImageDraw.Draw(canvas)
    dr.rounded_rectangle([2, 2, W-3, H-3], radius=34, fill=(255,255,255,255), outline=(216,208,196,255), width=3)
    canvas.paste(im, (padX, padTop), im)
    return canvas

def flip(im): return im.transpose(Image.FLIP_LEFT_RIGHT)

base = sticker(char); blinkS = sticker(blink_char)
outs = {
    'pet.png': base, 'pet-flip.png': flip(base),
    'pet-blink.png': blinkS, 'pet-blink-flip.png': flip(blinkS),
    'pet-tiltr.png': base.rotate(-5, resample=Image.BICUBIC, fillcolor=(255,0,255,255)),
    'pet-tiltl.png': base.rotate(5, resample=Image.BICUBIC, fillcolor=(255,0,255,255)),
    'pet-tiltr-flip.png': flip(base.rotate(-5, resample=Image.BICUBIC, fillcolor=(255,0,255,255))),
    'pet-tiltl-flip.png': flip(base.rotate(5, resample=Image.BICUBIC, fillcolor=(255,0,255,255))),
}
for name, im in outs.items():
    im.save(B + 'AliceButler/assets/' + name)
    print(name, im.size)
# preview blink on grey
prev = Image.new('RGBA', blinkS.size, (90,96,106,255)); prev.paste(blinkS, (0,0), blinkS)
prev.convert('RGB').save(B + 'pet-blink-preview.png')
print('blink preview saved')
