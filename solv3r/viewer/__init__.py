"""The browser viewer of the demo (and of the project page) for any solve: eye-dome lit points, glowing cameras and
camera path, the solve played call by call (a stream frame by frame), view chips, point and camera size, confidence
filtering.  A Recorder keeps snapshots of a solve while it runs; save_solve_viewer / save_stream_viewer pack them and
write one .html file that opens from disk.

    rec = Recorder(images)
    z = model.start(ctx); rec.cameras(model, z, ctx, 0)
    for call in range(1, 17):
        z = model.step(z, ctx); rec.record(model, z, ctx, call)
    rec.close(model, z, ctx, call)
    save_solve_viewer("solve.html", rec, names)
"""
import os

from .pack import SNAPS, Recorder, pack_stream_result
from .page import write_html

__all__ = ["SNAPS", "Recorder", "save_solve_viewer", "save_stream_viewer", "write_html"]


def save_solve_viewer(path, rec, labels, first_snap=None, title="Solv3R", stats=(), **kw):
    """rec: a Recorder of the solve; labels: the views' names (in the solve's order); first_snap: per view, the index of
    the snapshot it joined at (default: all from the start).  kw: Recorder.pack options (sky=True leaves the sky out,
    horizon=deg for aerial captures, n_pts)."""
    tmp = f"{path}.s3r"
    meta = rec.pack(tmp, list(labels), [0] * len(labels) if first_snap is None else list(first_snap), title=title, **kw)
    try:
        write_html(path, tmp, title, stats)
    finally:
        os.remove(tmp)
    return meta                                   # meta["view_keep"]: what save_solve needs to keep the same points


def save_stream_viewer(path, images, res, labels=None, title="Solv3R", stats=(), **kw):
    """images (F, 3, H, W) the frames; res: the StreamResult of a StreamingSolver(depth=True) run.  kw:
    pack_stream_result options (sky=True, horizon, per_frame)."""
    tmp = f"{path}.s3r"
    pack_stream_result(tmp, images, res, labels, title=title, **kw)
    try:
        return write_html(path, tmp, title, stats)
    finally:
        os.remove(tmp)
