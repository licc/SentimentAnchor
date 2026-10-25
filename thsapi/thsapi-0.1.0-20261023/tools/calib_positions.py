"""打印持仓表的 OCR 原始解析结果，定位列错位。"""
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
from thsapi.gui import ocr_table
from thsapi.gui.ths import ThsClient

cfg = load_config()
c = ThsClient(cfg)
c.ensure_ready()
c.nav("资金股票")
time.sleep(0.8)

g = next((w for w in c._windows() if w.cls == "CVirtualGridCtrl" and w.visible), None)
rect = (g.left, g.top, g.right, g.bottom)
img = ocr_table.capture(rect)
img.save(r"D:\jyauto\runtime\calib_pos.png")
print("size", img.size)

cols = ocr_table.detect_columns(img, use_cache=False)
print("columns:", len(cols) - 1, cols)

factor = min(2.5, 2500 / max(img.width, img.height))
big = img.resize((int(img.width * factor), int(img.height * factor)), Image.LANCZOS)
buf = io.BytesIO()
big.save(buf, format="BMP")
words = asyncio.run(ocr_table._recognize_bytes(buf.getvalue()))
for w in words:
    w.left /= factor
    w.top /= factor
    w.width /= factor
    w.height /= factor

table = ocr_table.build_table(img, words, cols)
print("headers:", table.headers)
for r in table.rows:
    print("  ", r)
