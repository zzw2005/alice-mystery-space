#!/usr/bin/env python3
"""双端接缝锚定(单次编码): 首帧段向锚A渐变、尾帧段向锚B渐变。
用法: anchor_seam2.py in.mp4 out.mp4 head_anchor_video head_idx tail_anchor_video tail_idx frames"""
import sys, cv2, numpy as np
src, dst = sys.argv[1], sys.argv[2]
hv, hi, tv, ti, nf = sys.argv[3], int(sys.argv[4]), sys.argv[5], int(sys.argv[6]), int(sys.argv[7])
def grab(p, idx):
    cap = cv2.VideoCapture(p); n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.set(cv2.CAP_PROP_POS_FRAMES, idx if idx>=0 else n+idx)
    ok, fr = cap.read(); return cv2.resize(fr, (1280,720)).astype(np.float32)
ha, ta = grab(hv, hi), grab(tv, ti)
cap = cv2.VideoCapture(src); fps = cap.get(cv2.CAP_PROP_FPS); frames = []
while True:
    ok, fr = cap.read()
    if not ok: break
    frames.append(cv2.resize(fr, (1280,720)))
n = len(frames)
out = cv2.VideoWriter(dst, cv2.VideoWriter_fourcc(*'mp4v'), fps, (1280,720))
for i, fr in enumerate(frames):
    f = fr.astype(np.float32)
    if i < nf:
        w = 1-(i/(nf-1)); w = w*w*(3-2*w); f = f*(1-w) + ha*w
    if i >= n-nf:
        w = (i-(n-nf))/(nf-1); w = w*w*(3-2*w); f = f*(1-w) + ta*w
    out.write(np.clip(f,0,255).astype(np.uint8))
out.release(); print("done", dst)
