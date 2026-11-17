#!/usr/bin/env python3
"""接缝帧锚定: 把视频首/尾 N 帧向锚帧平滑渐变, 末端帧与锚帧逐像素一致。
用法: anchor_seam.py in.mp4 out.mp4 anchor_video anchor_frame_index tail|head frames"""
import sys, cv2, numpy as np
src, dst, anchor_video, aidx, side, nf = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5], int(sys.argv[6])
def read_all(p):
    cap = cv2.VideoCapture(p); fs = []
    while True:
        ok, fr = cap.read()
        if not ok: break
        fs.append(cv2.resize(fr, (1280,720)))
    return fs, cap.get(cv2.CAP_PROP_FPS)
frames, fps = read_all(src)
acap = cv2.VideoCapture(anchor_video)
n_a = int(acap.get(cv2.CAP_PROP_FRAME_COUNT))
acap.set(cv2.CAP_PROP_POS_FRAMES, aidx if aidx>=0 else n_a+aidx)
ok, anchor = acap.read(); anchor = cv2.resize(anchor, (1280,720)).astype(np.float32)
n = len(frames)
out = cv2.VideoWriter(dst, cv2.VideoWriter_fourcc(*'mp4v'), fps, (1280,720))
for i, fr in enumerate(frames):
    f = fr.astype(np.float32)
    if side == 'tail' and i >= n-nf:
        w = (i-(n-nf))/(nf-1) if nf>1 else 1.0; w = w*w*(3-2*w)
        f = f*(1-w) + anchor*w
    if side == 'head' and i < nf:
        w = 1-(i/(nf-1)) if nf>1 else 0.0; w = w*w*(3-2*w)
        f = f*(1-w) + anchor*w
    out.write(np.clip(f,0,255).astype(np.uint8))
out.release(); print("done", dst)
