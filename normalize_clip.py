#!/usr/bin/env python3
"""源视频站位归一化: 逐帧测人物主体包围盒(最大连通域, 排除Zzz等小对象),
按目标轨迹(底边恒定/中心恒定/高度按姿势轨迹)做平滑仿射校正, 输出同尺寸绿幕视频。
用法: normalize_clip.py in.mp4 out.mp4 h_start h_end t_trans_start t_trans_end
高度为画幅百分比; 过渡区间内高度按原片实测形状插值到起止目标之间。"""
import sys, cv2, numpy as np

src, dst = sys.argv[1], sys.argv[2]
h0, h1 = float(sys.argv[3]), float(sys.argv[4])
ts, te = float(sys.argv[5]), float(sys.argv[6])
TARGET_B, TARGET_CX = 85.0, 51.0

cap = cv2.VideoCapture(src)
fps = cap.get(cv2.CAP_PROP_FPS); n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
frames = []
while True:
    ok, fr = cap.read()
    if not ok: break
    frames.append(fr)
n = len(frames)

def subject_bbox(fr):
    g = fr[:,:,1].astype(int); r = fr[:,:,2].astype(int); b = fr[:,:,0].astype(int)
    mask = (~((g>150)&(g>r+40)&(g>b+40))).astype(np.uint8)
    cnt, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if cnt <= 1: return None
    i = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
    x, y, w, h = stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_TOP], stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
    return x, y, x+w, y+h  # L,T,R,B px

boxes = [subject_bbox(f) for f in frames]
hs = np.array([ (b[3]-b[1])/H*100 if b else np.nan for b in boxes])
# 过渡形状: 用实测高度在 [ts,te] 内的归一化进度驱动目标高度
tsec = np.arange(n)/fps
shape = np.clip((hs - np.nanmin(hs)) / max(1e-6, (np.nanmax(hs)-np.nanmin(hs))), 0, 1)
target_h = np.where(tsec <= ts, h0, np.where(tsec >= te, h1, h0 + (h1-h0)*shape))
# 平滑实测与目标
def smooth(a, k=15):
    ker = np.ones(k)/k
    return np.convolve(np.pad(a, k//2, mode='edge'), ker, mode='valid')[:len(a)]
target_h = smooth(target_h, 21)

out = cv2.VideoWriter(dst, cv2.VideoWriter_fourcc(*'mp4v'), fps, (W, H))
green = np.zeros((H, W, 3), np.uint8); green[:] = (0, 255, 0)
for i, fr in enumerate(frames):
    b = boxes[i]
    if b is None:
        out.write(fr); continue
    L, T, R, B = b
    cur_h = (B-T)/H*100
    s = (target_h[i]/100*H) / max(1, (B-T))
    cx = (L+R)/2; 
    # 变换: 先以主体中心缩放, 再平移使底边->TARGET_B, 中心x->TARGET_CX
    M = np.float32([[s, 0, (1-s)*cx], [0, s, (1-s)*T + (TARGET_B/100*H - s*(B-T) - (1-s)*T)*0 + (TARGET_B/100*H - (T + s*(B-T))) ]])
    M[0,2] = (1-s)*cx + (TARGET_CX/100*W - cx)
    M[1,2] = TARGET_B/100*H - (T + s*(B-T)) + (1-s)*0  # 底边对齐
    M[1,2] = (TARGET_B/100*H) - (s*B + (1-s)*T) + (1-s)*T - (1-s)*T  # 简化见下行重算
    # 直接按点映射重算: 点 (x,y) -> (s*x + tx, s*y + ty); 要求 s*cx+tx=CX, s*B+ty=TB
    tx = TARGET_CX/100*W - s*cx; ty = TARGET_B/100*H - s*B
    M = np.float32([[s, 0, tx], [0, s, ty]])
    warped = cv2.warpAffine(fr, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0,255,0))
    out.write(warped)
out.release()
print("done", dst)
