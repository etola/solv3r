# Solv3R demo

An interactive demo of Solv3R: solve photos or a video offline, incrementally or as a stream, watch the solve call by call, keep
solving from the result (more calls, or new photos that join the solve or are added with the scene frozen) and
export the result.

```bash
pip install -e ".[demo]"
python demo/app.py            # http://127.0.0.1:7860
```

The same app runs as a Hugging Face Space on ZeroGPU.

| Mode | What it does |
|---|---|
| Offline | all views are solved together |
| Incremental | views join the ongoing solve in groups, in file order |
| Streaming | frames are answered on arrival (paper Table 8 configurations) |

Exports: the point cloud (`.ply`), a COLMAP text model with the images (`.zip`, e.g. for Gaussian splatting) and the
cameras and depth maps (`.npz`).

The viewer, its timeline and the view chips come from the project page; `demo/static/vendor` holds three.js
(MIT license).
