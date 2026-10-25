"""用保存的真实表格截图验证新的列检测 + 单元格归一化。"""
import asyncio
import io
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image

from thsapi.gui import ocr_table

img = Image.open(r"D:\jyauto\runtime\calib_grid.png")
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
print("rows:")
for r in table.rows:
    print("  ", r)
