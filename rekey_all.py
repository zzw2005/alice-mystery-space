# Re-key anim60 + anim-flat frames: the original pipelines keyed GREEN screen
# but the source videos have BLACK backdrops, so the black was never removed
# (only a thin transparent margin from normalization). This pass removes the
# edge-connected dark backdrop from the existing quantized frames, feathers
# the halo ring, and re-quantizes with the pipeline's own settings.
import os, sys, glob
import numpy as np, cv2
from PIL import Image
from multiprocessing import Pool

BASE = os.path.expanduser('~/workspace/butler-build/AliceButler/assets')
GROUPS = ['anim60', 'anim-flat']

def rekey(im):
    arr = np.asarray(im.convert('RGBA')).copy()
    rgb = arr[:, :, :3].astype(np.int32)
    mx = rgb.max(axis=2)
    dark = (mx < 52).astype(np.uint8)
    n, lab = cv2.connectedComponents(dark, connectivity=4)
    if n <= 1:
        return im
    border = set(np.unique(np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]))) - {0}
    if not border:
        return im
    backdrop = np.isin(lab, list(border))
    alpha = arr[:, :, 3].astype(np.float32)
    alpha[backdrop] = 0
    dil = cv2.dilate(backdrop.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    ring = dil & ~backdrop & (mx < 110)
    alpha[ring] = np.minimum(alpha[ring], np.clip((mx[ring] - 40) / 70.0, 0, 1) * 255)
    arr[:, :, 3] = alpha.astype(np.uint8)
    return Image.fromarray(arr)

def work(path):
    im = Image.open(path)
    fixed = rekey(im)
    q = fixed.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
    tmp = path + '.tmp.png'
    q.save(tmp, optimize=True)
    os.replace(tmp, path)
    return path

if __name__ == '__main__':
    jobs = []
    for g in GROUPS:
        gdir = os.path.join(BASE, g)
        for clip in sorted(os.listdir(gdir)):
            cdir = os.path.join(gdir, clip)
            if os.path.isdir(cdir):
                jobs += sorted(glob.glob(os.path.join(cdir, '*.png')))
    print('total frames:', len(jobs), flush=True)
    done = 0
    with Pool(2) as pool:
        for _ in pool.imap_unordered(work, jobs, chunksize=16):
            done += 1
            if done % 500 == 0:
                print('done', done, '/', len(jobs), flush=True)
    print('ALL DONE', done, flush=True)
