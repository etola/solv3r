"""One .html file that shows a packed solve in the demo's viewer and opens from disk: the viewer's modules travel inside
the page (data URLs in its import map) and the pack as base64; three.js r160 comes from jsDelivr, as for the project
page."""
import base64
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
THREE = "https://cdn.jsdelivr.net/npm/three@0.160.0/"

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<style>
html, body { margin: 0; height: 100%; background: #05070b; color: #dce3ec; color-scheme: dark; -webkit-font-smoothing: antialiased; }
body { font: 13px/1.5 "Inter", "Noto Sans", system-ui, -apple-system, "Segoe UI", sans-serif; }
#stage { position: fixed; inset: 0; }
#stage.s3r { border: 0; border-radius: 0; }
#stage *, #stage *::before, #stage *::after { box-sizing: border-box; }
#stage button { font: inherit; color: inherit; }
#stage svg { display: block; }
#stage [hidden] { display: none !important; }
__CSS__
</style>
<script type="importmap">__IMPORTS__</script>
</head><body><div id="stage"></div>
<script id="pack" type="application/octet-stream">__PACK__</script>
<script type="module">
import { mount } from 'solv3r/stage.js';
const b = atob(document.getElementById('pack').textContent.trim()), u = new Uint8Array(b.length);
for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
const url = URL.createObjectURL(new Blob([u], { type: 'application/octet-stream' }));
(window.solv3r = mount(document.getElementById('stage'))).show(Object.assign({ url }, __SPEC__));   // window.solv3r: for scripted captures
</script>
</body></html>
"""


def _data_url(path):
    return "data:text/javascript;base64," + base64.b64encode(path.read_bytes()).decode()


def write_html(path, pack, title="Solv3R", stats=()):
    """path: the .html to write; pack: a packed solve (file path or bytes, solv3r.viewer.pack)."""
    raw = pack if isinstance(pack, (bytes, bytearray)) else Path(pack).read_bytes()
    imports = {"three": THREE + "build/three.module.min.js", "three/addons/": THREE + "examples/jsm/",
               "solv3r/solve.js": _data_url(HERE / "solve.js"), "solv3r/stage.js": _data_url(HERE / "stage.js")}
    page = (PAGE.replace("__CSS__", (HERE / "stage.css").read_text())
                .replace("__IMPORTS__", json.dumps({"imports": imports}))
                .replace("__SPEC__", json.dumps(dict(title=title, stats=list(stats))))
                .replace("__TITLE__", title.replace("&", "&amp;").replace("<", "&lt;"))
                .replace("__PACK__", base64.b64encode(raw).decode()))
    Path(path).write_text(page)
    return path
