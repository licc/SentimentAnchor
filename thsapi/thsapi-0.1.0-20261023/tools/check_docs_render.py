import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import thsapi.webdocs as w

h = w.render("0.1.0", "live", 8888, False)
print("shot css :", ".shot{" in h)
print("img tag  :", 'class="shot"' in h)
print("images   :", h.count("/shots/"))
print("len      :", len(h))
