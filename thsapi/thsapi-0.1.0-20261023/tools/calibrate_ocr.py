"""OCR 校准：用真实委托表对比不同放大倍数/切图方式的识别结果。"""
from __future__ import annotations

import asyncio
import io
import sys
import time
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image

from thsapi.config import load_config
from thsapi.gui import ocr_table, winapi
from thsapi.gui.ths import ThsClient


def ocr(img: Image.Image, scale: float):
    factor = min(scale, 2500 / max(img.width, img.height))
    big = img.resize((int(img.width * factor), int(img.height * factor)), Image.LANCZOS)
    buf = io.BytesIO()
    big.save(buf, format="BMP")
    t0 = time.perf_counter()
    words = asyncio.run(ocr_table._recognize_bytes(buf.getvalue()))
    dt = (time.perf_counter() - t0) * 1000
    for w in words:
        w.left /= factor
        w.top /= factor
        w.width /= factor
        w.height /= factor
    return words, dt


cfg = load_config()
c = ThsClient(cfg)
c.ensure_ready()
c.nav("当日委托")
time.sleep(0.6)

g = next((w for w in c._windows() if w.cls == "CVirtualGridCtrl" and w.visible), None)
rect = (g.left, g.top, g.right, g.bottom)
img = ocr_table.capture(rect)
img.save(Path(r"D:\jyauto\runtime\calib_grid.png"))
print("grid", rect, img.size)

cols = ocr_table.detect_columns(img, use_cache=False)
print("columns:", cols)

for scale in (2.5, 3.0, 3.5):
    words, dt = ocr(Image.open(Path(r"D:\jyauto\runtime\calib_grid.png")), scale)
    print(f"\n=== scale {scale}  ({dt:.0f} ms, {len(words)} words)")
    # 只打印表格数据区（y > 表头）的词
    for w in sorted(words, key=lambda x: (round(x.cy / 10), x.left)):
        if w.cy < 40:
            continue
        print(f"   {w.text!r:<18} x={w.left:6.1f} y={w.cy:6.1f} w={w.width:5.1f}")
