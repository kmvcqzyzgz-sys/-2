// ---------- State ----------
const state = {
  images: [],     // { id, name, img: HTMLImageElement, dataUrl }
  clips: [],      // { id, imageId, duration, pan, transition, transitionDuration }
  subtitles: [],  // { id, text, start, end }
  audio: null,    // { name, el: HTMLAudioElement, dataUrl, duration }
  currentTime: 0,
  playing: false,
  selection: null, // { kind: 'clip'|'subtitle', id }
  pxPerSec: 60,
};

let nextId = 1;
const uid = () => String(nextId++);

// ---------- DOM ----------
const $ = (s) => document.querySelector(s);
const canvas = $('#stage');
const ctx = canvas.getContext('2d');
const trackArea = $('#track-area');
const trackImages = $('#track-images');
const trackSubs = $('#track-subtitles');
const trackAudio = $('#track-audio');
const ruler = $('#ruler');
const playhead = $('#playhead');
const inspectorBody = $('#inspector-body');
const seek = $('#seek');
const timeLabel = $('#time-label');

// ---------- Derived ----------
function clipStart(idx) {
  let t = 0;
  for (let i = 0; i < idx; i++) t += state.clips[i].duration;
  return t;
}
function totalImageDuration() {
  return state.clips.reduce((a, c) => a + c.duration, 0);
}
function totalDuration() {
  const subEnd = state.subtitles.reduce((m, s) => Math.max(m, s.end), 0);
  return Math.max(totalImageDuration(), state.audio?.duration || 0, subEnd);
}

// ---------- File handlers ----------
$('#btn-add-images').onclick = () => $('#file-images').click();
$('#file-images').onchange = (e) => {
  for (const f of e.target.files) loadImageFile(f);
  e.target.value = '';
};

$('#btn-add-audio').onclick = () => $('#file-audio').click();
$('#file-audio').onchange = (e) => {
  const f = e.target.files[0];
  if (f) loadAudioFile(f);
  e.target.value = '';
};

$('#btn-add-subtitle').onclick = () => {
  const t = state.currentTime;
  const sub = { id: uid(), text: '新字幕', start: t, end: Math.min(t + 2, Math.max(t + 2, totalDuration() || t + 2)) };
  state.subtitles.push(sub);
  state.selection = { kind: 'subtitle', id: sub.id };
  rebuild();
};

$('#btn-save').onclick = saveProject;
$('#btn-load').onclick = () => $('#file-load').click();
$('#file-load').onchange = (e) => {
  const f = e.target.files[0];
  if (f) loadProject(f);
  e.target.value = '';
};

$('#btn-export').onclick = exportVideo;

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const id = uid();
      state.images.push({ id, name: file.name, img, dataUrl: reader.result });
      state.clips.push({
        id: uid(), imageId: id,
        duration: 3, pan: 'right',
        transition: 'fade', transitionDuration: 0.5,
      });
      rebuild();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function loadAudioFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const el = new Audio();
    el.src = reader.result;
    el.addEventListener('loadedmetadata', () => {
      state.audio = { name: file.name, el, dataUrl: reader.result, duration: el.duration };
      rebuild();
    }, { once: true });
  };
  reader.readAsDataURL(file);
}

// ---------- Project save/load ----------
function saveProject() {
  const data = {
    version: 1,
    images: state.images.map(({ id, name, dataUrl }) => ({ id, name, dataUrl })),
    clips: state.clips,
    subtitles: state.subtitles,
    audio: state.audio ? { name: state.audio.name, dataUrl: state.audio.dataUrl, duration: state.audio.duration } : null,
    nextId,
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'project.json';
  a.click();
}

function loadProject(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const data = JSON.parse(reader.result);
    state.images = []; state.clips = []; state.subtitles = []; state.audio = null;
    nextId = data.nextId || 1;
    let pending = data.images.length + (data.audio ? 1 : 0);
    if (pending === 0) finish();
    for (const m of data.images) {
      const img = new Image();
      img.onload = () => {
        state.images.push({ id: m.id, name: m.name, img, dataUrl: m.dataUrl });
        if (--pending === 0) finish();
      };
      img.src = m.dataUrl;
    }
    if (data.audio) {
      const el = new Audio();
      el.src = data.audio.dataUrl;
      el.addEventListener('loadedmetadata', () => {
        state.audio = { name: data.audio.name, el, dataUrl: data.audio.dataUrl, duration: el.duration };
        if (--pending === 0) finish();
      }, { once: true });
    }
    function finish() {
      state.clips = data.clips;
      state.subtitles = data.subtitles;
      rebuild();
    }
  };
  reader.readAsText(file);
}

// ---------- Render canvas ----------
function drawClipPan(img, panType, progress) {
  const W = canvas.width, H = canvas.height;
  const ir = img.width / img.height;
  const cr = W / H;
  let baseW, baseH;
  if (ir > cr) { baseH = H; baseW = H * ir; }
  else { baseW = W; baseH = W / ir; }

  const overscan = 1.18;
  let dw = baseW * overscan, dh = baseH * overscan;
  let dx = (W - dw) / 2, dy = (H - dh) / 2;

  const p = Math.max(0, Math.min(1, progress));
  switch (panType) {
    case 'left':  dx = (W - dw) * p; break;
    case 'right': dx = (W - dw) * (1 - p); break;
    case 'up':    dy = (H - dh) * p; break;
    case 'down':  dy = (H - dh) * (1 - p); break;
    case 'zoom-in': {
      const s = 1 + 0.25 * p;
      dw = baseW * s; dh = baseH * s;
      dx = (W - dw) / 2; dy = (H - dh) / 2;
      break;
    }
    case 'zoom-out': {
      const s = 1.25 - 0.25 * p;
      dw = baseW * s; dh = baseH * s;
      dx = (W - dw) / 2; dy = (H - dh) / 2;
      break;
    }
    case 'none': default:
      dw = baseW; dh = baseH;
      dx = (W - dw) / 2; dy = (H - dh) / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}

function applyTransition(prevImg, prevPan, prevProg, newImg, newPan, newProg, type, tp) {
  const W = canvas.width, H = canvas.height;
  switch (type) {
    case 'fade':
      drawClipPan(prevImg, prevPan, prevProg);
      ctx.globalAlpha = tp;
      drawClipPan(newImg, newPan, newProg);
      ctx.globalAlpha = 1;
      break;
    case 'slide-left':
      ctx.save(); ctx.translate(-W * tp, 0);
      drawClipPan(prevImg, prevPan, prevProg);
      ctx.restore();
      ctx.save(); ctx.translate(W * (1 - tp), 0);
      drawClipPan(newImg, newPan, newProg);
      ctx.restore();
      break;
    case 'slide-right':
      ctx.save(); ctx.translate(W * tp, 0);
      drawClipPan(prevImg, prevPan, prevProg);
      ctx.restore();
      ctx.save(); ctx.translate(-W * (1 - tp), 0);
      drawClipPan(newImg, newPan, newProg);
      ctx.restore();
      break;
    case 'flip': {
      // Page-flip approximation via horizontal scale around center.
      if (tp < 0.5) {
        const s = 1 - tp * 2;
        ctx.save();
        ctx.translate(W / 2, 0); ctx.scale(s, 1); ctx.translate(-W / 2, 0);
        drawClipPan(prevImg, prevPan, prevProg);
        ctx.restore();
      } else {
        const s = (tp - 0.5) * 2;
        ctx.save();
        ctx.translate(W / 2, 0); ctx.scale(s, 1); ctx.translate(-W / 2, 0);
        drawClipPan(newImg, newPan, newProg);
        ctx.restore();
      }
      break;
    }
    default:
      drawClipPan(newImg, newPan, newProg);
  }
}

function drawSubtitle(text) {
  const W = canvas.width, H = canvas.height;
  const fs = Math.floor(H * 0.05);
  ctx.font = `600 ${fs}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const m = ctx.measureText(text);
  const padX = 18, padY = 10;
  const boxW = m.width + padX * 2;
  const boxH = fs + padY * 2;
  const cx = W / 2;
  const cy = H - H * 0.10;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, cx - boxW / 2, cy - boxH / 2, boxW, boxH, 6);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(text, cx, cy);
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function render() {
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const t = state.currentTime;
  if (state.clips.length > 0) {
    let acc = 0, idx = -1, localT = 0;
    for (let i = 0; i < state.clips.length; i++) {
      const c = state.clips[i];
      if (t < acc + c.duration) { idx = i; localT = t - acc; break; }
      acc += c.duration;
    }
    if (idx < 0) {
      // After last clip: hold last frame
      idx = state.clips.length - 1;
      localT = state.clips[idx].duration;
    }
    const clip = state.clips[idx];
    const img = state.images.find(i => i.id === clip.imageId);
    const progress = clip.duration > 0 ? localT / clip.duration : 1;
    const tDur = Math.min(clip.transitionDuration || 0, clip.duration);
    const inTrans = idx > 0 && tDur > 0 && localT < tDur;
    if (inTrans) {
      const prev = state.clips[idx - 1];
      const prevImg = state.images.find(i => i.id === prev.imageId);
      const tp = localT / tDur;
      applyTransition(prevImg.img, prev.pan, 1, img.img, clip.pan, progress, clip.transition, tp);
    } else if (img) {
      drawClipPan(img.img, clip.pan, progress);
    }
  }

  const sub = state.subtitles.find(s => t >= s.start && t < s.end);
  if (sub) drawSubtitle(sub.text);
}

// ---------- Timeline UI ----------
function rebuild() {
  // Build ruler
  const dur = totalDuration();
  const widthPx = Math.max(trackArea.clientWidth - 0, dur * state.pxPerSec + 60);
  ruler.style.width = trackImages.style.width = trackSubs.style.width = trackAudio.style.width = widthPx + 'px';
  ruler.innerHTML = '';
  const step = state.pxPerSec >= 60 ? 1 : 2;
  for (let s = 0; s <= dur + step; s += step) {
    const tick = document.createElement('div');
    tick.className = 'tick';
    tick.style.left = (s * state.pxPerSec) + 'px';
    tick.textContent = s + 's';
    ruler.appendChild(tick);
  }

  // Image clips
  trackImages.innerHTML = '';
  let acc = 0;
  state.clips.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'clip';
    if (state.selection?.kind === 'clip' && state.selection.id === c.id) el.classList.add('selected');
    const img = state.images.find(im => im.id === c.imageId);
    el.textContent = img ? img.name : '(图片缺失)';
    el.style.left = (acc * state.pxPerSec) + 'px';
    el.style.width = (c.duration * state.pxPerSec) + 'px';
    el.dataset.id = c.id;
    el.onclick = () => { state.selection = { kind: 'clip', id: c.id }; rebuild(); };
    const r = document.createElement('div');
    r.className = 'handle right';
    r.onmousedown = (ev) => startResizeClip(ev, c.id);
    el.appendChild(r);
    trackImages.appendChild(el);
    acc += c.duration;
  });

  // Subtitle clips
  trackSubs.innerHTML = '';
  state.subtitles.forEach(s => {
    const el = document.createElement('div');
    el.className = 'clip subtitle';
    if (state.selection?.kind === 'subtitle' && state.selection.id === s.id) el.classList.add('selected');
    el.textContent = s.text;
    el.style.left = (s.start * state.pxPerSec) + 'px';
    el.style.width = Math.max(20, (s.end - s.start) * state.pxPerSec) + 'px';
    el.dataset.id = s.id;
    el.onclick = () => { state.selection = { kind: 'subtitle', id: s.id }; rebuild(); };
    const left = document.createElement('div');
    left.className = 'handle left';
    left.onmousedown = (ev) => startResizeSubtitle(ev, s.id, 'start');
    const right = document.createElement('div');
    right.className = 'handle right';
    right.onmousedown = (ev) => startResizeSubtitle(ev, s.id, 'end');
    el.appendChild(left); el.appendChild(right);
    el.onmousedown = (ev) => {
      if (ev.target !== el) return;
      startMoveSubtitle(ev, s.id);
    };
    trackSubs.appendChild(el);
  });

  // Audio
  trackAudio.innerHTML = '';
  if (state.audio) {
    const el = document.createElement('div');
    el.className = 'clip audio';
    el.textContent = state.audio.name;
    el.style.left = '0px';
    el.style.width = (state.audio.duration * state.pxPerSec) + 'px';
    trackAudio.appendChild(el);
  }

  // Seek bar bounds
  seek.max = dur.toFixed(2);
  seek.value = state.currentTime.toFixed(2);
  updatePlayhead();
  updateTimeLabel();
  buildInspector();
  render();
}

function updatePlayhead() {
  const x = state.currentTime * state.pxPerSec;
  playhead.style.left = x + 'px';
}
function updateTimeLabel() {
  timeLabel.textContent = `${state.currentTime.toFixed(2)} / ${totalDuration().toFixed(2)}`;
}

// ---------- Inspector ----------
function buildInspector() {
  inspectorBody.innerHTML = '';
  const sel = state.selection;
  if (!sel) {
    inspectorBody.innerHTML = '<p class="hint">在时间轴上选中片段或字幕来编辑。</p>';
    return;
  }
  if (sel.kind === 'clip') {
    const clip = state.clips.find(c => c.id === sel.id);
    if (!clip) return;
    inspectorBody.appendChild(row('时长（秒）', numInput(clip.duration, 0.1, v => { clip.duration = Math.max(0.1, v); rebuild(); })));
    inspectorBody.appendChild(row('平移效果', selectInput(clip.pan, [
      ['none','无'], ['left','向左'], ['right','向右'],
      ['up','向上'], ['down','向下'],
      ['zoom-in','放大'], ['zoom-out','缩小'],
    ], v => { clip.pan = v; rebuild(); })));
    inspectorBody.appendChild(row('入场过渡', selectInput(clip.transition, [
      ['none','直切'], ['fade','淡入'], ['slide-left','左滑'], ['slide-right','右滑'], ['flip','翻页'],
    ], v => { clip.transition = v; rebuild(); })));
    inspectorBody.appendChild(row('过渡时长', numInput(clip.transitionDuration, 0.05, v => { clip.transitionDuration = Math.max(0, v); rebuild(); })));
    inspectorBody.appendChild(buttonRow([
      ['上移', () => moveClip(clip.id, -1)],
      ['下移', () => moveClip(clip.id, +1)],
    ]));
    inspectorBody.appendChild(dangerButton('删除片段', () => {
      state.clips = state.clips.filter(c => c.id !== clip.id);
      state.selection = null; rebuild();
    }));
  } else if (sel.kind === 'subtitle') {
    const sub = state.subtitles.find(s => s.id === sel.id);
    if (!sub) return;
    inspectorBody.appendChild(row('文案', textArea(sub.text, v => { sub.text = v; rebuild(); })));
    inspectorBody.appendChild(row('开始（秒）', numInput(sub.start, 0.1, v => { sub.start = Math.max(0, v); if (sub.end <= sub.start) sub.end = sub.start + 0.5; rebuild(); })));
    inspectorBody.appendChild(row('结束（秒）', numInput(sub.end, 0.1, v => { sub.end = Math.max(sub.start + 0.1, v); rebuild(); })));
    inspectorBody.appendChild(dangerButton('删除字幕', () => {
      state.subtitles = state.subtitles.filter(s => s.id !== sub.id);
      state.selection = null; rebuild();
    }));
  }
}
function row(label, control) {
  const w = document.createElement('div');
  w.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  w.appendChild(l); w.appendChild(control);
  return w;
}
function numInput(value, step, onChange) {
  const i = document.createElement('input');
  i.type = 'number'; i.step = step; i.value = value;
  i.oninput = () => onChange(parseFloat(i.value) || 0);
  return i;
}
function selectInput(value, options, onChange) {
  const s = document.createElement('select');
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    if (v === value) o.selected = true;
    s.appendChild(o);
  }
  s.onchange = () => onChange(s.value);
  return s;
}
function textArea(value, onChange) {
  const t = document.createElement('textarea');
  t.value = value;
  t.oninput = () => onChange(t.value);
  return t;
}
function buttonRow(items) {
  const w = document.createElement('div');
  w.className = 'row';
  const c = document.createElement('div');
  c.style.display = 'flex'; c.style.gap = '6px';
  for (const [label, fn] of items) {
    const b = document.createElement('button');
    b.textContent = label; b.onclick = fn;
    c.appendChild(b);
  }
  w.appendChild(c);
  return w;
}
function dangerButton(label, fn) {
  const w = document.createElement('div');
  w.className = 'row';
  const b = document.createElement('button');
  b.textContent = label; b.className = 'danger'; b.onclick = fn;
  w.appendChild(b);
  return w;
}

function moveClip(id, dir) {
  const idx = state.clips.findIndex(c => c.id === id);
  const ni = idx + dir;
  if (idx < 0 || ni < 0 || ni >= state.clips.length) return;
  const arr = state.clips;
  [arr[idx], arr[ni]] = [arr[ni], arr[idx]];
  rebuild();
}

// ---------- Drag interactions ----------
function startResizeClip(ev, id) {
  ev.stopPropagation();
  const clip = state.clips.find(c => c.id === id);
  const startX = ev.clientX;
  const startDur = clip.duration;
  const onMove = (e) => {
    const dx = e.clientX - startX;
    clip.duration = Math.max(0.2, startDur + dx / state.pxPerSec);
    rebuild();
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
function startResizeSubtitle(ev, id, edge) {
  ev.stopPropagation();
  const sub = state.subtitles.find(s => s.id === id);
  const startX = ev.clientX;
  const startStart = sub.start, startEnd = sub.end;
  const onMove = (e) => {
    const dx = e.clientX - startX;
    const dt = dx / state.pxPerSec;
    if (edge === 'start') sub.start = Math.min(sub.end - 0.1, Math.max(0, startStart + dt));
    else sub.end = Math.max(sub.start + 0.1, startEnd + dt);
    rebuild();
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
function startMoveSubtitle(ev, id) {
  const sub = state.subtitles.find(s => s.id === id);
  const startX = ev.clientX;
  const startStart = sub.start, startEnd = sub.end;
  const len = startEnd - startStart;
  const onMove = (e) => {
    const dx = e.clientX - startX;
    const dt = dx / state.pxPerSec;
    sub.start = Math.max(0, startStart + dt);
    sub.end = sub.start + len;
    rebuild();
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// Click ruler / track to seek
function seekFromEvent(ev) {
  const rect = trackArea.getBoundingClientRect();
  const x = ev.clientX - rect.left + trackArea.scrollLeft;
  const t = Math.max(0, Math.min(totalDuration(), x / state.pxPerSec));
  setCurrentTime(t);
}
ruler.addEventListener('mousedown', seekFromEvent);

// ---------- Transport ----------
$('#btn-play').onclick = () => { state.playing ? pause() : play(); };
$('#btn-stop').onclick = () => { pause(); setCurrentTime(0); };
seek.oninput = () => setCurrentTime(parseFloat(seek.value));

let rafId = null;
let lastTs = 0;
function play() {
  if (state.playing) return;
  state.playing = true;
  $('#btn-play').textContent = '⏸ 暂停';
  if (state.audio) {
    state.audio.el.currentTime = state.currentTime;
    state.audio.el.play().catch(() => {});
  }
  lastTs = performance.now();
  const tick = (ts) => {
    if (!state.playing) return;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    let t = state.currentTime + dt;
    const dur = totalDuration();
    if (t >= dur) { t = dur; pause(); }
    setCurrentTime(t, /*fromPlay*/ true);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}
function pause() {
  state.playing = false;
  $('#btn-play').textContent = '▶ 播放';
  if (rafId) cancelAnimationFrame(rafId);
  if (state.audio) state.audio.el.pause();
}
function setCurrentTime(t, fromPlay = false) {
  state.currentTime = t;
  seek.value = t.toFixed(2);
  updatePlayhead();
  updateTimeLabel();
  render();
  if (!fromPlay && state.audio) state.audio.el.currentTime = Math.min(t, state.audio.duration || 0);
}

// ---------- Export ----------
async function exportVideo() {
  if (state.clips.length === 0) { alert('请先添加图片'); return; }
  pause();
  const wasTime = state.currentTime;
  setCurrentTime(0);

  const fps = 30;
  const stream = canvas.captureStream(fps);

  let audioCtx, audioSrc;
  if (state.audio) {
    audioCtx = new AudioContext();
    audioSrc = audioCtx.createMediaElementSource(state.audio.el);
    const dest = audioCtx.createMediaStreamDestination();
    audioSrc.connect(dest);
    audioSrc.connect(audioCtx.destination);
    dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  }

  const mimeCandidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const mime = mimeCandidates.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const done = new Promise((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'export.webm';
      a.click();
      resolve();
    };
  });

  recorder.start();
  if (state.audio) {
    state.audio.el.currentTime = 0;
    await state.audio.el.play().catch(() => {});
  }

  await new Promise((resolve) => {
    const dur = totalDuration();
    const startTs = performance.now();
    const step = () => {
      const elapsed = (performance.now() - startTs) / 1000;
      if (elapsed >= dur) { resolve(); return; }
      setCurrentTime(elapsed, true);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  recorder.stop();
  if (state.audio) state.audio.el.pause();
  await done;
  setCurrentTime(wasTime);
}

// ---------- Init ----------
window.addEventListener('resize', rebuild);
rebuild();
