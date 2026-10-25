"""用屏幕截图 + Windows 自带 OCR 读取同花顺表格（不复制、不导出、不触发验证码）。

原理
----
1. 截取表格区域（CVirtualGridCtrl 的窗口矩形）。
2. 在原图上检测竖线，得到每一列的像素边界（表格是固定列宽，检测很稳）。
3. 放大 2.5 倍后交给 Windows.Media.Ocr（zh-Hans-CN 已安装）。
4. 把 OCR 出的每个字按坐标归到"行 × 列"，拼回单元格文本。
5. 过滤灰色水印文字（如"当前没有可撤委托单"）。

依赖：pillow、numpy、winsdk（Windows 10/11 自带 OCR 引擎）。
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageGrab

from ..errors import ThsError

MAX_OCR_SIDE = 2500.0  # OcrEngine 对图像尺寸有上限，超过会报错


@dataclass
class Word:
    text: str
    left: float
    top: float
    width: float
    height: float

    @property
    def cx(self) -> float:
        return self.left + self.width / 2

    @property
    def cy(self) -> float:
        return self.top + self.height / 2


@dataclass
class OcrTable:
    headers: list[str] = field(default_factory=list)
    rows: list[list[str]] = field(default_factory=list)
    columns: list[int] = field(default_factory=list)
    raw_rows: list[list[Word]] = field(default_factory=list)


_ENGINE = None


def _engine():
    """OCR 引擎单例（每次创建要 1 秒以上，必须复用）。"""
    global _ENGINE
    if _ENGINE is not None:
        return _ENGINE
    from winsdk.windows.globalization import Language
    from winsdk.windows.media.ocr import OcrEngine

    eng = OcrEngine.try_create_from_language(Language("zh-Hans-CN"))
    if eng is None:
        eng = OcrEngine.try_create_from_user_profile_languages()
    if eng is None:
        raise ThsError("系统未安装 OCR 语言包（需要 中文(简体) 的 OCR 能力）")
    _ENGINE = eng
    return eng


async def _recognize_bytes(data: bytes) -> list[Word]:
    """直接在内存里把 PNG 解码成 SoftwareBitmap 交给 OCR（不落盘）。

    落盘会触发杀毒软件实时扫描，耗时 1~3 秒且波动很大；内存流稳定在几百毫秒。
    """
    from winsdk.windows.graphics.imaging import BitmapDecoder
    from winsdk.windows.storage.streams import DataWriter, InMemoryRandomAccessStream

    stream = InMemoryRandomAccessStream()
    writer = DataWriter(stream)
    writer.write_bytes(data)
    await writer.store_async()
    await writer.flush_async()
    stream.seek(0)
    decoder = await BitmapDecoder.create_async(stream)
    bmp = await decoder.get_software_bitmap_async()
    result = await _engine().recognize_async(bmp)
    words: list[Word] = []
    for line in result.lines:
        for w in line.words:
            r = w.bounding_rect
            words.append(Word(w.text, float(r.x), float(r.y), float(r.width), float(r.height)))
    return words


async def _recognize(path: Path) -> list[Word]:
    from winsdk.windows.graphics.imaging import BitmapDecoder
    from winsdk.windows.storage import FileAccessMode, StorageFile

    f = await StorageFile.get_file_from_path_async(str(path))
    stream = await f.open_async(FileAccessMode.READ)
    decoder = await BitmapDecoder.create_async(stream)
    bmp = await decoder.get_software_bitmap_async()
    result = await _engine().recognize_async(bmp)
    words: list[Word] = []
    for line in result.lines:
        for w in line.words:
            r = w.bounding_rect
            words.append(Word(w.text, float(r.x), float(r.y), float(r.width), float(r.height)))
    return words


def _png_bytes(img: Image.Image) -> bytes:
    """编码成 BMP（无压缩，比 PNG 快 50~150ms；OCR 引擎同样支持）。"""
    import io

    buf = io.BytesIO()
    img.save(buf, format="BMP")
    return buf.getvalue()


def capture(rect: tuple[int, int, int, int]) -> Image.Image:
    return ImageGrab.grab(bbox=rect)


_COLUMN_CACHE: dict[tuple[int, int], list[int]] = {}


def detect_columns(
    img: Image.Image, thresh: int = 235, ratio: float = 0.7, *, use_cache: bool = True
) -> list[int]:
    """检测表格的竖向分隔线，返回列边界（像素 x，相对图片）。

    判据：一列像素在"纵向"上大部分都是深色 → 那是表格线；
    只有零星几行深色 → 那是文字。用占比而不是均值，才能在有数据时也稳定。
    """
    key = (img.width, img.height)
    if use_cache and key in _COLUMN_CACHE:
        return _COLUMN_CACHE[key]
    gray = np.array(img.convert("L"), dtype=np.float32)
    h, w = gray.shape
    if h < 20 or w < 20:
        return [0, w]
    body = gray[int(h * 0.08):, :]
    frac = (body < thresh).mean(axis=0)
    cand = np.where(frac >= ratio)[0]
    groups: list[list[int]] = []
    for x in cand:
        if groups and x - groups[-1][-1] <= 2:
            groups[-1].append(int(x))
        else:
            groups.append([int(x)])
    edges = [int(np.mean(g)) for g in groups]
    edges = [e for e in edges if 2 < e < w - 10]
    out = sorted(set([0] + edges + [w]))
    if use_cache and len(out) > 2:
        _COLUMN_CACHE[key] = out
    return out


def warmup() -> None:
    """预热 OCR 引擎（首次调用要加载模型，约 3 秒），避免拖慢第一个请求。"""
    import io

    try:
        img = Image.new("RGB", (240, 80), (255, 255, 255))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        out_dir = Path("runtime").resolve()
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / "ocr_warmup.png"
        path.write_bytes(buf.getvalue())
        asyncio.run(_recognize(path))
        path.unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        pass


def _dark_enough(img: Image.Image, word: Word, threshold: int = 165) -> bool:
    """区分正文（近黑）与灰色水印。"""
    box = (
        max(0, int(word.left)),
        max(0, int(word.top)),
        min(img.width, int(word.left + word.width)),
        min(img.height, int(word.top + word.height)),
    )
    if box[2] <= box[0] or box[3] <= box[1]:
        return True
    crop = np.array(img.crop(box).convert("L"))
    return float(crop.min()) < threshold


_FW_MAP = str.maketrans(
    {"．": ".", "。": ".", "：": ":", "，": ",", "－": "-", "—": "-", "％": "%", "\u00a0": ""}
)


def _norm_cell(text: str) -> str:
    """单元格文本归一化：全角标点转半角、去掉空格与前导冒号、修正负号。"""
    import re

    out = text.translate(_FW_MAP).replace(" ", "").strip().strip(":：")
    # "-19.40" 里的负号常被 OCR 认成汉字"一"或全角"－"
    out = re.sub(r"^[一－—–删刂](?=\d)", "-", out)
    # "撤" 常被认成 "撒"
    out = out.replace("撒", "撤")
    return out


def build_table(img: Image.Image, words: list[Word], columns: list[int], row_tol: float = 7.0) -> OcrTable:
    cols = list(columns)
    if len(cols) < 2:
        return OcrTable()

    def col_of(x: float) -> int:
        for i in range(len(cols) - 1):
            if cols[i] <= x < cols[i + 1]:
                return i
        return len(cols) - 1 if x >= cols[-1] else 0

    kept = [w for w in words if w.width > 0 and w.height > 0 and _dark_enough(img, w)]
    kept.sort(key=lambda w: (w.cy, w.cx))

    rows: list[list[Word]] = []
    for w in kept:
        if rows and abs(w.cy - np.mean([x.cy for x in rows[-1]])) <= row_tol:
            rows[-1].append(w)
        else:
            rows.append([w])

    table: list[list[str]] = []
    for row in rows:
        cells = [""] * (len(cols) - 1)
        for w in sorted(row, key=lambda x: x.cx):
            i = col_of(w.cx)
            if 0 <= i < len(cells):
                cells[i] += w.text
        table.append([_norm_cell(c) for c in cells])

    if not table:
        return OcrTable(columns=cols)

    headers = table[0]
    data = [
        r
        for r in table[1:]
        if any(r) and r[0] not in ("汇总", "合计", "总计", "小计")
    ]
    return OcrTable(headers=headers, rows=data, columns=cols, raw_rows=rows)


def locate_text(rect: tuple[int, int, int, int], needle: str, *, scale: float = 2.5) -> tuple[int, int] | None:
    """在表格区域里找到某段文字，返回它的屏幕坐标 (x, y)。

    用于"按合同编号定位委托行"——OCR 同时给了文字和坐标，
    所以可以像人一样点中那一行，而不需要复制表格。
    """
    needle = (needle or "").strip()
    if not needle:
        return None
    img = capture(rect)
    if img.width < 30 or img.height < 20:
        return None

    factor = min(scale, MAX_OCR_SIDE / max(img.width, img.height), MAX_OCR_SIDE / max(1, img.height))
    factor = max(1.0, factor)
    big = img.resize((int(img.width * factor), int(img.height * factor)), Image.LANCZOS)
    words = asyncio.run(_recognize_bytes(_png_bytes(big)))
    for w in words:
        w.left /= factor
        w.top /= factor
        w.width /= factor
        w.height /= factor
        if not _dark_enough(img, w):
            w.width = 0  # 标记为水印

    words = [w for w in words if w.width > 0]
    if not words:
        return None

    # 按行聚合，行内按 x 排序后拼接
    words.sort(key=lambda w: (round(w.cy / 8), w.left))
    rows: list[list[Word]] = []
    for w in words:
        if rows and abs(w.cy - np.mean([x.cy for x in rows[-1]])) <= 7:
            rows[-1].append(w)
        else:
            rows.append([w])

    for row in rows:
        row.sort(key=lambda w: w.left)
        text = "".join(w.text for w in row)
        if needle in text:
            # 找到覆盖 needle 起始位置的词
            idx = 0
            for w in row:
                end = idx + len(w.text)
                if idx <= text.index(needle) < end:
                    return (int(rect[0] + w.cx), int(rect[1] + w.cy))
                idx = end
            w = row[0]
            return (int(rect[0] + w.cx), int(rect[1] + w.cy))
    return None


def read_number(rect: tuple[int, int, int, int], *, scale: float = 3.0) -> float:
    """识别一小块区域里的数字（例如下单页"买入价格"框里的现价）。

    同花顺的价格/数量输入框是自绘控件，win32/UIA 都读不到文本，只能截屏识别。
    """
    import re

    img = capture(rect)
    if img.width < 8 or img.height < 6:
        return 0.0
    factor = min(scale, MAX_OCR_SIDE / max(img.width, img.height), MAX_OCR_SIDE / max(1, img.height))
    factor = max(1.0, factor)
    big = img.resize((int(img.width * factor), int(img.height * factor)), Image.LANCZOS)
    words = asyncio.run(_recognize_bytes(_png_bytes(big)))
    text = "".join(w.text for w in sorted(words, key=lambda w: w.left))
    text = text.translate(_FW_MAP).replace(" ", "")
    # OCR 常把小数点认成逗号（3,805），价格框里不会有千分位，直接统一成小数点
    text = text.replace(",", ".")
    m = re.search(r"-?\d+(?:\.\d+)?", text)
    if not m:
        return 0.0
    try:
        return float(m.group())
    except ValueError:  # pragma: no cover
        return 0.0


def read_text(rect: tuple[int, int, int, int], *, scale: float = 2.0) -> str:
    """识别一小块区域的文字（用于自定义绘制的弹窗，UIA 读不到时兜底）。"""
    img = capture(rect)
    if img.width < 10 or img.height < 8:
        return ""
    factor = min(scale, MAX_OCR_SIDE / max(img.width, img.height), MAX_OCR_SIDE / max(1, img.height))
    factor = max(1.0, factor)
    big = img.resize((int(img.width * factor), int(img.height * factor)), Image.LANCZOS)
    words = asyncio.run(_recognize_bytes(_png_bytes(big)))
    words = [w for w in words if w.width > 0]
    if not words:
        return ""
    words.sort(key=lambda w: (round(w.cy / 20), w.left))
    lines: list[str] = []
    last_y = None
    for w in words:
        if last_y is None or abs(w.cy - last_y) > 12 * factor / 2:
            lines.append(w.text)
            last_y = w.cy
        else:
            lines[-1] += w.text
    return "\n".join(lines)


def read_table(rect: tuple[int, int, int, int], *, scale: float = 2.5, out_dir: Path | None = None) -> OcrTable:
    """截取 rect 区域并识别成表格。rect 为屏幕坐标 (left, top, right, bottom)。"""
    img = capture(rect)
    if img.width < 30 or img.height < 20:
        raise ThsError("表格区域太小，无法识别")

    # 不缓存列边界：一旦缓存到一帧错的边界，后面所有读取都会系统性错位
    columns = detect_columns(img, use_cache=False)

    factor = min(scale, MAX_OCR_SIDE / max(img.width, img.height), MAX_OCR_SIDE / max(1, img.height))
    factor = max(1.0, factor)
    big = img.resize((int(img.width * factor), int(img.height * factor)), Image.LANCZOS)

    out_dir = Path(out_dir or "runtime").resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    words = asyncio.run(_recognize_bytes(_png_bytes(big)))
    for w in words:
        w.left /= factor
        w.top /= factor
        w.width /= factor
        w.height /= factor
    return build_table(img, words, columns)
