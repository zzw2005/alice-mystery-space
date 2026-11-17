from PIL import Image, ImageDraw
import numpy as np

B = '/home/hatch/workspace/butler-build/'
char = Image.open(B + 'pixel-char.png').convert('RGBA')
cw, chh = char.size
arr = np.asarray(char).astype(int)
rgb = arr[:, :, :3]; alpha = arr[:, :, 3]

# face ROI
x0, x1 = int(cw*0.20), int(cw*0.78)
y0, y1 = int(chh*0.36), int(chh*0.70)
roi = rgb[y0:y1, x0:x1]
white = (roi[:, :, 0] > 205) & (roi[:, :, 1] > 205) & (roi[:, :, 2] > 195)
cols = white.sum(axis=0)
xs = np.where(cols > 3)[0]
# cluster columns
clusters = []
cur = [xs[0]]
for x in xs[1:]:
    if x - cur[-1] > 30: clusters.append(cur); cur = [x]
    else: cur.append(x)
clusters.append(cur)
print('white clusters:', [(int(min(c)), int(max(c))) for c in clusters])

# skin sample: face centre below the eyes
sx, sy = int(cw*0.46), int(chh*0.615)
skin = tuple(int(v) for v in rgb[sy, sx])
print('skin sample', skin)

blink = char.copy()
d = ImageDraw.Draw(blink)
for c in clusters:
    ex0, ex1 = x0 + min(c) - 14, x0 + max(c) + 14
    sub = white[:, min(c):max(c)+1]
    rows = np.where(sub.sum(axis=1) > 3)[0]
    ey0, ey1 = y0 + int(rows.min()) - 10, y0 + int(rows.max()) + 26
    # fill eye interior (white / iris / light pink) with skin, keep dark outline
    region = rgb[ey0:ey1, ex0:ex1]
    interior = ((region[:, :, 0] > 150) & (region[:, :, 1] > 110)) | ((region[:, :, 0] > 60) & (region[:, :, 0] < 170) & (region[:, :, 1] < 90) & (region[:, :, 2] < 90))
    patch = np.asarray(blink.crop((ex0, ey0, ex1, ey1))).copy()
    patch[interior] = skin + (255,)
    blink.paste(Image.fromarray(patch), (ex0, ey0))
    # closed lash arc
    d = ImageDraw.Draw(blink)
    cx = (ex0 + ex1) // 2; cy = (ey0 + ey1) // 2 + int(chh*0.006)
    ew = (ex1 - ex0) // 2
    r = max(3, int(cw * 0.010))
    for i in range(41):
        t = i / 40.0
        x = cx - ew + int(2 * ew * t)
        y = cy + int(np.sin(t * np.pi) * chh * 0.016)
        d.ellipse([x-r, y-r, x+r, y+r], fill=(43, 28, 22, 255))
blink.save(B + 'pixel-char-blink.png')
head = blink.crop((int(cw*0.10), int(chh*0.18), int(cw*0.80), int(chh*0.72)))
head = head.resize((head.size[0]*1, head.size[1]*1), Image.NEAREST)
bg = Image.new('RGBA', head.size, (120, 120, 120, 255)); bg.paste(head, (0, 0), head)
bg.convert('RGB').save(B + 'pixel-blink-head.png')
print('blink rebuilt')
