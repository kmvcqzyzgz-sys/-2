// ---------- State ----------
const state = {
  images: [],     // { id, name, img, dataUrl }
  clips: [],      // { id, imageId, duration, pan, transition, transitionDuration }
  subtitles: [],  // { id, text, start, end }
  audio: null,    // { name, el, dataUrl, duration }
  currentTime: 0,
  playing: false,
  selection: null, // { kind: 'clip'|'subtitle', id }
  pxPerSec: 60,
  aspect: '16:9',
  subtitleStyle: {
    fontSize: 5.0,        // % of canvas height
    color: '#ffffff',
    bgOpacity: 0.55,
    yPercent: 88,         // % from top
    strokeColor: '#000000',
    strokeWidth: 0,       // px (in canvas space)
  },
};

let nextId = 1;
const uid = () => String(nextId++);

const ASPECTS = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1':  [1080, 1080],
  '4:3':  [1440, 1080],
};

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

applyAspect(state.aspect);

// ---------- Helpers ----------
function totalImageDuration() { return state.clips.reduce((a, c) => a + c.duration, 0); }
function totalDuration() {
  const subEnd = state.subtitles.reduce((m, s) => Math.max(m, s.end), 0);
  return Math.max(totalImageDuration(), state.audio?.duration || 0, subEnd, 0.01);
}
function applyAspect(name) {
  state.aspect = name;
  const [w, h] = ASPECTS[name] || ASPECTS['16:9'];
  canvas.width = w; canvas.height = h;
  canvas.style.aspectRatio = name.replace(':', '/');
}

// ---------- File input ----------
$('#btn-add-images').onclick = () => $('#file-images').click();
$('#file-images').onchange = (e) => {
  const files = Array.from(e.target.files);
  files.forEach(loadImageFile);
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
  const sub = { id: uid(), text: '新字幕', start: t, end: t + 2 };
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
$('#btn-script').onclick = openScriptModal;

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const id = uid();
      state.images.push({ id, name: file.name, img, dataUrl: reader.result });
      state.clips.push({
        id: uid(), imageId: id,
        duration: 3, pan: 'none',
        transition: 'book', transitionDuration: 0.6,
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

// ---------- Drag & drop files ----------
const dropzone = $('#dropzone');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++; dropzone.classList.remove('hidden');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropzone.classList.add('hidden');
});
window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0; dropzone.classList.add('hidden');
  const files = Array.from(e.dataTransfer.files);
  for (const f of files) {
    if (f.type.startsWith('image/')) loadImageFile(f);
    else if (f.type.startsWith('audio/')) loadAudioFile(f);
  }
});

// ---------- Script modal ----------
let tableLines = []; // imported from CSV/XLSX, current selected column

function openScriptModal() {
  $('#script-text').value = state.subtitles.map(s => s.text).join('\n');
  $('#modal').classList.remove('hidden');
  setTab('paste');
}
function setTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== name));
}
document.querySelectorAll('.tab').forEach(t => t.onclick = () => setTab(t.dataset.tab));

$('#modal-cancel').onclick = () => $('#modal').classList.add('hidden');
$('#modal-apply').onclick = () => {
  const activeTab = document.querySelector('.tab.active').dataset.tab;
  const perLine = parseFloat($('#script-per-line').value) || 3;
  const replace = $('#script-replace-clips').checked;
  const proportional = $('#script-proportional').checked;
  let lines = [];
  if (activeTab === 'paste') {
    let text = $('#script-text').value;
    if ($('#script-auto-split').checked) {
      lines = splitByPunctuation(text);
    } else {
      lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    }
  } else {
    lines = tableLines.slice();
  }
  if (lines.length === 0) { alert('没有可用的文案行'); return; }
  applyLines(lines, perLine, replace, proportional);
  $('#modal').classList.add('hidden');
};

function splitByPunctuation(text) {
  const cleaned = text.replace(/\s+/g, '');
  const parts = cleaned.split(/(?<=[。！？；!?;])/);
  return parts.map(s => s.trim()).filter(Boolean);
}

// ---------- Table import ----------
let tableRows = [];
let tableHeaders = [];

$('#table-file').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const ext = f.name.toLowerCase().split('.').pop();
    if (ext === 'csv' || ext === 'tsv') {
      const text = await f.text();
      const sep = ext === 'tsv' ? '\t' : ',';
      tableRows = parseDelimited(text, sep);
    } else {
      if (typeof XLSX === 'undefined') {
        alert('Excel 解析库未加载（需要联网）。请先把表格在 Excel/WPS 中"另存为 CSV"再上传。');
        return;
      }
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      tableRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    }
    if (tableRows.length < 2) { alert('表格内容为空'); return; }
    tableHeaders = tableRows[0].map((h, i) => String(h || `列${i+1}`));
    populateColumnPicker();
    $('#table-pick').classList.remove('hidden');
  } catch (err) {
    alert('解析失败：' + err.message);
  }
};

function populateColumnPicker() {
  const sel = $('#table-col');
  sel.innerHTML = '';
  tableHeaders.forEach((h, i) => {
    const o = document.createElement('option');
    o.value = String(i); o.textContent = h;
    sel.appendChild(o);
  });
  // Auto-pick the column whose header matches common subtitle names
  const prefer = ['原句','文案','字幕','台词','句子','文字','文本'];
  let picked = 0;
  for (let i = 0; i < tableHeaders.length; i++) {
    if (prefer.some(p => tableHeaders[i].includes(p))) { picked = i; break; }
  }
  sel.value = String(picked);
  sel.onchange = updateTablePreview;
  updateTablePreview();
}
function updateTablePreview() {
  const idx = parseInt($('#table-col').value, 10) || 0;
  tableLines = tableRows.slice(1)
    .map(r => String(r[idx] || '').trim())
    .filter(Boolean);
  const prev = $('#table-preview');
  prev.innerHTML = '';
  tableLines.slice(0, 6).forEach((t, i) => {
    const d = document.createElement('div');
    d.textContent = `${i + 1}. ${t}`;
    prev.appendChild(d);
  });
  if (tableLines.length > 6) {
    const d = document.createElement('div');
    d.textContent = `… 共 ${tableLines.length} 行`;
    prev.appendChild(d);
  }
}

function parseDelimited(text, sep) {
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === sep) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function applyLines(lines, perLine, redistributeClips, proportional = true) {
  const total = state.audio?.duration || (lines.length * perLine);
  let durations;
  if (proportional) {
    const weights = lines.map(l => Math.max(1, l.length));
    const sumW = weights.reduce((a, b) => a + b, 0);
    durations = weights.map(w => total * w / sumW);
  } else {
    durations = lines.map(() => total / lines.length);
  }
  let acc = 0;
  state.subtitles = lines.map((t, i) => {
    const sub = {
      id: uid(), text: t,
      start: acc,
      end: Math.max(acc + 0.15, acc + durations[i] - 0.05),
    };
    acc += durations[i];
    return sub;
  });
  if (redistributeClips && state.clips.length > 0) alignClipsToSubtitles();
  rebuild();
}

function alignClipsToSubtitles() {
  if (state.clips.length === 0 || state.subtitles.length === 0) return;
  const n = state.clips.length, m = state.subtitles.length;
  if (n === m) {
    // 1:1 — each image flips when its subtitle appears
    state.clips.forEach((c, i) => {
      const s = state.subtitles[i];
      c.duration = Math.max(0.2, s.end - s.start + 0.05);
    });
  } else {
    // Group subtitles per image proportionally by index
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * m / n);
      const b = Math.floor((i + 1) * m / n);
      const start = state.subtitles[a].start;
      const end = b >= m ? state.subtitles[m - 1].end : state.subtitles[b].start;
      state.clips[i].duration = Math.max(0.2, end - start);
    }
  }
}

// ---------- Save / Load ----------
function saveProject() {
  const data = {
    version: 2,
    aspect: state.aspect,
    subtitleStyle: state.subtitleStyle,
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
    if (data.aspect) applyAspect(data.aspect);
    if (data.subtitleStyle) state.subtitleStyle = { ...state.subtitleStyle, ...data.subtitleStyle };
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

// ---------- Render ----------
// Pan modes never crop the perpendicular axis:
// - left/right pans fit by HEIGHT (no top/bottom crop). If the height-fit
//   image is wider than canvas (landscape source), pan inside that natural
//   overflow. If image is same/narrower than canvas, slide laterally with
//   side letterbox so motion is still visible without losing any pixels.
// - up/down pans symmetric.
// - zoom uses fit-contain then a small uniform scale.
// - none = fit-contain, no motion.
function drawClipPan(img, panType, progress, target = ctx) {
  const W = canvas.width, H = canvas.height;
  const ir = img.width / img.height;
  const cr = W / H;
  const p = Math.max(0, Math.min(1, progress));

  let dw, dh, dx, dy;

  switch (panType) {
    case 'left':
    case 'right': {
      dh = H; dw = H * ir; dy = 0;
      if (dw > W + 0.5) {
        dx = (panType === 'left') ? (W - dw) * p : (W - dw) * (1 - p);
      } else {
        const slack = W * 0.10;
        const baseDx = (W - dw) / 2;
        dx = (panType === 'right')
          ? baseDx + slack - 2 * slack * p
          : baseDx - slack + 2 * slack * p;
      }
      break;
    }
    case 'up':
    case 'down': {
      dw = W; dh = W / ir; dx = 0;
      if (dh > H + 0.5) {
        dy = (panType === 'up') ? (H - dh) * p : (H - dh) * (1 - p);
      } else {
        const slack = H * 0.10;
        const baseDy = (H - dh) / 2;
        dy = (panType === 'down')
          ? baseDy + slack - 2 * slack * p
          : baseDy - slack + 2 * slack * p;
      }
      break;
    }
    case 'zoom-in':
    case 'zoom-out': {
      let baseW, baseH;
      if (ir > cr) { baseW = W; baseH = W / ir; }
      else         { baseH = H; baseW = H * ir; }
      const s = panType === 'zoom-in' ? (1 + 0.10 * p) : (1.10 - 0.10 * p);
      dw = baseW * s; dh = baseH * s;
      dx = (W - dw) / 2; dy = (H - dh) / 2;
      break;
    }
    case 'none':
    default: {
      if (ir > cr) { dw = W; dh = W / ir; }
      else         { dh = H; dw = H * ir; }
      dx = (W - dw) / 2; dy = (H - dh) / 2;
    }
  }
  target.drawImage(img, dx, dy, dw, dh);
}

const offscreen = document.createElement('canvas');
function panToOffscreen(img, panType, progress) {
  if (offscreen.width !== canvas.width) offscreen.width = canvas.width;
  if (offscreen.height !== canvas.height) offscreen.height = canvas.height;
  const oc = offscreen.getContext('2d');
  oc.fillStyle = '#000';
  oc.fillRect(0, 0, canvas.width, canvas.height);
  drawClipPan(img, panType, progress, oc);
  return offscreen;
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
      ctx.save(); ctx.translate(-W * tp, 0); drawClipPan(prevImg, prevPan, prevProg); ctx.restore();
      ctx.save(); ctx.translate(W * (1 - tp), 0); drawClipPan(newImg, newPan, newProg); ctx.restore();
      break;
    case 'slide-right':
      ctx.save(); ctx.translate(W * tp, 0); drawClipPan(prevImg, prevPan, prevProg); ctx.restore();
      ctx.save(); ctx.translate(-W * (1 - tp), 0); drawClipPan(newImg, newPan, newProg); ctx.restore();
      break;
    case 'flip':
      if (tp < 0.5) {
        const s = 1 - tp * 2;
        ctx.save(); ctx.translate(W / 2, 0); ctx.scale(s, 1); ctx.translate(-W / 2, 0);
        drawClipPan(prevImg, prevPan, prevProg); ctx.restore();
      } else {
        const s = (tp - 0.5) * 2;
        ctx.save(); ctx.translate(W / 2, 0); ctx.scale(s, 1); ctx.translate(-W / 2, 0);
        drawClipPan(newImg, newPan, newProg); ctx.restore();
      }
      break;
    case 'book': {
      // Realistic book peel with cylindrical curl: old page lifts from
      // right edge, the airborne portion is foreshortened (compressed
      // horizontally) and shaded as a half-cylinder; new page visible
      // underneath with a soft drop shadow.
      drawClipPan(newImg, newPan, newProg);
      const foldX = W * (1 - tp);
      if (foldX <= 0) break;

      const off = panToOffscreen(prevImg, prevPan, prevProg);

      // Flat portion still on the table (left of fold)
      ctx.drawImage(off, 0, 0, foldX, H, 0, 0, foldX, H);

      const lifted = W - foldX;
      if (lifted > 1) {
        // Compress lifted strip to simulate foreshortening (a half-cylinder
        // projects to ~ 2R; we squeeze the original strip into curlW).
        const curlW = Math.min(lifted, Math.max(40, lifted * 0.28 + 24));
        ctx.drawImage(off, foldX, 0, lifted, H, foldX, 0, curlW, H);

        // Cylindrical shading (dark - light - dark across the curl)
        const cg = ctx.createLinearGradient(foldX, 0, foldX + curlW, 0);
        cg.addColorStop(0,    'rgba(0,0,0,0.55)');
        cg.addColorStop(0.45, 'rgba(255,255,255,0.18)');
        cg.addColorStop(0.55, 'rgba(255,255,255,0.18)');
        cg.addColorStop(1,    'rgba(0,0,0,0.55)');
        ctx.fillStyle = cg;
        ctx.fillRect(foldX, 0, curlW, H);

        // Drop shadow falling onto new page beyond the curl
        const sw = Math.min(140, lifted * 0.45 + 30);
        const sg = ctx.createLinearGradient(foldX + curlW, 0, foldX + curlW + sw, 0);
        sg.addColorStop(0, 'rgba(0,0,0,0.5)');
        sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(foldX + curlW, 0, sw, H);

        // Bright fold spine highlight
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(foldX - 1, 0, 2, H);
      }
      break;
    }
    default:
      drawClipPan(newImg, newPan, newProg);
  }
}
function drawSubtitle(text) {
  const W = canvas.width, H = canvas.height;
  const st = state.subtitleStyle;
  const fs = Math.max(12, Math.floor(H * st.fontSize / 100));
  ctx.font = `600 ${fs}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Wrap by canvas width
  const maxW = W * 0.86;
  const lines = wrapText(text, maxW);
  const lineH = fs * 1.3;
  const cx = W / 2;
  const cy = H * st.yPercent / 100;
  const totalH = lines.length * lineH;
  const startY = cy - totalH / 2 + lineH / 2;

  // bg
  if (st.bgOpacity > 0) {
    let widest = 0;
    for (const ln of lines) widest = Math.max(widest, ctx.measureText(ln).width);
    const padX = fs * 0.6, padY = fs * 0.3;
    const boxW = widest + padX * 2;
    const boxH = totalH + padY * 2;
    ctx.fillStyle = `rgba(0,0,0,${st.bgOpacity})`;
    roundRect(ctx, cx - boxW / 2, cy - boxH / 2, boxW, boxH, 8);
    ctx.fill();
  }
  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * lineH;
    if (st.strokeWidth > 0) {
      ctx.lineWidth = st.strokeWidth;
      ctx.strokeStyle = st.strokeColor;
      ctx.lineJoin = 'round';
      ctx.strokeText(lines[i], cx, y);
    }
    ctx.fillStyle = st.color;
    ctx.fillText(lines[i], cx, y);
  }
}
function wrapText(text, maxW) {
  // Greedy wrap; supports CJK by char, latin by word
  const tokens = [];
  let buf = '';
  for (const ch of text) {
    if (/\s/.test(ch)) { if (buf) { tokens.push(buf); buf = ''; } tokens.push(ch); }
    else if (ch.charCodeAt(0) > 0x2E80) { if (buf) { tokens.push(buf); buf = ''; } tokens.push(ch); }
    else buf += ch;
  }
  if (buf) tokens.push(buf);
  const lines = [];
  let line = '';
  for (const tk of tokens) {
    const trial = line + tk;
    if (ctx.measureText(trial).width > maxW && line.trim()) {
      lines.push(line.trimEnd());
      line = tk.trim() ? tk : '';
    } else {
      line = trial;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.length ? lines : [text];
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
    if (idx < 0) { idx = state.clips.length - 1; localT = state.clips[idx].duration; }
    const clip = state.clips[idx];
    const img = state.images.find(i => i.id === clip.imageId);
    const progress = clip.duration > 0 ? localT / clip.duration : 1;
    const tDur = Math.min(clip.transitionDuration || 0, clip.duration);
    const inTrans = idx > 0 && tDur > 0 && localT < tDur;
    if (inTrans) {
      const prev = state.clips[idx - 1];
      const prevImg = state.images.find(i => i.id === prev.imageId);
      const tp = localT / tDur;
      if (prevImg && img) applyTransition(prevImg.img, prev.pan, 1, img.img, clip.pan, progress, clip.transition, tp);
      else if (img) drawClipPan(img.img, clip.pan, progress);
    } else if (img) {
      drawClipPan(img.img, clip.pan, progress);
    }
  }
  const sub = state.subtitles.find(s => t >= s.start && t < s.end);
  if (sub) drawSubtitle(sub.text);
}

// ---------- Timeline ----------
function rebuild() {
  const dur = totalDuration();
  const widthPx = Math.max(trackArea.clientWidth, dur * state.pxPerSec + 60);
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

  trackImages.innerHTML = '';
  let acc = 0;
  state.clips.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'clip';
    if (state.selection?.kind === 'clip' && state.selection.id === c.id) el.classList.add('selected');
    const img = state.images.find(im => im.id === c.imageId);
    el.textContent = `${i + 1}. ${img ? img.name : '(图片缺失)'}`;
    el.style.left = (acc * state.pxPerSec) + 'px';
    el.style.width = (c.duration * state.pxPerSec) + 'px';
    el.dataset.id = c.id;
    el.onclick = () => { state.selection = { kind: 'clip', id: c.id }; rebuild(); };
    el.onmousedown = (ev) => {
      if (ev.target !== el) return;
      startReorderClip(ev, c.id, i);
    };
    const r = document.createElement('div');
    r.className = 'handle right';
    r.onmousedown = (ev) => startResizeClip(ev, c.id);
    el.appendChild(r);
    trackImages.appendChild(el);
    acc += c.duration;
  });

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
    el.onmousedown = (ev) => { if (ev.target === el) startMoveSubtitle(ev, s.id); };
    trackSubs.appendChild(el);
  });

  trackAudio.innerHTML = '';
  if (state.audio) {
    const el = document.createElement('div');
    el.className = 'clip audio';
    el.textContent = state.audio.name;
    el.style.left = '0px';
    el.style.width = (state.audio.duration * state.pxPerSec) + 'px';
    trackAudio.appendChild(el);
  }

  seek.max = dur.toFixed(2);
  seek.value = state.currentTime.toFixed(2);
  updatePlayhead();
  updateTimeLabel();
  buildInspector();
  render();
}
function updatePlayhead() { playhead.style.left = (state.currentTime * state.pxPerSec) + 'px'; }
function updateTimeLabel() { timeLabel.textContent = `${state.currentTime.toFixed(2)} / ${totalDuration().toFixed(2)}`; }

// ---------- Inspector ----------
function buildInspector() {
  inspectorBody.innerHTML = '';
  const sel = state.selection;

  if (!sel) {
    inspectorBody.appendChild(sectionTitle('视频设置'));
    inspectorBody.appendChild(row('画幅', selectInput(state.aspect, [
      ['16:9','16:9 横屏'],['9:16','9:16 竖屏'],['1:1','1:1 方形'],['4:3','4:3'],
    ], v => { applyAspect(v); rebuild(); })));

    inspectorBody.appendChild(sectionTitle('字幕样式'));
    const st = state.subtitleStyle;
    inspectorBody.appendChild(row('字号 (% 高)', numInput(st.fontSize, 0.1, v => { st.fontSize = Math.max(1, v); render(); })));
    inspectorBody.appendChild(row('文字颜色', colorInput(st.color, v => { st.color = v; render(); })));
    inspectorBody.appendChild(row('描边粗细 (px)', numInput(st.strokeWidth, 0.5, v => { st.strokeWidth = Math.max(0, v); render(); })));
    inspectorBody.appendChild(row('描边颜色', colorInput(st.strokeColor, v => { st.strokeColor = v; render(); })));
    inspectorBody.appendChild(row('底框透明度', numInput(st.bgOpacity, 0.05, v => { st.bgOpacity = Math.min(1, Math.max(0, v)); render(); })));
    inspectorBody.appendChild(row('垂直位置 (% 上)', numInput(st.yPercent, 1, v => { st.yPercent = Math.min(100, Math.max(0, v)); render(); })));

    if (state.clips.length > 0 && state.subtitles.length > 0) {
      inspectorBody.appendChild(sectionTitle('批量操作'));
      inspectorBody.appendChild(buttonRow([
        ['图片翻页时长 → 对齐字幕', () => { alignClipsToSubtitles(); rebuild(); }],
      ]));
    }
    if (state.clips.length === 0) {
      const tip = document.createElement('p');
      tip.className = 'hint';
      tip.style.marginTop = '12px';
      tip.textContent = '提示：拖拽图片或音频到窗口，或点顶部按钮上传。然后点 "📝 粘文案" 一键对齐。';
      inspectorBody.appendChild(tip);
    }
    return;
  }

  if (sel.kind === 'clip') {
    const clip = state.clips.find(c => c.id === sel.id);
    if (!clip) return;
    const idx = state.clips.indexOf(clip);
    inspectorBody.appendChild(sectionTitle(`图片片段 ${idx + 1}`));
    inspectorBody.appendChild(row('时长（秒）', numInput(clip.duration, 0.1, v => { clip.duration = Math.max(0.1, v); rebuild(); })));
    inspectorBody.appendChild(row('平移效果', selectInput(clip.pan, [
      ['none','无（完整显示）'],
      ['left','向左（不裁上下）'],
      ['right','向右（不裁上下）'],
      ['up','向上（不裁左右）'],
      ['down','向下（不裁左右）'],
      ['zoom-in','放大'],['zoom-out','缩小'],
    ], v => { clip.pan = v; rebuild(); })));
    inspectorBody.appendChild(row('入场过渡', selectInput(clip.transition, [
      ['none','直切'],['fade','淡入'],['slide-left','左滑'],['slide-right','右滑'],
      ['book','仿真翻书'],['flip','翻转'],
    ], v => { clip.transition = v; rebuild(); })));
    inspectorBody.appendChild(row('过渡时长', numInput(clip.transitionDuration, 0.05, v => { clip.transitionDuration = Math.max(0, v); rebuild(); })));
    inspectorBody.appendChild(buttonRow([
      ['上移', () => moveClip(clip.id, -1)],
      ['下移', () => moveClip(clip.id, +1)],
      ['对齐到字幕', () => snapClipToSubtitle(clip.id)],
    ]));
    inspectorBody.appendChild(dangerButton('删除片段', () => {
      state.clips = state.clips.filter(c => c.id !== clip.id);
      state.selection = null; rebuild();
    }));
    return;
  }

  if (sel.kind === 'subtitle') {
    const sub = state.subtitles.find(s => s.id === sel.id);
    if (!sub) return;
    inspectorBody.appendChild(sectionTitle('字幕'));
    inspectorBody.appendChild(row('文案', textArea(sub.text, v => { sub.text = v; rebuild(); })));
    inspectorBody.appendChild(row('开始（秒）', numInput(sub.start, 0.1, v => { sub.start = Math.max(0, v); if (sub.end <= sub.start) sub.end = sub.start + 0.5; rebuild(); })));
    inspectorBody.appendChild(row('结束（秒）', numInput(sub.end, 0.1, v => { sub.end = Math.max(sub.start + 0.1, v); rebuild(); })));
    inspectorBody.appendChild(dangerButton('删除字幕', () => {
      state.subtitles = state.subtitles.filter(s => s.id !== sub.id);
      state.selection = null; rebuild();
    }));
  }
}
function snapClipToSubtitle(clipId) {
  // Set this clip's start (cumulative) to the nearest subtitle start by adjusting prior clip durations is too invasive.
  // Instead: set its duration to match the duration of subtitle starting nearest to its start.
  const idx = state.clips.findIndex(c => c.id === clipId);
  if (idx < 0) return;
  let start = 0;
  for (let i = 0; i < idx; i++) start += state.clips[i].duration;
  const sub = state.subtitles.find(s => Math.abs(s.start - start) < 0.5) ||
              state.subtitles.reduce((best, s) => Math.abs(s.start - start) < Math.abs(best.start - start) ? s : best, state.subtitles[0]);
  if (!sub) return;
  state.clips[idx].duration = Math.max(0.2, sub.end - sub.start);
  rebuild();
}
function sectionTitle(text) {
  const d = document.createElement('div');
  d.style.cssText = 'font-weight:600;margin:4px 0 8px;color:#cfd3da;border-bottom:1px solid var(--line);padding-bottom:4px;';
  d.textContent = text;
  return d;
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
function colorInput(value, onChange) {
  const i = document.createElement('input');
  i.type = 'color'; i.value = value;
  i.oninput = () => onChange(i.value);
  return i;
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
  c.style.display = 'flex'; c.style.gap = '6px'; c.style.flexWrap = 'wrap';
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
  [state.clips[idx], state.clips[ni]] = [state.clips[ni], state.clips[idx]];
  rebuild();
}

// ---------- Drag interactions ----------
function startReorderClip(ev, id, originalIdx) {
  ev.preventDefault();
  let lastSwap = originalIdx;
  const startX = ev.clientX;
  const onMove = (e) => {
    const dx = e.clientX - startX;
    // Compute absolute timeline x for this clip's center under drag
    const me = state.clips.findIndex(c => c.id === id);
    if (me < 0) return;
    let myStart = 0;
    for (let i = 0; i < me; i++) myStart += state.clips[i].duration;
    const myCenterPx = (myStart + state.clips[me].duration / 2) * state.pxPerSec + dx;
    // Find target index by walking clips
    let acc = 0, target = me;
    for (let i = 0; i < state.clips.length; i++) {
      const c = state.clips[i];
      const center = (acc + c.duration / 2) * state.pxPerSec;
      if (myCenterPx < center) { target = i; break; }
      acc += c.duration;
      target = i + 1;
    }
    if (target > me) target -= 1;
    target = Math.max(0, Math.min(state.clips.length - 1, target));
    if (target !== me) {
      const [x] = state.clips.splice(me, 1);
      state.clips.splice(target, 0, x);
      rebuild();
    }
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
function startResizeClip(ev, id) {
  ev.stopPropagation(); ev.preventDefault();
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
  ev.stopPropagation(); ev.preventDefault();
  const sub = state.subtitles.find(s => s.id === id);
  const startX = ev.clientX;
  const s0 = sub.start, e0 = sub.end;
  const onMove = (e) => {
    const dt = (e.clientX - startX) / state.pxPerSec;
    if (edge === 'start') sub.start = Math.min(sub.end - 0.1, Math.max(0, s0 + dt));
    else sub.end = Math.max(sub.start + 0.1, e0 + dt);
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
  ev.preventDefault();
  const sub = state.subtitles.find(s => s.id === id);
  const startX = ev.clientX;
  const s0 = sub.start, e0 = sub.end, len = e0 - s0;
  const onMove = (e) => {
    const dt = (e.clientX - startX) / state.pxPerSec;
    sub.start = Math.max(0, s0 + dt);
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

ruler.addEventListener('mousedown', (ev) => {
  const rect = trackArea.getBoundingClientRect();
  const x = ev.clientX - rect.left + trackArea.scrollLeft;
  const t = Math.max(0, Math.min(totalDuration(), x / state.pxPerSec));
  setCurrentTime(t);
});

// ---------- Transport ----------
$('#btn-play').onclick = () => { state.playing ? pause() : play(); };
$('#btn-stop').onclick = () => { pause(); setCurrentTime(0); };
$('#btn-fullscreen').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else canvas.requestFullscreen?.().catch(() => {});
};
seek.oninput = () => setCurrentTime(parseFloat(seek.value));

let rafId = null;
let lastTs = 0;
function play() {
  if (state.playing) return;
  if (state.currentTime >= totalDuration() - 0.01) state.currentTime = 0;
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
    setCurrentTime(t, true);
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
let exportCancelled = false;
$('#export-cancel').onclick = () => { exportCancelled = true; };

async function exportVideo() {
  if (state.clips.length === 0) { alert('请先添加图片'); return; }
  pause();
  exportCancelled = false;
  const wasTime = state.currentTime;
  setCurrentTime(0);

  $('#export-overlay').classList.remove('hidden');
  setExportProgress(0, '准备...');

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
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=h264,aac',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const mime = mimeCandidates.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const done = new Promise((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `export.${ext}`;
      a.click();
      if (ext !== 'mp4') {
        setTimeout(() => alert('当前浏览器不支持直接导出 MP4，已导出为 WebM。\nAndroid 多数可直接播；iPhone 不支持 WebM，请用剪映/醒图等导入再导出，或在线工具转 MP4。\n建议使用最新版 Chrome / Edge 可直接导出 MP4。'), 100);
      }
      resolve();
    };
  });

  recorder.start(200);
  if (state.audio) {
    state.audio.el.currentTime = 0;
    await state.audio.el.play().catch(() => {});
  }

  const dur = totalDuration();
  await new Promise((resolve) => {
    const startTs = performance.now();
    const step = () => {
      const elapsed = (performance.now() - startTs) / 1000;
      if (exportCancelled || elapsed >= dur) { resolve(); return; }
      setCurrentTime(elapsed, true);
      setExportProgress(elapsed / dur, `导出中 ${(elapsed / dur * 100).toFixed(0)}%`);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  recorder.stop();
  if (state.audio) state.audio.el.pause();
  if (audioCtx) audioCtx.close().catch(() => {});
  await done;
  setCurrentTime(wasTime);
  $('#export-overlay').classList.add('hidden');
}
function setExportProgress(p, label) {
  $('#export-bar').style.width = `${Math.min(100, Math.max(0, p * 100))}%`;
  $('#export-status').textContent = label;
}

// ---------- Calibration (tap-to-sync subtitles to audio) ----------
let calibrationState = null;

$('#btn-calibrate').onclick = startCalibration;
$('#cal-cancel').onclick = cancelCalibration;
$('#cal-finish').onclick = finishCalibration;

function startCalibration() {
  if (state.subtitles.length === 0) { alert('请先用 📝 粘文案 添加字幕'); return; }
  if (!state.audio) { alert('请先上传配音音频'); return; }
  // First subtitle assumed to start at 0; user marks the start of each
  // subsequent subtitle by pressing space while listening.
  calibrationState = { idx: 0, marks: [0] };
  $('#calibration').classList.remove('hidden');
  updateCalibrationOverlay();
  pause();
  setCurrentTime(0);
  play();
}
function calibrationMark() {
  if (!calibrationState) return;
  const next = calibrationState.idx + 1;
  if (next >= state.subtitles.length) { finishCalibration(); return; }
  calibrationState.marks.push(state.currentTime);
  calibrationState.idx = next;
  updateCalibrationOverlay();
}
function updateCalibrationOverlay() {
  const cur = calibrationState.idx;
  const total = state.subtitles.length;
  $('#cal-progress').textContent = `当前：第 ${cur + 1} / ${total} 句`;
  if (cur < total - 1) {
    $('#cal-line').textContent = `下一句：${state.subtitles[cur + 1].text}`;
  } else {
    $('#cal-line').textContent = '最后一句正在播放，结束时按"完成"。';
  }
}
function finishCalibration() {
  if (!calibrationState) return;
  pause();
  while (calibrationState.marks.length < state.subtitles.length) {
    calibrationState.marks.push(state.audio?.duration || state.currentTime);
  }
  const marks = calibrationState.marks;
  const n = state.subtitles.length;
  for (let i = 0; i < n; i++) {
    state.subtitles[i].start = marks[i];
    const next = i < n - 1 ? marks[i + 1] : (state.audio?.duration || marks[i] + 3);
    state.subtitles[i].end = Math.max(marks[i] + 0.2, next - 0.05);
  }
  calibrationState = null;
  $('#calibration').classList.add('hidden');
  if (state.clips.length > 0 && confirm('字幕时间已更新。是否同时让图片翻页时长对齐字幕？')) {
    alignClipsToSubtitles();
  }
  rebuild();
}
function cancelCalibration() {
  pause();
  calibrationState = null;
  $('#calibration').classList.add('hidden');
}
document.addEventListener('keydown', (e) => {
  if (!calibrationState) return;
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    calibrationMark();
  } else if (e.key === 'Escape') {
    cancelCalibration();
  }
});

// ---------- Init ----------
window.addEventListener('resize', rebuild);
rebuild();
