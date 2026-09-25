// Medidor de voz del micrófono mientras se graba (ver startRecording en
// app.js). Sirve para NO mandar a Whisper un clip sin habla: sobre
// silencio o ruido Whisper se inventa texto (sobre todo con prompt, que
// tiende a copiar o parafrasear), y el alumno veía una frase que no había
// dicho. Mide el RMS del stream cada VOICE_METER_INTERVAL_MS y acumula el
// tiempo por encima de VOICE_RMS_THRESHOLD.
//
// Deliberadamente conservador: solo se descarta un clip si la medición es
// FIABLE (el AudioContext estaba en marcha y llegó señal distinta de cero)
// y aun así casi no hubo voz. Ante cualquier duda, el clip se manda: es
// peor perder una frase real que dejar pasar un silencio (que el backend
// también filtra).

// Con echoCancellation/noiseSuppression/autoGainControl activados, el
// silencio de una habitación queda por debajo de ~0.005 de RMS y la voz
// normal por encima de ~0.03; el umbral queda entre ambos con margen para
// micrófonos flojos.
export const VOICE_RMS_THRESHOLD = 0.012;
// Voz acumulada mínima para mandar el clip: una sílaba corta ("yes") ya
// supera esto.
export const MIN_VOICED_MS = 200;
// Ruido constante (ventilador, aire acondicionado) puede superar el umbral
// fijo aunque nadie hable, y sobre él Whisper se inventa frases ("I'm
// sorry."). La voz sube y baja (sílabas, pausas); el ruido de fondo no. Por
// eso cuenta como voz solo lo que supera también NOISE_FLOOR_FACTOR veces
// el suelo de ruido del propio clip (su percentil NOISE_FLOOR_PERCENTILE).
const NOISE_FLOOR_FACTOR = 2.5;
const NOISE_FLOOR_PERCENTILE = 0.2;
const VOICE_METER_INTERVAL_MS = 40;

// Empieza a medir `stream` con el AudioContext `ctx`. Devuelve un objeto
// con stop() -> { reliable, voicedMs, peakRms, noiseFloor }, o null si no se puede
// medir (sin AudioContext, navegador sin soporte...).
export function startVoiceMeter(ctx, stream) {
  if (!ctx || !stream) return null;
  let source;
  let analyser;
  try {
    source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser); // sin conectar a destination: no se oye
  } catch (e) {
    console.warn("voice-meter: no se pudo medir el micrófono:", e);
    return null;
  }
  const buf = new Float32Array(analyser.fftSize);
  const frames = []; // [rms, ms] de cada medición
  let peakRms = 0;
  let wasRunning = ctx.state === "running";
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const dt = now - last;
    last = now;
    if (ctx.state !== "running") return;
    wasRunning = true;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    if (rms > peakRms) peakRms = rms;
    // dt acotado: con la pestaña en segundo plano el intervalo se estira a
    // ~1 s y un único pico no debe contar como un segundo entero de voz.
    frames.push([rms, Math.min(dt, 100)]);
  }, VOICE_METER_INTERVAL_MS);

  return {
    stop() {
      clearInterval(timer);
      try { source.disconnect(); } catch (e) {}
      const sorted = frames.map((f) => f[0]).sort((a, b) => a - b);
      const noiseFloor = sorted.length ? sorted[Math.floor((sorted.length - 1) * NOISE_FLOOR_PERCENTILE)] : 0;
      const threshold = Math.max(VOICE_RMS_THRESHOLD, noiseFloor * NOISE_FLOOR_FACTOR);
      let voicedMs = 0;
      for (const [rms, ms] of frames) if (rms > threshold) voicedMs += ms;
      return { reliable: wasRunning && peakRms > 0, voicedMs, peakRms, noiseFloor };
    },
  };
}

// true solo si hay certeza razonable de que el clip no tiene voz.
export function isSilentClip(result) {
  return !!result && result.reliable && result.voicedMs < MIN_VOICED_MS;
}
