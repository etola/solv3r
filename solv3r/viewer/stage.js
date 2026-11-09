// Copied from the Solv3R demo (demo/static/app.js) by build_viewer_assets.py; edit the demo's file, not this one.
// Solv3R demo: the stage that shows a solve.  The viewer, the timeline and the view chips are those of the project page
// (solve.js); this file loads a packed solve (demo/scene_pack.py), plays it and adds the stage's controls.
import * as THREE from 'three';
import { SolveData, StreamData, SolveView, Timeline, Chips, animate, errColor, css, NEUTRAL, ACC_L, LIGHT, BLEND, fade } from 'solv3r/solve.js';

// live stream points: world xyz, colour and footprint; discs through the same EDL pass as the final viewer
const LIVE_VERT = `attribute vec3 rgb; attribute float foot; uniform float scale; uniform float maxSize; varying vec3 vRgb;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vRgb = rgb;
  gl_PointSize = clamp(foot * scale / max(-mv.z, 1e-3), 1.0, maxSize); gl_Position = projectionMatrix * mv; }`;
const LIVE_FRAG = `varying vec3 vRgb; void main() { vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c);
  if (r2 > 1.0) discard; gl_FragColor = vec4(vRgb * (1.0 - 0.10 * r2), 1.0); }`;
// a glowing camera path, as in the film: it grows with the frames, and the recent part glows (halos + a thin core, additive);
// setFlat(1) lights it evenly (a finished stream at rest)
const PATH_VERT = `attribute float fr; varying float vF; void main() { vF = fr; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PATH_FRAG = `uniform float head; uniform float tau; uniform float op; uniform float even; uniform vec3 col; varying float vF;
void main() { if (vF > head) discard; float a = mix(exp(-(head - vF) / tau), 0.5, even); gl_FragColor = vec4(col, op * (0.08 + 0.92 * a * a)); }`;
function glowPath(pos, n) {
  const G = new THREE.Group();
  G.frustumCulled = false; G.mats = [];
  G.setHead = (h) => { for (const m of G.mats) m.uniforms.head.value = h; };
  G.setFlat = (f) => { for (const m of G.mats) m.uniforms.even.value = f; };
  if (n < 2) return G;
  const v = [], lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = lo.clone().negate();
  for (let i = 0; i < n; i++) { const q = new THREE.Vector3(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]); v.push(q); lo.min(q); hi.max(q); }
  const w = Math.max(1e-4, hi.distanceTo(lo) * 0.0009);
  const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal');
  const segs = Math.min(3000, n * 8), radial = 6;
  const fr = new Float32Array((segs + 1) * (radial + 1));
  for (let i = 0; i <= segs; i++) fr.fill(curve.getUtoTmapping(i / segs) * (n - 1), i * (radial + 1), (i + 1) * (radial + 1));   // tube rings sit at equal arc length: back to frame index
  for (const [r, op, col] of [[w * 6, LIGHT ? 0.06 : 0.07, ACC_L], [w * 2.6, 0.2, ACC_L], [w, 0.85, LIGHT ? [0.08, 0.26, 0.55] : [0.88, 0.94, 1]]]) {
    const g = new THREE.TubeGeometry(curve, segs, r, radial, false);
    g.setAttribute('fr', new THREE.BufferAttribute(fr, 1));
    const m = new THREE.ShaderMaterial({ uniforms: { head: { value: n - 1 }, even: { value: 0 }, tau: { value: Math.max(6, n * 0.25) }, op: { value: op }, col: { value: new THREE.Color(...col) } },
      vertexShader: PATH_VERT, fragmentShader: PATH_FRAG, transparent: true, blending: BLEND, depthWrite: false });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false; mesh.layers.set(1); G.add(mesh); G.mats.push(m);
  }
  return G;
}
function dropGroup(scene, G) {
  if (!G) return;
  G.parent?.remove(G) ?? scene.remove(G);
  G.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
}

function f16(h) {                               // half -> float
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  return e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
}

const ICON = {
  cams: '<svg viewBox="0 0 20 20"><path d="M3 6.5h9.5v7H3zM12.5 9l4.5-2.5v7L12.5 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  photos: '<svg viewBox="0 0 20 20"><rect x="3" y="4.5" width="14" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 14l4-4.5 3 3 2-2 3 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  smaller: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="2.6" fill="currentColor"/></svg>',
  larger: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="5.2" fill="currentColor"/></svg>',
  views: '<svg viewBox="0 0 20 20"><circle cx="7" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="13" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  shot: '<svg viewBox="0 0 20 20"><path d="M3.5 6.5h3l1.2-2h4.6l1.2 2h3v9h-13z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="11" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  home: '<svg viewBox="0 0 20 20"><path d="M4 10.5L10 5l6 5.5M6 9v6h8V9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  full: '<svg viewBox="0 0 20 20"><path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
};

const PT = 0.35;                                       // point size at 1.0x (the old slider's 0.35x)
const TEMPLATE = `
<div class="s3r-canvas"></div>
<div class="s3r-empty"><div class="s3r-empty-in">
  <div class="s3r-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M12 6.5l5 2.8v5.4l-5 2.8-5-2.8V9.3zM7 9.3l5 2.8 5-2.8M12 12.1v5.4"/></svg></div>
  <b>No scene yet</b>
  <span>Drop photos or a video on the left, or pick an example.</span>
</div></div>
<div class="s3r-head">
  <div class="s3r-panel">
    <div class="s3r-tgs">
      <label class="s3r-tg"><input type="checkbox" data-show="cams" checked><i></i>Cameras</label>
      <label class="s3r-tg"><input type="checkbox" data-show="photos"><i></i>Images</label>
      <label class="s3r-tg s3r-traj"><input type="checkbox" data-show="traj" checked><i></i>Trajectory</label>
    </div>
    <details class="s3r-more"><summary><svg class="ic" viewBox="0 0 16 16"><path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="10.5" cy="4.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="5.5" cy="11.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg><span>Display settings</span><svg class="chev" viewBox="0 0 16 16"><path d="M5 6.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
      <div class="s3r-sls">
        <label class="s3r-sl"><span>Point size <output>1.0×</output></span><input type="range" data-sl="pt" min="-1.8" max="1.5" step="0.05" value="0"></label>
        <label class="s3r-sl"><span>Camera size <output>1.0×</output></span><input type="range" data-sl="cam" min="-2" max="1.6" step="0.05" value="0"></label>
        <label class="s3r-sl s3r-wide"><span>Confidence filtering <output>100%</output></span><input type="range" data-sl="conf" min="10" max="100" step="5" value="100"></label>
      </div>
    </details>
  </div>
  <div class="s3r-tools">
    <button data-tool="full" title="Full screen">${ICON.full}</button>
    <span class="s3r-slot"></span>
  </div>
</div>
<div class="s3r-toast"></div>
<div class="s3r-foot">
  <div class="s3r-title"><b></b><span></span></div>
  <div class="s3r-tl"></div>
  <div class="s3r-chips"></div>
  <div class="s3r-legend"><span class="s3r-hint">drag to orbit · right-drag to pan · scroll to zoom · click a chip to look through its camera</span>
    <span class="s3r-key"><em>camera motion per call</em><i class="bar"></i><em>still</em><em>moving</em></span></div>
</div>
<div class="s3r-load"><div class="s3r-load-in"><span>Loading the solve…</span><div class="s3r-bar"><i></i></div></div></div>`;

async function fetchPack(url, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const total = Number(r.headers.get('content-length')) || 0;
  let buf;
  if (r.body && total) {
    const rd = r.body.getReader(), parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value); n += value.length; onProgress?.(n / total);
    }
    const u = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { u.set(p, o); o += p.length; }
    buf = u.buffer;
  } else buf = await r.arrayBuffer();
  const dv = new DataView(buf);
  if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'S3R1') throw new Error('not a Solv3R pack');
  let o = 4;
  const part = () => { const n = dv.getUint32(o, true); o += 4; const p = buf.slice(o, o + n); o += n; return p; };
  const js = part(), gz = part(), jpg = part();
  const meta = JSON.parse(new TextDecoder().decode(js));
  const bin = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const thumbs = new Image();
  await new Promise((res, rej) => { thumbs.onload = res; thumbs.onerror = rej; thumbs.src = URL.createObjectURL(new Blob([jpg], { type: 'image/jpeg' })); });
  return meta.kind === 'stream' ? new StreamData(meta, bin, thumbs) : new SolveData(meta, bin, thumbs);
}

class Stage {
  constructor(root) {
    this.root = root;
    root.classList.add('s3r');
    root.innerHTML = TEMPLATE;
    this.$ = (s) => root.querySelector(s);
    this.view = new SolveView(this.$('.s3r-canvas'), { pointScale: 0.8 * PT, maxScale: 0.7 * PT, cmin: 0 });
    this.view.show = { cams: true, photos: false };
    this.chips = new Chips(this.$('.s3r-chips'), this.view, {
      onHover: (r) => { const L = this.view.layers[0]; if (L) { L.highlight = r; this.view.dirty = true; } },
      onPick: (r) => this.look(r),
    });
    for (const b of root.querySelectorAll('.s3r-tools button')) b.addEventListener('click', () => this.tool(b));
    this.camMult = 1; this.showTraj = true;
    for (const inp of root.querySelectorAll('.s3r-sl input')) inp.addEventListener('input', () => {
      const m = 2 ** Number(inp.value), v = this.view;
      if (inp.dataset.sl === 'conf') {                 // keep the top x % of the scene by confidence
        inp.previousElementSibling.querySelector('output').textContent = `${inp.value}%`;
        v.opts.cmin = 1 - Number(inp.value) / 100 - 0.5 / 255; v.dirty = true; return;
      }
      inp.previousElementSibling.querySelector('output').textContent = `${m.toFixed(m < 1 ? 2 : 1)}×`;
      if (inp.dataset.sl === 'pt') { v.opts.pointScale = 0.8 * PT * m; v.opts.maxScale = 0.7 * PT * m; }
      else { this.camMult = m; for (const L of v.layers) L.frustumScale = L.baseFs * m; if (this.lv) this.liveFrusta(); }
      v.dirty = true;
    });
    for (const inp of root.querySelectorAll('.s3r-tg input')) inp.addEventListener('change', () => {
      const k = inp.dataset.show;
      if (k === 'traj') { this.showTraj = inp.checked; if (this.traj) this.traj.visible = inp.checked; if (this.lv) this.lv.path.visible = inp.checked; }
      else this.view.show[k] = inp.checked;
      this.view.dirty = true;
    });
    this.view.canvas.addEventListener('webglcontextlost', (e) => {     // e.g. the GPU process restarted
      e.preventDefault(); this.toast('The 3D view lost its graphics context. Reload the page to see it again.');
    });
    this.D = null; this.tl = null; this.lastT = null;
    this.visible = true;              // always drawn when dirty (the browser pauses frames of hidden tabs)
    animate(this);
  }

  tool(b) {
    const v = this.view, k = b.dataset.tool;
    if (k === 'opts') b.classList.toggle('on', this.root.classList.toggle('opts'));
    if (k === 'home') v.home(true);
    if (k === 'shot') this.wantShot = true;
    if (k === 'full') { if (document.fullscreenElement) document.exitFullscreen(); else this.root.requestFullscreen?.().catch(() => {}); }
    v.dirty = true;
  }

  toast(text) {
    const el = this.$('.s3r-toast');
    el.textContent = text; el.classList.add('on');
    clearTimeout(this.toastT); this.toastT = setTimeout(() => el.classList.remove('on'), 1800);
  }

  async show(spec) {
    if (!spec || !spec.url) return;
    const tok = (this.tok = {});
    const load = this.$('.s3r-load'), bar = this.$('.s3r-bar i');
    load.classList.add('on'); bar.style.width = '0%';
    let D;
    try { D = await fetchPack(spec.url, (f) => { bar.style.width = `${Math.round(f * 100)}%`; }); } catch (e) {
      load.classList.remove('on'); this.toast(`Could not load the solve (${e.message})`); return;
    }
    if (tok !== this.tok) return;
    load.classList.remove('on');
    this.open(D, spec);
    const ci = this.$('.s3r-sl input[data-sl="conf"]');   // each scene opens at its own confidence filtering (examples may set it)
    ci.value = spec.conf ?? 100; ci.dispatchEvent(new Event('input'));
  }

  // a stream while it is solved: every answered frame adds its points and its camera, drawn like the final viewer
  // (frustums with the photo for the newest frames, dimmed and smaller once they leave the window)
  live(items, title) {
    const v = this.view;
    if (!this.lv) {
      if (this.D) { v.setLayers([]); this.D = null; this.tl = null; this.$('.s3r-tl').innerHTML = ''; this.chips.setData(null); }
      const cap = 1 << 19;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('rgb', new THREE.BufferAttribute(new Uint8Array(cap * 3), 3, true).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('foot', new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
      g.setDrawRange(0, 0);
      const u = { scale: { value: 1 }, maxSize: { value: 6 } };
      const pts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: u, vertexShader: LIVE_VERT, fragmentShader: LIVE_FRAG }));
      pts.frustumCulled = false;
      pts.onBeforeRender = (r) => {
        const h = r.domElement.height, dpr = Math.min(window.devicePixelRatio || 1, 2);
        u.scale.value = h / (2 * Math.tan(v.camera.fov * Math.PI / 360)) * v.opts.pointScale;
        u.maxSize.value = 6 * dpr * (v.opts.maxScale ?? 1);
      };
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4096 * 16 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(4096 * 16 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const fr = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: BLEND }));
      fr.frustumCulled = false; fr.layers.set(1);
      const path = new THREE.Group(); path.visible = this.showTraj;
      const G = new THREE.Group(); G.add(pts, fr, path); v.scene.add(G);
      this.lv = { G, pts, fr, path, pathPos: new Float32Array(4096 * 3), n: 0, cap, cams: [], planes: [], depth: [] };
      this.root.classList.add('has', 'live', 'stream'); this.root.classList.remove('has-motion');
      if (this.traj) { dropGroup(v.scene, this.traj); this.traj = null; }
      this.$('.s3r-title b').textContent = title ? `${title} · streaming` : 'Streaming';
      v.userMoved = false;
    }
    const L = this.lv, P = L.pts.geometry.attributes;
    const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    for (const c of items) {                     // OpenCV world (y down, z forward) -> three.js (y up): flip y and z
      if (L.cams.length >= 4096) break;
      const C = [c[1], c[2], c[3]], fwd = [c[4], c[5], c[6]], down = [-c[7], -c[8], -c[9]];
      const right = [down[1] * fwd[2] - down[2] * fwd[1], down[2] * fwd[0] - down[0] * fwd[2], down[0] * fwd[1] - down[1] * fwd[0]];
      L.cams.push({ C, fwd, down, right, k: c.slice(10, 14), thumb: c[17] });
      const raw = b64(c[14]), col = b64(c[15]), m = raw.length / 6;
      if (!m) continue;
      if (L.n + m > L.cap) continue;
      const xyz = new Float32Array(m * 3), h16 = new Uint16Array(raw.buffer, raw.byteOffset, m * 3);
      let dsum = 0;
      for (let i = 0; i < m; i++) {
        const x = f16(h16[i * 3]), y = f16(h16[i * 3 + 1]), z = f16(h16[i * 3 + 2]);
        xyz[i * 3] = x; xyz[i * 3 + 1] = -y; xyz[i * 3 + 2] = -z;
        dsum += Math.hypot(x - C[0], y - C[1], z - C[2]);
      }
      L.depth.push(dsum / m);
      const fb = b64(c[16]), fh = new Uint16Array(fb.buffer, fb.byteOffset, m);
      for (let i = 0; i < m; i++) P.foot.array[L.n + i] = f16(fh[i]);
      P.position.array.set(xyz, L.n * 3); P.rgb.array.set(col, L.n * 3);
      L.n += m;
    }
    L.pts.geometry.setDrawRange(0, L.n);
    for (const a of [P.position, P.rgb, P.foot]) a.needsUpdate = true;
    this.liveFrusta();
    this.$('.s3r-title span').textContent = `${L.cams.length} frames answered`;
    v.dirty = true;
  }

  liveFrusta() {
    const L = this.lv, v = this.view, n = L.cams.length, WIN = 6;
    const ds = [...L.depth].sort((a, b) => a - b), md = ds.length ? ds[ds.length >> 1] : 1;
    const F = L.fr.geometry.attributes.position, Cc = L.fr.geometry.attributes.color;
    const seq = [0, 1, 0, 2, 0, 3, 0, 4, 1, 2, 2, 3, 3, 4, 4, 1];
    const corners = (c, d) => {
      const [fx, fy, cx, cy] = c.k, xs = [(0 - cx) / fx, (1 - cx) / fx], ys = [(0 - cy) / fy, (1 - cy) / fy];
      const at = (x, y) => [0, 1, 2].map((i) => c.C[i] + (x * c.right[i] + y * c.down[i] + c.fwd[i]) * d);
      return [c.C, at(xs[0], ys[0]), at(xs[1], ys[0]), at(xs[1], ys[1]), at(xs[0], ys[1])].map((q) => [q[0], -q[1], -q[2]]);
    };
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let r = 0; r < n; r++) {
      const c = L.cams[r], live = r === n - 1;     // only the newest camera is drawn; the path shows the rest
      const Q = corners(c, md * 0.1 * this.camMult), dim = live ? 1 : 0;
      L.pathPos.set(Q[0], r * 3);
      for (let q = 0; q < 16; q++) {
        F.array.set(Q[seq[q]], (r * 16 + q) * 3);
        Cc.array.set(fade(LIGHT ? [0.10, 0.32, 0.64] : ACC_L, dim), (r * 16 + q) * 3);
      }
      for (let k = 0; k < 3; k++) { const x = k ? -c.C[k] : c.C[k]; lo[k] = Math.min(lo[k], x); hi[k] = Math.max(hi[k], x); }
      c.Q = Q;
    }
    F.needsUpdate = Cc.needsUpdate = true;
    L.fr.geometry.setDrawRange(0, n * 16);
    for (const o of [...L.path.children]) dropGroup(v.scene, o);
    L.path.add(glowPath(L.pathPos, n));
    // photos on the newest frames' image planes
    const want = L.cams.slice(Math.max(0, n - 1));
    while (L.planes.length < want.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
      m.frustumCulled = false; m.layers.set(1); L.G.add(m); L.planes.push({ m, src: null });
    }
    want.forEach((c, i) => {
      const pl = L.planes[i], A = pl.m.geometry.attributes.position;
      for (let q = 0; q < 4; q++) A.array.set(c.Q[q + 1], q * 3);
      A.needsUpdate = true;
      if (pl.src !== c.thumb && c.thumb) {
        pl.src = c.thumb;
        const img = new Image(); img.src = `data:image/jpeg;base64,${c.thumb}`;
        const tex = new THREE.Texture(img); tex.colorSpace = THREE.NoColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
        img.onload = () => { tex.needsUpdate = true; v.dirty = true; };
        pl.m.material.map?.dispose(); pl.m.material.map = tex; pl.m.material.needsUpdate = true;
      }
    });
    if (!v.userMoved && n) {                     // keep the cameras and what they see in view
      const ctr = new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
      const c = L.cams[n - 1];
      ctr.add(new THREE.Vector3(c.fwd[0], -c.fwd[1], -c.fwd[2]).multiplyScalar(md * 0.5));
      const rad = Math.max(md * 0.8, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 + md * 0.5);
      const eye = ctr.clone().add(new THREE.Vector3(0.55, 0.6, 0.75).normalize().multiplyScalar(rad * 2.6));
      v.camera.position.copy(eye); v.controls.target.copy(ctr); v.camera.fov = 40; v.camera.updateProjectionMatrix(); v.controls.update();
    }
  }

  endLive() {
    const L = this.lv;
    if (!L) return;
    this.view.scene.remove(L.G);
    L.G.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
    this.lv = null; this.root.classList.remove('live');
  }

  open(D, spec) {
    this.endLive();
    const str = D instanceof StreamData, v = this.view;
    this.D = D;
    this.root.classList.add('has');
    D.hasErr = false;                               // demo: frustums in one colour (no camera-motion colouring)
    this.root.classList.remove('has-motion');
    v.setLayers([{ data: D, frustum: D.meta.frustum ?? (str ? 0.04 : 0.06) }]);
    v.layers[0].points.geometry.getAttribute('rgb').array = new Uint8Array(D.rgb);   // own copy: recolouring keeps D.rgb
    for (const L of v.layers) { L.baseFs = L.frustumScale * (str ? 1.5 : 1); L.frustumScale = L.baseFs * this.camMult; }   // stream cameras a little larger: they are seen along a long path
    if (this.traj) { dropGroup(v.scene, this.traj); this.traj = null; }
    if (str) {                                   // the camera path of a stream, at exit
      const pos = new Float32Array(D.V * 3);
      for (let r = 0; r < D.V; r++) pos.set(D.cam(0, r).subarray(9, 12), r * 3);   // on arrival: where the newest camera is drawn
      this.traj = glowPath(pos, D.V); this.traj.visible = this.showTraj; v.scene.add(this.traj);
    }
    this.root.classList.toggle('stream', str);
    if (this.byView) this.recolor();
    if (!spec.keepView || !this.opened) v.home();
    this.opened = true;
    this.$('.s3r-title b').textContent = spec.title ?? D.meta.title ?? '';
    this.$('.s3r-title span').textContent = (spec.stats ?? []).join(' · ');
    const marks = [];
    if (!str) for (const f of D.waves) if (f > 0) {
      const n = D.first.filter((x) => x === f).length;
      marks.push({ t: D.calls[f - 1] + 0.5, text: `+${n}`, n });
    }
    this.marks = marks;
    const el = this.$('.s3r-tl');
    el.innerHTML = '';
    const t1 = str ? D.V + D.win + 1 : D.t1, span = t1 - D.t0;
    const log = !str && span > 96 && D.t0 >= 0;
    const t0 = log ? Math.max(1, D.t0) : D.t0;
    this.tl = new Timeline(el, {
      t0, t1, scale: log ? 'log' : 'lin', marks,
      duration: spec.duration ?? (str ? Math.min(24, Math.max(8, D.V / 18)) : Math.min(12, Math.max(5, (D.S || 8) * 0.8))),
      label: (t) => (str ? `frame ${Math.min(D.V, Math.max(0, Math.ceil(t - 1e-6)))} / ${D.V}` : `call ${Math.max(0, Math.ceil(t - 1e-6))}`),
      tickEvery: str || log ? 0 : span > 40 ? 8 : span > 16 ? 4 : 1,
    });
    this.tl.on(() => { v.dirty = true; });
    this.chips.setData(D);
    this.lastT = null;
    if (spec.play === false) this.tl.set(1);
    else { this.tl.set(0); setTimeout(() => { if (this.D === D) this.tl.play(); }, 450); }
    v.dirty = true;
  }

  recolor() {
    const L = this.view.layers[0], D = this.D;
    if (!L || !D) return;
    const attr = L.points.geometry.getAttribute('rgb');
    if (!this.byView) { attr.array.set(D.rgb); attr.needsUpdate = true; this.view.dirty = true; return; }
    const pal = [];
    for (let r = 0; r < D.V; r++) {                      // golden-angle hues, one per view
      const h = (r * 137.508) % 360, c = 0.62, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = 0.28;
      const [a, b, d] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
      pal.push([(a + m) * 255, (b + m) * 255, (d + m) * 255]);
    }
    const out = new Uint8Array(D.rgb.length);
    for (let i = 0; i < D.N; i++) { const p = pal[D.vid[i]]; out[i * 3] = p[0]; out[i * 3 + 1] = p[1]; out[i * 3 + 2] = p[2]; }
    attr.array.set(out); attr.needsUpdate = true; this.view.dirty = true;
  }

  look(r) {
    if (!this.D) return;
    this.tl?.pause();
    this.view.lookThrough(r);
  }

  frame(dt) {
    if (this.tl) {
      this.tl.tick(dt);
      const t = this.tl.t;
      if (this.D instanceof StreamData && this.traj) {
        this.traj.setHead(Math.max(0, this.D.presentViews(t) - 1));   // the path ends at the newest camera
        const flat = this.tl.playing ? 0 : 1;                           // the recent part glows only while it plays
        if (this.traj.flat !== flat) { this.traj.setFlat(flat); this.traj.flat = flat; this.view.dirty = true; }
      }
      if (t !== this.lastT) {
        if (this.tl.playing && this.lastT !== null) for (const m of this.marks) if (this.lastT < m.t && t >= m.t) this.toast(`+${m.n} views join`);
        this.view.setTime(t); this.lastT = t;
      }
    }
    if (this.wantShot) this.view.dirty = true;
    const states = this.view.frame(dt);
    if (states && this.D) this.chips.draw(states);
    if (this.wantShot && states) {                       // read the canvas in the frame that drew it
      this.wantShot = false;
      this.view.renderer.domElement.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = `solv3r_${(this.D?.meta.title || 'view').replace(/[^\w]+/g, '_')}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }, 'image/png');
    }
  }
}

export function mount(root) {
  const s = new Stage(root);
  return { show: (spec) => s.show(spec), stage: s };
}

export { errColor, css };
