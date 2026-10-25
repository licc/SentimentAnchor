"""验证打出来的压缩包：解压到临时目录，检查内容 + 跑测试。"""
from __future__ import annotations

import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ZIP = Path(r"D:\jyauto\dist\thsapi-0.1.0-20261023.zip")
tmp = Path(tempfile.mkdtemp(prefix="thsapi_pkg_"))

with zipfile.ZipFile(ZIP) as zf:
    names = zf.namelist()
    zf.extractall(tmp)

root = next(p for p in tmp.iterdir() if p.is_dir())
print("解压到:", root)
print("顶层条目:", sorted(p.name for p in root.iterdir()))

bad = [n for n in names if "__pycache__" in n or n.endswith(".pyc") or ".pytest_cache" in n]
print("垃圾文件:", bad or "无")

cfg = (root / "config.yaml").read_text(encoding="utf-8")
mode_line = next((ln.strip() for ln in cfg.splitlines() if ln.strip().startswith("mode:")), "")
print("config mode:", mode_line)

print("\n跑单测：")
r = subprocess.run(
    [sys.executable, "-m", "pytest", "tests", "-q"],
    cwd=root,
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="replace",
)
print("  ", (r.stdout or "").strip().splitlines()[-1] if r.stdout else r.stderr[-300:])

print("\n导入检查：")
r2 = subprocess.run(
    [sys.executable, "-c", "import thsapi.api, thsapi.service, thsapi.gui.ths; print('import ok')"],
    cwd=root,
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="replace",
)
print("  ", (r2.stdout or r2.stderr).strip()[-200:])
