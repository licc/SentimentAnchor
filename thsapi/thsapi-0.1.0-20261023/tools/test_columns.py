"""测试改进后的列线检测（按"暗像素纵向占比"）。"""
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
from PIL import Image


def detect(img: Image.Image, thresh: int = 235, ratio: float = 0.7):
    gray = np.array(img.convert("L"), dtype=np.float32)
    h, w = gray.shape
    body = gray[int(h * 0.08):, :]
    frac = (body < thresh).mean(axis=0)
    cand = np.where(frac >= ratio)[0]
    groups = []
    for x in cand:
        if groups and x - groups[-1][-1] <= 2:
            groups[-1].append(int(x))
        else:
            groups.append([int(x)])
    edges = [int(np.mean(g)) for g in groups]
    return sorted(set([0] + [e for e in edges if 2 < e < w - 2] + [w])), frac


img = Image.open(r"D:\jyauto\runtime\calib_grid.png")
print("size", img.size)
for th, ra in ((235, 0.7), (235, 0.5), (240, 0.6), (245, 0.8)):
    edges, frac = detect(img, th, ra)
    print(f"th={th} ratio={ra}: {len(edges)-1} 列 -> {edges}")
