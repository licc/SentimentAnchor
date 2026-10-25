"""把项目打包成可分发压缩包：只带源码与文档，不带运行数据和调试脚本。"""
from __future__ import annotations

import shutil
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(r"D:\jyauto")
STAMP = datetime.now().strftime("%Y%m%d")
NAME = f"thsapi-0.1.0-{STAMP}"
STAGE = ROOT / "dist" / NAME
ZIP = ROOT / "dist" / f"{NAME}.zip"

# 整个目录都带上
INCLUDE_DIRS = ["thsapi", "tests", "examples", "docs", "static", "deploy"]

# tools 里的一次性调试脚本不带
SKIP_TOOL_PREFIX = ("probe_", "debug_", "profile_", "diag_", "check_price", "check_encodings")

# 根目录散文件
INCLUDE_FILES = [
    "README.md",
    "INSTALL.md",
    "requirements.txt",
    "selectors.yaml",
    "run_api.bat",
    ".gitignore",
]

SKIP_DIR_NAMES = {"__pycache__", ".pytest_cache", ".git"}


def keep_tool(p: Path) -> bool:
    return not p.name.startswith(SKIP_TOOL_PREFIX)


def copy_tree(src: Path, dst: Path) -> None:
    for item in src.rglob("*"):
        if any(part in SKIP_DIR_NAMES for part in item.parts):
            continue
        rel = item.relative_to(src)
        target = dst / rel
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        if src.name == "tools" and rel.parent == Path(".") and not keep_tool(item):
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, target)


def main() -> None:
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)

    for d in INCLUDE_DIRS:
        copy_tree(ROOT / d, STAGE / d)
    copy_tree(ROOT / "tools", STAGE / "tools")

    for f in INCLUDE_FILES:
        shutil.copy2(ROOT / f, STAGE / f)

    # 打包内的 config.yaml 强制为 dry_run，避免新机器一上来就实盘
    cfg = (ROOT / "config.yaml").read_text(encoding="utf-8-sig")
    import re

    cfg = re.sub(r"(?m)^(\s*mode:\s*)\S+.*$", r"\1dry_run            # 首次使用请保持演练模式，确认无误后再改 live", cfg)
    (STAGE / "config.yaml").write_text(cfg, encoding="utf-8")

    # INSTALL.md 是 UTF-8，.bat 也要 UTF-8（脚本里已 chcp 65001）
    if ZIP.exists():
        ZIP.unlink()
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for item in sorted(STAGE.rglob("*")):
            if item.is_file():
                zf.write(item, item.relative_to(STAGE.parent))

    files = [p for p in STAGE.rglob("*") if p.is_file()]
    total = sum(p.stat().st_size for p in files)
    print(f"打包完成: {ZIP}")
    print(f"  文件数 : {len(files)}")
    print(f"  源大小 : {total/1024:.0f} KB")
    print(f"  压缩后 : {ZIP.stat().st_size/1024:.0f} KB")
    print("\n包含：")
    for d in INCLUDE_DIRS + ["tools"]:
        n = len([p for p in (STAGE / d).rglob("*") if p.is_file()])
        print(f"  {d:10s} {n} 个文件")
    print(f"  根目录     {len(INCLUDE_FILES)+1} 个文件（含 config.yaml）")


if __name__ == "__main__":
    main()
