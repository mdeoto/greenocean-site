let manifest = null;
const $ = (s)=>document.querySelector(s);
const $$ = (s)=>document.querySelectorAll(s);

async function loadManifest(){
  try{
    const resp = await fetch('manifest.json');
    if (!resp.ok) throw new Error('fetch failed');
    return await resp.json();
  }catch(e){
    const el = document.getElementById('inline-manifest');
    return JSON.parse(el.textContent);
  }
}

function fmtCycleStr(cyc){
  const y = cyc.slice(0,4), m = cyc.slice(4,6), d = cyc.slice(6,8), H = cyc.slice(9,11);
  const dt = new Date(`${y}-${m}-${d}T${H}:00:00Z`);
  const months = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${String(d).padStart(2,"0")}-${months[dt.getUTCMonth()]}-${y} ${H}Z`;
}

async function init(){
  manifest = await loadManifest();
  setupTabs();
  setupCycleBanner();
  setupRegionBanner();
  setupVariableBanner();
  setupTimePanel();
  setStatus();
  updateFigure(true);
}

function setupTabs(){
  $$('.tab-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $$('.tab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      $$('.tab').forEach(t=>t.classList.remove('active'));
      $('#'+btn.dataset.tab).classList.add('active');
    });
  });
}

let state = {
  cycle: null,
  region: "golfo_san_matias",
  variable: "swh_dir",
  tIndex: 0,
  playing: false,
  timer: null,
};

function setupCycleBanner(){
  const cont = document.getElementById("cycles");
  const btn = document.getElementById("cycleBtn");
  const label = document.getElementById("cycleLabel");
  const menu = document.getElementById("cycleMenu");
  menu.innerHTML = "";
  state.cycle = manifest.latest_cycle;
  label.textContent = fmtCycleStr(state.cycle);
  manifest.available_cycles.forEach(cyc=>{
    const li = document.createElement("li");
    li.className = "dropdown-item";
    li.setAttribute("role","option");
    li.dataset.cycle = cyc;
    li.textContent = fmtCycleStr(cyc);
    li.title = cyc;
    li.addEventListener("click",()=>{
      state.cycle = cyc; state.tIndex = 0; label.textContent = fmtCycleStr(cyc);
      menu.style.display = "none"; btn.setAttribute("aria-expanded","false");
      updateFigure(true); setStatus();
    });
    menu.appendChild(li);
  });
  btn.addEventListener("click",()=>{
    const open = menu.style.display === "block";
    menu.style.display = open ? "none" : "block";
    btn.setAttribute("aria-expanded", open ? "false" : "true");
  });
  document.addEventListener("click",(e)=>{
    if(!cont.contains(e.target)){ menu.style.display = "none"; btn.setAttribute("aria-expanded","false"); }
  });
}

function setupRegionBanner(){
  const cont = $('#regions'); cont.innerHTML='';
  manifest.regions.forEach(r=>{
    const b = document.createElement('div');
    b.className = 'chip'+(r.id===state.region?' active':'');
    b.textContent = r.name;
    b.dataset.region = r.id;
    b.addEventListener('click',()=>{
      state.region = r.id;
      state.tIndex = 0;
      $$('#regions .chip').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      updateFigure(true);
    });
    cont.appendChild(b);
  });
}

function setupVariableBanner(){
  const cont = $('#variables'); cont.innerHTML='';
  manifest.variables.forEach(v=>{
    const b = document.createElement('div');
    b.className = 'chip'+(v.key===state.variable?' active':'');
    b.textContent = v.name;
    b.dataset.var = v.key;
    b.addEventListener('click',()=>{
      state.variable = v.key;
      state.tIndex = 0;
      $$('#variables .chip').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      updateFigure(true);
    });
    cont.appendChild(b);
  });
}

function setupTimePanel(){
  const maxIdx = manifest.times_hours.length - 1;
  const slider = $('#time-slider');
  slider.min = 0; slider.max = maxIdx; slider.value = 0;
  $('#time-label').textContent = `${manifest.times_hours[0]} h`;
  slider.addEventListener('input', e=>{
    state.tIndex = parseInt(e.target.value,10);
    $('#time-label').textContent = `${manifest.times_hours[state.tIndex]} h`;
    updateFigure();
  });
  $('#loop-btn').addEventListener('click',()=>{
    state.playing = !state.playing;
    $('#loop-btn').textContent = state.playing ? 'Stop' : 'Loop';
    if (state.playing){
      state.timer = setInterval(()=>{
        state.tIndex = (state.tIndex + 1) % (maxIdx+1);
        slider.value = state.tIndex;
        $('#time-label').textContent = `${manifest.times_hours[state.tIndex]} h`;
        updateFigure();
      }, 350);
    } else {
      clearInterval(state.timer);
    }
  });
}

function pathForFrame(){
  const cyc = state.cycle;
  const reg = state.region;
  const v   = state.variable;
  const tIdx = state.tIndex;
  const y = cyc.slice(0,4), m = cyc.slice(4,6), d = cyc.slice(6,8), H = cyc.slice(9,11);
  const dt0 = new Date(`${y}-${m}-${d}T${H}:00:00Z`);
  const hrs = manifest.times_hours[tIdx];
  const dt = new Date(dt0.getTime() + hrs*3600*1000);
  const ts = dt.toISOString().replace(/[:-]|\.\d{3}/g,''); // YYYYMMDDTHHMMSSZ
  return `assets/${cyc}/${reg}/${v}/${ts}.png`;
}

function updateFigure(force=false){
  const img = $('#fig');
  const src = pathForFrame();
  if (force || img.getAttribute('src') !== src){
    img.setAttribute('src', src);
  }
}

function setStatus(){
  // Footer text simplified (no cycle) and subline shows today\'s date.
  const months = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const now = new Date();
  const dd = String(now.getDate()).padStart(2,"0");
  const mm = months[now.getMonth()];
  const yyyy = now.getFullYear();
  const todayStr = `${dd}-${mm}-${yyyy}`;
  const sub = document.getElementById("subline");
  sub.textContent = `Mapas & Índices — ${todayStr}`;
  const st = document.getElementById("status");
  st.textContent = "GreenOcean — demo";
}

init();