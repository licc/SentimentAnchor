"""直连客户端，打印 positions() 的原始行（与 API 同一路径）。"""
import json
import sys
import time
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from thsapi.config import load_config
from thsapi.gui.ths import ThsClient

cfg = load_config()
c = ThsClient(cfg)
rows, account = c.positions()
print("account:", json.dumps(account, ensure_ascii=False))
for r in rows:
    print("row:", json.dumps(r, ensure_ascii=False))
