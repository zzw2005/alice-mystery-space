from PIL import Image, ImageDraw
import numpy as np

B = '/home/hatch/workspace/butler-build/'
char = Image.open(B + 'pixel-char.png').convert('RGBA')
cw, chh = char.size
arr = np.asarray(char).astype(int)
rgb = arr[:, :, :3]

# skin = average of pale pixels in a patch on the cheek (char coords ~620,850)
patch = rgb[838:862, 608:632].reshape(-1, 3)
pale = patch[(patch[:, 0] > 200) & (patch[:, 1] > 150)]
skin = tuple(int(v) for v in pale.mean(axis=0)) if len(pale) else (247, 214, 193)
print('skin', skin, 'from', len(pale), 'px')

blink = char.copy()
barr = np.asarray(blink).copy()
for (ex0, ex1) in ((355, 515), (715, 895)):
    ey0, ey1 = 645, 832
    region = rgb[ey0:ey1, ex0:ex1]
    bright = region.min(axis=2) > 165
    iris = (region[:, :, 0] > 70) & (region[:, :, 0] < 175) & (region[:, :, 1] < 105) & (region[:, :, 2] < 105)
    hairred = (region[:, :, 0] > 150) & ((region[:, :, 0] - region[:, :, 1]) > 80)
    interior = (bright | iris) & ~hairred
    sub = barr[ey0:ey1, ex0:ex1]
    sub[interior] = skin + (255,)
    barr[ey0:ey1, ex0:ex1] = sub
blink = Image.fromarray(barr)
d = ImageDraw.Draw(blink)
for (ex0, ex1) in ((355, 515), (715, 895)):
    cx = (ex0 + ex1) // 2; cy = 792; ew = (ex1 - ex0) // 2 - 8
    r = 9
    for i in range(41):
        t = i / 40.0
        x = cx - ew + int(2 * ew * t)
        y = cy + int(np.sin(t * np.pi) * 15)
        d.ellipse([x-r, y-r, x+r, y+r], fill=(43, 28, 22, 255))
blink.save(B + 'pixel-char-blink.png')
head = blink.crop((280, 560, 1010, 1010))
bg = Image.new('RGBA', head.size, (120, 120, 120, 255)); bg.paste(head, (0, 0), head)
bg.convert('RGB').resize((730, 450)).save(B + 'pixel-blink-head.png')
print('blink v2 done')
