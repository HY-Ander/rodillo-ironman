// app.js — controlador principal: pantallas, ejecución del entreno, gráficas y export.

const trainer = new TrainerConnection();
const hr = new HeartRateConnection();

const latest = { power: null, cadence: null, speedKmh: null, hr: null };

let currentWorkout = null; // { name, steps: [...] } — copia de trabajo, no el preset original
let stepIndex = 0;
let stepElapsed = 0; // segundos dentro del bloque actual
let runningElapsed = 0; // segundos totales de sesión (sin contar pausas)
let manualOffset = 0;
let lastSentTarget = null;
let lastSentAt = 0;
let paused = false;
// El tiempo se calcula con el reloj real (Date.now), no contando ticks: si la app pasa a
// segundo plano, el navegador ralentiza los temporizadores y contar ticks retrasa el entreno.
let sessionWallStart = 0; // ms
let pausedMs = 0;
let pauseStartedAt = null;
let lastAutosaveAt = 0;
let tickTimer = null;
let sessionSamples = []; // {t, power, target, cadence, hr, speedKmh}
let sessionStartedAt = null;

let builderSteps = [];
let liveChart = null;
let summaryChart = null;
let viewedSession = null; // sesión que se está viendo en el resumen (para el CSV)

const LIVE_WINDOW_S = 300;

// Mantener la pantalla encendida durante la sesión (si no, el móvil se bloquea
// a los pocos minutos y el navegador puede cortar el Bluetooth).
let wakeLock = null;
async function keepScreenOn() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (err) { console.warn('WakeLock:', err); }
}
function releaseScreen() {
  try { if (wakeLock) wakeLock.release(); } catch (_) {}
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && tickTimer) { keepScreenOn(); tick(); }
});

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
} // ventana visible en el gráfico en vivo (5 min)

// ---------------------------------------------------------------- utilidades UI

function $(id) { return document.getElementById(id); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  $(id).classList.add('active');
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function fmtHMS(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h + ':' + String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}

// ---------------------------------------------------------------- conexión Bluetooth

async function connectTrainer() {
  if (!TrainerConnection.isSupported()) {
    toast('Este navegador no soporta Bluetooth (¿estás en iOS? usa Chrome en Android o en el ordenador).');
    return;
  }
  try {
    trainer.onStatusChange = (status) => {
      const btn = $('btn-connect-trainer');
      if (status === 'connected') {
        btn.classList.remove('badge-off');
        btn.classList.add('badge-on');
        btn.textContent = '🚴 Rodillo ✓';
        toast('Rodillo conectado');
      } else if (status === 'disconnected') {
        btn.classList.remove('badge-on');
        btn.classList.add('badge-off');
        btn.textContent = '🚴 Rodillo';
        toast('Rodillo desconectado');
      }
    };
    trainer.onData = (d) => {
      if (d.power !== null) latest.power = d.power;
      if (d.cadence !== null) latest.cadence = d.cadence;
      if (d.speedKmh !== null) latest.speedKmh = d.speedKmh;
    };
    await trainer.connect();
  } catch (err) {
    console.error(err);
    toast('No se pudo conectar el rodillo: ' + err.message);
  }
}

async function connectHR() {
  if (!HeartRateConnection.isSupported()) {
    toast('Este navegador no soporta Bluetooth.');
    return;
  }
  try {
    hr.onStatusChange = (status) => {
      const btn = $('btn-connect-hr');
      if (status === 'connected') {
        btn.classList.remove('badge-off');
        btn.classList.add('badge-on');
        btn.textContent = '❤️ FC ✓';
        toast('Pulsómetro conectado');
      } else if (status === 'disconnected') {
        btn.classList.remove('badge-on');
        btn.classList.add('badge-off');
        btn.textContent = '❤️ FC';
      }
    };
    hr.onData = (bpm) => { latest.hr = bpm; };
    await hr.connect();
  } catch (err) {
    console.error(err);
    toast('No se pudo conectar la FC: ' + err.message);
  }
}

// ---------------------------------------------------------------- pantalla: selección

async function renderWorkoutList() {
  const custom = await Storage.getAllWorkouts();
  const all = [...PRESET_WORKOUTS, ...custom];
  const list = $('workout-list');
  list.innerHTML = '';
  all.forEach((w) => {
    const card = document.createElement('div');
    card.className = 'workout-card';
    const totalMin = Math.round(workoutTotalSeconds(w) / 60);
    card.innerHTML = `
      <div>
        <div class="wname">${esc(w.name)}</div>
        <div class="wmeta">${w.steps.length} bloques · ${totalMin}'</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn-secondary btn-use-base">Usar como base</button>
        <label class="from-min" title="Empezar a mitad del entreno">desde min <input type="number" min="0" step="1" value="0" class="inp-from"></label>
        <button class="btn-primary btn-start">Empezar</button>
      </div>`;
    card.querySelector('.btn-start').addEventListener('click', () => {
      const min = parseFloat(card.querySelector('.inp-from').value) || 0;
      startSession(w, Math.round(min * 60));
    });
    card.querySelector('.btn-use-base').addEventListener('click', () => loadIntoBuilder(w));
    list.appendChild(card);
  });
}

function loadIntoBuilder(workout) {
  builderSteps = workout.steps.map((s) => ({ ...s }));
  $('builder-body').closest('details').open = true;
  renderBuilder();
  $('builder-body').closest('details').scrollIntoView({ behavior: 'smooth' });
}

function renderBuilder() {
  const body = $('builder-body');
  body.innerHTML = '';

  const nameRow = document.createElement('div');
  nameRow.style.margin = '8px 0';
  nameRow.innerHTML = `<input id="builder-name" placeholder="Nombre del entreno" style="width:100%; padding:8px; border-radius:8px; background:var(--bg); border:1px solid var(--border); color:var(--text);">`;
  body.appendChild(nameRow);

  builderSteps.forEach((step, i) => {
    const row = document.createElement('div');
    row.className = 'step-row';
    row.innerHTML = `
      <input type="text" value="${esc(step.name)}" data-field="name" placeholder="Nombre del bloque">
      <select data-field="type">
        ${['warmup', 'steady', 'interval', 'recovery', 'cooldown']
          .map((t) => `<option value="${t}" ${t === step.type ? 'selected' : ''}>${t}</option>`)
          .join('')}
      </select>
      <input type="number" min="0.5" step="0.5" value="${(step.duration_s / 60).toFixed(1)}" data-field="duration_min" placeholder="min">
      <input type="number" min="0" step="1" value="${step.startW}" data-field="startW" placeholder="W inicio">
      <input type="number" min="0" step="1" value="${step.endW}" data-field="endW" placeholder="W fin">
      <button class="del" title="Eliminar bloque">✕</button>
    `;
    row.querySelectorAll('input,select').forEach((input) => {
      input.addEventListener('change', (e) => {
        const field = e.target.dataset.field;
        if (field === 'duration_min') step.duration_s = Math.round(parseFloat(e.target.value) * 60);
        else if (field === 'startW' || field === 'endW') step[field] = parseInt(e.target.value, 10) || 0;
        else step[field] = e.target.value;
      });
    });
    row.querySelector('.del').addEventListener('click', () => {
      builderSteps.splice(i, 1);
      renderBuilder();
    });
    body.appendChild(row);
  });
}

function addBuilderStep() {
  builderSteps.push({ name: 'Bloque', type: 'steady', duration_s: 300, startW: 150, endW: 150 });
  renderBuilder();
}

async function saveBuilderWorkout() {
  if (builderSteps.length === 0) {
    toast('Añade al menos un bloque');
    return;
  }
  const name = $('builder-name')?.value?.trim() || 'Entreno personalizado';
  const workout = {
    id: 'custom-' + Date.now(),
    name,
    steps: builderSteps.map((s) => ({ ...s })),
  };
  await Storage.saveWorkout(workout);
  toast('Entreno guardado');
  renderWorkoutList();
}

async function renderHistory() {
  const sessions = await Storage.getAllSessions();
  const list = $('history-list');
  if (sessions.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim); font-size:0.85rem;">Todavía no hay sesiones grabadas.</p>';
    return;
  }
  list.innerHTML = '';
  sessions.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'history-item';
    const date = new Date(s.startedAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    row.innerHTML = `<span class="hi-main">${date} — ${esc(s.workoutName)}${s.inProgress ? ' (incompleta)' : ''}</span><span>${Math.round(s.summary.durationS / 60)}' · ${s.summary.avgPower ?? '--'}W avg ›</span>`;
    row.addEventListener('click', () => {
      viewedSession = s;
      renderSummaryScreen(s);
      showScreen('screen-summary');
    });
    list.appendChild(row);
  });
}

// ---------------------------------------------------------------- sesión en vivo

function currentStep() {
  return currentWorkout.steps[stepIndex];
}

function locate(elapsed) {
  let cum = 0;
  for (let i = 0; i < currentWorkout.steps.length; i++) {
    const d = currentWorkout.steps[i].duration_s;
    if (elapsed < cum + d) return { idx: i, inStep: elapsed - cum };
    cum += d;
  }
  return { idx: currentWorkout.steps.length, inStep: 0 };
}

function startSession(workoutTemplate, startAtS = 0) {
  currentWorkout = { name: workoutTemplate.name, steps: workoutTemplate.steps.map((s) => ({ ...s })) };
  const total = workoutTotalSeconds(currentWorkout);
  startAtS = Math.max(0, Math.min(startAtS, total - 1));
  sessionWallStart = Date.now() - startAtS * 1000;
  pausedMs = 0;
  pauseStartedAt = null;
  lastAutosaveAt = Date.now();
  const loc = locate(startAtS);
  stepIndex = loc.idx;
  stepElapsed = loc.inStep;
  runningElapsed = startAtS;
  manualOffset = 0;
  lastSentTarget = null;
  lastSentAt = 0;
  paused = false;
  sessionSamples = [];
  sessionStartedAt = Date.now();

  $('btn-pause').textContent = '⏸';
  showScreen('screen-live');
  updateTotals();
  initLiveChart();
  updateStepBanner();
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(tick, 1000);
  keepScreenOn();
  toast('Sesión empezada: ' + currentWorkout.name);
}

function remainingSeconds() {
  let rem = currentStep() ? currentStep().duration_s - stepElapsed : 0;
  for (let i = stepIndex + 1; i < currentWorkout.steps.length; i++) rem += currentWorkout.steps[i].duration_s;
  return rem;
}

function updateTotals() {
  const rem = remainingSeconds();
  $('total-elapsed').textContent = fmtHMS(runningElapsed);
  $('total-remaining').textContent = fmtHMS(rem);
  $('step-count').textContent = (stepIndex + 1) + '/' + currentWorkout.steps.length;
  const total = runningElapsed + rem;
  $('total-progress-bar').style.width = (total ? (100 * runningElapsed) / total : 0) + '%';
}

// Guardado automático cada 30 s: si el móvil se bloquea o se cierra la app,
// la sesión queda en el historial hasta donde llegaste.
function buildSessionRecord(inProgress) {
  return {
    id: 'session-' + sessionStartedAt,
    startedAt: sessionStartedAt,
    workoutName: currentWorkout.name,
    workout: currentWorkout,
    samples: sessionSamples,
    summary: computeSummary(),
    inProgress,
  };
}
function autosaveSession() {
  Storage.saveSession(buildSessionRecord(true)).catch((err) => console.warn('autosave:', err));
}

function skipStep() {
  const step = currentStep();
  if (!step) return;
  // El bloque se acorta a lo realmente hecho, para que el resumen cuadre.
  step.duration_s = Math.max(0, stepElapsed);
  toast('Bloque saltado');
  tick();
}

function extendStep(seconds) {
  const step = currentStep();
  if (!step) return;
  if (step.startW !== step.endW) {
    // En una rampa, alargar cambiaría la pendiente: se añade tiempo al final a potencia final.
    currentWorkout.steps.splice(stepIndex + 1, 0, { ...step, name: step.name + ' (+)', duration_s: seconds, startW: step.endW });
  } else {
    step.duration_s += seconds;
  }
  updateTotals();
  updateStepBanner();
  toast('+' + Math.round(seconds / 60) + "' al bloque");
}

function updateStepBanner() {
  const step = currentStep();
  const next = currentWorkout.steps[stepIndex + 1];
  $('step-name').textContent = step ? step.name : '—';
  $('step-next').textContent = 'Siguiente: ' + (next ? next.name : 'fin de la sesión');
}

async function tick() {
  if (paused || !currentWorkout) return;
  if (!currentStep()) return;

  runningElapsed = Math.floor((Date.now() - sessionWallStart - pausedMs) / 1000);
  const loc = locate(runningElapsed);
  if (loc.idx !== stepIndex) {
    stepIndex = loc.idx;
    manualOffset = 0;
    if (stepIndex >= currentWorkout.steps.length) {
      endSession();
      return;
    }
    updateStepBanner();
    toast('Siguiente bloque: ' + currentStep().name);
  }
  stepElapsed = loc.inStep;

  const activeStep = currentStep();
  const baseTarget = targetPowerAt(activeStep, stepElapsed);
  const target = Math.max(0, Math.round(baseTarget + manualOffset));

  // Enviar el objetivo al rodillo solo si cambia lo suficiente y no más de 1 vez cada 2s,
  // para no saturar el Control Point con escrituras.
  const now = Date.now();
  if (trainer.connected && (lastSentTarget === null || Math.abs(target - lastSentTarget) >= 1) && now - lastSentAt >= 2000) {
    lastSentTarget = target;
    lastSentAt = now;
    trainer
      .setTargetPower(target)
      .then((ok) => { if (!ok) lastSentTarget = null; }) // no confirmado -> se reenvía en 2s
      .catch((err) => { lastSentTarget = null; console.warn('setTargetPower:', err); });
  }

  const sample = {
    t: runningElapsed,
    power: latest.power,
    target,
    cadence: latest.cadence,
    hr: latest.hr,
    speedKmh: latest.speedKmh,
  };
  sessionSamples.push(sample);

  $('live-power').textContent = latest.power ?? '--';
  $('live-target').textContent = target;
  $('live-cadence').textContent = latest.cadence ?? '--';
  $('live-hr').textContent = latest.hr ?? '--';
  $('live-speed').textContent = latest.speedKmh != null ? latest.speedKmh.toFixed(1) : '--';
  $('step-timer').textContent = fmtClock(activeStep.duration_s - stepElapsed);
  updateTotals();
  if (Date.now() - lastAutosaveAt >= 30000) { lastAutosaveAt = Date.now(); autosaveSession(); }

  pushLiveChartPoint(sample);
}

function togglePause() {
  paused = !paused;
  if (paused) pauseStartedAt = Date.now();
  else if (pauseStartedAt) { pausedMs += Date.now() - pauseStartedAt; pauseStartedAt = null; }
  $('btn-pause').textContent = paused ? '▶' : '⏸';
  if (trainer.connected) {
    if (paused) trainer.pause().catch(() => {});
    else trainer.resume().catch(() => {});
  }
  // Al reanudar, forzar reenvío del objetivo: algunos rodillos olvidan el ERG tras pausa.
  if (!paused) { lastSentTarget = null; lastSentAt = 0; }
  toast(paused ? 'Pausado' : 'Reanudado');
}

function adjustPower(delta) {
  manualOffset += delta;
  toast('Ajuste manual: ' + (manualOffset > 0 ? '+' : '') + manualOffset + 'W');
}

async function endSession() {
  clearInterval(tickTimer);
  tickTimer = null;
  releaseScreen();
  if (trainer.connected) trainer.pause().catch(() => {});

  const session = buildSessionRecord(false);
  await Storage.saveSession(session);
  viewedSession = session;

  renderSummaryScreen(session);
  showScreen('screen-summary');
}

function computeSummary() {
  const powers = sessionSamples.map((s) => s.power).filter((p) => p != null);
  const hrs = sessionSamples.map((s) => s.hr).filter((h) => h != null);
  const cadences = sessionSamples.map((s) => s.cadence).filter((c) => c != null);
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  const max = (arr) => (arr.length ? Math.round(Math.max(...arr)) : null);

  // Estadísticas por bloque, a partir de los límites de tiempo planificados
  // (los bloques se ejecutan siempre en orden, sin saltos, en la v1).
  let cursor = 0;
  const intervals = currentWorkout.steps.map((step) => {
    const from = cursor;
    const to = cursor + step.duration_s;
    cursor = to;
    const slice = sessionSamples.filter((s) => s.t > from && s.t <= to);
    const p = slice.map((s) => s.power).filter((x) => x != null);
    const h = slice.map((s) => s.hr).filter((x) => x != null);
    const targetAvg = Math.round((step.startW + step.endW) / 2);
    const avgP = avg(p);
    return {
      name: step.name,
      type: step.type,
      targetW: targetAvg,
      avgPower: avgP,
      avgHr: avg(h),
      deviationPct: avgP != null && targetAvg > 0 ? Math.round(((avgP - targetAvg) / targetAvg) * 100) : null,
    };
  });

  return {
    durationS: runningElapsed,
    avgPower: avg(powers),
    maxPower: max(powers),
    avgHr: avg(hrs),
    avgCadence: avg(cadences),
    intervals,
  };
}

function renderSummaryScreen(session) {
  const s = session.summary;
  $('summary-stats').innerHTML = `
    <div class="stat"><span>${s.avgPower ?? '--'}</span><small>W</small><div class="stat-label">Potencia media</div></div>
    <div class="stat"><span>${s.maxPower ?? '--'}</span><small>W</small><div class="stat-label">Potencia máx</div></div>
    <div class="stat"><span>${fmtClock(s.durationS)}</span><div class="stat-label">Duración</div></div>
    <div class="stat"><span>${s.avgHr ?? '--'}</span><small>bpm</small><div class="stat-label">FC media</div></div>
    <div class="stat"><span>${s.avgCadence ?? '--'}</span><small>rpm</small><div class="stat-label">Cadencia media</div></div>
    <div class="stat"><span>${esc(session.workoutName)}</span><div class="stat-label">Entreno</div></div>
  `;

  const ivDiv = $('summary-intervals');
  ivDiv.innerHTML = '';
  s.intervals.forEach((iv) => {
    const row = document.createElement('div');
    row.className = 'interval-row';
    const devClass = iv.deviationPct == null ? '' : Math.abs(iv.deviationPct) <= 5 ? 'iv-dev-ok' : 'iv-dev-bad';
    row.innerHTML = `<span class="iv-name">${esc(iv.name)}</span><span>${iv.avgPower ?? '--'}W / obj. ${iv.targetW}W <span class="${devClass}">${iv.deviationPct != null ? (iv.deviationPct > 0 ? '+' : '') + iv.deviationPct + '%' : ''}</span></span>`;
    ivDiv.appendChild(row);
  });

  renderSummaryChart(session);
}

// ---------------------------------------------------------------- CSV export

function exportSessionCsv() {
  Storage.getAllSessions().then((sessions) => {
    const session = viewedSession || sessions[0]; // la que estás viendo, o la última
    if (!session) { toast('No hay sesión que exportar'); return; }
    const lines = ['t_s,power_w,target_w,cadence_rpm,hr_bpm,speed_kmh'];
    session.samples.forEach((s) => {
      lines.push([s.t, s.power ?? '', s.target ?? '', s.cadence ?? '', s.hr ?? '', s.speedKmh != null ? s.speedKmh.toFixed(1) : ''].join(','));
    });
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date(session.startedAt).toISOString().slice(0, 16).replace(':', '');
    a.href = url;
    a.download = `rodillo_${dateStr}_${session.workoutName.replace(/[^a-z0-9]+/gi, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ---------------------------------------------------------------- gráficas

function initLiveChart() {
  const ctx = $('live-chart').getContext('2d');
  if (liveChart) liveChart.destroy();
  liveChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        { label: 'Potencia', data: [], borderColor: '#2dd4bf', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 2, tension: 0.15 },
        { label: 'Objetivo', data: [], borderColor: '#ff5c35', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.5, stepped: true },
      ],
    },
    options: {
      animation: false,
      responsive: true,
      scales: {
        x: { type: 'linear', ticks: { callback: (v) => fmtClock(v), maxTicksLimit: 6, color: '#93a0bd' }, grid: { color: '#2a375a' } },
        y: { ticks: { color: '#93a0bd' }, grid: { color: '#2a375a' }, title: { display: true, text: 'W', color: '#93a0bd' } },
      },
      plugins: { legend: { labels: { color: '#e8edf7' } } },
    },
  });
}

function pushLiveChartPoint(sample) {
  if (!liveChart) return;
  liveChart.data.datasets[0].data.push({ x: sample.t, y: sample.power });
  liveChart.data.datasets[1].data.push({ x: sample.t, y: sample.target });
  const cutoff = sample.t - LIVE_WINDOW_S;
  liveChart.data.datasets.forEach((ds) => {
    while (ds.data.length && ds.data[0].x < cutoff) ds.data.shift();
  });
  liveChart.update('none');
}

function downsample(samples, maxPoints) {
  if (samples.length <= maxPoints) return samples;
  const bucketSize = Math.ceil(samples.length / maxPoints);
  const out = [];
  for (let i = 0; i < samples.length; i += bucketSize) {
    const bucket = samples.slice(i, i + bucketSize);
    const avgField = (field) => {
      const vals = bucket.map((b) => b[field]).filter((v) => v != null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    out.push({ t: bucket[0].t, power: avgField('power'), target: avgField('target'), hr: avgField('hr') });
  }
  return out;
}

function renderSummaryChart(session) {
  const ctx = $('summary-chart').getContext('2d');
  if (summaryChart) summaryChart.destroy();
  const data = downsample(session.samples, 600);
  summaryChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        { label: 'Potencia', data: data.map((d) => ({ x: d.t, y: d.power })), borderColor: '#2dd4bf', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.5, tension: 0.1 },
        { label: 'Objetivo', data: data.map((d) => ({ x: d.t, y: d.target })), borderColor: '#ff5c35', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.5, stepped: true },
      ],
    },
    options: {
      animation: false,
      responsive: true,
      scales: {
        x: { type: 'linear', ticks: { callback: (v) => fmtClock(v), maxTicksLimit: 8, color: '#93a0bd' }, grid: { color: '#2a375a' } },
        y: { ticks: { color: '#93a0bd' }, grid: { color: '#2a375a' }, title: { display: true, text: 'W', color: '#93a0bd' } },
      },
      plugins: { legend: { labels: { color: '#e8edf7' } } },
    },
  });
}

// ---------------------------------------------------------------- arranque

function init() {
  if (!('bluetooth' in navigator)) {
    toast('Aviso: este navegador no soporta Web Bluetooth. Usa Chrome en Android o en el ordenador (no funciona en iOS Safari).');
  }
  renderWorkoutList();
  renderHistory();

  $('btn-connect-trainer').addEventListener('click', connectTrainer);
  $('btn-connect-hr').addEventListener('click', connectHR);
  $('btn-add-step').addEventListener('click', addBuilderStep);
  $('btn-save-workout').addEventListener('click', saveBuilderWorkout);
  $('btn-pause').addEventListener('click', togglePause);
  $('btn-power-up').addEventListener('click', () => adjustPower(5));
  $('btn-power-down').addEventListener('click', () => adjustPower(-5));
  $('btn-step-skip').addEventListener('click', () => {
    if (confirm('¿Saltar al siguiente bloque?')) skipStep();
  });
  $('btn-step-extend').addEventListener('click', () => extendStep(60));
  $('btn-end-session').addEventListener('click', () => {
    if (confirm('¿Terminar la sesión ahora?')) endSession();
  });
  $('btn-export-csv').addEventListener('click', exportSessionCsv);
  $('btn-back-home').addEventListener('click', () => {
    showScreen('screen-select');
    renderHistory();
  });

  window.addEventListener('beforeunload', (e) => {
    if (tickTimer) { autosaveSession(); e.preventDefault(); e.returnValue = ''; }
  });

  if (navigator.serviceWorker) {
    navigator.serviceWorker.register('service-worker.js').catch((err) => console.warn('SW:', err));
  }
}

document.addEventListener('DOMContentLoaded', init);
