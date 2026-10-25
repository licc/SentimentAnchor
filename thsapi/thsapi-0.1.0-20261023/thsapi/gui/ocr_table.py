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
import io
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageGrab

from ..errors import ThsError

MAX_OCR_SIDE = 2500.0  # OcrEngine 对图像尺寸有上限，超过会报错

log = logging.getLogger("thsapi.ocr")

# OCR 引擎选择：auto=优先 RapidOCR，失败回退 Windows 自带引擎
# 环境变量：THSAPI_OCR_ENGINE=rapid|windows|auto
_OCR_ENGINE_PREF = os.environ.get("THSAPI_OCR_ENGINE", "auto").strip().lower()


def _use_rapid() -> bool:
    if _OCR_ENGINE_PREF == "windows":
        return False
    from . import ocr_rapid

    return ocr_rapid.available()


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
    """识别一张图片（PNG/BMP 字节）并返回词框，坐标与原图像素一致。

    RapidOCR 优先：小号中文（客户端表格只有 12px 高）用 Windows 自带 OCR 会被认成
    "E±ETF"、"黄±ETF" 这类乱码；RapidOCR 准确得多。不可用或抛错时静默回退。
    """
    if _use_rapid():
        try:
            from . import ocr_rapid

            img = Image.open(io.BytesIO(data)).convert("RGB")
            words = [
                Word(text, left, top, width, height)
                for text, left, top, width, height in ocr_rapid.recognize(img)
            ]
            if words:
                return words
            log.debug("RapidOCR 未识别到文字，回退 Windows OCR")
        except Exception as exc:  # pragma: no cover - 取决于运行环境
            log.warning("RapidOCR 失败，回退 Windows OCR: %s", exc)
    return await _recognize_windows(data)


async def _recognize_windows(data: bytes) -> list[Word]:
    """直接用内存流把图片解码成 SoftwareBitmap 交给 Windows OCR（不落盘）。

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
    """预热 OCR 引擎（首次调用要加载模型，约 2~3 秒），避免拖慢第一个请求。"""
    import io

    if _use_rapid():
        try:
            from . import ocr_rapid

            ocr_rapid.warmup()
        except Exception:  # noqa: BLE001
            log.warning("RapidOCR 预热失败，将在首次识别时加载", exc_info=True)

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


_GARBLED_RE = re.compile(r"[^\u4e00-\u9fa5A-Za-z0-9()（）\-*.\s]")


def looks_garbled(text: str) -> bool:
    """便宜地判断一段识别结果是否明显被 OCR 认错。

    中文名里出现汉字/字母/数字/括号之外的字符（如 "E±ETF"、"æETF" 里的 ± 和 æ），
    基本可以断定是字形误识，而不是真实名称。
    """
    return bool(_GARBLED_RE.search(text or ""))


def read_cell(rect: tuple[int, int, int, int], *, scale: float = 6.0, threshold: int = 200) -> str:
    """单元格定点补读。

    RapidOCR 可用时走「单行模式」：整格当一行直接识别，约 46ms 且不需要放大/二值化。
    Windows OCR 则必须二值化 + 高倍放大（小号彩色中文在 2.5 倍下会被认成 E±ETF）。
    只有可疑单元格才会走到这里。
    """
    img = capture(rect)
    if img.width < 8 or img.height < 8:
        return ""
    if _use_rapid():
        try:
            from . import ocr_rapid

            text = "".join(t for t, *_ in ocr_rapid.recognize(img, single_line=True, min_score=0.35))
            if text.strip():
                return text.strip()
            log.debug("RapidOCR 单行识别为空，回退 Windows OCR")
        except Exception:  # pragma: no cover - 取决于运行环境
            log.warning("RapidOCR 单行识别失败，回退 Windows OCR", exc_info=True)
    gray = img.convert("L").point(lambda p: 255 if p > threshold else 0)
    factor = min(scale, MAX_OCR_SIDE / max(img.width, img.height), MAX_OCR_SIDE / max(1, img.height))
    factor = max(1.0, factor)
    big = gray.convert("RGB").resize((int(img.width * factor), int(img.height * factor)), Image.LANCZOS)
    words = [w for w in asyncio.run(_recognize_windows(_png_bytes(big))) if w.text.strip()]
    words.sort(key=lambda w: w.left)
    return "".join(w.text for w in words).strip()


def _cjk_count(text: str) -> int:
    return sum(1 for ch in text if "\u4e00" <= ch <= "\u9fa5")


def read_cell_best(rect: tuple[int, int, int, int], *, score=None) -> str:
    """多组参数各补读一次，取评分最高的结果。

    不同渲染状态下最优参数并不相同：早期窗口用 (6, 200) 能读出「黄金ETF」，
    换布局后同一格在 (3, 180) 才行，故多试几组；只有可疑单元格才会走到这里。
    """
    score = score or (lambda t: (_cjk_count(t), len(t)))
    best = ""
    for scale, threshold in ((3.0, 180), (6.0, 200), (8.0, 220)):
        text = read_cell(rect, scale=scale, threshold=threshold)
        if score(text) > score(best):
            best = text
    return best


def _repair_column(table: OcrTable, rect: tuple[int, int, int, int], header: str, suspect,
                   *, require_cjk_if_nonascii: bool = False, digit_only: bool = False) -> int:
    """对某一列做"可疑即补读"：二值化 + 高倍放大重新识别该单元格。

    suspect(text) 返回 True 表示该格识别结果不可信；只对可疑格付补读代价。
    """
    try:
        idx = table.headers.index(header)
    except ValueError:
        return 0
    cols = table.columns
    if not (0 <= idx < len(cols) - 1):
        return 0
    code_idx = table.headers.index("证券代码") if "证券代码" in table.headers else None
    if code_idx is not None and not (0 <= code_idx < len(cols) - 1):
        code_idx = None

    def cell_text(words: list[Word], i: int | None) -> str:
        if i is None:
            return ""
        return "".join(w.text for w in words if cols[i] <= w.cx < cols[i + 1])

    rows_by_code: dict[str, list[str]] = {}
    for r in table.rows:
        if code_idx is not None and code_idx < len(r):
            rows_by_code.setdefault(r[code_idx], r)

    fixed = 0
    for raw in table.raw_rows[1:]:
        if code_idx is None:
            continue
        target = rows_by_code.get(cell_text(raw, code_idx))
        if target is None or idx >= len(target) or not suspect(target[idx]):
            continue
        words = [w for w in raw if cols[idx] <= w.cx < cols[idx + 1]]
        if words:
            top = min(w.top for w in words)
            bottom = max(w.top + w.height for w in words)
        else:
            top = min(w.top for w in raw)
            bottom = max(w.top + w.height for w in raw)
        # 行高只有 14~18px，而认错的那两个字可能压根没被识别成词框，
        # 垂直方向必须留足余量，否则会把汉字上半部分裁掉（"黄金ETF" 只剩 "ETF"）。
        pad = max(8.0, (bottom - top) * 0.6)
        top, bottom = top - pad, bottom + pad
        if bottom - top < 26:
            mid = (top + bottom) / 2
            top, bottom = mid - 13, mid + 13
        score = (lambda x: (sum(ch.isdigit() for ch in x), len(x))) if digit_only else None
        text = read_cell_best((rect[0] + cols[idx] + 1, rect[1] + top,
                               rect[0] + cols[idx + 1] - 1, rect[1] + bottom), score=score).strip()
        if not text or suspect(text):
            continue
        if require_cjk_if_nonascii and any(ord(ch) > 127 for ch in target[idx]):
            # 原来那格是"中文名被认坏"，补读结果必须含汉字，否则会用残缺的 "ETF" 覆盖中文名
            if not any("\u4e00" <= ch <= "\u9fa5" for ch in text):
                continue
        target[idx] = text
        fixed += 1
    return fixed


def repair_name_cells(table: OcrTable, rect: tuple[int, int, int, int]) -> int:
    """修正被 OCR 认错的「证券名称」（黄金ETF → E±ETF、æETF）。"""
    return _repair_column(table, rect, "证券名称", looks_garbled, require_cjk_if_nonascii=True)


def repair_symbol_cells(table: OcrTable, rect: tuple[int, int, int, int]) -> int:
    """修正被 OCR 认错的「证券代码」（518880 → S18880）。

    代码读错会直接导致下错标的，因此校验成 6 位数字，不合法就定点补读。
    """
    return _repair_column(table, rect, "证券代码", lambda s: not re.fullmatch(r"\d{6}", (s or "").strip()), digit_only=True)


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
    """截取 rect 区域并识别成表格。rect 为屏幕坐标 (left, top, right, bottom)。

    RapidOCR 自带文本检测，不需要 2.5 倍放大；默认 1.6 倍是"精度/速度"的折中。
    注意：实测 1.6 与 1.2 的**稳态**耗时几乎相同（都是 ~3.6s，差异主要来自模型首次加载），
    所以没有为了速度降低倍数。需要实验不同倍数时用 THSAPI_OCR_SCALE 覆盖。
    """
    if _use_rapid():
        try:
            tuned = float(os.environ.get("THSAPI_OCR_SCALE", "1.6"))
        except ValueError:
            tuned = 1.6
        scale = min(scale, max(1.0, tuned))
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
