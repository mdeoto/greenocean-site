// ===== util =====
const $  = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));

const state = {
  manifest: null,
  cycle: null,
  variable: null,
  region: null,
  hourIndex: 0,
  loopTimer: null,
};

// ===== manifest =====
async function loadManifest() {
  const res = await fetch('manifest.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('No pude leer manifest.json');
  return await res.json();
}

function buildImgUrl() {
  const { manifest, cycle, region, variable, hourIndex } = state;
  const t = manifest.times_hours[hourIndex] ?? 0;
  const h3 = String(t).padStart(3, '0') + 'h.png';
  const base = manifest.base_url.replace(/\/+$/,'');
  return `${base}/${cycle}/${region}/${variable}/${h3}`;
}

function allowedRegionsFor(vkey) {
  const avail = state.manifest.availability || {};
  return new Set(avail[vkey] || []);
}

// ===== status helpers =====
function setBannerStatus(text) {
  const el = $('#now-playing');
  if (el) el.textContent = text || '';
}

function setStatus(text) { // fallback (si dejaste el footer)
  const el = $('#status');
  if (el) el.textContent = text || '';
}

// ===== ciclos (dropdown custom) =====
function renderCycles() {
  const wrap = $('#cycles');
  const btn  = $('#cycleBtn');
  const menu = $('#cycleMenu');
  const lab  = $('#cycleLabel');
  if (!wrap || !btn || !menu || !lab) return;
  menu.innerHTML = '';

  const cycles = state.manifest.available_cycles || [];
  const latest = state.manifest.latest_cycle || cycles[cycles.length-1] || null;
  state.cycle = latest;

  for (const cyc of cycles) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.value = cyc;
    li.textContent = cyc.replace('_00Z',' 00Z').replace(/(\d{4})(\d{2})(\d{2})/, '$3-$2-$1');
    li.onclick = () => {
      state.cycle = cyc;
      lab.textContent = li.textContent;
      menu.classList.remove('open');
      updateFigure();
    };
    menu.appendChild(li);
  }
  lab.textContent = (latest || '—').replace('_00Z',' 00Z').replace(/(\d{4})(\d{2})(\d{2})/, '$3-$2-$1');

  // abrir/cerrar
  btn.onclick = () => menu.classList.toggle('open');

  // si hay un solo ciclo, ocultar el dropdown
  if (cycles.length <= 1) wrap.style.visibility = 'hidden';
}

// ===== variables =====
function renderVariables() {
  const box = $('#variables');
  if (!box) return;
  box.innerHTML = '';
  const entries = Object.entries(state.manifest.variables); // [key,label]

  for (const [key, label] of entries) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.variable = key;
    b.textContent = label;
    b.onclick = () => {
      $$('#variables .chip.active').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      state.variable = key;
      renderRegions();       // filtra por availability
      updateFigure();
    };
    box.appendChild(b);
  }
  const first = box.querySelector('.chip');
  if (first) first.click();
}

// ===== regiones =====
function renderRegions() {
  const box = $('#regions');
  if (!box) return;
  box.innerHTML = '';
  const allowed = allowedRegionsFor(state.variable);
  const entries = Object.entries(state.manifest.regions); // [key,label]

  for (const [key, label] of entries) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.region = key;
    b.textContent = label;

    const ok = allowed.has(key);
    b.disabled = !ok;
    b.style.opacity = ok ? '1' : '.4';
    b.style.pointerEvents = ok ? 'auto' : 'none';

    b.onclick = () => {
      if (b.disabled) return;
      $$('#regions .chip.active').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      state.region = key;
      updateFigure();
    };
    box.appendChild(b);
  }

  const firstOk = box.querySelector('.chip:not([disabled])');
  if (firstOk) firstOk.click();
}

// ===== horas =====
function setupHourSlider() {
  const slider = $('#time-slider');
  const label  = $('#time-label');
  if (!slider || !label) return;

  const n = state.manifest.times_hours.length;
  slider.min = 0;
  slider.max = Math.max(0, n - 1);
  slider.step = 1;
  slider.value = 0;

  const updateLabel = () => {
    const idx = parseInt(slider.value, 10);
    const h = state.manifest.times_hours[idx] ?? 0;
    state.hourIndex = idx;
    label.textContent = `${h} h`;
  };

  slider.oninput = () => { updateLabel(); updateFigure(); };
  updateLabel();
}

// ===== reproducción (⏮, ▶/⏸ y compatibilidad con Loop viejo) =====
function hourAt(idx) {
  const t = state.manifest.times_hours;
  return t[Math.max(0, Math.min(idx, t.length - 1))] ?? 0;
}

// salto 3h hasta 48; luego 6h
function nextHourStep(h) {
  if (h < 48) return h + 3;
  return h + 6;
}

// primer índice cuyo valor >= targetH (si no hay, wrap a 0)
function findIndexForHour(targetH) {
  const arr = state.manifest.times_hours;
  const idx = arr.findIndex(v => v >= targetH);
  return idx >= 0 ? idx : 0;
}

function stopTimer(btnPlay, btnLoop) {
  if (state.loopTimer) {
    clearInterval(state.loopTimer);
    state.loopTimer = null;
  }
  if (btnPlay) btnPlay.textContent = '▶';
  if (btnLoop) btnLoop.textContent = 'Loop';
}

function wireControls() {
  const slider = $('#time-slider');
  const btnPlay = $('#play-btn');     // nuevo
  const btnRew  = $('#rewind-btn');   // nuevo
  const btnLoop = $('#loop-btn');     // legacy

  if (btnRew) {
    btnRew.onclick = () => {
      stopTimer(btnPlay, btnLoop);
      slider.value = 0;
      slider.dispatchEvent(new Event('input'));
    };
  }

  if (btnPlay) {
    btnPlay.onclick = () => {
      if (state.loopTimer) {
        stopTimer(btnPlay, btnLoop);
        return;
      }
      btnPlay.textContent = '⏸';
      if (btnLoop) btnLoop.textContent = 'Loop';
      state.loopTimer = setInterval(() => {
        const curIdx = parseInt(slider.value, 10);
        const curH = hourAt(curIdx);
        const nextH = nextHourStep(curH);
        const nextIdx = findIndexForHour(nextH);
        slider.value = nextIdx;
        slider.dispatchEvent(new Event('input'));
      }, 500); // velocidad de animación
    };
  }

  if (btnLoop) { // compatibilidad con botón viejo
    btnLoop.onclick = () => {
      if (state.loopTimer) {
        stopTimer(btnPlay, btnLoop);
        return;
      }
      btnLoop.textContent = '⏸';
      if (btnPlay) btnPlay.textContent = '▶';
      state.loopTimer = setInterval(() => {
        let idx = parseInt(slider.value, 10);
        idx = (idx + 1) % (state.manifest.times_hours.length || 1);
        slider.value = idx;
        slider.dispatchEvent(new Event('input'));
      }, 600);
    };
  }
}

// ===== figura =====
function updateFigure() {
  if (!state.cycle || !state.variable || !state.region) return;
  const img = $('#fig');
  const url = buildImgUrl();
  const regLabel = state.manifest.regions[state.region];
  const varLabel = state.manifest.variables[state.variable];
  const h = state.manifest.times_hours[state.hourIndex] ?? 0;

  // mostrar estado en la barra temporal
  setBannerStatus(`${regLabel} · ${varLabel} · ${String(h).padStart(3,'0')} h`);

  img.onerror = () => {
    // si no existe la imagen (p.ej. olas > 48h), mostrar aviso
    setBannerStatus(`${regLabel} · ${varLabel} · ${String(h).padStart(3,'0')} h (sin imagen)`);
    // si está animando con ▶, saltar automáticamente al siguiente paso
    if (state.loopTimer && $('#play-btn')) {
      const nextH = nextHourStep(h);
      const nextIdx = findIndexForHour(nextH);
      if (nextIdx !== state.hourIndex) {
        const slider = $('#time-slider');
        slider.value = nextIdx;
        slider.dispatchEvent(new Event('input'));
      }
    }
  };

  img.onload = () => { /* ok */ };
  img.src = url;
}

// ===== init =====
(async function init() {
  try {
    state.manifest = await loadManifest();
    renderCycles();
    renderVariables();
    setupHourSlider();
    wireControls();
    updateFigure();
  } catch (e) {
    console.error(e);
    setStatus('Error cargando configuración');
  }
})();
