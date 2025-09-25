// ===== Manifest loader (usa manifest.json del repo) =====
async function loadManifest() {
  const res = await fetch('manifest.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('No pude leer manifest.json');
  const m = await res.json();
  return m;
}

const state = {
  manifest: null,
  cycle: null,
  variable: null,
  region: null,
  hourIndex: 0,         // índice dentro de times_hours
};

// Helpers
const $ = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));

function buildImageUrl() {
  const { manifest, cycle, variable, region } = state;
  const t = manifest.times_hours[state.hourIndex] ?? 0;
  const h3 = String(t).padStart(3, '0') + 'h.png';
  const base = manifest.base_url.replace(/\/+$/,'');
  return `${base}/${cycle}/${region}/${variable}/${h3}`;
}

function allowedRegionsFor(variableKey) {
  const avail = state.manifest.availability || {};
  return new Set(avail[variableKey] || []);
}

// ===== Render de ciclos (dropdown) =====
function renderCycles() {
  const sel = $('#initSelect');          // <select id="initSelect"> en tu HTML
  const box = $('#initBox');             // contenedor para ocultar si hay 1 ciclo
  sel.innerHTML = '';

  const cycles = state.manifest.available_cycles || [];
  for (const cyc of cycles) {
    const opt = document.createElement('option');
    opt.value = cyc;
    opt.textContent = cyc.replace('_00Z',' 00Z')
                         .replace(/(\d{4})(\d{2})(\d{2})/,'$3-$2-$1');
    sel.appendChild(opt);
  }

  state.cycle = state.manifest.latest_cycle || cycles[cycles.length-1] || null;
  sel.value = state.cycle || '';

  // esconder si hay 1 solo ciclo
  if (box && cycles.length <= 1) box.style.display = 'none';

  sel.onchange = () => {
    state.cycle = sel.value;
    updateFigure();
  };
}

// ===== Render de variables =====
function renderVariables() {
  const wrap = $('#varButtons');         // contenedor de pills
  wrap.innerHTML = '';
  const entries = Object.entries(state.manifest.variables); // [key, label]

  for (const [key, label] of entries) {
    const b = document.createElement('button');
    b.className = 'pill';
    b.dataset.variable = key;
    b.textContent = label;
    b.onclick = () => {
      $$('#varButtons .pill.selected').forEach(x=>x.classList.remove('selected'));
      b.classList.add('selected');
      state.variable = key;
      renderRegions();     // filtra según availability
      updateFigure();
    };
    wrap.appendChild(b);
  }

  // default: primera variable
  const first = wrap.querySelector('.pill');
  if (first) { first.click(); }
}

// ===== Render de regiones (filtra por availability) =====
function renderRegions() {
  const wrap = $('#regionButtons');
  wrap.innerHTML = '';

  const allowed = allowedRegionsFor(state.variable);
  const entries = Object.entries(state.manifest.regions);   // [key, label]

  for (const [key, label] of entries) {
    const b = document.createElement('button');
    b.className = 'pill';
    b.dataset.region = key;
    b.textContent = label;

    const ok = allowed.has(key);
    b.disabled = !ok;
    b.style.opacity = ok ? '1' : '.4';
    b.style.pointerEvents = ok ? 'auto' : 'none';

    b.onclick = () => {
      if (b.disabled) return;
      $$('#regionButtons .pill.selected').forEach(x=>x.classList.remove('selected'));
      b.classList.add('selected');
      state.region = key;
      updateFigure();
    };

    wrap.appendChild(b);
  }

  // default: primera permitida
  const firstOk = wrap.querySelector('.pill:not([disabled])');
  if (firstOk) { firstOk.click(); }
}

// ===== Slider de horas =====
function setupHourSlider() {
  const slider = $('#hourSlider');   // <input type="range" id="hourSlider">
  const label  = $('#hourLabel');    // span que muestra "84 h"

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

// ===== Actualizar figura =====
function updateFigure() {
  const img = $('#mainFigure'); // <img id="mainFigure">
  if (!state.variable || !state.region || !state.cycle) return;
  const url = buildImageUrl();
  img.src = url;

  // Título
  const title = $('#figureTitle');
  const regLabel = state.manifest.regions[state.region];
  const varLabel = state.manifest.variables[state.variable];
  const h = state.manifest.times_hours[state.hourIndex] ?? 0;
  title.textContent = `${regLabel} · ${varLabel} · ${String(h).padStart(3,'0')} h`;
}

// ===== Init =====
(async function init() {
  try {
    state.manifest = await loadManifest();
    renderCycles();
    renderVariables();
    setupHourSlider();
    updateFigure();
  } catch (e) {
    console.error(e);
  }
})();

