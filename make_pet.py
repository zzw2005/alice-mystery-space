from PIL import Image, ImageDraw, ImageFilter
from collections import deque
import numpy as np

src = Image.open('/home/hatch/workspace/butler-build/avatar.png').convert('RGB')
w, h = src.size
arr = np.asarray(src).astype(int)
bg = arr[0, 0].copy()
dist = np.abs(arr - bg).sum(axis=2)
tol = 60
cand = dist < tol

# flood fill from borders over candidate pixels
mask = np.zeros((h, w), dtype=bool)
dq = deque()
for x in range(w):
    for y in (0, h - 1):
        if cand[y, x] and not mask[y, x]:
            mask[y, x] = True; dq.append((y, x))
for y in range(h):
    for x in (0, w - 1):
        if cand[y, x] and not mask[y, x]:
            mask[y, x] = True; dq.append((y, x))
while dq:
    y, x = dq.popleft()
    for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not mask[ny, nx]:
            mask[ny, nx] = True; dq.append((ny, nx))

alpha = np.where(mask, 0, 255).astype(np.uint8)
aimg = Image.fromarray(alpha, 'L').filter(ImageFilter.GaussianBlur(1.2))
rgba = src.convert('RGBA')
rgba.putalpha(aimg)

bbox = aimg.getbbox()
char = rgba.crop(bbox)
cw, chh = char.size
padX, padTop, strip = 26, 20, 40
W, H = cw + padX * 2, chh + padTop + strip
MAGENTA = (255, 0, 255, 255)
for name, im in (('pet.png', char), ('pet-flip.png', char.transpose(Image.FLIP_LEFT_RIGHT))):
    canvas = Image.new('RGBA', (W, H), MAGENTA)
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle([2, 2, W - 3, H - 3], radius=34, fill=(255, 255, 255, 255), outline=(216, 208, 196, 255), width=3)
    canvas.paste(im, (padX, padTop), im)
    canvas.save('/home/hatch/workspace/butler-build/AliceButler/assets/' + name)
    print(name, canvas.size)

# preview on grey to eyeball
prev = Image.new('RGBA', (W, H), (90, 96, 106, 255))
p = Image.open('/home/hatch/workspace/butler-build/AliceButler/assets/pet.png')
prev.paste(p, (0, 0), p)
prev.convert('RGB').save('/home/hatch/workspace/butler-build/pet-preview.png')
print('preview saved')
