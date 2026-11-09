"""Solv3R demo.  Runs locally (python demo/app.py) and as a Hugging Face Space on ZeroGPU.

The page is one web app (demo/static/ui.js); Gradio serves it and runs the requests it sends.  Every request is one
event: the app calls trigger('submit', {op, ...}) and the handler streams progress and the result back through a small
message channel (the "bus" component) that the app watches.
"""
import copy
import os
import queue
import re
import sys
import threading
import time
import traceback

try:                                                  # before torch: ZeroGPU sets up CUDA on import
    import spaces
    GPU = spaces.GPU
except ImportError:                                   # outside Hugging Face: the local GPU
    def GPU(fn=None, **kw):
        return fn if fn is not None else (lambda f: f)

import gradio as gr  # noqa: E402
import cv2
import numpy as np
from PIL import Image, ImageOps  # noqa: E402
import torch  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, ROOT)
import engine as E  # noqa: E402

STATIC = os.path.join(HERE, "static")
EXAMPLES = next((d for d in (os.path.join(HERE, "examples"), os.path.join(ROOT, "examples", "data")) if os.path.isdir(d)), None)
ON_SPACE = bool(os.environ.get("SPACE_ID"))
LIMITED = ON_SPACE or bool(os.environ.get("SOLV3R_DEMO_LIMITS"))
LIMITS = dict(offline=64, stages=64, stream=400, large=256) if LIMITED else dict(offline=160, stages=160, stream=3000, large=1024)
gr.set_static_paths(paths=[p for p in (STATIC, E.OUT, EXAMPLES) if p])
if torch.cuda.is_available() or ON_SPACE:
    E.model()                                         # on ZeroGPU the weights go to the GPU at start-up


def url(path):
    return f"/gradio_api/file={path}"


def device_info():
    if ON_SPACE:
        return "ZeroGPU"
    if torch.cuda.is_available():
        p = torch.cuda.get_device_properties(0)
        return f"{p.name.replace('NVIDIA ', '')} · {p.total_memory / 2 ** 30:.0f} GB"
    return "CPU"


# ---------------------------------------------------------------------- examples
def natural(p):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", os.path.basename(p))]


def folder_images(d):
    return sorted((os.path.join(d, f) for f in os.listdir(d) if f.lower().endswith((".jpg", ".jpeg", ".png"))), key=natural)


EXAMPLE_SETS = [   # name, folder, mode, title, description, options (every: frame step; params: solver settings; credit)
    ("park", "park", "Offline", "Park", "39 drone photos", dict(sky=True, params=dict(calls=16))),
    ("fr3str", "fr3str", "Offline", "Poster wall", "32 frames of a handheld video", dict(params=dict(calls=16), mv=2, credit="tum")),
    ("irving", "irving", "Incremental", "Library", "12 photos of one wing, then 28 more are added: the whole front",
     dict(sky=True, join=12, params=dict(calls1=16, calls2=16))),
    ("sofas", "sofas", "Incremental", "Sofas", "8 video frames, then 10 more are added: two sofas, then three",
     dict(join=8, params=dict(calls1=12, calls2=12))),
    ("tum", "tum", "Streaming", "Office desk", "a 64-frame handheld video", dict(params=dict(config="L8"), conf=90, credit="tum")),
    ("chem", "chem", "Streaming", "Building", "a 56-frame phone video", dict(sky=True, params=dict(config="L8"))),
]


def examples_meta():
    out = []
    for key, folder, mode, title, sub, opt in EXAMPLE_SETS:
        d = os.path.join(EXAMPLES or "", folder)
        if not EXAMPLES or not os.path.isdir(d):
            continue
        ims = folder_images(d)[::opt.get("every", 1)]
        k = opt.get("join") or len(ims)                 # Incremental: the first k are the input, the rest join
        out.append(dict(key=key, mode=mode, title=title, sub=sub, n=k, thumb=url(ims[len(ims) // 3]),
                        images=[url(q) for q in ims[:k][::max(1, k // 24)][:24]], join=[url(q) for q in ims[k:]],
                        sky=bool(opt.get("sky")), params=opt.get("params", {}), credit=opt.get("credit", ""),
                        conf=opt.get("conf", 100)))
    return out


def example_paths(key):
    for k, folder, mode, *_ , opt in EXAMPLE_SETS:
        if k == key:
            return folder_images(os.path.join(EXAMPLES, folder))[::opt.get("every", 1)]
    raise ValueError(f"unknown example {key}")


def example_opt(key):
    return next((opt for k, *_, opt in EXAMPLE_SETS if k == key), {})


def example_join(key):
    return next((opt.get("join") for k, *_, opt in EXAMPLE_SETS if k == key), None)


# ---------------------------------------------------------------------- jobs on the GPU
def _paths_of(req):
    if req.get("example"):
        return example_paths(req["example"])
    if req.get("video"):
        return E.extract_frames(req["video"], int(req.get("frames", 96)))
    paths = [p for p in req.get("files", []) if p.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".bmp"))]
    return sorted(paths, key=natural)


def _spread(paths, n):
    if len(paths) <= n:
        return paths
    return [paths[i] for i in np.linspace(0, len(paths) - 1, n).round().astype(int)]


def _solve(req, prog):
    mode = req["mode"]
    p = req.get("params", {})
    paths = _paths_of(req)
    if not paths:
        raise gr.Error("Add photos or a video first, or pick an example.")
    if mode == "Streaming":
        paths = _spread(paths, LIMITS["stream"])
        if len(paths) < 8:
            raise gr.Error("Streaming needs at least 8 frames.")
        labels = [os.path.splitext(os.path.basename(x))[0] for x in paths]
        return E.solve_stream(paths, labels, p.get("config", "L8"), progress=prog), None, None
    if mode == "Incremental":                        # the input is solved first, then the other views join it once
        if req.get("example"):
            k = example_join(req["example"]) or len(paths) // 2
            first, later = paths[:k], paths[k:]
        else:
            first, later = paths, list(req.get("join") or [])
        if not later:
            raise gr.Error("Add the views that join later.")
        first, later = first[:LIMITS["stages"] // 2], later[:LIMITS["stages"] - min(len(first), LIMITS["stages"] // 2)]
        paths = first + later
        prog(0.0, f"Loading {len(paths)} images")
        images = E.load_images(paths)
        labels = [os.path.splitext(os.path.basename(x))[0] for x in paths]
        stages = [list(range(len(first))), list(range(len(first), len(paths)))]
        return E.solve_stages(images, labels, paths, stages, calls=[int(p.get("calls1", 12)), int(p.get("calls2", 12))],
                              progress=prog, mode="incremental")
    if not req.get("example"):                       # the examples are sized for the Space already
        paths = _spread(paths, LIMITS["large" if mode == "Large scene" else "offline"])
    prog(0.0, f"Loading {len(paths)} images")
    images = E.load_images(paths)
    labels = [os.path.splitext(os.path.basename(x))[0] for x in paths]
    if mode == "Offline":
        sess, rec = E.solve_offline(images, labels, paths, calls=int(p.get("calls", 16)),
                                    adaptive=float(np.clip(float(p.get("tol", 0.02)), 0.005, 0.1)) if p.get("adaptive") else None, progress=prog)
        return sess, rec, [0] * sess.V
    if mode == "Large scene":
        sess, rec = E.solve_stochastic(images, labels, paths, per_call=int(p.get("per_call", 8)),
                                       updates=int(p.get("updates", 32)), progress=prog)
        return sess, rec, [0] * sess.V
    stages = E.stages_of(len(paths), int(p.get("initial", 8)), int(p.get("group", 4)),
                         "random" if mode == "Any order" else "file", seed=int(p.get("seed", 0)))
    return E.solve_stages(images, labels, paths, stages, calls=int(p.get("calls", 8)), progress=prog,
                          mode=mode.lower().replace(" ", "_"))


def _continue(req, sess, prog):
    return (*E.continue_solve(sess, int(req.get("calls", 64)), progress=prog), None)


def _add(req, sess, prog):
    paths = sorted(req.get("files", []), key=natural)
    if not paths:
        raise gr.Error("Add the new photos first.")
    images = E.load_images(paths, size=sess.hw)
    labels = [os.path.splitext(os.path.basename(x))[0] for x in paths]
    return E.add_photos(sess, images, labels, paths, int(req.get("calls", 16)), progress=prog)


def _fixed(req, sess, prog):
    paths = sorted(req.get("files", []), key=natural)
    if not paths:
        raise gr.Error("Add the new photos first.")
    images = E.load_images(paths, size=sess.hw)
    labels = [os.path.splitext(os.path.basename(x))[0] for x in paths]
    return E.add_fixed(sess, images, labels, paths, int(req.get("calls", 16)), progress=prog)


MAX_VIDEO_SECS = 120
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic", ".heif")
try:                                                  # HEIC photos from phones
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    IMAGE_EXT = IMAGE_EXT[:5]


def _thumb(path, d, h=120):
    im = cv2.imread(path)
    t = os.path.join(d, "t_" + os.path.basename(path))
    cv2.imwrite(t, cv2.resize(im, (max(1, round(h * im.shape[1] / im.shape[0])), h), interpolation=cv2.INTER_AREA),
                [cv2.IMWRITE_JPEG_QUALITY, 80])
    return t


def photos_as_jpg(src):
    """Uploaded photos as .jpg (HEIC read, EXIF orientation applied, long side at most 1008), in a new folder."""
    d = E.new_dir("photos")
    paths = []
    for i, q in enumerate(src):
        try:
            im = ImageOps.exif_transpose(Image.open(q)).convert("RGB")
        except Exception:                             # noqa: BLE001 - an unreadable file is skipped
            continue
        im.thumbnail((1008, 1008), Image.LANCZOS)
        out = os.path.join(d, f"{i:04d}_{os.path.splitext(os.path.basename(q))[0]}.jpg")
        im.save(out, quality=95)
        paths.append(out)
    if not paths:
        raise gr.Error("None of the images could be read.")
    return paths


def prepare(req):
    """Preprocessing on the CPU, before any GPU time: frames from a video, or the photos resized; with thumbnails."""
    cap = LIMITS["stream"] if req.get("mode") == "Streaming" else LIMITS["offline"]
    note = ""
    if req.get("video"):
        v = req["video"]
        info = E.video_info(v)
        if req.get("frames"):
            n = int(np.clip(int(req["frames"]), 8, cap))
        else:                                         # the browser could not read the length (e.g. HEVC): choose here
            per = 4.0 if req.get("mode") == "Streaming" else 1.2  # frames per second of video
            secs = min(info["duration"] or 30, MAX_VIDEO_SECS)
            n = int(np.clip(round(secs * per), 8, cap))
        paths = E.extract_frames(v, n, max_secs=MAX_VIDEO_SECS)
        dur = info["duration"]
        if not paths:
            raise gr.Error("No frames could be read from this video.")
        used = min(dur, MAX_VIDEO_SECS) if dur else None
        what = f"{len(paths)} frames from {int(used // 60)}:{int(used % 60):02d}" if used else f"{len(paths)} frames"
        if dur and dur > MAX_VIDEO_SECS:
            note = f" (the first {MAX_VIDEO_SECS // 60} minutes of {int(dur // 60)}:{int(dur % 60):02d})"
        text = f"{what}{note}, one every {used / len(paths):.2f} s" if used else what
        d = os.path.dirname(paths[0])
    else:
        src = sorted((p for p in req.get("files", []) if p.lower().endswith(IMAGE_EXT)), key=natural)
        if not src:
            raise gr.Error("No images among the uploaded files.")
        n_all = len(src)
        if n_all > cap:
            src = _spread(src, cap)
            note = f", {cap} of them spread over the set (the limit here)"
        paths = photos_as_jpg(src)
        d = os.path.dirname(paths[0])
        text = f"{n_all} photo{'s' * (n_all != 1)}{note}"
    thumbs = [url(_thumb(q, d)) for q in paths]
    return dict(files=paths, thumbs=thumbs, n=len(paths), text=text)


JOBS = dict(solve=_solve, more=_continue, add=_add, fixed=_fixed)


def _duration(op, req, sess=None):
    n = (len(req.get("files", [])) + len(req.get("join", []))) or 64
    if op == "solve":
        k = dict(Offline=0.8, Incremental=1.5, **{"Any order": 1.5}, Streaming=0.15, **{"Large scene": 1.2}).get(req.get("mode"), 1)
        if req.get("example"):
            n = 150 if "desk" in req["example"] else 40
        return int(min(300, 40 + k * n))
    if op == "more":
        return int(min(300, 20 + (sess.V if sess else 64) * int(req.get("calls", 64)) * 0.006))
    if op == "add":                                   # the new views join: every view gets the calls
        return int(min(300, 30 + ((sess.V if sess else 64) + n) * int(req.get("calls", 16)) * 0.006))
    return int(min(240, 30 + (sess.V if sess else 64) * 0.8 + n * (1 + int(req.get("calls", 8)) * 0.02)))


@GPU(duration=_duration)
def gpu_job(op, req, sess=None):
    """Runs one job, yielding ("progress", fraction, text) and finally ("done", result)."""
    q, box = queue.Queue(), {}

    def prog(f, d="", extra=None):
        q.put(("progress", float(f), str(d), extra))

    def work():
        try:
            box["out"] = JOBS[op](req, prog) if op == "solve" else JOBS[op](req, sess, prog)
        except BaseException as e:           # noqa: BLE001 - surfaced to the page below
            box["err"] = e
        finally:
            q.put(None)

    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()
    threading.Thread(target=work, daemon=True).start()
    last, pend = 0.0, []
    while True:
        item = q.get()
        if item is None:
            break
        pend += item[3] or []                     # live cameras are never dropped, only batched
        if time.time() - last > 0.12 or item[1] >= 1:
            last = time.time()
            yield ("progress", item[1], item[2], pend)
            pend = []
    if "err" in box:
        raise box["err"]
    yield ("done", box["out"])


# ---------------------------------------------------------------------- results for the page
def summary(sess):
    if sess is None:
        return None
    m = dict(mode=sess.mode.replace("_", " "), views=sess.V, kind=sess.kind)
    if sess.kind == "stream":
        s = sess.stream
        m.update(config=s["config"], ms_frame=round(s["ms"], 1), refreshes=int(sum(s["refreshed"])))
    else:
        m.update(calls=sess.calls)
        if sess.ms_per_call:
            m["ms_call"] = round(float(np.median(sess.ms_per_call)), 1)
        if sess.residual:
            m["change"] = sess.residual[-1][1]
            m["residual"] = [[int(c), float(r)] for c, r in sess.residual[-2000:]]
    if sess.peak_gb:
        m["peak_gb"] = round(sess.peak_gb, 2)
    if sess.gpu:
        m["gpu"] = sess.gpu
    m["log"] = sess.log[-12:]
    return m


def pack(sess, rec, first, title, exposure=1.0, horizon=None, graze=None, firstseen=False, mv=None):
    path = os.path.join(E.new_dir("pack"), "solve.s3r")
    if sess.kind == "stream":
        meta = E.pack_stream_session(sess, path, sky=sess.sky, exposure=exposure, horizon=horizon, graze=graze, firstseen=firstseen)
    else:
        meta = rec.pack(path, sess.labels, first, title=title, frame=sess.frame, sky=sess.sky, exposure=exposure, horizon=horizon,
                        final=sess.final, mv=mv)
        sess.hist = (rec, list(first))                # a continuation of this solve plays after it
        sess.view_keep = meta.get("view_keep", 1.0)   # downloads keep what the viewer shows
        if sess.frame is None:
            f = meta["frame"]
            sess.frame = (np.array(f["center"]), f["radius"], np.array(f["R"]), meta["aerial"])
    return dict(url=url(path), title=title, mb=round(meta["bytes"] / 1e6, 1))


MV = int(os.environ.get("SOLV3R_MV", 0)) or None              # test rig: the floater filter on every solve


def msg(rid, kind, **kw):
    return dict(id=rid, type=kind, t=time.time(), **kw)


def handle(sess, evt: gr.EventData):
    req = dict(evt._data or {})
    rid, op = req.get("id"), req.get("op")
    try:
        if op == "prepare":
            yield sess, msg(rid, "progress", f=0.2, text="Preprocessing")
            yield sess, msg(rid, "prepared", **prepare(req))
            return
        if op == "export":
            if sess is None:
                raise gr.Error("Solve a scene first.")
            yield sess, msg(rid, "progress", f=0.3, text="Preparing the export")
            kind, keep = req.get("kind", "ply"), float(req.get("keep", 50)) / 100
            path = {"ply": E.export_ply, "colmap": E.export_colmap, "npz": lambda s, k: E.export_npz(s)}[kind](sess, keep)
            yield sess, msg(rid, "download", url=url(path), name=os.path.basename(path),
                            mb=round(os.path.getsize(path) / 1e6, 1))
            return
        if op in ("more", "add", "fixed"):
            if sess is None:
                raise gr.Error("Solve a scene first.")
            if sess.kind == "stream":
                raise gr.Error("A stream keeps only its recent frames. Solve the scene in another mode to keep solving it.")
        if op == "solve" and req.get("join"):           # Incremental: the views that join, as .jpg before any GPU time
            src = sorted((q for q in req["join"] if q.lower().endswith(IMAGE_EXT)), key=natural)
            req["join"] = photos_as_jpg(src[:LIMITS["stages"]]) if src else []
        if op in ("add", "fixed"):                    # the new views as .jpg, on the CPU before any GPU time
            src = sorted((q for q in req.get("files", []) if q.lower().endswith(IMAGE_EXT)), key=natural)
            if not src:
                raise gr.Error("Add the new photos first.")
            req["files"] = photos_as_jpg(src[:LIMITS["offline"]])
        if op not in JOBS:
            raise gr.Error(f"unknown request {op}")
        t0 = time.time()
        out = None
        hist, job = getattr(sess, "hist", None), sess   # the history stays in this process (not sent to the GPU worker)
        if hist:
            job = copy.copy(sess); job.hist = None
        for item in gpu_job(op, req, job):
            if item[0] == "progress":
                yield sess, msg(rid, "progress", f=item[1], text=item[2], **({"cams": item[3]} if item[3] else {}))
            else:
                out = item[1]
        yield sess, msg(rid, "progress", f=1.0, text="Done. Preparing the 3D view")
        new, rec, first = out
        if op == "solve":
            new.sky = bool(req.get("params", {}).get("sky"))
            new.source = req.get("source", "")
            title = f"{req['mode']} · {new.source}" if new.source else req["mode"]
        else:
            title = {"more": f"{new.source} · continued to call {new.calls}" if new.source else f"Continued to call {new.calls}",
                     "add": f"{new.source} · {len(req.get('files', []))} photos joined" if new.source else "New photos joined",
                     "fixed": f"{new.source} · {len(req.get('files', []))} photos added, scene frozen" if new.source
                     else "New photos added, scene frozen"}[op]
            first = first or [0] * new.V
            if hist:
                rec, first = E.with_history(hist, rec, first)
        xo = example_opt(req.get("example"))
        view = pack(new, rec, first, title, exposure=xo.get("exposure", 1.0), horizon=xo.get("horizon"), graze=xo.get("graze"), firstseen=xo.get("firstseen", False),
                    mv=xo.get("mv", MV))
        view["keepView"] = op != "solve"
        yield new, msg(rid, "result", view=view, summary=summary(new), secs=round(time.time() - t0, 1))
    except gr.Error as e:
        yield sess, msg(rid, "error", text=str(e.message if hasattr(e, "message") else e))
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        text = "The GPU ran out of memory: try fewer views." if isinstance(e, torch.OutOfMemoryError) else f"{type(e).__name__}: {e}"
        yield sess, msg(rid, "error", text=text)


# ---------------------------------------------------------------------- page
SHELL_JS = """
const base = props.base;
element.style.height = '100%';
import(base + '/ui.js?v=' + props.v).then((m) => m.mount(element.querySelector('#s3r-app'), { trigger, upload, props }))
  .catch((e) => { console.error('Solv3R app', e); element.textContent = 'The app could not load: ' + e; });
"""
BUS_JS = """
watch('value', () => { const v = props.value; if (v) window.__s3rBus ? window.__s3rBus(v) : (window.__s3rQueue = (window.__s3rQueue || []).concat([v])); });
"""
PAGE_CSS = """
html, body { background: #0c0f14 !important; }
body, gradio-app, .gradio-container, .main, .wrap, .contain { margin: 0 !important; padding: 0 !important; max-width: none !important; background: #0c0f14 !important; }
.gradio-container > .main > .wrap { padding: 0 !important; }
footer, .show-api, .built-with { display: none !important; }
#s3r-shell { position: relative; }   /* in the page flow: the Space frame takes the page's height */
#s3r-bus { display: none !important; }
"""
HEAD = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
        '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">')


def build():
    with gr.Blocks(title="Solv3R: 3D Looped Transformer as a Multi-view Solver") as demo:
        state = gr.State(None)
        shell = gr.HTML("", html_template='<div id="s3r-app"><div style="height:480px;display:grid;place-items:center;color:#7e8a9b;font:13px system-ui,sans-serif">Loading Solv3R…</div></div>', js_on_load=SHELL_JS, elem_id="s3r-shell",
                        apply_default_css=False,
                        base=url(STATIC), v=str(int(max(os.path.getmtime(os.path.join(STATIC, f)) for f in ("ui.js", "ui.css", "app.js", "solve.js")))),
                        examples=examples_meta(), device=device_info(), limits=LIMITS, space=ON_SPACE,
                        head=HEAD)
        bus = gr.HTML(None, html_template="", js_on_load=BUS_JS, elem_id="s3r-bus")
        job = shell.submit(handle, [state], [state, bus], show_progress="hidden", concurrency_limit=1)
        shell.input(None, None, None, cancels=[job])                     # the app's Stop button
    return demo


demo = build().queue(max_size=32)

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("GRADIO_SERVER_PORT", os.environ.get("PORT", 7860))))
    ap.add_argument("--host", default=os.environ.get("GRADIO_SERVER_NAME", "0.0.0.0" if ON_SPACE else "127.0.0.1"))
    a = ap.parse_args()
    demo.launch(server_name=a.host, server_port=a.port, css=PAGE_CSS, show_error=True, ssr_mode=False,
                allowed_paths=[p for p in (STATIC, E.OUT, EXAMPLES) if p], footer_links=[],
                favicon_path=os.path.join(STATIC, "favicon.svg"))
