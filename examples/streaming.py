"""Streaming reconstruction of a video: every frame is answered when it arrives.

Frames are read in file-name order. Writes <out>/stream.npz (camera-to-world of every frame on arrival and when it left
the recent window, intrinsics, depth on arrival), <out>/stream.ply (points of the depth maps on arrival) and
<out>/stream.html (the stream in a browser viewer, played frame by frame).

usage: python examples/streaming.py --frames path/to/frames --out outputs/streaming [--config L8 | L4 | S4]
"""
import argparse
import dataclasses
import os
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from solv3r import PRESETS, Solv3R, StreamingSolver, list_images, load_images  # noqa: E402
from solv3r.export import write_ply  # noqa: E402
from solv3r.streaming import StreamResult  # noqa: E402
from solv3r.viewer import save_stream_viewer  # noqa: E402
from solv3r.viewer.pack import stream_export, to_u8  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--frames", required=True, help="a folder of video frames or a video file")
    ap.add_argument("--out", required=True)
    ap.add_argument("--checkpoint", default=None, help="a .safetensors file or a Hugging Face repo id (default: checkpoints/ if present, else the released weights)")
    ap.add_argument("--config", default="L8", choices=("L8", "L4", "S4"))
    ap.add_argument("--stride", type=int, default=1)
    ap.add_argument("--max-frames", type=int, default=None)
    ap.add_argument("--memory-stride", default="auto", help="every how many frames one joins the memory: auto (from the "
                    "number of frames: denser for short videos, at most the config's 16) or a number (16: the paper's setting)")
    ap.add_argument("--keep", type=float, default=1.0, help="fraction of the stream's points in the .ply, the most confident "
                    "first (1: all; points on depth edges always leave), as the demo's confidence filtering")
    ap.add_argument("--sky-mask", action="store_true", help="leave the sky out of the point cloud (outdoor captures)")
    a = ap.parse_args()

    model = Solv3R.from_pretrained(a.checkpoint)
    paths = list_images(a.frames, a.stride, a.max_frames)
    size = load_images(paths[:1]).shape[-2:]
    frames = (load_images([p], size)[0] for p in paths)   # read one at a time: long videos do not fill the memory
    cfg = PRESETS[a.config]                             # auto: short inputs get a denser memory (up to every frame), long ones the preset's stride
    stride = min(cfg.memory_stride, max(1, -(-len(paths) // cfg.memory))) if a.memory_stride == "auto" else int(a.memory_stride)
    cfg = dataclasses.replace(cfg, memory_stride=stride)
    solver = StreamingSolver(model, cfg, depth=True)
    for i, frame in enumerate(frames):
        answered = solver.push(frame)
        if answered and i % 50 == 0:
            print(f"frame {i}: answered {answered}")
    res = solver.result()
    print(f"{len(paths)} frames, memory stride {stride}, {res.ms_per_frame:.1f} ms per frame (solver), memory refreshed at "
          f"{sum(res.refreshed)} frames")
    os.makedirs(a.out, exist_ok=True)
    np.savez_compressed(f"{a.out}/stream.npz", c2w=res.c2w, c2w_exit=res.c2w_exit, K=res.intrinsics,
                        depth=res.depth.astype(np.float16), depth_conf=res.depth_conf.astype(np.float16),
                        names=np.array([os.path.basename(p) for p in paths]))
    def frames_of(sel):                                   # uint8 frames, read a chunk at a time (long videos)
        return torch.cat([to_u8(load_images([paths[i] for i in sel[k:k + 64]], size)) for k in range(0, len(sel), 64)])

    def part(sel):                                        # the stream's result for the frames sel
        return StreamResult(**{f: (getattr(res, f)[sel] if isinstance(getattr(res, f), np.ndarray) and len(getattr(res, f)) == len(paths)
                                   else getattr(res, f)) for f in res.__dataclass_fields__})

    every = max(1, -(-len(paths) * size[0] * size[1] * a.keep // 20e6))   # at most ~20M points in the exported cloud
    idx = list(range(0, len(paths), int(every)))
    xyz, rgb = stream_export(frames_of(idx), part(idx), a.keep, a.sky_mask)   # the points the viewer shows, every pixel
    write_ply(f"{a.out}/stream.ply", xyz, rgb)
    every = max(1, -(-len(paths) // 1500))              # the viewer: at most 1,500 frames, about a million points
    sel = list(range(0, len(paths), every))
    save_stream_viewer(f"{a.out}/stream.html", frames_of(sel), part(sel), [os.path.basename(paths[i]) for i in sel], sky=a.sky_mask,
                       per_frame=int(np.clip(1_000_000 / len(sel), 300, 8000)), title=os.path.basename(os.path.normpath(a.frames)),
                       stats=[f"{len(paths)} frames", f"{res.ms_per_frame:.0f} ms per frame"])

if __name__ == "__main__":
    main()
