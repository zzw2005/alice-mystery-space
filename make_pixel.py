from PIL import Image, ImageDraw, ImageFilter
from collections import deque
import numpy as np

B = '/home/hatch/workspace/butler-build/'
src = Image.open(B + 'pixel-src.png').convert('RGB')
w, h = src.size
arr = np.asarray(src).astype(int)
white = np.array([255, 255, 255])
cand = np.abs(arr - white).sum(axis=2) < 55
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
aimg = Image.fromarray(alpha, 'L')
char = src.convert('RGBA'); char.putalpha(aimg)
bbox = aimg.getbbox()
char = char.crop(bbox)
char.save(B + 'pixel-char.png')
cw, chh = char.size
print('char', char.size, 'bbox', bbox)

# --- blink: paint lids over the two eyes, draw closed lash arcs
blink = char.copy()
d = ImageDraw.Draw(blink)
arr_c = np.asarray(char)
# eye centres estimated from the artwork proportions (of char bbox)
for fx in (0.335, 0.585):
    cx = int(cw * fx); cy = int(chh * 0.545)
    ew = int(cw * 0.085); eh = int(chh * 0.085)
    skin = tuple(int(v) for v in arr_c[min(chh-1, cy + int(chh*0.13)), cx][:3])
    d.rectangle([cx-ew, cy-eh, cx+ew, cy+eh], fill=skin + (255,))
    r = max(3, int(cw * 0.011))
    for i in range(41):
        t = i / 40.0
        x = cx - ew + int(2 * ew * t)
        y = cy + int(np.sin(t * np.pi) * chh * 0.022)
        d.ellipse([x-r, y-r, x+r, y+r], fill=(43, 28, 22, 255))
blink.save(B + 'pixel-char-blink.png')

def sticker(im):
    target_h = 492
    sc = target_h / im.size[1]
    im2 = im.resize((int(im.size[0] * sc), target_h), Image.NEAREST)
    padX, padTop, strip = 26, 20, 40
    W, H = im2.size[0] + padX*2, target_h + padTop + strip
    canvas = Image.new('RGBA', (W, H), (255, 0, 255, 255))
    dr = ImageDraw.Draw(canvas)
    dr.rounded_rectangle([2, 2, W-3, H-3], radius=34, fill=(255,255,255,255), outline=(216,208,196,255), width=3)
    canvas.paste(im2, (padX, padTop), im2)
    return canvas

def flip(im): return im.transpose(Image.FLIP_LEFT_RIGHT)
def tilt(im, deg): return im.rotate(deg, resample=Image.BICUBIC, fillcolor=(255,0,255,255))

base = sticker(char); blinkS = sticker(blink)
outs = {
    'pet.png': base, 'pet-flip.png': flip(base),
    'pet-blink.png': blinkS, 'pet-blink-flip.png': flip(blinkS),
    'pet-tiltr.png': tilt(base, -5), 'pet-tiltl.png': tilt(base, 5),
    'pet-tiltr-flip.png': flip(tilt(base, -5)), 'pet-tiltl-flip.png': flip(tilt(base, 5)),
}
for name, im in outs.items():
    im.save(B + 'AliceButler/assets/' + name)
print('sticker', base.size)

# avatar: transparent char + head-crop icon
char.save(B + 'AliceButler/assets/avatar.png')
head = char.crop((int(cw*0.08), 0, int(cw*0.92), int(chh*0.60)))
head.save(B + 'avatar-head.png')
ico_img = head.resize((256, 256), Image.NEAREST)
ico_img.save(B + 'AliceButler/assets/avatar.ico', format='ICO', sizes=[(16,16),(32,32),(48,48),(256,256)])
# previews
for nm, im in (('pixel-pet-preview.png', base), ('pixel-blink-preview.png', blinkS)):
    prev = Image.new('RGBA', im.size, (90,96,106,255)); prev.paste(im, (0,0), im)
    prev.convert('RGB').save(B + nm)
print('done')
