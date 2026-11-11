// Chistes Studio — sin backend. Fuente de verdad: data/jokes.json.
const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 9);
const DEFAULT_PAGE = { name: 'Mi página', bg: '#f4efe6', fg: '#1c1b1a', accent: '#b3380a', watermark: '', logo: null, logoPos: { x: 88, y: 4, size: 12 } };
const SPEAKER_COLORS = ['#1d4ed8', '#047857', '#9333ea', '#be123c', '#a16207'];

let state = { version: 1, pages: [], jokes: [] };
let ui = { lang: 'es', jokeId: null, pageId: null, speakerColors: {}, dirty: false, fileHandle: null };
let logoImg = null;

// ---------- Persistencia local (IndexedDB) ----------
const idb = {
  open: () => new Promise((res, rej) => {
    const r = indexedDB.open('chistes-studio', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }),
  async get(k) { try { const db = await this.open(); return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); } catch { return undefined; } },
  async set(k, v) { try { const db = await this.open(); await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch { /* sin almacenamiento */ } },
};
let saveTimer;
function persist() { ui.dirty = true; updateBadge(); clearTimeout(saveTimer); saveTimer = setTimeout(() => idb.set('state', state), 300); }

// ---------- Utilidades de UI ----------
function toast(msg, actionLabel, action) {
  const t = $('toast'); t.innerHTML = ''; t.append(msg);
  if (actionLabel) { const b = document.createElement('button'); b.textContent = actionLabel; b.onclick = () => { action(); t.hidden = true; }; t.append(b); }
  t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 6000);
}
function confirmDlg(msg) { return new Promise((res) => { $('dlgMsg').textContent = msg; const d = $('dlg'); d.onclose = () => res(d.returnValue === 'ok'); d.showModal(); }); }
function updateBadge() {
  const b = $('fileBadge');
  b.textContent = (ui.fileHandle ? 'Archivo vinculado' : 'Archivo: sin vincular') + (ui.dirty ? ' · cambios sin guardar' : '');
  b.className = 'chip ' + (ui.dirty ? 'warn' : ui.fileHandle ? 'ok' : '');
}
const page = (id) => state.pages.find((p) => p.id === id) || state.pages[0];
const jtext = (j) => (ui.lang === 'es' && j.es && j.es.text) || j.text;
const curJoke = () => state.jokes.find((j) => j.id === ui.jokeId);

// ---------- Análisis del texto ----------
function parseLines(text, split) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim(); if (!line) continue;
    let m = line.match(/^([\p{L}][\p{L}\p{N} ]{0,18}):\s*(.+)$/u);
    if (m) { out.push({ speaker: m[1].trim(), text: m[2] }); continue; }
    m = line.match(/^[-–—]\s*(.+)$/);
    if (m) {
      if (split) out.push({ speaker: null, dash: true, text: m[1] });
      else if (out.length && out[out.length - 1].dash) out[out.length - 1].text += ' ' + m[1];
      else out.push({ speaker: null, dash: true, text: m[1] });
      continue;
    }
    out.push({ speaker: null, text: line });
  }
  return out;
}
function review(text) {
  const lines = parseLines(text, true); const notes = []; let level = 'ok';
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const up = (s) => { const l = s.replace(/[^\p{L}]/gu, ''); return l.length > 3 && l === l.toUpperCase(); };
  if (!text.trim()) return { level: 'ok', notes: [], words };
  if (lines.length > 5) { notes.push(`Tiene ${lines.length} líneas; para Reels el máximo recomendado es 5.`); level = 'bad'; }
  if (words > 70) { notes.push(`Tiene ${words} palabras; es largo para 30–60 s.`); level = level === 'bad' ? 'bad' : 'warn'; }
  if (lines.length && !up(lines[lines.length - 1].text)) { notes.push('El remate (última línea) no está en mayúsculas.'); if (level === 'ok') level = 'warn'; }
  if (lines.length < 2) { notes.push('Un chiste necesita al menos planteamiento y remate.'); if (level === 'ok') level = 'warn'; }
  return { level, notes, words };
}
const LEVEL = { ok: ['ok', '✓ Sin alertas'], warn: ['warn', '⚠ Revisar'], bad: ['bad', '✕ Cambiar'] };

// ---------- Contraste ----------
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ---------- Render ----------
function dims() { const [w, h] = $('fmt').value.split('x').map(Number); return { w, h }; }
function wrap(ctx, text, maxW) {
  const words = text.split(' '); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
const SAMPLE = ['Hijo: Papá, ¿qué es la crisis?', 'Papá: Cuando te piden el cambio.', 'Hijo: ¿Y eso es grave?', 'Papá: NO, PERO NO HAY CAMBIO.'].join(String.fromCharCode(10));
const items = (sample = false) => parseLines(sample && !$('jokeText').value.trim() ? SAMPLE : $('jokeText').value, $('splitDialog').checked);
// o: { t (seg|null), starts[], anim, bgDraw(ctx,w,h), light, progress (0..1) }
function drawJoke(cv, w, h, o = {}) {
  if (cv.width !== w) cv.width = w; if (cv.height !== h) cv.height = h;
  const ctx = cv.getContext('2d'); const pg = page(ui.pageId);
  ctx.fillStyle = pg.bg; ctx.fillRect(0, 0, w, h);
  if (o.bgDraw) o.bgDraw(ctx, w, h);
  const fg = o.light ? '#ffffff' : pg.fg;
  const list = items(o.sample);
  const pad = w * 0.09; const maxW = w - pad * 2; const family = 'system-ui, "Segoe UI", sans-serif';
  let size = Math.round(w * 0.075); let blocks;
  const layout = () => {
    ctx.font = `700 ${size}px ${family}`;
    blocks = list.map((it, i) => {
      const last = i === list.length - 1 && list.length > 1;
      const txt = (it.speaker ? it.speaker + ': ' : it.dash ? '— ' : '') + (last && $('capsTwist').checked ? it.text.toUpperCase() : it.text);
      return { it, last, txt, lines: wrap(ctx, txt, maxW) };
    });
    return blocks.reduce((a, b) => a + b.lines.length, 0) * size * 1.25 + (blocks.length - 1) * size * 0.5;
  };
  while (size > 22 && layout() > h * 0.7) size -= 2;
  const total = layout(); let y = (h - total) / 2 + size; ctx.textBaseline = 'alphabetic';
  blocks.forEach((b, i) => {
    let p = 1;
    if (o.t != null && o.anim !== 'all') { const dur = o.anim === 'type' ? Math.max(0.6, Math.min(2.5, b.txt.length * 0.05)) : 0.5; p = Math.max(0, Math.min(1, (o.t - o.starts[i]) / dur)); }
    ctx.fillStyle = b.last ? pg.accent : b.it.speaker ? ui.speakerColors[b.it.speaker] || fg : fg;
    let budget = o.anim === 'type' && o.t != null ? Math.floor(p * b.txt.length) : Infinity;
    ctx.globalAlpha = o.anim === 'type' || o.t == null ? 1 : p;
    const dy = o.anim === 'fade' && o.t != null ? (1 - p) * size * 0.4 : 0;
    for (const l of b.lines) { if (budget > 0) ctx.fillText(budget >= l.length ? l : l.slice(0, budget), pad, y + dy); budget -= l.length + 1; y += size * 1.25; }
    ctx.globalAlpha = 1; y += size * 0.5;
  });
  if (!list.length) { ctx.fillStyle = fg; ctx.globalAlpha = 0.4; ctx.font = `400 ${w * 0.05}px ${family}`; ctx.fillText('Escribe un chiste…', pad, h / 2); ctx.globalAlpha = 1; }
  if (pg.watermark) { ctx.font = `600 ${w * 0.035}px ${family}`; ctx.fillStyle = fg; ctx.globalAlpha = 0.6; ctx.textAlign = 'center'; ctx.fillText(pg.watermark, w / 2, h - h * 0.04); ctx.textAlign = 'left'; ctx.globalAlpha = 1; }
  if (logoImg) {
    const lw = (pg.logoPos.size / 100) * w; const lh = (logoImg.height / logoImg.width) * lw;
    ctx.drawImage(logoImg, (pg.logoPos.x / 100) * (w - lw), (pg.logoPos.y / 100) * (h - lh), lw, lh);
  }
  if (o.progress != null) { ctx.fillStyle = pg.accent; ctx.fillRect(0, h - h * 0.008, w * o.progress, h * 0.008); }
}
function render() { const { w, h } = dims(); drawJoke($('canvas'), w, h); renderPagePreview(); renderVideoFrame?.(); }
function renderPagePreview() { const p = $('panel-pages'); if (!p || p.hidden) return; drawJoke($('pcanvas'), 1080, 1440, { sample: true }); }
function loadLogo() {
  const pg = page(ui.pageId); logoImg = null;
  if (pg.logo) { const im = new Image(); im.onload = () => { logoImg = im; render(); }; im.src = pg.logo; }
  render();
}

// ---------- Biblioteca ----------
function renderLibrary() {
  const q = $('fSearch').value.toLowerCase(); const sort = $('fSort').value;
  let list = state.jokes.filter((j) => {
    if (q && !(((j.text || '') + ' ' + (j.title || '') + ' ' + (j.es ? j.es.text + ' ' + j.es.title : '')).toLowerCase().includes(q) || (j.tags || []).some((t) => t.toLowerCase().includes(q)))) return false;
    if ($('fPage').value && !(j.pages || []).includes($('fPage').value)) return false;
    if ($('fReview').value && review(jtext(j)).level !== $('fReview').value) return false;
    if ($('fUsage').value === 'unused' && j.exported) return false;
    if ($('fUsage').value === 'used' && !j.exported) return false;
    return true;
  });
  list.sort(sort === 'score' ? (a, b) => (b.score || 0) - (a.score || 0) : sort === 'alpha' ? (a, b) => jtext(a).localeCompare(jtext(b)) : (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  $('libCount').textContent = `(${list.length} de ${state.jokes.length})`;
  const ul = $('jokeList'); ul.innerHTML = '';
  for (const j of list) {
    const li = document.createElement('li'); const [cls, label] = LEVEL[review(jtext(j)).level];
    const left = document.createElement('div'); left.style.flex = '1';
    const t = document.createElement('div'); t.className = 'txt'; t.textContent = jtext(j);
    const m = document.createElement('div'); m.className = 'meta';
    m.innerHTML = `<span class="chip ${cls}"></span><span class="chip"></span>`;
    m.children[0].textContent = label; m.children[1].textContent = '★'.repeat(j.score || 0) + '☆'.repeat(5 - (j.score || 0));
    m.children[1].title = 'Valoración tuya (1–5)';
    for (const tag of j.tags || []) { const s = document.createElement('span'); s.className = 'chip'; s.textContent = '#' + tag; m.append(s); }
    if (ui.lang === 'es' && j.es) { const s = document.createElement('span'); s.className = 'chip'; s.textContent = 'ES'; m.append(s); }
    if (j.exported) { const s = document.createElement('span'); s.className = 'chip'; s.textContent = 'exportado'; m.append(s); }
    left.append(t, m);
    const acts = document.createElement('div'); acts.className = 'acts';
    const mk = (label, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (cls) b.className = cls; b.onclick = fn; return b; };
    acts.append(mk('Imagen', '', () => openJoke(j.id, 'image')), mk('Video', 'ghost', () => openJoke(j.id, 'video')), mk('Eliminar', 'danger', () => deleteJoke(j.id)));
    li.append(left, acts); ul.append(li);
  }
  if (!list.length) ul.innerHTML = '<li class="empty">No hay chistes con esos filtros.</li>';
}
function openJoke(id, tab = 'image') {
  const j = state.jokes.find((x) => x.id === id); if (!j) return;
  ui.jokeId = id; $('jokeText').value = jtext(j);
  if (j.pages?.[0]) { ui.pageId = j.pages[0]; $('edPage').value = ui.pageId; syncPageForm(); loadLogo(); }
  onText(); showTab(tab);
}
function deleteJoke(id) {
  const idx = state.jokes.findIndex((j) => j.id === id); const [removed] = state.jokes.splice(idx, 1);
  persist(); renderLibrary(); if (ui.jokeId === id) ui.jokeId = null;
  toast('Chiste eliminado.', 'Deshacer', () => { state.jokes.splice(idx, 0, removed); persist(); renderLibrary(); });
}
function saveJoke() {
  const text = $('jokeText').value.trim(); if (!text) return toast('Escribe algo primero.');
  let j = curJoke();
  if (j) { if (ui.lang === 'es' && j.es) j.es.text = text; else j.text = text; if (!j.pages?.includes(ui.pageId)) j.pages = [...(j.pages || []), ui.pageId]; }
  else { j = { id: uid(), text, pages: [ui.pageId], score: 0, tags: [], exported: false, createdAt: new Date().toISOString() }; state.jokes.unshift(j); ui.jokeId = j.id; }
  persist(); renderLibrary(); toast('Guardado en la biblioteca.');
}

// ---------- Editor ----------
function onText() {
  const text = $('jokeText').value; const r = review(text);
  $('counter').textContent = `${text.length}/1200 caracteres · ${r.words} palabras`;
  const [cls, label] = LEVEL[r.level]; $('reviewBadge').className = 'chip ' + cls; $('reviewBadge').textContent = label;
  $('reviewNotes').innerHTML = ''; r.notes.forEach((n) => { const li = document.createElement('li'); li.textContent = n; $('reviewNotes').append(li); });
  const names = [...new Set(parseLines(text, true).filter((l) => l.speaker).map((l) => l.speaker))];
  const box = $('speakers'); box.innerHTML = '';
  names.forEach((n, i) => {
    ui.speakerColors[n] ||= SPEAKER_COLORS[i % SPEAKER_COLORS.length];
    const lab = document.createElement('label'); lab.append(n + ' ');
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = ui.speakerColors[n]; inp.setAttribute('aria-label', 'Color de ' + n);
    inp.oninput = () => { ui.speakerColors[n] = inp.value; render(); }; lab.append(inp); box.append(lab);
  });
  if (!names.length) box.innerHTML = '<span class="muted">Sin hablantes. Usa «Nombre: texto» para asignar colores. Los hablantes también llevan su nombre en el texto, no solo color.</span>';
  render();
}
async function blob() { return new Promise((r) => $('canvas').toBlob(r, 'image/png')); }
function markExported() { const j = curJoke(); if (j) { j.exported = true; persist(); renderLibrary(); } }
async function downloadPng() { const b = await blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'chiste-' + Date.now() + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); markExported(); }
async function copyImg() { try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': await blob() })]); toast('Imagen copiada.'); markExported(); } catch { toast('Tu navegador no permite copiar imágenes; usa Descargar.'); } }
async function shareImg() { const f = new File([await blob()], 'chiste.png', { type: 'image/png' }); if (navigator.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f] }); markExported(); } catch { /* cancelado */ } } else toast('Compartir no está disponible aquí; usa Descargar.'); }

// ---------- Páginas ----------
function fillPageSelects() {
  for (const id of ['edPage', 'pgSelect', 'fPage']) {
    const s = $(id); const prev = s.value; s.innerHTML = id === 'fPage' ? '<option value="">Todas</option>' : '';
    state.pages.forEach((p) => s.append(new Option(p.name, p.id))); s.value = id === 'fPage' ? prev : ui.pageId;
  }
}
function syncPageForm() {
  const p = page(ui.pageId); $('pgSelect').value = p.id; $('edPage').value = p.id;
  $('pgName').value = p.name; $('pgBg').value = p.bg; $('pgFg').value = p.fg; $('pgAccent').value = p.accent; $('pgMark').value = p.watermark || '';
  $('logoX').value = p.logoPos.x; $('logoY').value = p.logoPos.y; $('logoS').value = p.logoPos.size; $('pgLogoClear').checked = false; contrast();
}
function contrast() {
  const p = page(ui.pageId); const a = ratio(p.bg, p.fg), b = ratio(p.bg, p.accent);
  $('contrastInfo').textContent = `Contraste texto/fondo: ${a.toFixed(1)}:1 ${a >= 4.5 ? '(correcto)' : '(bajo, mínimo recomendado 4.5)'} · remate/fondo: ${b.toFixed(1)}:1 ${b >= 3 ? '(correcto)' : '(bajo)'}`;
}
function pageChanged() {
  const p = page(ui.pageId); p.name = $('pgName').value; p.bg = $('pgBg').value; p.fg = $('pgFg').value; p.accent = $('pgAccent').value; p.watermark = $('pgMark').value;
  p.logoPos = { x: +$('logoX').value, y: +$('logoY').value, size: +$('logoS').value };
  persist(); contrast(); render();
}
function bindLogoDrag(cv) {
  let drag = false;
  const move = (e) => { if (!drag) return; const r = cv.getBoundingClientRect(); $('logoX').value = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)); $('logoY').value = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)); pageChanged(); };
  cv.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && !cv.classList.contains('moving')) return; drag = true; cv.setPointerCapture(e.pointerId); move(e); });
  cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', () => (drag = false));
  cv.tabIndex = 0; cv.addEventListener('keydown', (e) => { const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!d) return; e.preventDefault(); $('logoX').value = +$('logoX').value + d[0]; $('logoY').value = +$('logoY').value + d[1]; pageChanged(); });
}

// ---------- Archivo (fuente de verdad) ----------
function normalize(d) {
  if (!d || !Array.isArray(d.jokes) || !Array.isArray(d.pages)) throw new Error('Formato inválido: se esperaba { pages: [], jokes: [] }.');
  d.pages.forEach((p) => { p.id ||= uid(); p.logoPos ||= { x: 88, y: 4, size: 12 }; });
  d.jokes.forEach((j) => { j.id ||= uid(); j.text = String(j.text || ''); j.tags ||= []; j.pages ||= []; j.score = +j.score || 0; });
  if (!d.pages.length) d.pages.push({ id: uid(), ...DEFAULT_PAGE });
  return { version: 1, rev: +d.rev || 1, pages: d.pages, jokes: d.jokes };
}
function parseCsv(txt) { return txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => ({ text: l.replace(/^"|"$/g, '').replace(/\\n/g, '\n') })); }
function applyImported(d, mode) {
  if (mode === 'replace') state = d; else { const ids = new Set(state.jokes.map((j) => j.id)); state.jokes.push(...d.jokes.filter((j) => !ids.has(j.id))); const pids = new Set(state.pages.map((p) => p.id)); state.pages.push(...d.pages.filter((p) => !pids.has(p.id))); }
  ui.pageId = state.pages[0].id; fillPageSelects(); syncPageForm(); loadLogo(); renderLibrary(); persist();
}
const fileJson = () => JSON.stringify(state, null, 2) + '\n';
async function saveToFile() {
  if (!ui.fileHandle) return exportCopy();
  try { const w = await ui.fileHandle.createWritable(); await w.write(fileJson()); await w.close(); ui.dirty = false; updateBadge(); $('fileMsg').textContent = 'Guardado en ' + ui.fileHandle.name + ' a las ' + new Date().toLocaleTimeString() + '. Haz commit y push para publicarlo.'; }
  catch (e) { $('fileMsg').textContent = 'No se pudo guardar: ' + e.message; }
}
function exportCopy() { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([fileJson()], { type: 'application/json' })); a.download = 'jokes.json'; a.click(); ui.dirty = false; updateBadge(); }
async function linkFile() {
  if (!window.showOpenFilePicker) return ($('fileMsg').textContent = 'Tu navegador no soporta vincular archivos. Usa Importar y Exportar copia.');
  try {
    const [h] = await showOpenFilePicker({ types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
    const d = normalize(JSON.parse(await (await h.getFile()).text()));
    if (state.jokes.length && ui.dirty && !(await confirmDlg('Hay cambios sin guardar. ¿Reemplazarlos con el contenido del archivo?'))) return;
    ui.fileHandle = h; await idb.set('handle', h); applyImported(d, 'replace'); ui.dirty = false; updateBadge(); $('fileMsg').textContent = 'Vinculado: ' + h.name;
  } catch (e) { if (e.name !== 'AbortError') $('fileMsg').textContent = 'Error: ' + e.message; }
}
async function importFile(f) {
  try {
    const txt = await f.text(); const d = normalize(f.name.endsWith('.json') ? JSON.parse(txt) : { pages: [{ id: uid(), ...DEFAULT_PAGE }], jokes: parseCsv(txt) });
    const replace = await confirmDlg(`Se encontraron ${d.jokes.length} chistes. Aceptar = reemplazar la biblioteca; Cancelar = no importar.`);
    if (replace) { applyImported(d, 'replace'); toast('Biblioteca reemplazada.'); }
  } catch (e) { toast('No se pudo importar: ' + e.message); }
}
async function loadSeed() { const r = await fetch('data/jokes.json', { cache: 'no-cache' }); if (!r.ok) throw new Error('HTTP ' + r.status); return normalize(await r.json()); }

// ---------- Inicio ----------
async function init() {
  const saved = await idb.get('state');
  let merged = 0;
  try {
    if (saved) {
      state = normalize(saved);
      try { const seed = await loadSeed(); if (seed.rev > state.rev) { const ids = new Set(state.jokes.map((j) => j.id)); const add = seed.jokes.filter((j) => !ids.has(j.id)); state.jokes.push(...add); const byId = new Map(state.jokes.map((x) => [x.id, x])); let tr = 0; for (const sj of seed.jokes) { const lj = byId.get(sj.id); if (lj && sj.es && !lj.es) { lj.es = sj.es; tr++; } } merged = add.length + tr; state.rev = seed.rev; idb.set('state', state); } } catch { /* sin red: se usa la copia local */ }
    } else state = await loadSeed();
  } catch { state = normalize({ pages: [], jokes: [] }); toast('No se pudo cargar data/jokes.json; empiezas con una biblioteca vacía.'); }
  ui.fileHandle = (await idb.get('handle')) || null; ui.pageId = state.pages[0].id;
  if (merged) toast('Se actualizaron ' + merged + ' chistes desde data/jokes.json.');
  fillPageSelects(); syncPageForm(); renderLibrary(); loadLogo(); onText(); bindLogoDrag($('canvas')); bindLogoDrag($('vcanvas')); bindLogoDrag($('pcanvas')); updateBadge(); initTabs(); initVideo(); initMobile();

  ['fSearch', 'fSort', 'fPage', 'fReview', 'fUsage'].forEach((id) => $(id).addEventListener('input', renderLibrary));
  try { ui.lang = localStorage.getItem('lang') || 'es'; } catch { /* nada */ }
  $('fLang').value = ui.lang;
  $('fLang').oninput = () => { ui.lang = $('fLang').value; try { localStorage.setItem('lang', ui.lang); } catch { /* nada */ } renderLibrary(); };
  $('btnLang').onclick = () => { const j = curJoke(); if (!j || !j.es) return toast('Este chiste no tiene traducción guardada.'); ui.lang = ui.lang === 'es' ? 'en' : 'es'; $('fLang').value = ui.lang; $('jokeText').value = jtext(j); onText(); renderLibrary(); toast(ui.lang === 'es' ? 'Mostrando la traducción.' : 'Mostrando el original.'); };
  $('jokeText').addEventListener('input', onText);
  ['fmt', 'splitDialog', 'capsTwist'].forEach((id) => $(id).addEventListener('input', render));
  $('edPage').onchange = () => { ui.pageId = $('edPage').value; syncPageForm(); loadLogo(); };
  $('pgSelect').onchange = () => { ui.pageId = $('pgSelect').value; syncPageForm(); loadLogo(); };
  ['pgName', 'pgBg', 'pgFg', 'pgAccent', 'pgMark', 'logoX', 'logoY', 'logoS'].forEach((id) => $(id).addEventListener('input', () => { pageChanged(); if (id === 'pgName') fillPageSelects(); }));
  $('pgLogo').onchange = (e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { page(ui.pageId).logo = r.result; persist(); loadLogo(); }; r.readAsDataURL(f); };
  $('pgLogoClear').onchange = (e) => { if (e.target.checked) { page(ui.pageId).logo = null; persist(); loadLogo(); } };
  $('btnPgNew').onclick = () => { const p = { id: uid(), ...structuredClone(DEFAULT_PAGE), name: 'Página ' + (state.pages.length + 1) }; state.pages.push(p); ui.pageId = p.id; fillPageSelects(); syncPageForm(); loadLogo(); persist(); };
  $('btnPgDel').onclick = async () => { if (state.pages.length < 2) return toast('Debe quedar al menos una página.'); if (!(await confirmDlg('¿Eliminar la página «' + page(ui.pageId).name + '»? Los chistes se conservan.'))) return; state.pages = state.pages.filter((p) => p.id !== ui.pageId); state.jokes.forEach((j) => (j.pages = j.pages.filter((x) => x !== ui.pageId))); ui.pageId = state.pages[0].id; fillPageSelects(); syncPageForm(); loadLogo(); renderLibrary(); persist(); };
  $('btnPgReset').onclick = () => { Object.assign(page(ui.pageId), structuredClone(DEFAULT_PAGE), { id: ui.pageId, name: page(ui.pageId).name }); syncPageForm(); loadLogo(); persist(); };
  $('btnNewJoke').onclick = () => { ui.jokeId = null; $('jokeText').value = ''; onText(); showTab('image'); $('jokeText').focus(); };
  $('btnExample').onclick = () => { $('jokeText').value = 'Pepe: Doctor, ¿qué tengo?\nDoctor: Mucha imaginación.\nPepe: ¿Y eso es grave?\nDoctor: NO, PERO NO ES REAL.'; ui.jokeId = null; onText(); };
  $('btnClear').onclick = async () => { const prev = $('jokeText').value; if (!prev) return; if (prev.length > 40 && !(await confirmDlg('¿Borrar el texto del editor?'))) return; $('jokeText').value = ''; onText(); toast('Texto borrado.', 'Deshacer', () => { $('jokeText').value = prev; onText(); }); };
  $('btnSaveJoke').onclick = saveJoke; $('btnPng').onclick = downloadPng; $('btnCopy').onclick = copyImg; $('btnShare').onclick = shareImg;
  $('btnImport').onclick = () => $('fileImport').click(); $('fileImport').onchange = (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; };
  $('btnExport').onclick = exportCopy; $('btnFileLink').onclick = linkFile; $('btnFileSave').onclick = saveToFile;
  $('btnReload').onclick = async () => { if (ui.dirty && !(await confirmDlg('Hay cambios sin guardar. ¿Reemplazarlos con data/jokes.json?'))) return; try { applyImported(await loadSeed(), 'replace'); ui.dirty = false; updateBadge(); toast('Recargado desde data/jokes.json.'); } catch (e) { toast('No se pudo recargar: ' + e.message); } };
  addEventListener('beforeunload', (e) => { if (ui.dirty) { e.preventDefault(); e.returnValue = ''; } });
  addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveToFile(); } });
}
// ---------- Pestañas ----------
const TABS = ['library', 'image', 'video', 'pages', 'file'];
function showTab(name, push = true) {
  if (!TABS.includes(name)) name = 'library';
  try { if (push && !(history.state && history.state.tab === name)) history.pushState({ tab: name }, '', '#' + name); else if (!push) history.replaceState({ tab: name }, '', '#' + name); } catch { /* sin historial */ }
  for (const t of TABS) { const on = t === name; $('tab-' + t).setAttribute('aria-selected', on); $('tab-' + t).tabIndex = on ? 0 : -1; $('panel-' + t).hidden = !on; }
  const comp = $('composer'); comp.hidden = !(name === 'image' || name === 'video');
  if (name === 'image') $('slotImg').append(comp);
  if (name === 'video') $('slotVid').append(comp);
  if (name !== 'video') vStop();
  window.scrollTo(0, 0);
  try { localStorage.setItem('tab', name); } catch { /* sin almacenamiento */ }
  if (name === 'pages') renderPagePreview();
  if (name === 'image') render();
  if (name === 'video') renderVideoFrame();
}
function initMobile() {
  document.querySelectorAll('.moveLogo').forEach((b) => (b.onclick = () => { const cv = $(b.dataset.target); const on = cv.classList.toggle('moving'); b.setAttribute('aria-pressed', on); b.textContent = on ? 'Listo (terminar de mover)' : 'Mover logo'; }));
  if (matchMedia('(max-width: 720px)').matches) $('filtDet').open = false;
}
function initTabs() {
  TABS.forEach((t, i) => {
    const b = $('tab-' + t); b.onclick = () => showTab(t);
    b.onkeydown = (e) => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!d) return; const n = TABS[(i + d + TABS.length) % TABS.length]; showTab(n); $('tab-' + n).focus(); };
  });
  let last = 'library'; try { last = localStorage.getItem('tab') || 'library'; } catch { /* nada */ }
  const fromHash = location.hash.slice(1); if (TABS.includes(fromHash)) last = fromHash;
  showTab(last, false);
  window.addEventListener('popstate', (e) => showTab((e.state && e.state.tab) || 'library', false));
}

// ---------- Video ----------
const V = { starts: [], manual: false, key: '', playing: false, t: Infinity, raf: 0, t0: 0, bgImg: null, bgVid: null, bgUrl: null, audioUrl: null, audioEl: null, onEnd: null, recording: false, cancel: false, cancelHook: null };
// Duración automática: más texto, más tiempo (máx. 30 s). Intro 3 s + lectura (~2.5 palabras/s) + pausa por línea + 2 s finales.
function vAutoDuration() {
  const list = items(); if (!list.length) return 6;
  const words = list.reduce((a, l) => a + l.text.split(/\s+/).filter(Boolean).length, 0);
  return Math.max(6, Math.min(30, Math.round(3 + words / 2.5 + list.length * 0.6 + 2)));
}
const vDur = () => {
  if ($('vAutoDur').checked) { const d = vAutoDuration(); if (+$('vDur').value !== d) { $('vDur').value = d; $('vDurOut').textContent = d + ' s'; } }
  return +$('vDur').value;
};
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function vAutoTimes() {
  const list = items(); const D = vDur(); const hold = Math.min(3, D * 0.2); const avail = Math.max(1, D - hold - 0.6);
  const wts = list.map((l) => l.text.split(/\s+/).length + 2); const tot = wts.reduce((a, b) => a + b, 0) || 1; let acc = 0;
  V.starts = list.map((_, i) => { const s = 0.4 + (avail * acc) / tot; acc += wts[i]; return Math.round(s * 10) / 10; }); V.manual = false;
}
function vBuildTimes() {
  const ol = $('vTimes'); ol.innerHTML = ''; const list = items();
  list.forEach((l, i) => {
    const li = document.createElement('li'); const inp = document.createElement('input'); inp.type = 'number'; inp.min = 0; inp.max = vDur(); inp.step = 0.1; inp.value = V.starts[i]; inp.setAttribute('aria-label', 'Segundo de la línea ' + (i + 1));
    inp.oninput = () => { V.starts[i] = Math.max(0, +inp.value || 0); V.manual = true; renderVideoFrame(); };
    const sp = document.createElement('span'); sp.textContent = l.text; sp.title = l.text; li.append(inp, sp); ol.append(li);
  });
  if (!list.length) ol.innerHTML = '<li class="muted">Escribe el chiste para ver su línea de tiempo.</li>';
}
function vSyncTimes() {
  const key = $('jokeText').value + '|' + vDur() + '|' + $('splitDialog').checked;
  if (key !== V.key || V.starts.length !== items().length) { V.key = key; if (!V.manual || V.starts.length !== items().length) { vAutoTimes(); vBuildTimes(); } }
}
function cover(ctx, el, sw, sh, w, h) { if (!sw || !sh) return; const s = Math.max(w / sw, h / sh); ctx.drawImage(el, (w - sw * s) / 2, (h - sh * s) / 2, sw * s, sh * s); }
function renderVideoFrame() {
  if ($('panel-video').hidden && !V.recording) return;
  vSyncTimes();
  const [w, h] = $('vFmt').value.split('x').map(Number); const D = vDur(); const t = Math.min(V.t, D);
  const mode = $('vBg').value; const vid = mode === 'video' && V.bgVid && V.bgVid.readyState >= 2 ? V.bgVid : null; const img = mode === 'image' ? V.bgImg : null;
  const media = !!(vid || img); const dim = media && $('vDim').checked;
  drawJoke($('vcanvas'), w, h, {
    t, starts: V.starts, anim: $('vAnim').value, light: dim, progress: $('vProgress').checked ? t / D : null,
    bgDraw: media ? (ctx) => { if (vid) cover(ctx, vid, vid.videoWidth, vid.videoHeight, w, h); else cover(ctx, img, img.naturalWidth, img.naturalHeight, w, h); if (dim) { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, w, h); } } : null,
  });
  $('vScrub').value = Math.round((t / D) * 1000); $('vTime').textContent = `${fmtT(t)} / ${fmtT(D)}`;
}
function vStop() {
  V.playing = false; cancelAnimationFrame(V.raf); if (V.audioEl) V.audioEl.pause(); if (V.bgVid) V.bgVid.pause();
  const b = $('vPlay'); if (b) { b.textContent = '▶'; b.setAttribute('aria-label', 'Reproducir'); }
}
function vPlay(fromStart = false, onEnd = null) {
  if (V.playing) return vStop();
  const D = vDur(); if (fromStart || V.t >= D) V.t = 0;
  V.playing = true; V.onEnd = onEnd; V.t0 = performance.now() - V.t * 1000;
  $('vPlay').textContent = '⏸'; $('vPlay').setAttribute('aria-label', 'Pausar');
  if (V.audioEl && !V.recording) { V.audioEl.currentTime = V.t; V.audioEl.volume = +$('vVol').value; V.audioEl.play().catch(() => {}); }
  if (V.bgVid && $('vBg').value === 'video') { V.bgVid.currentTime = V.bgVid.duration ? V.t % V.bgVid.duration : 0; V.bgVid.play().catch(() => {}); }
  const loop = () => {
    if (!V.playing) return;
    V.t = (performance.now() - V.t0) / 1000;
    if (V.t >= D) { V.t = D; renderVideoFrame(); const cb = V.onEnd; vStop(); if (cb) cb(); return; }
    renderVideoFrame(); V.raf = requestAnimationFrame(loop);
  };
  loop();
}
function vMsg(m) { $('vMsg').textContent = m; }
async function vExport() {
  if (!window.MediaRecorder || !$('vcanvas').captureStream) return vMsg('Tu navegador no permite grabar video desde la página. Usa Chrome, Edge o Firefox actualizados.');
  vStop(); V.recording = true; V.cancel = false; $('vExport').disabled = true; $('vCancel').hidden = false;
  const D = vDur(); const stream = $('vcanvas').captureStream(30); let actx = null, aEl = null;
  try {
    if (V.audioUrl) {
      actx = new AudioContext(); const dest = actx.createMediaStreamDestination(); aEl = new Audio(V.audioUrl);
      const gain = actx.createGain(); gain.gain.value = +$('vVol').value; actx.createMediaElementSource(aEl).connect(gain); gain.connect(dest);
      dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    }
    const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6000000 } : undefined);
    const chunks = []; rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start(250); if (aEl) aEl.play().catch(() => {}); vMsg('Grabando en tiempo real… no cambies de pestaña.');
    const tick = setInterval(() => vMsg(`Grabando… ${Math.min(100, Math.round((V.t / D) * 100))}%`), 500);
    await new Promise((res) => { V.cancelHook = () => { vStop(); res(); }; vPlay(true, res); });
    clearInterval(tick); if (aEl) aEl.pause(); if (rec.state !== 'inactive') rec.stop(); await stopped;
    if (V.cancel) vMsg('Exportación cancelada.');
    else {
      const type = rec.mimeType || mime || 'video/webm'; const ext = type.includes('mp4') ? 'mp4' : 'webm'; const url = URL.createObjectURL(new Blob(chunks, { type }));
      const a = document.createElement('a'); a.href = url; a.download = 'chiste-' + Date.now() + '.' + ext; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
      vMsg(`Listo (${ext.toUpperCase()}).` + (ext === 'webm' ? ' Si Facebook o Instagram no lo aceptan, conviértelo a MP4 (HandBrake, CapCut).' : '')); markExported();
    }
  } catch (e) { vMsg('Error al exportar: ' + e.message); }
  finally { if (actx) actx.close(); V.recording = false; $('vExport').disabled = false; $('vCancel').hidden = true; V.t = D; renderVideoFrame(); }
}
function setBgFile(f) {
  if (V.bgUrl) URL.revokeObjectURL(V.bgUrl); V.bgImg = null; V.bgVid = null; V.bgUrl = null; if (!f) return renderVideoFrame();
  V.bgUrl = URL.createObjectURL(f);
  if (f.type.startsWith('video/')) { const v = document.createElement('video'); v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.src = V.bgUrl; v.onloadeddata = () => { V.bgVid = v; $('vBg').value = 'video'; renderVideoFrame(); }; v.onseeked = renderVideoFrame; }
  else { const im = new Image(); im.onload = () => { V.bgImg = im; $('vBg').value = 'image'; renderVideoFrame(); }; im.src = V.bgUrl; }
}
function initVideo() {
  const rf = () => renderVideoFrame();
  ['vFmt', 'vAnim', 'vProgress', 'vDim', 'splitDialog', 'capsTwist'].forEach((id) => $(id).addEventListener('input', rf));
  $('vAutoDur').onchange = () => { $('vDur').disabled = $('vAutoDur').checked; V.manual = false; V.key = ''; vStop(); renderVideoFrame(); };
  $('vDur').oninput = () => { $('vDurOut').textContent = vDur() + ' s'; V.manual = false; V.key = ''; vStop(); renderVideoFrame(); };
  $('vBg').onchange = () => { $('vBgFileRow').hidden = $('vBg').value === 'color'; rf(); };
  $('vBgFile').onchange = (e) => setBgFile(e.target.files[0]);
  $('vAudio').onchange = (e) => {
    const f = e.target.files[0]; if (V.audioUrl) URL.revokeObjectURL(V.audioUrl); V.audioEl = null; V.audioUrl = null; if (!f) return;
    V.audioUrl = URL.createObjectURL(f); V.audioEl = new Audio(V.audioUrl);
    V.audioEl.onloadedmetadata = () => { const d = Math.min(30, Math.max(5, Math.ceil(V.audioEl.duration))); $('vAutoDur').checked = false; $('vDur').disabled = false; $('vDur').value = d; $('vDur').oninput(); vMsg(`Duración ajustada al audio: ${d} s.`); };
  };
  $('vVol').oninput = () => { if (V.audioEl) V.audioEl.volume = +$('vVol').value; };
  $('vScrub').oninput = () => { vStop(); V.t = (+$('vScrub').value / 1000) * vDur(); if (V.bgVid) V.bgVid.currentTime = V.bgVid.duration ? V.t % V.bgVid.duration : 0; renderVideoFrame(); };
  $('vPlay').onclick = () => vPlay();
  $('vAuto').onclick = () => { vAutoTimes(); vBuildTimes(); renderVideoFrame(); };
  $('vExport').onclick = vExport;
  $('vCancel').onclick = () => { V.cancel = true; if (V.cancelHook) V.cancelHook(); };
}

init();
