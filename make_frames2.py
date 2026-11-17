from PIL import Image, ImageDraw, ImageFilter
from collections import deque
import numpy as np, glob

B = '/home/hatch/workspace/butler-build/'
def cutout(path):
    src = Image.open(path).convert('RGB').resize((512, 512))
    w, h = src.size
    arr = np.asarray(src).astype(int)
    bg = arr[0, 0].copy()
    cand = np.abs(arr - bg).sum(axis=2) < 60
    mask = np.zeros((h, w), dtype=bool)
    dq = deque()
    for x in range(w):
        for y in (0, h-1):
            if cand[y, x] and not mask[y, x]: mask[y, x] = True; dq.append((y, x))
    for y in range(h):
        for x in (0, w-1):
            if cand[y, x] and not mask[y, x]: mask[y, x] = True; dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
            ny, nx = y+dy, x+dx
            if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not mask[ny, nx]:
                mask[ny, nx] = True; dq.append((ny, nx))
    alpha = np.where(mask, 0, 255).astype(np.uint8)
    aimg = Image.fromarray(alpha, 'L').filter(ImageFilter.GaussianBlur(1.2))
    rgba = src.convert('RGBA'); rgba.putalpha(aimg)
    return rgba.crop(aimg.getbbox())

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
def tilt(im, deg): return im.rotate(deg, resample=Image.BICUBIC, fillcolor=(255,0,255,255))

char = cutout(B + 'avatar.png')
blink_path = glob.glob(B + 'media-generation-alice-avatar-blink-*.png')[0]
blink_char = cutout(blink_path)
base = sticker(char); blinkS = sticker(blink_char)
outs = {
    'pet.png': base, 'pet-flip.png': flip(base),
    'pet-blink.png': blinkS, 'pet-blink-flip.png': flip(blinkS),
    'pet-tiltr.png': tilt(base, -5), 'pet-tiltl.png': tilt(base, 5),
    'pet-tiltr-flip.png': flip(tilt(base, -5)), 'pet-tiltl-flip.png': flip(tilt(base, 5)),
}
for name, im in outs.items():
    im.save(B + 'AliceButler/assets/' + name)
print('frames regenerated:', ', '.join(outs.keys()))
prev = Image.new('RGBA', blinkS.size, (90,96,106,255)); prev.paste(blinkS, (0,0), blinkS)
prev.convert('RGB').save(B + 'pet-blink-preview.png')
print('preview ok')
