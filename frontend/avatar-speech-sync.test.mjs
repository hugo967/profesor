// Tests de la lógica PURA de avatar-speech-sync.js (sin three.js/DOM, sin
// dependencias). Correr con:  node frontend/avatar-speech-sync.test.mjs
// Sale con código 0 si todo pasa, 1 si algo falla (falla rápido: assert.*
// lanza y el catch de abajo lo reporta con contexto).
import assert from "node:assert/strict";
import { computeTextBeats, createPauseTracker } from "./avatar-speech-sync.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------- computeTextBeats ----------

test("sin puntuación -> sin beats", () => {
  assert.deepEqual(computeTextBeats("Hello there how are you", 2), []);
});

test("texto vacío / nulo / duración inválida -> sin beats, sin lanzar", () => {
  assert.deepEqual(computeTextBeats("", 2), []);
  assert.deepEqual(computeTextBeats(null, 2), []);
  assert.deepEqual(computeTextBeats(undefined, 2), []);
  assert.deepEqual(computeTextBeats("Hi, there.", 0), []);
  assert.deepEqual(computeTextBeats("Hi, there.", -1), []);
  assert.deepEqual(computeTextBeats("Hi, there.", NaN), []);
  assert.deepEqual(computeTextBeats("Hi, there.", Infinity), []);
});

test("una coma a mitad de frase -> un beat tipo comma, a mitad de la duración", () => {
  // "Well, I think so" (17 chars) -> coma tras el char 5 ("Well,")
  const text = "Well, I think so";
  const beats = computeTextBeats(text, 4);
  assert.equal(beats.length, 1);
  assert.equal(beats[0].type, "comma");
  const expected = (5 / text.length) * 4;
  assert.ok(Math.abs(beats[0].time - expected) < 1e-9);
});

test("punto final de frase (no al final del texto) -> beat tipo sentence", () => {
  const text = "I see. Let's continue with the lesson";
  const beats = computeTextBeats(text, 6);
  assert.equal(beats.length, 1);
  assert.equal(beats[0].type, "sentence");
});

test("interrogación -> beat tipo question, con prioridad sobre sentence/comma", () => {
  const text = "Are you ready? Let's begin the exercise now";
  const beats = computeTextBeats(text, 5);
  assert.equal(beats.length, 1);
  assert.equal(beats[0].type, "question");
});

test("puntuación pegada al principio -> se descarta (margen de cabeza)", () => {
  // La coma cae dentro del primer 0.12s de un audio de 1s -> se descarta.
  const text = ",abcdefghijklmnopqrstuvwxyz"; // coma en char 1 de 28 -> ~0.036s
  const beats = computeTextBeats(text, 1);
  assert.deepEqual(beats, []);
});

test("puntuación pegada al final -> se descarta (margen de cola)", () => {
  const text = "abcdefghijklmnopqrstuvwxyz."; // punto en char 27 de 27 -> ~1s (pegado al final)
  const beats = computeTextBeats(text, 1);
  assert.deepEqual(beats, []);
});

test("puntuación en mitad de frase pero fuera de los márgenes -> sí cuenta", () => {
  const text = "abcdefghijklmnop, qrstuvwxyz"; // coma en char 17 de 29 -> ~0.586s de 1s
  const beats = computeTextBeats(text, 1);
  assert.equal(beats.length, 1);
  assert.equal(beats[0].type, "comma");
});

test("puntos suspensivos / runs de puntuación -> un solo beat, no uno por signo", () => {
  const text = "Well... let's see how this goes today shall we";
  const beats = computeTextBeats(text, 6);
  assert.equal(beats.length, 1);
  assert.equal(beats[0].type, "sentence");
});

test("'?!' junto -> un beat, tipo question (gana la prioridad más alta)", () => {
  const text = "Really?! I can't believe you did that today somehow";
  const beats = computeTextBeats(text, 6);
  assert.equal(beats.length, 1);
  assert.equal(beats[0].type, "question");
});

test("dos signos de puntuación muy seguidos (< BEAT_MIN_GAP_SECONDS) -> se funden en uno", () => {
  // Coma y punto separados por muy pocos caracteres -> en una duración
  // corta caen a menos de 0.25s el uno del otro -> deben fundirse.
  const text = "Yes, ok. Let's move on to the next topic in our lesson today";
  const beats = computeTextBeats(text, 3); // frase larga, primeros signos muy próximos en tiempo
  // Solo debe quedar un beat por el par coma+punto inicial (fundidos) y
  // ninguno más (no hay más puntuación).
  assert.equal(beats.length, 1);
  assert.equal(beats[0].type, "sentence"); // gana el punto (mayor prioridad)
});

test("varias frases bien separadas -> un beat por cada una, en orden creciente", () => {
  const text = "First, we start. Then, we continue? Finally we finish now for real";
  const beats = computeTextBeats(text, 10);
  assert.ok(beats.length >= 3, `esperaba al menos 3 beats, salieron ${beats.length}`);
  for (let i = 1; i < beats.length; i++) {
    assert.ok(beats[i].time > beats[i - 1].time, "los beats deben salir en orden estrictamente creciente");
  }
});

test("es determinista: mismo texto + duración -> mismos beats siempre", () => {
  const text = "Hello, how are you today? I hope you're doing well, really.";
  const a = computeTextBeats(text, 7.3);
  const b = computeTextBeats(text, 7.3);
  assert.deepEqual(a, b);
});

// ---------- createPauseTracker ----------

function feed(tracker, frames) {
  // frames: [[dt, speaking], ...] -> corre todos los frames y devuelve el
  // último resultado de update().
  let last = null;
  for (const [dt, speaking] of frames) last = tracker.update(dt, speaking);
  return last;
}

test("silencio corto (menor que enterSeconds) no dispara pausa", () => {
  const t = createPauseTracker({ enterSeconds: 0.38, exitSeconds: 0.09, softEnterSeconds: 0.16 });
  // 0.2s de silencio total, repartido en frames de 16ms (~60fps)
  const frames = Array.from({ length: 12 }, () => [0.0166, false]);
  const result = feed(t, frames);
  assert.equal(result.paused, false);
  assert.equal(t.paused, false);
});

test("silencio sostenido >= enterSeconds SÍ dispara pausa, y solo una vez (changed)", () => {
  const t = createPauseTracker({ enterSeconds: 0.38, exitSeconds: 0.09, softEnterSeconds: 0.16 });
  const frames = Array.from({ length: 30 }, () => [0.0166, false]); // ~0.5s
  let changedCount = 0;
  let finalPaused = false;
  for (const [dt, speaking] of frames) {
    const r = t.update(dt, speaking);
    finalPaused = r.paused;
    if (r.changed) changedCount++;
  }
  assert.equal(finalPaused, true);
  assert.equal(changedCount, 1, "debe pasar a pausado en un único frame, no repetidamente");
});

test("huecos cortos intercalados con voz (simula sílabas) nunca disparan pausa", () => {
  const t = createPauseTracker({ enterSeconds: 0.38, exitSeconds: 0.09, softEnterSeconds: 0.16 });
  // Patrón realista: 100ms de voz, 60ms de hueco, repetido 40 veces (~6.4s
  // de "habla" con micro-huecos entre sílabas, ninguno llega a 0.38s).
  let anyPaused = false;
  for (let i = 0; i < 40; i++) {
    for (let f = 0; f < 6; f++) { // ~100ms de voz en frames de ~16.6ms
      const r = t.update(0.0166, true);
      if (r.paused) anyPaused = true;
    }
    for (let f = 0; f < 4; f++) { // ~66ms de silencio (< enterSeconds)
      const r = t.update(0.0166, false);
      if (r.paused) anyPaused = true;
    }
  }
  assert.equal(anyPaused, false, "no debe pausar nunca ante huecos más cortos que enterSeconds");
});

test("tras pausar, requiere exitSeconds de voz sostenida para despausar", () => {
  const t = createPauseTracker({ enterSeconds: 0.2, exitSeconds: 0.15, softEnterSeconds: 0.1 });
  // Fuerza la pausa
  for (let i = 0; i < 20; i++) t.update(0.02, false); // 0.4s de silencio
  assert.equal(t.paused, true);
  // Un pulso de voz de 0.06s (menor que exitSeconds=0.15) NO debe despausar
  for (let i = 0; i < 3; i++) t.update(0.02, true); // 0.06s
  assert.equal(t.paused, true, "un pulso corto de voz no debe despausar (evita parpadeo)");
  // Voz sostenida >= exitSeconds sí despausa
  let despausado = false;
  for (let i = 0; i < 10; i++) {
    const r = t.update(0.02, true);
    if (!r.paused && r.changed) despausado = true;
  }
  assert.equal(despausado, true);
  assert.equal(t.paused, false);
});

test("requestSoftWindow reduce el umbral de entrada durante su ventana, y solo durante ella", () => {
  const t = createPauseTracker({ enterSeconds: 0.4, exitSeconds: 0.1, softEnterSeconds: 0.12 });
  t.requestSoftWindow(0.3); // ventana corta desde clockSeconds=0
  // 0.15s de silencio: menor que enterSeconds normal (0.4) pero mayor que
  // softEnterSeconds (0.12) -> debe pausar SOLO porque estamos en la ventana.
  let paused = false;
  for (let i = 0; i < 15; i++) { // 0.15s en frames de 0.01s
    const r = t.update(0.01, false);
    if (r.paused) paused = true;
  }
  assert.equal(paused, true, "dentro de la ventana soft, 0.15s de silencio ya debe pausar");
});

test("sin requestSoftWindow, el mismo silencio corto (> soft, < normal) NO pausa", () => {
  const t = createPauseTracker({ enterSeconds: 0.4, exitSeconds: 0.1, softEnterSeconds: 0.12 });
  let paused = false;
  for (let i = 0; i < 15; i++) { // 0.15s, sin ventana soft activa
    const r = t.update(0.01, false);
    if (r.paused) paused = true;
  }
  assert.equal(paused, false);
});

test("reset() vuelve todo a estado inicial (paused=false, contadores a 0)", () => {
  const t = createPauseTracker({ enterSeconds: 0.1, exitSeconds: 0.1, softEnterSeconds: 0.05 });
  for (let i = 0; i < 20; i++) t.update(0.02, false); // fuerza pausa
  assert.equal(t.paused, true);
  t.reset();
  assert.equal(t.paused, false);
  // Tras reset, hace falta enterSeconds completo de nuevo para volver a pausar
  // (si los contadores no se hubieran reiniciado, un solo frame bastaría).
  const r = t.update(0.02, false);
  assert.equal(r.paused, false);
  assert.equal(r.changed, false);
});

test("dt inválido (0, negativo, NaN) no rompe ni acumula tiempo", () => {
  const t = createPauseTracker({ enterSeconds: 0.1, exitSeconds: 0.1, softEnterSeconds: 0.05 });
  const r1 = t.update(0, false);
  const r2 = t.update(-1, false);
  const r3 = t.update(NaN, false);
  assert.equal(r1.paused, false);
  assert.equal(r2.paused, false);
  assert.equal(r3.paused, false);
});

// ---------- runner ----------
let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL - ${name}`);
    console.error(err && err.message ? `  ${err.message}` : err);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} tests pasados`);
if (failed) process.exit(1);
