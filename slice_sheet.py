from PIL import Image
import numpy as np, os, json, sys
from collections import deque

SRC = '/home/hatch/workspace/user/files/redhair_all_actions-2_20_1qbp.png'
im = Image.open(SRC).convert('RGB')
W, H = im.size
print('sheet', W, H)
arr = np.asarray(im).astype(np.int32)
gray = arr.sum(axis=2)

ROWS = [('idle', 0), ('walk', 1), ('love', 2), ('sleep', 3)]
COLS, NROWS = 8, 4
cw, ch = W // COLS, H // NROWS

def key_out(cell):
    """flood fill from borders over near-black -> alpha 0; keep the rest."""
    h, w = cell.shape[:2]
    g = cell.sum(axis=2)
    bg = g < 90
    vis = np.zeros((h, w), bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bg[y, x] and not vis[y, x]: vis[y, x] = True; dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if bg[y, x] and not vis[y, x]: vis[y, x] = True; dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
            if 0 <= ny < h and 0 <= nx < w and bg[ny, nx] and not vis[ny, nx]:
                vis[ny, nx] = True; dq.append((ny, nx))
    alpha = np.where(vis, 0, 255).astype(np.uint8)
    # soften: pixels adjacent to bg get partial alpha by brightness
    return alpha

frames_meta = {}
for name, r in ROWS:
    cells = []
    for c in range(COLS):
        cell = arr[r*ch:(r+1)*ch, c*cw:(c+1)*cw]
        alpha = key_out(cell)
        ys, xs = np.where(alpha > 0)
        if len(xs) == 0: continue
        cells.append((cell, alpha, xs.min(), xs.max(), ys.min(), ys.max()))
    maxw = max(x2-x1+1 for _,_,x1,x2,_,_ in cells)
    maxh = max(y2-y1+1 for _,_,_,_,y1,y2 in cells)
    outdir = f'/home/hatch/workspace/butler-build/sprite-frames/{name}'
    os.makedirs(outdir, exist_ok=True)
    for i, (cell, alpha, x1, x2, y1, y2) in enumerate(cells):
        rgba = np.dstack([cell.astype(np.uint8), alpha])
        crop = Image.fromarray(rgba, 'RGBA').crop((x1, y1, x2+1, y2+1))
        canvas = Image.new('RGBA', (maxw, maxh), (0, 0, 0, 0))
        # bottom-center anchor: feet aligned
        canvas.paste(crop, ((maxw - crop.width)//2, maxh - crop.height), crop)
        canvas.save(f'{outdir}/f{i:03d}.png')
    frames_meta[name] = {'frames': len(cells), 'size': [maxw, maxh]}
    print(name, len(cells), 'frames, cell', maxw, maxh)

json.dump(frames_meta, open('/home/hatch/workspace/butler-build/sprite-frames/meta.json', 'w'), indent=1)
