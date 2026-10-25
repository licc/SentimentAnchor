"""RapidOCR（PaddleOCR 的 ONNX 离线版）引擎封装。

为什么需要它
------------
持仓表是自绘控件，只能截屏识别，而客户端里汉字实际只有 **12px 高**。
Windows 自带 OCR（Windows.Media.Ocr）在这个字号下不稳定：实测同一句话
「黄金ETF」在 18px 时会被认成「黄±ETF」，12px 直接认不出；
证券代码也会把 5 认成 S。RapidOCR 使用检测+识别两阶段模型，
对小字号中文的准确率高得多，且完全离线（模型随 pip 包分发）。

坐标约定：返回的 left/top/width/height 与传入图片同一像素尺度，
调用方不需要再换算（ocr_table.read_table 会统一除以放大倍数）。
"""
from __future__ import annotations

import logging
import threading

log = logging.getLogger("thsapi.ocr.rapid")

_ENGINE = None
_LOCK = threading.Lock()


def available() -> bool:
    """rapidocr-onnxruntime 是否可用（未安装时应静默回退到 Windows OCR）。"""
    try:
        import rapidocr_onnxruntime  # noqa: F401
        return True
    except Exception:  # pragma: no cover - 取决于环境
        return False


def _engine():
    global _ENGINE
    if _ENGINE is None:
        from rapidocr_onnxruntime import RapidOCR

        # 引擎初始化要加载两个 onnx 模型，约 1~2 秒，必须复用
        _ENGINE = RapidOCR()
    return _ENGINE


def warmup() -> None:
    """预热：让首次真实识别不必等待模型加载。"""
    from PIL import Image

    img = Image.new("RGB", (64, 24), "white")
    recognize(img)


def recognize(
    img, *, min_score: float = 0.5, single_line: bool = False
) -> list[tuple[str, float, float, float, float]]:
    """识别整张图，返回 [(text, left, top, width, height), ...]。

    min_score 过滤低置信度结果：小字号里"猜"出来的字符置信度通常明显偏低。
    single_line=True 时跳过文本检测，直接把整图当一行送进识别模型——
    单元格补读场景下快一个数量级（约 46ms vs 1.7s），且更准。
    """
    import numpy as np

    arr = np.array(img.convert("RGB"))
    kwargs = {"use_det": False, "use_cls": False} if single_line else {}
    with _LOCK:  # 引擎内部状态不是线程安全的
        result, _elapse = _engine()(arr, **kwargs)
    out: list[tuple[str, float, float, float, float]] = []
    for item in result or []:
        try:
            if not isinstance(item[0], str):  # 带检测：[[box, text, score], ...]
                box, text, score = item[0], item[1], float(item[2])
                xs = [float(p[0]) for p in box]
                ys = [float(p[1]) for p in box]
                left, top = min(xs), min(ys)
                width, height = max(xs) - left, max(ys) - top
            else:  # 单行模式：[[text, score], ...]
                text, score = item[0], float(item[1])
                left, top, width, height = 0.0, 0.0, float(img.width), float(img.height)
        except Exception:  # pragma: no cover - 返回结构异常时跳过该条
            continue
        if not text or score < min_score:
            continue
        out.append((text, left, top, width, height))
    return out
