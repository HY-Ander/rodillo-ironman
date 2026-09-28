// workouts.js — entrenos de ejemplo (con tus vatios actuales, FTP 256W) y utilidades
// para construir/editar entrenos a medida. Los presets son solo un punto de partida:
// "Usar como base" los carga en el editor para ajustarlos antes de empezar.
//
// Cada bloque (step) es: { name, type, duration_s, startW, endW }
// startW === endW  -> potencia constante
// startW !== endW  -> rampa lineal entre los dos valores a lo largo del bloque

const PRESET_WORKOUTS = [
  {
    id: 'plan-2026-09-28-suave',
    name: "HOY lun 28/09 · Aeróbico suave 75' (FC < 125)",
    steps: [
      { name: 'Calentamiento', type: 'warmup', duration_s: 10 * 60, startW: 110, endW: 145 },
      { name: 'Aeróbico 165 W (alto de 145-165) · cadencia 85-95 · FC < 125', type: 'steady', duration_s: 55 * 60, startW: 165, endW: 165 },
      { name: 'Vuelta a la calma', type: 'cooldown', duration_s: 10 * 60, startW: 140, endW: 110 },
    ],
  },
  {
    id: 'plan-2026-09-27-larga',
    name: "Dom 27/09 · Bici larga 3:30 (ritmo IM + 3×20')",
    steps: [
      { name: 'Calentamiento', type: 'warmup', duration_s: 9 * 60, startW: 120, endW: 135 },
      { name: 'Acelerón de cadencia 30" (sube rpm, mismos W)', type: 'interval', duration_s: 30, startW: 135, endW: 135 },
      { name: 'Calentamiento', type: 'warmup', duration_s: 5 * 60, startW: 135, endW: 145 },
      { name: 'Acelerón de cadencia 30" (sube rpm, mismos W)', type: 'interval', duration_s: 30, startW: 145, endW: 145 },
      { name: 'Calentamiento', type: 'warmup', duration_s: 5 * 60, startW: 145, endW: 150 },
      { name: 'Bloque 1 — ritmo IM parte baja (155-165)', type: 'steady', duration_s: 50 * 60, startW: 160, endW: 160 },
      { name: "Serie 1 — 20' parte alta (165-174)", type: 'interval', duration_s: 20 * 60, startW: 170, endW: 170 },
      { name: 'Bloque 2 — ritmo IM parte baja (155-165)', type: 'steady', duration_s: 30 * 60, startW: 160, endW: 160 },
      { name: "Serie 2 — 20' parte alta (165-174)", type: 'interval', duration_s: 20 * 60, startW: 170, endW: 170 },
      { name: 'Bloque 3 — ritmo IM parte baja (155-165)', type: 'steady', duration_s: 20 * 60, startW: 160, endW: 160 },
      { name: "Serie 3 — LA QUE CUENTA: sostener con piernas cargadas", type: 'interval', duration_s: 20 * 60, startW: 170, endW: 170 },
      { name: 'Vuelta a la calma', type: 'cooldown', duration_s: 30 * 60, startW: 145, endW: 130 },
    ],
  },
  {
    id: 'preset-4x5',
    name: "Calidad 4×5' (232-245W)",
    steps: [
      { name: 'Calentamiento', type: 'warmup', duration_s: 12 * 60, startW: 100, endW: 150 },
      { name: "Serie 1/4", type: 'interval', duration_s: 5 * 60, startW: 238, endW: 238 },
      { name: 'Recuperación', type: 'recovery', duration_s: 3 * 60, startW: 130, endW: 130 },
      { name: "Serie 2/4", type: 'interval', duration_s: 5 * 60, startW: 238, endW: 238 },
      { name: 'Recuperación', type: 'recovery', duration_s: 3 * 60, startW: 130, endW: 130 },
      { name: "Serie 3/4", type: 'interval', duration_s: 5 * 60, startW: 238, endW: 238 },
      { name: 'Recuperación', type: 'recovery', duration_s: 3 * 60, startW: 130, endW: 130 },
      { name: "Serie 4/4", type: 'interval', duration_s: 5 * 60, startW: 238, endW: 238 },
      { name: 'Vuelta a la calma', type: 'cooldown', duration_s: 8 * 60, startW: 130, endW: 90 },
    ],
  },
  {
    id: 'preset-sweetspot',
    name: "Sweet spot continuo 40'",
    steps: [
      { name: 'Calentamiento', type: 'warmup', duration_s: 10 * 60, startW: 100, endW: 150 },
      { name: 'Sweet spot', type: 'interval', duration_s: 40 * 60, startW: 220, endW: 220 },
      { name: 'Vuelta a la calma', type: 'cooldown', duration_s: 8 * 60, startW: 150, endW: 90 },
    ],
  },
  {
    id: 'preset-larga',
    name: 'Bici larga ritmo IRONMAN (ajusta la duración)',
    steps: [
      { name: 'Calentamiento', type: 'warmup', duration_s: 20 * 60, startW: 100, endW: 150 },
      { name: 'Grueso — ritmo IRONMAN', type: 'steady', duration_s: 130 * 60, startW: 165, endW: 165 },
      { name: 'Vuelta a la calma', type: 'cooldown', duration_s: 15 * 60, startW: 150, endW: 100 },
    ],
  },
  {
    id: 'preset-suave',
    name: "Suave / recuperación 45'",
    steps: [{ name: 'Suave, piernas sueltas', type: 'steady', duration_s: 45 * 60, startW: 140, endW: 140 }],
  },
];

function targetPowerAt(step, elapsedInStep) {
  if (step.startW === step.endW) return step.startW;
  const frac = Math.min(1, Math.max(0, elapsedInStep / step.duration_s));
  return step.startW + (step.endW - step.startW) * frac;
}

function workoutTotalSeconds(workout) {
  return workout.steps.reduce((sum, s) => sum + s.duration_s, 0);
}

function fmtMinSec(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return m + "' " + (s ? s + '"' : '');
}

window.PRESET_WORKOUTS = PRESET_WORKOUTS;
window.targetPowerAt = targetPowerAt;
window.workoutTotalSeconds = workoutTotalSeconds;
window.fmtMinSec = fmtMinSec;
