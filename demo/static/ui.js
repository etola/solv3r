// Solv3R demo: a Space page.  Left: the upload, the solver and Reconstruct.  Right: the stage (app.js), what to do with a
// solve and the solver details.  Below: the examples, which load their input and settings.  Requests go to Python with
// trigger('submit', {...}); answers come back on the bus.
import { mount as mountStage } from './app.js';


const MAIN = ['Offline', 'Incremental', 'Streaming'];   // Any order stays on the project page
const MODES = [
  { id: 'Offline', desc: 'All views are solved together', icon: '<rect x="3" y="3" width="5" height="5" rx="1"/><rect x="10" y="3" width="5" height="5" rx="1"/><rect x="3" y="10" width="5" height="5" rx="1"/><rect x="10" y="10" width="5" height="5" rx="1"/>' },
  { id: 'Incremental', desc: 'More views are added to a solve in progress', icon: '<rect x="2.5" y="10" width="3.5" height="5" rx="1"/><rect x="7.25" y="7" width="3.5" height="8" rx="1"/><rect x="12" y="3" width="3.5" height="12" rx="1"/>' },
  { id: 'Any order', desc: 'Views join in groups, at random', icon: '<path d="M3 5h3.5l5 8H15M3 13h3.5l1.8-2.9M15 5h-3.5l-1.8 2.9" fill="none" stroke-width="1.5"/>' },
  { id: 'Streaming', desc: 'Frames answered on arrival', icon: '<path d="M2.5 9h3l2-5 3 10 2-5h3" fill="none" stroke-width="1.5" stroke-linejoin="round"/>' },
  { id: 'Large scene', desc: 'A few random views per call', icon: '<circle cx="5" cy="5" r="1.6"/><circle cx="13" cy="5" r="1.6"/><circle cx="9" cy="9" r="2.2"/><circle cx="5" cy="13" r="1.6"/><circle cx="13" cy="13" r="1.6"/>' },
];
const I = {
  plus: '<svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  photos:'<svg viewBox="0 0 18 18"><rect x="2.5" y="3.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.5 13l3.5-4 2.5 2.5 2-2 3 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  upload: '<svg viewBox="0 0 20 20"><path d="M10 13V4M6.5 7.5L10 4l3.5 3.5M4 13v2.5h12V13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M5 3.2v9.6l8-4.8z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor"/></svg>',
  down: '<svg viewBox="0 0 16 16"><path d="M8 3v7M5 7.5L8 10.5l3-3M3.5 13h9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  ext: '<svg viewBox="0 0 16 16"><path d="M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5L7.5 8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const LINKS = [['Paper', 'https://arxiv.org/abs/2611.02857'], ['Code', 'https://github.com/ubc-vision/solv3r'], ['Project page', 'https://ubc-vision.github.io/solv3r/']];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const fmtNum = (x, d = 1) => (x === undefined || x === null ? '–' : Number(x).toFixed(d));

function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

// ---------------------------------------------------------------- small controls
function field({ key, label, min, max, step = 1, value, fmt = (v) => v, hint }) {
  return `<div class="f" data-key="${key}"><div class="f-row"><label>${label}</label><output>${fmt(value)}</output></div>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${value}">${hint ? `<div class="f-hint">${hint}</div>` : ''}</div>`;
}
function toggle({ key, label, value, hint }) {
  return `<label class="tg" data-key="${key}"><input type="checkbox" ${value ? 'checked' : ''}><i></i><span>${label}${hint ? `<em>${hint}</em>` : ''}</span></label>`;
}
function seg(key, items, value) {
  return `<div class="seg" data-key="${key}">${items.map(([v, t]) => `<button data-v="${v}" class="${v === value ? 'on' : ''}">${t}</button>`).join('')}</div>`;
}

class Drop {
  // a drop zone for images (or one video) with thumbnails; files upload as soon as they are added
  constructor(app, root, { video = false, compact = false, label = 'Drop photos here' } = {}) {
    this.app = app; this.root = root; this.video = video; this.items = []; this.onChange = null;
    root.classList.add('drop-wrap');
    root.innerHTML = `<div class="drop ${compact ? 'compact' : ''}" tabindex="0">${I.upload}<div><b>${label}</b><span>or <u>browse</u>${video ? ' · mp4, mov, webm' : ' · jpg, png'}</span></div>
      <input type="file" ${video ? 'accept="video/*"' : 'accept="image/*" multiple'} hidden></div>
      <div class="drop-list"></div>`;
    this.zone = root.querySelector('.drop'); this.input = root.querySelector('input'); this.list = root.querySelector('.drop-list');
    this.zone.addEventListener('click', () => this.input.click());
    this.zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.input.click(); } });
    this.input.addEventListener('change', () => { this.add([...this.input.files]); this.input.value = ''; });
    for (const ev of ['dragenter', 'dragover']) this.zone.addEventListener(ev, (e) => { e.preventDefault(); this.zone.classList.add('over'); });
    for (const ev of ['dragleave', 'drop']) this.zone.addEventListener(ev, (e) => { e.preventDefault(); this.zone.classList.remove('over'); });
    this.zone.addEventListener('drop', (e) => this.add([...e.dataTransfer.files]));
  }
  add(files) {
    files = files.filter((f) => (this.video ? f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(f.name) : f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|heic|heif)$/i.test(f.name)));
    if (!files.length) { this.app.toast(this.video ? 'That is not a video file.' : 'No images in what was dropped.'); return; }
    if (this.video) { this.clear(); files = files.slice(0, 1); }
    for (const f of files) {
      const it = { file: f, name: f.name, size: f.size, url: URL.createObjectURL(f), path: null, state: 'up' };
      it.done = this.app.upload(f).then((r) => { it.path = r.path; it.state = 'ok'; this.render(); }).catch((e) => { it.state = 'err'; it.err = String(e); this.render(); });
      this.items.push(it);
    }
    if (this.video) this.probe(this.items[0]);
    this.render(); this.onChange?.();
  }
  probe(it) {
    const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true; v.src = it.url;
    v.onloadedmetadata = () => {
      it.duration = isFinite(v.duration) ? v.duration : (it.recorded ?? NaN); it.w = v.videoWidth; it.h = v.videoHeight;
      this.render(); this.onChange?.();
    };
    v.onerror = () => { it.duration = it.recorded ?? NaN; this.render(); this.onChange?.(); };   // e.g. HEVC the browser cannot play: the server reads it
  }
  clear() { for (const it of this.items) URL.revokeObjectURL(it.url); this.items = []; this.render(); this.onChange?.(); }
  async paths() {
    await Promise.all(this.items.map((it) => it.done));
    const bad = this.items.filter((it) => it.state !== 'ok');
    if (bad.length) throw new Error(`${bad.length} file(s) failed to upload`);
    return this.items.map((it) => it.path);
  }
  render() {
    const n = this.items.length, up = this.items.filter((it) => it.state === 'up').length;
    this.root.classList.toggle('has', n > 0);
    if (!n) { this.list.innerHTML = ''; return; }
    if (this.video) {
      const it = this.items[0];
      this.list.innerHTML = `<div class="vid"><video src="${it.url}" muted playsinline preload="metadata"></video>
        <div class="vid-meta"><b title="${esc(it.name)}">${esc(it.name)}</b><span>${isFinite(it.duration) ? `${fmtTime(it.duration)} · ${it.w}×${it.h}` : it.w ? `${it.w}×${it.h}` : 'reading…'}${up ? ' · uploading' : ''}</span></div>
        <button class="icon x" title="Remove">${I.x}</button></div>`;
    } else {
      const show = this.items.slice(0, 17);
      this.list.innerHTML = `<div class="thumbs">${show.map((it) => `<i class="${it.state}" style="background-image:url(${it.url})" title="${esc(it.name)}"></i>`).join('')}${n > 17 ? `<i class="more">+${n - 17}</i>` : ''}</div>
        <div class="drop-meta"><span>${n} photo${n > 1 ? 's' : ''}${up ? ` · uploading ${n - up}/${n}` : ''}</span><button class="link x">Clear</button></div>`;
    }
    this.list.querySelector('.x')?.addEventListener('click', () => this.clear());
    if (this.onChange) this.app.renderPreview?.();
  }
}

// ---------------------------------------------------------------- the app
class App {
  constructor(root, { trigger, upload, props }) {
    this.root = root; this.trigger = trigger; this.uploadFn = upload; this.props = props;
    this.mode = 'Offline';
    this.tab = 'photos';
    this.example = null;
    this.p = { calls: 16, adaptive: false, initial: 8, group: 4, scalls: 8, calls1: 12, calls2: 12, config: 'L8', order: 'random', tol: 0.02, sky: false, frames: 96, framesTouched: false };
    this.prepared = null;
    this.job = null; this.summary = null;
    this.build();
    this.stage = mountStage(this.$('.stage-host'));
    this.$('.s3r-slot').appendChild(this.$('.dl'));
    this.cont = el(`<button class="cont" title="Add views or more calls, from the kept solver state">${I.plus}<span>Continue from here</span></button>`);
    this.$('.s3r-foot').appendChild(this.cont);                       // above the timeline, at the right of the 3D view
    this.cont.addEventListener('click', () => this.toggleLab());
    for (const b of this.root.querySelectorAll('.ex')) b.addEventListener('click', () => this.$('.work').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    this.renderMode(); this.renderSummary();
    document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') this.solve(); });
  }
  $(s) { return this.root.querySelector(s); }
  upload(f) { return this.uploadFn(f); }

  build() {
    const P = this.props, mode = (m) => `<button class="mode" data-mode="${m.id}"><b>${m.id}</b><em>${m.desc}</em></button>`;
    this.root.className = 'app';
    this.root.innerHTML = `
<header class="hero">
  <h1>Solv3R</h1>
  <div class="hero-sub"><h2>3D Looped Transformer as a Multi-view Solver</h2>
    <nav>${LINKS.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${t}${I.ext}</a>`).join('')}</nav></div>
  <p>Reconstruct a scene from photos or a video: solve all views together, add views to a solve in progress, or stream
      frames as they arrive. All modes run on one solver.</p>
</header>
<div class="work">
  <div class="col-in">
    <div class="card up">
      <div class="card-h"><span>Input</span><em class="in-count"></em><button class="link in-change" hidden>Change</button></div>
      <div class="in-empty">
        <div class="drop drop-main" tabindex="0">${I.upload}<div><b>Image or video</b><span>drop photos or one video here, or <u>browse</u><br>jpg, png, heic · mp4, mov, webm · up to 2 minutes</span></div>
          <input type="file" accept="image/*,video/*" multiple hidden></div>
      </div>
      <div class="in-full" hidden>
        <div class="in-t"><b class="in-name"></b></div>
        <div class="strip"></div>
        <div class="src-lists"><div class="drop-photos"></div><div class="drop-video"></div></div>
        <div class="in-info"></div>
        <div class="vid-only" hidden>${field({ key: 'frames', label: 'Frames taken from the video', min: 8, max: P.limits.stream, value: 96 })}
          <button class="go re-extract">Extract again</button></div>
      </div>
    </div>
    <div class="card">
      <div class="card-h"><span>Mode</span></div>
      <div class="modes main">${MODES.filter((m) => MAIN.includes(m.id)).map(mode).join('')}</div>
      <div class="params"></div>
    </div>
    <div class="run-wrap">
      <button class="run primary"><span class="run-t">Reconstruct</span><i class="run-p"></i></button>
      <button class="stop" title="Stop" hidden>${I.stop}<span>Stop</span></button>
    </div>
    <div class="status"><i class="sp"></i><span class="dot"></span><span class="st">Ready</span><span class="ready"><i></i>Model ready</span></div>
    ${P.space ? '<p class="gpu-note">Running on Hugging Face <b>ZeroGPU</b>: each run first waits for a free GPU and loads the model there, so times here are longer than on a dedicated GPU.<span class="gpu-name"></span></p>' : ''}
  </div>
  <div class="col-out">
    <div class="viewer"><div class="stage-host"></div></div>
    <div class="dl" hidden>
      <button class="dl-btn" title="Download">${I.down}</button>
      <div class="dl-menu" hidden>
        <p class="dl-note">Points kept as shown in the viewer: <b class="dl-keep">100%</b> (Display settings)</p>
        <button class="exp" data-kind="ply"><span><b>Point cloud</b><em>.ply</em></span>${I.down}</button>
        <button class="exp" data-kind="colmap"><span><b>COLMAP model</b><em>.zip · cameras, points, images</em></span>${I.down}</button>
        <button class="exp" data-kind="npz"><span><b>Cameras and depth</b><em>.npz</em></span>${I.down}</button>
      </div>
    </div>
    <div class="below">
    <div class="sumline"></div>
    <div class="lab" hidden>
      <div class="act add-act">
        <div class="act-h"><b>Add views</b><span>New photos of this scene join it, and the solve continues from its current state. Without new photos, the scene is only refined.</span></div>
        <div class="drop-add"></div>
        ${toggle({ key: 'keepscene', label: 'Keep the current scene frozen', value: false, hint: 'existing views stay as they are (cached); only the new views are solved' })}
        ${field({ key: 'addcalls', label: 'Calls', min: 1, max: 64, value: 16, hint: 'every view is updated' })}
        <div class="act-row"><span class="grow"></span><button class="go keep-go" data-op="keep">Keep solving</button></div>
      </div>
    </div>
    </div>
  </div>
</div>
<section class="examples">
  <div class="ex-h">Examples <span>click one to load its photos and mode, then Reconstruct</span></div>
  <div class="ex-grid">
    ${[0, 1].map((col) => `<div class="ex-table">
      <div class="ex-row ex-head"><span>Input</span><span>Mode</span></div>
      ${(P.examples || []).filter((_, i) => i % 2 === col).map((x) => `<button class="ex ex-row" data-key="${x.key}">
        <span class="ex-in"><span class="ex-th">${x.images.slice(0, 3).map((u) => `<i style="background-image:url(${u})"></i>`).join('')}</span><span><b>${esc(x.title)}</b><em>${esc(x.sub)}</em></span></span>
        <span class="ex-mode">${esc(x.mode)}</span></button>`).join('')}</div>`).join('')}
  </div>
  ${(P.examples || []).some((x) => x.credit === 'vggt') ? '<p class="ex-credit">Canyon is an example of the <a href="https://huggingface.co/spaces/facebook/vggt" target="_blank" rel="noopener">VGGT demo</a> (Meta, CC BY-NC 4.0).</p>' : ''}
  ${(P.examples || []).some((x) => x.credit === 'tum') ? '<p class="ex-credit">Office desk, Desk with toys and Poster wall: TUM RGB-D, fr3/long_office_household, fr2/desk and fr3/structure_texture_far (<a href="https://cvg.cit.tum.de/data/datasets/rgbd-dataset" target="_blank" rel="noopener">TUM CVG</a>, CC BY 4.0).</p>' : ''}
</section>
<div class="toasts"></div>`;

    // input: one drop zone; photos and a video keep their own lists, and the last one given is what Solve uses
    this.dPhotos = new Drop(this, this.$('.drop-photos'), { label: 'Drop photos here' });
    this.dAdd = new Drop(this, this.$('.drop-add'), { compact: true, label: 'New photos (optional)' });
    this.joinEl = el('<div class="drop-join"></div>');
    this.dJoin = new Drop(this, this.joinEl, { compact: true, label: 'Views added later' });
    this.addCalls = 16; this.keepScene = false;
    this.dVideo = new Drop(this, this.$('.drop-video'), { video: true, label: 'Drop a video here' });
    // photos default to Offline and a video to Streaming; either is preprocessed on the CPU as soon as it is given
    this.dPhotos.onChange = () => {
      if (!this.dPhotos.items.length) return this.renderPreview();
      if (this.tab !== 'photos' && this.mode === 'Streaming') { this.mode = 'Offline'; this.renderMode(); }
      this.setTab('photos'); if (this.dVideo.items.length) this.dVideo.clear();
      this.prepareInput();
    };
    this.dVideo.onChange = () => {
      const it = this.dVideo.items[0];
      if (!it) return this.renderPreview();
      if (this.tab !== 'video') { this.mode = 'Streaming'; this.renderMode(); }
      this.setTab('video'); if (this.dPhotos.items.length) this.dPhotos.clear();
      if (it.duration === undefined) return;      // wait for the video's metadata (length) to choose the frames
      this.autoFrames(); this.prepareInput();
    };
    const zone = this.$('.drop-main'), inp = zone.querySelector('input');
    const take = (files) => {
      const vid = files.find((f) => f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(f.name));
      if (vid) this.dVideo.add([vid]); else this.dPhotos.add(files);
    };
    zone.addEventListener('click', () => inp.click());
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    inp.addEventListener('change', () => { take([...inp.files]); inp.value = ''; });
    for (const ev of ['dragenter', 'dragover']) zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); });
    for (const ev of ['dragleave', 'drop']) zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); });
    zone.addEventListener('drop', (e) => take([...e.dataTransfer.files]));
    this.$('.re-extract').addEventListener('click', () => this.prepareInput(true));
    this.$('.in-change').addEventListener('click', () => {
      if (this.job) return;
      this.prepared = null; this.prepKey = null;
      this.dPhotos.clear(); this.dVideo.clear(); this.example = null; this.tab = 'photos';
      for (const b of this.root.querySelectorAll('.ex')) b.classList.remove('on');
      this.renderPreview();
    });
    const dl = this.$('.dl'), menu = this.$('.dl-menu');
    this.$('.dl-btn').addEventListener('click', () => { menu.hidden = !menu.hidden; this.$('.dl-keep').textContent = `${this.viewKeep()}%`; });

    this.wireField(this.$('.add-act'), 'addcalls', (v) => { this.addCalls = v; }, (v) => v, false);
    this.$('.tg[data-key="keepscene"] input').addEventListener('change', (e) => {   // fixed: only the new views move; free: a joint solve
      this.keepScene = e.target.checked;
      this.$('.add-act .f-hint').textContent = this.keepScene ? 'only the new views are updated' : 'every view is updated';
    });
    this.wireField(this.$('.vid-only'), 'frames', (v) => { this.p.frames = v; this.p.framesTouched = true; this.renderPreview(); });
    for (const b of this.root.querySelectorAll('.ex')) b.addEventListener('click', () => this.loadExample(b.dataset.key));
    for (const b of this.root.querySelectorAll('.mode')) b.addEventListener('click', () => {
      this.edited = this.edited || b.dataset.mode !== this.mode;
      this.mode = b.dataset.mode; this.renderMode(); this.autoFrames();
      if (this.tab !== 'examples' && !this.job) this.prepareInput();   // the frame count (and its limit) follow the mode
    });
    this.$('.run').addEventListener('click', () => this.solve());
    this.$('.stop').addEventListener('click', () => this.stop());
    for (const b of this.root.querySelectorAll('.go[data-op]')) b.addEventListener('click', () => this.lab(b.dataset.op));
    for (const b of this.root.querySelectorAll('.exp')) b.addEventListener('click', () => this.exportAs(b.dataset.kind));
  }

  wireSeg(key, fn) {
    const s = this.root.querySelector(`.seg[data-key="${key}"]`);
    for (const b of s.querySelectorAll('button')) b.addEventListener('click', () => {
      for (const o of s.querySelectorAll('button')) o.classList.toggle('on', o === b);
      fn(b.dataset.v); this.edited = true;
    });
  }
  wireField(scope, key, fn, fmt = (v) => v, edits = true) {   // edits: a solve setting (not the keep-solving calls)
    const f = scope.querySelector(`.f[data-key="${key}"]`);
    if (!f) return;
    const inp = f.querySelector('input'), out = f.querySelector('output');
    const paint = () => { const p = (inp.value - inp.min) / (inp.max - inp.min) * 100; inp.style.setProperty('--p', `${p}%`); };
    inp.addEventListener('input', () => { const v = Number(inp.value); out.textContent = fmt(v); paint(); fn(v); if (edits) this.edited = true; });
    paint();
    return inp;
  }
  setTab(t) {
    this.tab = t;
    if (t !== 'examples') { this.example = null; for (const b of this.root.querySelectorAll('.ex')) b.classList.remove('on'); }
    this.$('.vid-only').hidden = t !== 'video';
    this.renderPreview();
  }
  renderPreview() {                              // the input as Reconstruct will use it: an example, photos or a video
    this.renderJoin();
    const x = this.tab === 'examples' && (this.props.examples || []).find((e) => e.key === this.example);
    const ph = this.dPhotos.items, vi = this.dVideo.items[0];
    const has = !!(x || ph.length || vi);
    this.$('.in-empty').hidden = has; this.$('.in-full').hidden = !has; this.$('.in-change').hidden = !has;
    this.$('.vid-only').hidden = !(vi && this.tab === 'video');
    if (!has) return;
    const name = this.$('.in-name'), info = this.$('.in-info'), strip = this.$('.strip');
    this.$('.src-lists').hidden = !!x;
    if (x) {
      name.textContent = `Example: ${x.title}`;
      strip.innerHTML = x.images.map((u) => `<i style="background-image:url(${u})"></i>`).join('');
      info.textContent = `${x.n} ${x.mode === 'Streaming' ? 'video frames' : 'photos'} · ${x.sub}`;
    } else {
      const pr = this.prepared;
      name.textContent = vi ? `Video: ${vi.name}${isFinite(vi.duration) ? ` · ${fmtTime(vi.duration)}` : ''}${vi.w ? ` · ${vi.w}×${vi.h}` : ''}` : `${ph.length} photo${ph.length > 1 ? 's' : ''}`;
      this.$('.src-lists').hidden = !!pr || !!vi;
      strip.innerHTML = pr ? pr.thumbs.map((u) => `<i style="background-image:url(${u})"></i>`).join('') : '';
      info.innerHTML = pr ? `<span class="ok">Preprocessing done</span> · ${esc(pr.text)}` : '<span class="wait">Preprocessing…</span>';
    }
    this.renderCount();
  }
  autoFrames() {
    const it = this.dVideo.items[0];
    if (!it || !isFinite(it.duration) || this.p.framesTouched) return;
    const per = { Streaming: 4, 'Large scene': 3 }[this.mode] ?? 1.2;   // frames per second of video
    const cap = { Streaming: this.props.limits.stream, 'Large scene': this.props.limits.large }[this.mode] ?? this.props.limits.offline;
    const n = Math.max(8, Math.min(cap, Math.round(it.duration * per), this.mode === 'Offline' ? 64 : cap));
    const inp = this.root.querySelector('.f[data-key="frames"] input');
    inp.value = n; inp.dispatchEvent(new Event('input')); this.p.framesTouched = false;
  }
  renderCount() {
    const c = this.$('.in-count');
    if (this.tab === 'photos') c.textContent = this.dPhotos.items.length ? plural(this.dPhotos.items.length, 'photo') : '';
    else if (this.tab === 'video') c.textContent = this.dVideo.items.length ? `${this.p.frames} frames` : '';
    else if (this.example) c.textContent = 'example';
    else c.textContent = '';
  }

  renderMode() {
    for (const b of this.root.querySelectorAll('.mode')) b.classList.toggle('on', b.dataset.mode === this.mode);
    const p = this.p, m = this.mode, box = this.$('.params');
    let html = '';
    if (m === 'Offline') html = toggle({ key: 'adaptive', label: 'Adaptive stopping', value: p.adaptive, hint: 'stop once the state changes by less than the threshold' })
      + `<div class="tol-f" ${p.adaptive ? '' : 'hidden'}>${field({ key: 'tol', label: 'Threshold (relative change per call)', min: 0.01, max: 0.05, step: 0.005, value: p.tol, fmt: (v) => Number(v).toFixed(3) })}</div>`
      + `<div class="calls-f ${p.adaptive ? 'dim' : ''}">${field({ key: 'calls', label: 'Calls', min: 1, max: 64, value: p.calls, hint: p.adaptive ? 'set by adaptive stopping' : 'all views are solved together; more calls refine the state' })}</div>`;
    if (m === 'Streaming') html = `<div class="f"><div class="f-row"><label>Configuration</label></div>${seg('config', [['L8', 'L8'], ['L4', 'L4'], ['S4', 'S4']], p.config)}
      <div class="f-hint">frames are answered on arrival, in the frame of the first one</div></div>`;
    if (m === 'Incremental') html = `<div class="f"><div class="f-row"><label>Added views</label></div><div class="join-slot"></div>
      <div class="f-hint">the input above is solved first; these views are then added to the solve in progress, all at once</div></div>`
      + field({ key: 'calls1', label: 'Calls before adding', min: 1, max: 32, value: p.calls1 })
      + field({ key: 'calls2', label: 'Calls after adding', min: 1, max: 32, value: p.calls2 });
    if (m === 'Any order') html = field({ key: 'initial', label: 'First views', min: 2, max: 32, value: p.initial })
      + field({ key: 'group', label: 'Views per group', min: 1, max: 32, value: p.group })
      + field({ key: 'scalls', label: 'Calls per group', min: 1, max: 32, value: p.scalls });
    html += `<div class="common">${toggle({ key: 'sky', label: 'Remove the sky', value: p.sky, hint: 'outdoor scenes' })}</div>`;
    box.innerHTML = `<div class="params-in">${html}</div>`;
    for (const k of ['calls', 'initial', 'group', 'scalls', 'calls1', 'calls2']) this.wireField(box, k, (v) => { p[k] = v; });
    if (m === 'Incremental') this.renderJoin();
    this.wireField(box, 'tol', (v) => { p.tol = v; }, (v) => Number(v).toFixed(3));
    if (m === 'Offline' && p.adaptive) box.querySelector('.calls-f input').disabled = true;
    for (const t of box.querySelectorAll('.tg')) t.querySelector('input').addEventListener('change', (e) => {
      p[t.dataset.key] = e.target.checked; this.edited = true;
      if (t.dataset.key === 'adaptive') this.renderMode();      // the calls become a cap; the threshold appears
    });
    if (m === 'Streaming') this.wireSeg('config', (v) => { p.config = v; });
  }
  renderJoin() {                                 // an example shows its own joining views; otherwise the drop zone
    const slot = this.$('.join-slot');
    if (!slot) return;
    const x = this.tab === 'examples' && (this.props.examples || []).find((e) => e.key === this.example);
    if (x?.join?.length) {
      slot.innerHTML = `<div class="strip join-strip">${x.join.map((u) => `<i style="background-image:url(${u})"></i>`).join('')}</div><div class="f-hint">${x.join.length} views of the example</div>`;
    } else { slot.innerHTML = ''; slot.appendChild(this.joinEl); }
  }
  solveMode() { return this.mode === 'Any order' ? 'Any order' : this.mode; }

  // a short clip from the camera (the browser asks for permission), added as the video

  // ---------------------------------------------------------------- requests
  busy() { return !!this.job; }
  send(op, extra) {
    if (this.job) { this.toast('Wait for the current run to finish, or stop it.'); return false; }
    const id = Math.random().toString(36).slice(2, 10);
    this.job = { id, op, t0: performance.now(), source: extra?.source };
    if (op === 'solve') { this.summary = null; this.renderSummary(); }   // a new scene: no stale numbers while it is solved
    this.setRunning(true, op);
    this.trigger('submit', { id, op, ...extra });
    return true;
  }
  params() {
    const p = this.p;
    if (this.mode === 'Incremental') return { calls1: p.calls1, calls2: p.calls2, sky: p.sky };
    return { calls: this.mode === 'Offline' ? p.calls : p.scalls, adaptive: p.adaptive, tol: p.tol, initial: p.initial, group: p.group, config: p.config,
      per_call: p.per_call, updates: p.updates, sky: p.sky };
  }
  async prepareInput(force = false) {
    const vid = this.tab === 'video', items = vid ? this.dVideo.items : this.dPhotos.items;
    if (!items.length) return;
    const key = `${this.tab}|${items.map((it) => it.url).join(',')}|${vid ? this.p.frames : ''}|${this.mode === 'Streaming'}`;
    if (!force && key === this.prepKey) return;
    if (this.job) { this.toast('Preprocessing starts when the current run ends.'); return; }
    this.prepKey = key; this.prepared = null; this.renderPreview();
    try {
      this.status('Uploading…', 'run');
      const paths = vid ? await this.dVideo.paths() : await this.dPhotos.paths();
      if (key !== this.prepKey) return;
      const known = vid && (this.p.framesTouched || isFinite(this.dVideo.items[0].duration));
      this.send('prepare', vid ? { video: paths[0], frames: known ? this.p.frames : null, mode: this.mode } : { files: paths, mode: this.mode });
    } catch (e) { this.prepKey = null; this.status(e.message, 'err'); this.toast(e.message, 'err'); }
  }
  async solve() {
    if (this.job) return;
    if (this.tab === 'examples' && this.example) return this.runExample(this.example);
    if (!this.dPhotos.items.length && !this.dVideo.items.length) { this.toast('Upload an image set or a video first, or pick an example below.'); return; }
    if (!this.prepared) { this.toast('Preprocessing is not done yet.'); return; }
    const src = this.tab === 'video' ? this.dVideo.items[0].name : plural(this.prepared.n, 'photo');
    let join = [];
    if (this.mode === 'Incremental') {
      if (!this.dJoin.items.length) { this.toast('Add the views that join later (under Incremental).'); return; }
      try { join = await this.dJoin.paths(); } catch (e) { this.toast(e.message, 'err'); return; }
    }
    this.send('solve', { mode: this.solveMode(), files: this.prepared.files, join, params: this.params(), source: src });
  }
  loadExample(key) {
    const x = (this.props.examples || []).find((e) => e.key === key);
    if (!x || this.job) return;
    this.example = key; this.tab = 'examples';
    for (const b of this.root.querySelectorAll('.ex')) b.classList.toggle('on', b.dataset.key === key);
    this.mode = x.mode; this.p.sky = !!x.sky; Object.assign(this.p, x.params || {}); this.edited = false;
    this.renderPreview(); this.renderMode();
    this.toast(`Loaded ${x.title}: ${x.mode}${x.sky ? ', sky removed' : ''}. Press Reconstruct.`);
  }
  runExample(key) {
    const x = (this.props.examples || []).find((e) => e.key === key);
    if (!x || this.job) return;
    this.send('solve', { mode: this.solveMode(), example: key, params: this.params(), edited: !!this.edited, source: x.title });
  }
  toggleLab(open = this.$('.lab').hidden) {            // "Continue from here" opens the panel under the stage
    this.$('.lab').hidden = !open; this.cont.classList.toggle('on', open);
    if (open) this.$('.lab').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  async lab() {                                      // Keep solving: new photos join (with the scene, or the scene frozen); none: more calls
    if (!this.summary) { this.toast('Solve a scene first.'); return; }
    try {
      if (!this.dAdd.items.length) {
        if (this.keepScene) throw new Error('Drop new photos to add them to the frozen scene.');
        this.send('more', { calls: this.addCalls });
        return;
      }
      const files = await this.dAdd.paths();
      if (this.send(this.keepScene ? 'fixed' : 'add', { files, calls: this.addCalls })) this.dAdd.clear();
    } catch (e) { this.toast(e.message); }
  }
  exportAs(kind) {
    if (!this.summary) { this.toast('Solve a scene first.'); return; }
    this.$('.dl-keep').textContent = `${this.viewKeep()}%`;
    this.send('export', { kind, keep: this.viewKeep() });
  }
  stop() {
    if (!this.job) return;
    this.trigger('input', {});
    this.job = null; this.setRunning(false); this.status('Stopped', 'err');
  }

  onMessage(m) {
    if (!this.job || m.id !== this.job.id) return;
    if (m.type === 'progress') {
      if (m.cams?.length) this.stage.stage.live(m.cams, this.job.source);
      this.$('.run-p').style.width = `${Math.round(m.f * 100)}%`;
      this.$('.sp').style.width = `${Math.round(m.f * 100)}%`;
      this.status(m.text || 'Working…', 'run');
      return;
    }
    const op = this.job.op, secs = ((performance.now() - this.job.t0) / 1000).toFixed(1);
    this.job = null; this.setRunning(false);
    this.root.dataset.done = String(Number(this.root.dataset.done || 0) + 1);
    if (m.type === 'error') { if (op === 'prepare') this.prepKey = null; this.status(m.text, 'err'); this.toast(m.text, 'err'); return; }
    if (m.type === 'prepared') {
      this.prepared = m;
      if (this.tab === 'video' && !this.p.framesTouched) {   // show the frame count the server chose
        const inp = this.root.querySelector('.f[data-key="frames"] input');
        inp.value = m.n; inp.dispatchEvent(new Event('input')); this.p.framesTouched = false;
        this.prepKey = this.prepKey?.replace(/\|[^|]*\|(true|false)$/, `|${m.n}|$1`);
      }
      this.renderPreview();
      this.status(`Preprocessing done in ${secs} s · ${m.text}`, 'ok'); return;
    }
    if (m.type === 'download') {
      const a = document.createElement('a'); a.href = m.url; a.download = m.name; document.body.appendChild(a); a.click(); a.remove();
      this.status(`Exported ${m.name} (${m.mb} MB)`, 'ok'); return;
    }
    if (m.type === 'result') {
      this.summary = m.summary; this.renderSummary();
      if (m.summary.gpu && this.$('.gpu-name')) this.$('.gpu-name').textContent = ` This run: ${m.summary.gpu}.`;
      const s = m.summary;
      const stats = s.kind === 'stream' ? [`${s.views} frames`]
        : [plural(s.views, 'view'), `${s.calls} calls`].concat(s.ms_call ? [`${fmtNum(s.ms_call)} ms / call`] : []);
      const ex = this.tab === 'examples' && (this.props.examples || []).find((e) => e.key === this.example);
      this.stage.show({ ...m.view, stats, conf: ex?.conf ?? 100 });
      const what = { solve: 'Solved', more: 'Continued', add: 'Joined', fixed: 'Added' }[op] ?? 'Done';
      this.status(`${what} in ${secs} s · ${m.view.mb} MB to the browser`, 'ok');
    }
  }

  setRunning(on, op) {
    this.root.classList.toggle('running', on);
    const run = this.$('.run');
    run.disabled = on; this.$('.stop').hidden = !on; run.hidden = on;
    this.$('.run-t').textContent = on ? ({ prepare: 'Preprocessing…', solve: 'Reconstructing…', more: 'Solving…', add: 'Joining…', fixed: 'Adding…', export: 'Exporting…' }[op] ?? 'Working…') : 'Reconstruct';
    for (const b of this.root.querySelectorAll('.go, .exp, .ex, .mode')) b.disabled = on;
    this.$('.ready').hidden = on;
    if (!on) { this.$('.run-p').style.width = '0'; this.$('.sp').style.width = '0'; }
  }
  status(text, kind = '') {
    this.$('.st').textContent = text;
    this.$('.status').dataset.kind = kind;
  }
  toast(text, kind = '') {
    const t = el(`<div class="toast ${kind}">${esc(text)}</div>`);
    this.$('.toasts').appendChild(t);
    requestAnimationFrame(() => t.classList.add('on'));
    setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 300); }, kind === 'err' ? 6000 : 3200);
  }

  // ---------------------------------------------------------------- solver details (folded under the stage)
  viewKeep() {                                   // exports keep what the viewer shows: its confidence filtering
    return Number(this.stage.stage.$('.s3r-sl input[data-sl="conf"]')?.value ?? 100);
  }

  renderSummary() {
    const s = this.summary;
    this.root.classList.toggle('solved', !!s);
    const kept = !!s && s.kind !== 'stream';   // a stream has no solver state to continue
    this.root.classList.toggle('kept', kept);
    if (!kept) this.toggleLab(false);
    this.$('.dl').hidden = !s; if (!s) this.$('.dl-menu').hidden = true;
    const gb = s?.peak_gb ? `${fmtNum(s.peak_gb, 2)} GB VRAM` : '';
    this.$('.sumline').innerHTML = !s ? '' : (s.kind === 'stream'   // items do not break inside: the line may wrap beside the panel
      ? [`${s.views} frames`, gb]
      : [plural(s.views, 'view'), `${s.calls} calls`, s.ms_call ? `${fmtNum(s.ms_call)} ms/call` : '', gb])
      .filter(Boolean).map((x) => `<span${x === gb ? ' title="peak GPU memory of the solve"' : ''}>${esc(x)}</span>`).join('<i> · </i>');
  }

}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function mount(host, ctx) {
  // the app lives in a shadow root, so the page's own styles do not reach it
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<link rel="stylesheet" href="${ctx.props.base}/ui.css?v=${ctx.props.v}"><div></div>`;
  const root = shadow.lastElementChild;
  root.style.visibility = 'hidden'; root.style.height = '880px'; root.style.overflow = 'hidden';   // unstyled, the page would be very tall for a moment
  shadow.firstElementChild.addEventListener('load', () => { root.style.visibility = root.style.height = root.style.overflow = ''; }, { once: true });
  const app = new App(root, ctx);
  window.__s3rApp = app;
  window.__s3rBus = (m) => app.onMessage(m);
  for (const m of window.__s3rQueue || []) app.onMessage(m);
  window.__s3rQueue = [];
  return app;
}
