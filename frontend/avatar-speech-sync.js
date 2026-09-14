// Lógica PURA (sin three.js, sin DOM) para sincronizar los GESTOS DE CUERPO
// del avatar con el ritmo real del habla. Separada de avatar3d.js a
// propósito para poder testear esta parte con Node normal y corriente, sin
// levantar three.js/WebGL/un navegador — ver avatar-speech-sync.test.mjs
// (mismo directorio) y córrela con `node avatar-speech-sync.test.mjs`.
//
// Dos piezas independientes que avatar3d.js combina por frame:
//
//   1. computeTextBeats(text, duration): antes de reproducir un segmento de
//      audio, a partir del TEXTO de ese segmento (ya conocido por WebSocket,
//      antes de que termine de sonar) y de la duración real del audio (en
//      cuanto el navegador la conoce), calcula en qué instante aproximado
//      cae cada coma/punto/interrogación — repartiendo el texto en
//      proporción lineal sobre la duración. Es una aproximación (edge-tts
//      no da marcas por palabra), pero de sobra para disparar un cambio de
//      gesto "más o menos" en el sitio correcto: el oído no detecta un
//      desfase de unas pocas décimas en un gesto corporal (al contrario que
//      en el lip-sync, que si necesita precisión real por eso usa el
//      volumen del audio en vivo, no el texto).
//
//   2. createPauseTracker(...): máquina de histéresis que decide, cuadro a
//      cuadro y a partir del volumen REAL del audio (no del texto), si el
//      cuerpo debe soltar el gesto de hablar y pasar a la idle porque hay
//      una pausa sostenida — sin parpadear en los huecos cortos normales
//      entre sílabas. computeTextBeats() y el pause tracker se retro-
//      alimentan: cruzar un beat de puntuación acorta la ventana que hace
//      falta de silencio real para confirmar la pausa (ahí SÍ se espera una,
//      así que no hace falta esperar tanto).

// ---------- Beats de puntuación ----------
// Solo se consideran estos signos; el resto del texto es irrelevante para
// el ritmo del gesto. Se agrupan en 3 tipos por la fuerza de la pausa que
// suelen marcar en el habla real:
//   "comma"    ,  ;  :
//   "sentence" .  !
//   "question" ?  (o cualquier run que incluya "?", p. ej. "?!")
const PUNCT_RUN_RE = /[,;:.!?]+/g;
const BEAT_TYPE_PRIORITY = { comma: 1, sentence: 2, question: 3 };

// Márgenes: nunca se dispara un beat pegado al arranque (el gesto que acaba
// de arrancar el turno ya "vale" como primer impulso) ni pegado al final
// (el cierre real de turno, con su propio crossfade a idle, ya lo cubre —
// ver stopTalkingAnimation en avatar3d.js). BEAT_MIN_GAP_SECONDS funde en
// un único beat cualquier puntuación muy seguida ("...", "?!", una coma a
// medio segundo de un punto): sin esto, una frase con puntuación densa
// dispararía cambios de gesto pegados unos a otros y se vería nervioso en
// vez de natural.
const BEAT_HEAD_MARGIN_SECONDS = 0.12;
const BEAT_TAIL_MARGIN_SECONDS = 0.12;
const BEAT_MIN_GAP_SECONDS = 0.25;

/**
 * Calcula los beats de puntuación de `text` repartidos linealmente sobre
 * `durationSeconds`. Determinista (mismo texto + duración -> mismos beats),
 * sin depender de nada externo.
 *
 * @param {string} text
 * @param {number} durationSeconds
 * @returns {{ time: number, type: "comma" | "sentence" | "question" }[]}
 *   Ordenado por `time` ascendente (se recorre el texto en orden, así que
 *   sale ordenado sin necesidad de un sort aparte).
 */
export function computeTextBeats(text, durationSeconds) {
  if (!text || typeof text !== "string") return [];
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const len = text.length;
  if (len === 0) return [];

  const beats = [];
  PUNCT_RUN_RE.lastIndex = 0;
  let match;
  while ((match = PUNCT_RUN_RE.exec(text))) {
    const run = match[0];
    const type = run.includes("?") ? "question" : /[.!]/.test(run) ? "sentence" : "comma";
    // Posición justo DESPUÉS del signo (o del run completo, si van varios
    // seguidos): es ahí donde cae la pausa real, no en el signo en sí.
    const charOffset = match.index + run.length;
    const time = (charOffset / len) * durationSeconds;

    if (time < BEAT_HEAD_MARGIN_SECONDS || time > durationSeconds - BEAT_TAIL_MARGIN_SECONDS) {
      continue;
    }

    const prev = beats[beats.length - 1];
    if (prev && time - prev.time < BEAT_MIN_GAP_SECONDS) {
      // Se funde con el anterior: se queda el tipo más fuerte (question >
      // sentence > comma) y el instante más tardío de los dos.
      if (BEAT_TYPE_PRIORITY[type] >= BEAT_TYPE_PRIORITY[prev.type]) prev.type = type;
      prev.time = time;
      continue;
    }
    beats.push({ time, type });
  }
  return beats;
}

// ---------- Pausa real por volumen (histéresis) ----------
/**
 * Crea un rastreador de pausas con histéresis: hacen falta `enterSeconds`
 * seguidos de silencio para declarar una pausa, y `exitSeconds` seguidos de
 * voz para darla por terminada — así un hueco corto entre sílabas (mucho
 * más breve que enterSeconds) nunca la dispara, y una voz que sube y baja
 * de golpe (ruido puntual) tampoco la corta antes de tiempo.
 *
 * requestSoftWindow(seconds): durante los próximos `seconds` (reloj propio
 * del tracker, avanzado por `update`), usa `softEnterSeconds` en vez de
 * `enterSeconds` — pensado para llamarlo justo al cruzar un beat de
 * puntuación (ver computeTextBeats): ahí SÍ se espera una pausa real, así
 * que no hace falta esperar tanto para confirmarla.
 *
 * @param {{ enterSeconds: number, exitSeconds: number, softEnterSeconds: number }} opts
 */
export function createPauseTracker({ enterSeconds, exitSeconds, softEnterSeconds }) {
  let paused = false;
  let aboveSeconds = 0; // tiempo acumulado sonando por encima del umbral, sin interrupción
  let belowSeconds = 0; // tiempo acumulado en silencio, sin interrupción
  let clockSeconds = 0;
  let softUntilSeconds = -1;

  function reset() {
    paused = false;
    aboveSeconds = 0;
    belowSeconds = 0;
    softUntilSeconds = -1;
    // clockSeconds NO se reinicia a propósito: softUntilSeconds se compara
    // contra él, así que reiniciar solo uno de los dos podría dejar una
    // ventana "soft" abierta o cerrada por error si reset() se llama justo
    // después de requestSoftWindow(). Da igual que crezca sin límite (es un
    // double de JS, ver Number.MAX_SAFE_INTEGER) para la vida de una pestaña.
  }

  return {
    reset,
    requestSoftWindow(seconds) {
      softUntilSeconds = clockSeconds + seconds;
    },
    /**
     * @param {number} dtSeconds delta de este frame
     * @param {boolean} speaking si el volumen real está por encima del
     *   umbral de silencio ESTE frame (antes de aplicar histéresis)
     * @returns {{ paused: boolean, changed: boolean }} `changed` es true
     *   solo en el frame exacto en que `paused` cambia de valor.
     */
    update(dtSeconds, speaking) {
      const dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0;
      clockSeconds += dt;

      if (speaking) {
        aboveSeconds += dt;
        belowSeconds = 0;
      } else {
        belowSeconds += dt;
        aboveSeconds = 0;
      }

      const requiredEnter = clockSeconds < softUntilSeconds ? softEnterSeconds : enterSeconds;

      let changed = false;
      if (!paused && belowSeconds >= requiredEnter) {
        paused = true;
        changed = true;
      } else if (paused && aboveSeconds >= exitSeconds) {
        paused = false;
        changed = true;
      }
      return { paused, changed };
    },
    get paused() {
      return paused;
    },
  };
}
