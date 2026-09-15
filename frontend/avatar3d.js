// Avatar 3D ("model", exportado de Avaturn) con Three.js vía CDN — sin
// build. Sustituye a los avatares anteriores ("Mario" y antes "Camila",
// ambos de Character Creator/Reallusion): otro generador, otra malla y
// otra nomenclatura.
//
// Este modelo usa nombres de hueso estilo Mixamo (`Head`, `Neck`,
// `LeftArm`, `Spine1`...) y blendshapes ARKit (`jawOpen`, `eyeBlinkLeft`,
// `mouthClose`, visemas `viseme_aa`/`viseme_SS`...), la misma familia que
// Ready Player Me — NO la de Character Creator (`CC_Base_*`, `Jaw_Open`,
// `V_Wide`). Verificado contra el .glb real (script Node parseando los
// chunks del contenedor GLB).
//
// El .glb TRAE una animación horneada de ~8 s (`avaturn_animation`) con
// cuerpo Y cara (parpadeo, micro-miradas, cejas, respiración, balanceo de
// brazos/dedos). Body: ya NO se usa como idle — se sustituyó por
// `Idle.fbx` (ver bloque "Gestos de cuerpo" más abajo) para que la idle
// pudiera formar un único sistema homogéneo con los demás gestos de
// Mixamo (talking1-3) y así cruzar entre ellos con un
// crossfade simétrico simple, sin trucos de peso (ver el porqué en el
// comentario de GESTURE_CROSSFADE_SECONDS). Cara: SÍ se sigue usando —
// `Idle.fbx` es mocap de Mixamo puro, sin blendshapes, así que el
// parpadeo/cejas/mirada del `.glb` se reproduce aparte, en un canal propio
// (`actionFace`, ver mountAvatar3D) que nunca se apaga ni compite con
// nada (no comparte ninguna propiedad con los clips de cuerpo, que son
// puro hueso). El lip-sync de más abajo se SUPERPONE encima de todo esto:
// después de cada `mixer.update()` se sobreescriben los influences de la
// boca. Comprobado en el `.glb` que su animación mueve `jawOpen` como
// mucho a 0.04 (y ningún `viseme_*`), así que sobreescribir esos shapes no
// pelea con nada perceptible.
//
// Sin compresión meshopt/draco (solo la extensión KHR_materials_ior, que
// three soporta de serie): GLTFLoader lo carga tal cual, sin decoder extra.
import * as THREE from "three";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/FBXLoader.js";
import { computeTextBeats, createPauseTracker } from "./avatar-speech-sync.js";

const MODEL_URL = "./avatar/model.glb";

// ---------- Encuadre de cámara ----------
// El plano va desde un poco de aire por encima del pelo hasta un pelín por
// encima del ombligo (hueso Spine) — plano medio, no solo cabeza+pecho. Se
// mide por posición de huesos, no por bounding box (los SkinnedMesh no
// tienen bbox fiable hasta el primer render).
//
// La cabeza queda ANCLADA cerca del borde superior: el sobrante por
// diferencia de aspect ratio se va hacia abajo (más torso), nunca a más
// aire sobre la cabeza. Para bajar el corte inferior, cambiar
// FRAME_BOTTOM_BONE (Spine ~ombligo, Spine1 abdomen alto, Spine2 esternón)
// o subir FRAME_BOTTOM_LIFT; para el aire sobre el pelo, FRAME_TOP_AIR.
const FRAME_TOP_BONE = "Head";
const FRAME_HAIR_MARGIN = 0.21;       // hueso Head -> punta del peinado (estimado; el pelo de este modelo es alto)
const FRAME_TOP_AIR = 0.10;           // aire por encima del pelo (deja al personaje un pelín más abajo en el plano)
const FRAME_BOTTOM_BONE = "Spine";    // ~altura del ombligo
const FRAME_BOTTOM_LIFT = 0.02;       // subir el corte un pelín por ENCIMA del ombligo
const FRAME_WIDTH_BONES = ["LeftArm", "RightArm"];
const FRAME_WIDTH_MARGIN = 0.07;      // a cada lado del ancho de hombros
const CAMERA_DISTANCE_PADDING = 1.03; // aire mínimo extra (el anclado arriba ya evita recortes)

// ---------- Lip-sync ----------
// edge-tts (el TTS del backend) solo entrega audio, sin marcas por viseme,
// así que esto NO es lip-sync fonético: es análisis del audio en tiempo
// real. app.js pasa a setMouthOpen() en cada frame DOS cosas: el volumen
// RMS (getAudioVolume(), 0..1, dominio del tiempo) y el AnalyserNode.
//
//   * La APERTURA se calcula desde el RMS. Es una señal lineal con buen
//     rango dinámico y silencios reales a 0. (Los bytes de
//     getByteFrequencyData están comprimidos en dB: se quedan planos y
//     altos durante toda la frase — si se usan para amplitud, la boca se
//     queda abierta fija. Solo sirven para RELACIONES entre bandas.)
//   * El TIMBRE (para la forma de labios) sí sale de las bandas del
//     analizador, como proporción, no como nivel absoluto.
//
// Diseño:
//   1. AGC: la apertura se normaliza por la media móvil de RMS "con voz",
//      así cambiar la voz del TTS (Jenny -> Andrew...) no vuelve a
//      descalibrar el lip-sync.
//   2. Suavizado por lerp: ningún valor se aplica directo; cada blendshape
//      persigue su objetivo con THREE.MathUtils.lerp(actual, obj,
//      MOUTH_SMOOTH) una vez por frame.
//   3. Combinación de visemas ARKit: jawOpen (tope bajo, JAW_MAX) +
//      mouthOpen de apoyo; mouthFunnel/mouthPucker según lo "oscuro" del
//      timbre (o/u/w) para dar volumen a los labios; mouthSmile/cheekPuff
//      muy sutiles para que la cara no quede rígida.
//   4. Filtro de ruido: bajo NOISE_THRESHOLD (RMS) es pausa -> todos los
//      objetivos a 0 y el lerp cierra la boca suave.

// Blendshapes de boca que este módulo controla (sobreescribe cada frame lo
// que la animación idle hubiera dejado en ellos).
const MOUTH_SHAPES = ["jawOpen", "mouthOpen", "mouthFunnel", "mouthPucker", "mouthSmile", "cheekPuff"];

const MOUTH_SMOOTH = 0.3;       // pulido final por THREE.MathUtils.lerp (el envelope de abajo ya suaviza mucho)
const NOISE_THRESHOLD = 0.02;   // RMS por debajo del cual la boca cierra del todo (pausa real)
// El RMS crudo (ventana de ~6 ms) es muy nervioso frame a frame. Un
// seguidor de envolvente asimétrico lo convierte en la envolvente
// SILÁBICA (bultos de ~150 ms): sube rápido al empezar cada sílaba, baja
// algo más lento. Esto es lo que hace que la mandíbula "acompañe" el habla
// en vez de temblar o quedarse fija.
const ENV_ATTACK = 0.40;
const ENV_RELEASE = 0.13;
// AGC por media móvil de la envolvente "con voz": el objetivo de apertura
// se normaliza contra el volumen TÍPICO reciente, así cambiar la voz del
// TTS (Jenny -> Andrew...) no descalibra nada.
const SPEECH_AVG_RISE = 0.05;
const SPEECH_AVG_FALL = 0.015;
const SPEECH_AVG_MIN = 0.045;   // suelo de la media (evita amplificar ruido en silencio)
const AGC_HEADROOM = 1.9;       // media*HEADROOM = referencia; SOLO los picos silábicos la superan (abren del todo), el resto queda entreabierto
const REL_FLOOR = 0.25;         // norm < REL_FLOOR -> boca cerrada (da el movimiento silábico)
const OPEN_GAMMA = 1.3;         // curva sobre la apertura: baja los valores medios sin tocar los picos (menos "boca abierta fija")
const JAW_MAX = 0.42;           // apertura máxima de mandíbula en un pico (articula sin exagerar)
const MOUTH_OPEN_RATIO = 0.32;  // cuánto mouthOpen acompaña a jawOpen
const FUNNEL_MAX = 0.22;        // tope de mouthFunnel (labios hacia adelante)
const PUCKER_MAX = 0.15;        // tope de mouthPucker (labios fruncidos)
const SMILE_MAX = 0.08;         // tope de mouthSmile durante el habla (sutil)
const CHEEK_MAX = 0.04;         // tope de cheekPuff durante el habla (muy sutil)
const ROUND_FRONT_LO = 0.20;    // "frontness" <= LO -> labios totalmente redondeados
const ROUND_FRONT_HI = 0.62;    // "frontness" >= HI -> sin redondeo (labios neutros/estirados)

// Bandas de frecuencia para el TIMBRE (Hz). Solo se usan como proporción
// entre ellas (frontness), nunca como nivel de amplitud.
const BAND_LOW_HZ = [150, 1000];   // graves / F1
const BAND_MID_HZ = [1000, 2600];  // F2
const BAND_HIGH_HZ = [3000, 8000]; // fricativas / brillo

// ---------- Gestos de cuerpo (Mixamo) ----------
// Animaciones sueltas descargadas de Mixamo (mocap de cuerpo entero, no
// tocan blendshapes de boca: el lip-sync de arriba se sigue superponiendo
// encima sin conflicto). Idle es la pose de reposo/respirar, neutra y
// siempre igual (sin variantes que rompan la postura); talking1-3 son
// variaciones de gesto mientras el tutor habla: la primera se elige
// totalmente al azar y, si el turno dura más que un pase del gesto, van
// rotando a otra distinta de la
// que acaba de terminar (nunca se repite la inmediatamente anterior), ver
// pickTalkingAction/startTalkingAnimation/onGestureFinished. Sobre esto se
// monta además una sincronía con el RITMO real del habla (bloque de
// constantes "Sincronía de cuerpo con el habla" y updateBodySpeechSync más
// abajo): una pausa real en el audio suelta el gesto a la idle, y cada
// coma/punto/interrogación del texto puede forzar un cambio -- sin esto el
// gesto activo corría "a piñón fijo" hasta que su propio clip terminaba,
// sin mirar para nada si el tutor seguía hablando de verdad.
//
// Mixamo exporta los huesos con el prefijo "mixamorigN" (N crece cada vez
// que se reprocesa el mismo personaje subido a su auto-rigger) — CON o SIN
// ":" según cómo lo procese el exportador/loader; en los .fbx reales de
// este proyecto sale SIN ":" ("mixamorig7Hips", verificado parseando los 4
// .fbx con FBXLoader de verdad en Node: el nombre de pista real es
// "mixamorig7Hips.position", no "mixamorig7:Hips.position"). El esqueleto
// de este .glb (Avaturn, ya compatible con Mixamo) usa esos mismos nombres
// SIN el prefijo (Head, Hips, Spine...: verificado parseando el chunk JSON
// del .glb), así que basta con quitárselo a cada pista de la animación
// para que el AnimationMixer las case directamente con los huesos reales
// del modelo — no hace falta un retargeting completo (huesos/jerarquía/
// bind pose distintos). MIXAMO_PREFIX_RE contempla ambas variantes (con y
// sin ":") para no volver a romperse si un futuro re-export sí lo trae.
const GESTURE_IDLE_URL = "./avatar/Idle.fbx";
const GESTURE_TALKING_URLS = [
  "./avatar/talking1.fbx",
  "./avatar/talking2.fbx",
  "./avatar/talking3.fbx",
];
const GESTURE_CROSSFADE_SECONDS = 0.9; // crossfade largo y gradual: el cambio de postura debe leerse como fluido, no como un corte

// ---------- Sincronía de cuerpo con el habla ----------
// Antes, mientras el turno durase, el gesto de hablar corría "a piñón
// fijo": rotaba solo cuando un clip terminaba su propio pase, sin mirar
// para nada el audio ni el texto (el mismo gesto seguía sobre un silencio
// real, y no había ninguna reacción a comas/puntos/preguntas). Esto añade
// dos señales, combinadas en updateBodySpeechSync() más abajo:
//   1. Pausa real por volumen (createPauseTracker, en avatar-speech-sync.js):
//      un silencio sostenido en el audio real suelta el gesto y cruza a la
//      idle; al volver la voz, cruza de vuelta a un gesto de hablar.
//   2. Beats de puntuación del texto (computeTextBeats, mismo módulo): en
//      cada coma/punto/interrogación se fuerza un cambio de gesto (si se
//      sigue hablando) o se adelanta la detección de la pausa real (si es
//      una coma, donde forzar el cambio sería demasiado frecuente).
// Ambas son deliberadamente aproximadas -- no hay marcas de palabra del
// TTS -- así que están pensadas para dar variación con sentido, no
// precisión de vídeo doblado. Segunda pasada de calibración (el primer
// juego de valores reaccionaba demasiado y se sentía nervioso/artificial):
// ahora todo pesa hacia MENOS movimiento y MÁS gradual -- el avatar debe
// quedarse en una postura el tiempo suficiente para que se lea como
// natural, y solo soltarla en un silencio de verdad largo (una pausa real
// de fin de frase/turno), no en cualquier micro-hueco entre palabras.
// Conviene seguir afinando mirando el avatar real con TTS real
// (frontend/avatar3d-preview.html tiene un modo de prueba con texto+audio
// para esto, ver más abajo).
//
// Tercera pasada (2026-09-14): respuestas troceadas en varios segmentos de
// audio (ver holdSpeechGap más abajo) tenían un hueco de red/generación
// entre uno y el siguiente en el que app.js dejaba de tener nada que
// analizar -- antes eso se confundía con un fin de turno real (se soltaba
// el gesto a idle Y se elegía uno nuevo al azar en cuanto llegaba el
// siguiente trozo, un "corte" visible). holdSpeechGap() deja una señal de
// "sin nivel ahora mismo" que pasa por la MISMA histéresis de pausa de
// arriba, sin tocar isTalking: un hueco corto no se nota, uno largo de
// verdad sí suelta el gesto con el mismo crossfade suave de siempre.
const PAUSE_ENTER_SECONDS = 1.1;         // silencio sostenido para soltar el gesto y pasar a idle -- solo pausas largas de verdad
const PAUSE_ENTER_SOFT_SECONDS = 0.55;   // igual, pero justo tras un beat de puntuación (ahí SÍ se espera pausa) -- sigue siendo largo, no cualquier coma
const PAUSE_EXIT_SECONDS = 0.15;         // voz sostenida para confirmar que se ha vuelto a hablar (evita parpadeos)
const PAUSE_CROSSFADE_SECONDS = 0.7;     // crossfade de la pausa, también largo y suave (algo más corto que el normal: sigue siendo un hueco puntual)
const BEAT_SOFT_WINDOW_SECONDS = 0.7;    // cuánto dura el umbral corto tras cruzar un beat de puntuación (más que PAUSE_ENTER_SOFT_SECONDS, para que le dé tiempo a cumplirse)
const QUESTION_CROSSFADE_SECONDS = 0.75; // interrogación: crossfade un pelín más vivo que el normal, pero igual de suave (único proxy de "énfasis" sin gestos dedicados)
const GESTURE_MIN_SWITCH_MS = 3500;      // no cambiar de gesto de hablar más seguido que esto -- deja que cada postura se vea de verdad antes de la siguiente

// idle y los 3 talking son "compañeros" del mismo
// canal de cuerpo: en todo momento hay como mucho UNO entrando (fadeIn) y
// UNO saliendo (fadeOut), con la MISMA duración y arrancados en el mismo
// instante (ver crossFadeBody) — así sus pesos son literalmente
// complementarios (entra 0->1 mientras el otro va 1->0) y su suma es 1 en
// todo momento, por construcción, sin necesitar ningún cálculo ni ningún
// "peso mínimo" artificial.
//
// Esto sustituye al esquema anterior (una idle "base" siempre encendida a
// la que las demás se sumaban por encima con un peso mínimo aparte): ahí,
// al arrancar un gesto, el peso de la base y el del gesto entrante subían/
// bajaban con relojes distintos y la suma podía caer por debajo de 1 un
// instante — y three.js, cuando la suma de pesos de una propiedad no
// llega a 1, rellena el resto mezclando hacia el valor "original" cacheado
// de cada hueso (la bind pose / T-pose, ver PropertyMixer.apply() en el
// código fuente de three.js). Eso era el amago de T-pose que se veía al
// arrancar cualquier gesto. Con un crossfade simétrico entre pares eso ya
// no puede pasar.

// ---------- Estado del módulo ----------
let renderer = null;
let scene = null;
let camera = null;
let clock = null;
let mixer = null;
let rafHandle = null;
let resizeObserver = null;
let canvasEl = null;
let loadedRoot = null;

// Acciones de animación de cuerpo y máquina de estados de los gestos (ver
// bloque "Gestos de cuerpo" más abajo). actionIdle/talkingActions son
// todas PARES entre sí: currentBodyAction es la que está activa (o
// entrando) ahora mismo, siempre exactamente una — nunca null una vez
// montado el avatar (ver mountAvatar3D). actionFace es un canal aparte,
// solo blendshapes de cara (parpadeo/cejas/mirada del .glb horneado),
// siempre a peso 1, independiente de todo lo anterior.
let actionIdle = null;
let talkingActions = [];
let actionFace = null;
let currentBodyAction = null;
let currentGestureState = "idle"; // "idle" | "talking" | "talking_pause"
let isTalking = false;

// Sincronía de cuerpo con el habla (ver bloque de constantes de arriba).
// runningSeconds: reloj propio del módulo (suma de los dt del render loop),
// para el rate-limit de cambios de gesto (GESTURE_MIN_SWITCH_MS) — no se
// reinicia nunca, como clockSeconds en createPauseTracker.
let runningSeconds = 0;
let lastGestureSwitchAt = -Infinity;
let pausedFromAction = null; // gesto de hablar del que se venía al entrar en pausa (para no repetirlo al volver)
let pauseTracker = createPauseTracker({
  enterSeconds: PAUSE_ENTER_SECONDS,
  exitSeconds: PAUSE_EXIT_SECONDS,
  softEnterSeconds: PAUSE_ENTER_SOFT_SECONDS,
});
let pendingSpeechText = ""; // texto del segmento en curso, a la espera de conocer su duración real
let speechBeats = [];       // beats de puntuación del segmento en curso (ver computeTextBeats)
let speechBeatIndex = 0;    // siguiente beat pendiente de disparar

// morph targets de boca: name -> [{ mesh, index }] (recogidos en el load)
// y name -> valor suavizado actual (perseguido por lerp cada frame).
let mouthGroups = {};
let mouthCurrent = {};

// señal de audio
let externalMouthLevel = 0; // RMS 0..1 (getAudioVolume() en app.js)
let externalCurrentTime = null; // currentTime (s) del <audio> en curso, para los beats de puntuación
let analyser = null;
let freqBuf = null;
let analyserNyquist = 24000;
let levelEnv = 0;               // envolvente silábica del RMS (seguidor asimétrico)
let speechAvg = SPEECH_AVG_MIN; // media móvil de la envolvente "con voz" para el AGC

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Busca un blendshape por nombre en cualquier mesh del modelo (cara,
// dientes, lengua...) — varias mallas comparten el mismo nombre de shape y
// todas deben moverse a la vez.
function collectMorphTargets(root, morphName) {
  const targets = [];
  root.traverse((node) => {
    const dict = node.morphTargetDictionary;
    const influences = node.morphTargetInfluences;
    if (dict && influences && Object.prototype.hasOwnProperty.call(dict, morphName)) {
      targets.push({ mesh: node, index: dict[morphName] });
    }
  });
  return targets;
}

function applyGroup(group, value) {
  for (const { mesh, index } of group) mesh.morphTargetInfluences[index] = value;
}

function findBone(root, name) {
  return root.getObjectByName(name) || null;
}

// ---------- Cámara ----------
function frameCameraOnFullBody(root) {
  // Respaldo por si el rig no trae los huesos esperados: peor encuadre,
  // pero nunca deja al avatar sin cámara.
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const centerY = box.max.y - size.y * 0.16;
  const visibleHeight = size.y * 0.34;
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const distance = ((visibleHeight / 2) / Math.tan(vFov / 2)) * CAMERA_DISTANCE_PADDING;
  camera.position.set(center.x, centerY, center.z + distance);
  camera.lookAt(center.x, centerY, center.z);
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = distance * 50;
  camera.updateProjectionMatrix();
}

function frameCameraOnBust(root) {
  // Sin esto los huesos aún no tienen matrixWorld real y getWorldPosition()
  // devolvería la pose de bind (o basura).
  root.updateMatrixWorld(true);

  const top = findBone(root, FRAME_TOP_BONE);
  const bottom = findBone(root, FRAME_BOTTOM_BONE);
  const widthBones = FRAME_WIDTH_BONES.map((n) => findBone(root, n)).filter(Boolean);

  if (!top || !bottom || widthBones.length === 0) {
    frameCameraOnFullBody(root);
    return;
  }

  const wp = (b) => b.getWorldPosition(new THREE.Vector3());
  const topPos = wp(top);
  const bottomPos = wp(bottom);

  const frameTopY = topPos.y + FRAME_HAIR_MARGIN + FRAME_TOP_AIR; // borde superior deseado
  const bottomY = bottomPos.y + FRAME_BOTTOM_LIFT;                // borde inferior deseado
  const visibleHeight = frameTopY - bottomY;
  const halfWidth = Math.max(...widthBones.map((b) => Math.abs(wp(b).x))) + FRAME_WIDTH_MARGIN;

  const centerX = 0; // el modelo está centrado en X
  const centerZ = topPos.z;

  // Distancia que satisface TANTO el alto como el ancho pedidos para el
  // aspect ratio actual — la mayor de las dos, para no recortar en ningún
  // lado.
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const distanceForHeight = (visibleHeight / 2) / Math.tan(vFov / 2);
  const distanceForWidth = halfWidth / (Math.tan(vFov / 2) * camera.aspect);
  const distance = Math.max(distanceForHeight, distanceForWidth) * CAMERA_DISTANCE_PADDING;

  // Ancla el borde superior en frameTopY: lo que sobre por aspect ratio se
  // ve hacia ABAJO (más torso), no como más aire sobre la cabeza.
  const shownHalfHeight = distance * Math.tan(vFov / 2);
  const centerY = frameTopY - shownHalfHeight;

  camera.position.set(centerX, centerY, centerZ + distance);
  camera.lookAt(centerX, centerY, centerZ);
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = distance * 50;
  camera.updateProjectionMatrix();
}

function resize() {
  if (!renderer || !camera || !canvasEl) return;
  const { clientWidth, clientHeight } = canvasEl;
  if (!clientWidth || !clientHeight) return;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  // El encuadre depende del aspect ratio: reencuadrar en cada resize para
  // que rotar el móvil o redimensionar la ventana no recorte el plano.
  if (loadedRoot) frameCameraOnBust(loadedRoot);
}

// ---------- Análisis de audio ----------
function bandEnergy(loHz, hiHz) {
  const binHz = analyserNyquist / freqBuf.length;
  const lo = Math.max(1, Math.round(loHz / binHz));
  const hi = Math.min(freqBuf.length - 1, Math.round(hiHz / binHz));
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += freqBuf[i];
  return sum / (Math.max(1, hi - lo + 1) * 255); // media normalizada 0..1
}

// ---------- Boca (por frame) ----------
// Devuelve `speaking` (el mismo booleano que ya calculaba internamente para
// el AGC) para que renderLoop() se lo pase también a updateBodySpeechSync():
// una sola fuente de verdad sobre "hay voz real ahora mismo", compartida
// entre la boca y el cuerpo, en vez de calcularlo dos veces por separado.
function updateMouth() {
  // APERTURA: siempre desde el RMS (señal lineal, buen rango dinámico).
  const level = externalMouthLevel;

  // TIMBRE: proporción entre bandas del analizador (si lo hay). Nunca se
  // usa como nivel de amplitud — ver nota de cabecera.
  let frontness = 0.4;
  if (analyser && freqBuf) {
    analyser.getByteFrequencyData(freqBuf);
    const low = bandEnergy(...BAND_LOW_HZ);
    const mid = bandEnergy(...BAND_MID_HZ);
    const high = bandEnergy(...BAND_HIGH_HZ);
    frontness = clamp01((mid + high * 0.6) / (low + mid + high + 1e-4));
  }

  // Envolvente silábica: seguidor asimétrico sobre el RMS crudo.
  levelEnv += (level - levelEnv) * (level > levelEnv ? ENV_ATTACK : ENV_RELEASE);

  // AGC: media móvil de la envolvente mientras hay voz; el objetivo se
  // normaliza contra ella -> independiente del volumen absoluto de la voz.
  const speaking = levelEnv > NOISE_THRESHOLD;
  speechAvg += (speaking ? levelEnv - speechAvg : -speechAvg) * (speaking ? SPEECH_AVG_RISE : SPEECH_AVG_FALL);
  if (speechAvg < SPEECH_AVG_MIN) speechAvg = SPEECH_AVG_MIN;
  const norm = levelEnv / (speechAvg * AGC_HEADROOM);

  // Filtro de ruido + rango dinámico: bajo REL_FLOOR (o el umbral absoluto)
  // la boca cierra; el resto se estira a [0..1].
  const openAmount = speaking
    ? clamp01((norm - REL_FLOOR) / (1 - REL_FLOOR)) ** OPEN_GAMMA
    : 0;

  // redondeo de labios: máximo con sonido oscuro (frontness bajo), nada
  // con sonido brillante
  const roundness = speaking
    ? clamp01((ROUND_FRONT_HI - frontness) / (ROUND_FRONT_HI - ROUND_FRONT_LO))
    : 0;

  const targets = {
    jawOpen: openAmount * JAW_MAX,
    mouthOpen: openAmount * JAW_MAX * MOUTH_OPEN_RATIO,
    mouthFunnel: openAmount * roundness * FUNNEL_MAX,
    mouthPucker: openAmount * roundness * PUCKER_MAX,
    mouthSmile: openAmount * (0.45 + 0.55 * frontness) * SMILE_MAX,
    cheekPuff: openAmount * CHEEK_MAX,
  };

  // Suavizado: cada shape persigue su objetivo con lerp (nunca directo).
  for (const name of MOUTH_SHAPES) {
    mouthCurrent[name] = THREE.MathUtils.lerp(mouthCurrent[name], targets[name] || 0, MOUTH_SMOOTH);
    applyGroup(mouthGroups[name], mouthCurrent[name]);
  }

  return speaking;
}

// ---------- Gestos de cuerpo (Mixamo, por frame/evento) ----------
// El ":" es opcional a propósito: verificado con los 4 .fbx reales del
// proyecto (FBXLoader real en Node, sin mocks) que el nombre de pista viene
// como "mixamorig7Hips.position", SIN ":" — con el ":" obligatorio de una
// versión anterior de esta regex, NINGUNA pista casaba con ningún hueso del
// modelo y los gestos no movían nada (ver cabecera de la sección de arriba).
const MIXAMO_PREFIX_RE = /^mixamorig\d*:?/;

// Renombra las pistas de un AnimationClip de Mixamo in-place, quitando el
// prefijo "mixamorigN" (con o sin ":") de cada nombre de hueso (ver
// comentario de cabecera de esta sección). Sin esto el AnimationMixer no
// encuentra ningún hueso del modelo con ese nombre y la animación no mueve
// nada.
function remapMixamoTrackNames(clip) {
  for (const track of clip.tracks) {
    track.name = track.name.replace(MIXAMO_PREFIX_RE, "");
  }
}

// Quita del clip cualquier pista ".position" (verificado con los .fbx
// reales del proyecto: cada uno trae EXACTAMENTE una, "Hips.position" — el
// resto del rig son solo rotaciones, como es normal en mocap humanoide).
// Es obligatorio quitarla, no basta con renombrarla: Mixamo exporta la
// posición en centímetros SIN convertir (cadera ~97-99) mientras que este
// .glb usa metros (cadera ~0.98, estándar glTF). Como TODOS los clips de
// cuerpo (idle, talking1-3) pasan por aquí, ninguno de ellos
// trae ya pista de posición — así que da igual el orden en que se crucen,
// nunca puede colarse una en centímetros mezclada con otra en metros. Solo
// importa si alguna vez se vuelve a usar directamente un clip del .glb sin
// pasar por esta función (ver el fallback de mountAvatar3D si Idle.fbx no
// carga): mezclar ESE clip, con Hips.position en metros, con un gesto que
// no la tiene ya no arrastra la cadera fuera de la cámara — simplemente
// esa propiedad queda solo a cargo del clip del .glb mientras esté activo.
// Los gestos de Mixamo aquí son en el sitio (hablar/idle, no locomoción),
// así que perder su pista de traslación no quita nada real.
function stripPositionTracks(clip) {
  clip.tracks = clip.tracks.filter((track) => !track.name.endsWith(".position"));
}

// Carga un .fbx y devuelve su primer AnimationClip ya remapeado, o null si
// falla (fichero que falte, red caída, .fbx sin pistas...). Una animación
// de gesto rota o ausente nunca debe tumbar el avatar entero: en el peor
// caso se sigue solo con la idle horneada del .glb.
async function loadMixamoClip(fbxLoader, url) {
  try {
    const fbx = await fbxLoader.loadAsync(url);
    const clip = fbx.animations && fbx.animations[0];
    if (!clip) {
      console.warn(`avatar3d: ${url} no trae ninguna pista de animación`);
      return null;
    }
    remapMixamoTrackNames(clip);
    stripPositionTracks(clip);
    return clip;
  } catch (err) {
    console.error(`avatar3d: no se pudo cargar el gesto ${url}:`, err);
    return null;
  }
}

// zeroSlopeAtStart/zeroSlopeAtEnd controlan el suavizado cúbico que three
// aplica en el primer/último keyframe cuando la acción hace bucle: con los
// valores por defecto (true), el motor de interpolación puede "asomar"
// hacia el fotograma de bind pose de la propia pista al calcular la
// tangente en esos extremos. Se desactiva en todas las acciones de Mixamo
// (idle incluida) para que la interpolación se quede pegada a los valores
// reales de la pista, sin ese suavizado extra.
//
// IMPORTANTE — NO llamar aquí a action.setEffectiveWeight(0) para dejar
// "preparado" el peso a 0 antes del primer fadeIn (una versión anterior de
// esta función lo hacía, pensando en evitar que getEffectiveWeight()
// devolviera un 1 transitorio antes del primer mixer.update()). Es un
// error real: setEffectiveWeight(w) fija PARA SIEMPRE action.weight = w, y
// _updateWeight() de three.js calcula el peso de cada frame como
// `this.weight * interpolanteDelFade` — con action.weight clavado a 0,
// NINGÚN fadeIn() posterior puede volver a subir el peso nunca, por mucho
// que su interpolante llegue a 1: 0 * cualquier_cosa = 0. El gesto queda
// mudo (weight siempre 0) desde el instante en que se crea. No hace falta
// ningún ajuste aquí: nada en este módulo lee getEffectiveWeight() en
// producción (crossFadeBody solo llama fadeIn/fadeOut/play), así que el
// valor "transitorio" de fábrica (1, hasta el primer update()) es
// completamente inofensivo.
function configureGestureAction(action, { loopOnce = false } = {}) {
  action.zeroSlopeAtStart = false;
  action.zeroSlopeAtEnd = false;
  // clampWhenFinished: si la acción llega a su fin (solo aplica a
  // LoopOnce; en las de hablar/idle, LoopRepeat, no tiene efecto pero no
  // molesta) se queda congelada en su última pose en vez de "soltarse" y
  // dejar ese hueco a merced del valor cacheado de bind pose.
  action.clampWhenFinished = true;
  if (loopOnce) action.setLoop(THREE.LoopOnce, 1);
  return action;
}

// Carga las 3 variantes de hablar y prepara sus AnimationAction. Se llama
// una sola vez desde mountAvatar3D, después de que la idle (Idle.fbx o el
// fallback del .glb) ya esté lista y montada — nunca bloquea el primer
// frame ni el arranque del lip-sync. Cada animación que falle en su
// descarga se descarta sola (loadMixamoClip ya lo resuelve a null) sin
// afectar a las demás.
async function loadExtraGestureAnimations(fbxLoader) {
  const talkingClips = await Promise.all(
    GESTURE_TALKING_URLS.map((url) => loadMixamoClip(fbxLoader, url))
  );

  // Si hay más de un gesto de hablar disponible, cada uno se reproduce UNA
  // vez (loopOnce) y, al terminar, onGestureFinished elige otro distinto y
  // cruza a él (rotación continua mientras el tutor siga hablando, ver
  // startTalkingAnimation/onGestureFinished). Con uno solo cargado no hay
  // entre qué rotar: se deja en LoopRepeat como antes, sencillamente en
  // bucle hasta que se corte.
  talkingActions = talkingClips
    .filter(Boolean)
    .map((clip) => mixer.clipAction(clip));
  const rotateTalking = talkingActions.length > 1;
  talkingActions.forEach((action) => configureGestureAction(action, { loopOnce: rotateTalking }));
}

// Cruza el CUERPO (huesos) de la acción de cuerpo actual a `nextAction`
// (idle o un talking — todas PARES entre sí, ver el
// comentario de GESTURE_CROSSFADE_SECONDS): fadeOut explícito de la que
// estuviera activa y fadeIn explícito de la nueva, arrancados en el mismo
// instante y con la misma duración — nunca crossFadeTo, que en three.js
// hace fadeOut+fadeIn igual pero además puede warpear el timeScale, y aquí
// no hace falta. `restart`=true reinicia la animación desde el frame 0
// (el caso normal: cada disparo de un talking es un
// gesto nuevo; para volver a idle tampoco importa, es un bucle).
function crossFadeBody(nextAction, { duration = GESTURE_CROSSFADE_SECONDS, restart = true } = {}) {
  if (!nextAction || nextAction === currentBodyAction) return;
  const previous = currentBodyAction;
  if (restart) nextAction.reset();
  nextAction.enabled = true;
  nextAction.fadeIn(duration);
  nextAction.play();
  if (previous) previous.fadeOut(duration);
  currentBodyAction = nextAction;
}

// mixer "finished" dispara cuando un gesto de hablar (loopOnce, cuando hay
// >1 cargados) termina su único pase mientras se sigue hablando -> se
// cruza a otro gesto de hablar distinto, sin repetir el que acaba de
// terminar (rotación continua, ver pickTalkingAction). Si para entonces ya
// se dejó de hablar (currentGestureState ya no es "talking", ver
// stopTalkingAnimation) el evento llega tarde y no hace nada. (La idle,
// LoopRepeat, nunca dispara "finished".)
function onGestureFinished(event) {
  if (currentGestureState === "talking" && talkingActions.includes(event.action)) {
    rotateTalkingGesture(event.action);
  }
}

// Elige un gesto de hablar al azar, excluyendo opcionalmente `exclude` (si
// hay más de uno cargado) para no repetir esa animación inmediatamente:
//   - Selección inicial (startTalkingAnimation, sin `exclude`): totalmente
//     aleatoria entre los disponibles, sin memoria de turnos anteriores.
//   - Rotación mientras se sigue hablando (onGestureFinished, con
//     `exclude` = el gesto que acaba de terminar): aleatoria entre el
//     resto, para no repetir inmediatamente el que acaba de terminar.
function pickTalkingAction(exclude = null) {
  if (!talkingActions.length) return null;
  const choices = exclude && talkingActions.length > 1
    ? talkingActions.filter((a) => a !== exclude)
    : talkingActions;
  return choices[Math.floor(Math.random() * choices.length)];
}

// Cruza a un gesto de hablar distinto de `exclude` (normalmente el que
// acaba de estar activo) y registra el instante para el rate-limit de
// GESTURE_MIN_SWITCH_MS (ver switchTalkingGesture). Único punto que de
// verdad mete un talking* en el canal de cuerpo -- onGestureFinished,
// switchTalkingGesture y resumeTalkingGesture pasan todos por aquí para que
// el rate-limit cuente también los cambios "naturales" (clip que termina su
// pase), no solo los disparados por un beat de puntuación.
function rotateTalkingGesture(exclude, duration = GESTURE_CROSSFADE_SECONDS) {
  const next = pickTalkingAction(exclude);
  if (!next) return;
  lastGestureSwitchAt = runningSeconds;
  crossFadeBody(next, { duration });
}

// Se llama desde setMouthOpen() en cuanto arranca el audio de un segmento
// nuevo (ver el flag isTalking más abajo). Elige un gesto de hablar inicial
// completamente al azar (ver pickTalkingAction). A partir de ahí, mientras
// se siga hablando, onGestureFinished se encarga de rotar a un gesto
// distinto cada vez que el actual termina (crossfade de
// GESTURE_CROSSFADE_SECONDS, igual que aquí), y updateBodySpeechSync()
// reacciona además a pausas reales y a beats de puntuación del texto (ver
// bloque de constantes "Sincronía de cuerpo con el habla"). pauseTracker se
// reinicia aquí: un turno nuevo nunca debe arrancar ya "pausado" por resto
// de un turno anterior.
function startTalkingAnimation() {
  const next = pickTalkingAction();
  if (!next) return; // sin gestos de hablar cargados
  currentGestureState = "talking";
  lastGestureSwitchAt = runningSeconds;
  pausedFromAction = null;
  pauseTracker.reset();
  crossFadeBody(next);
}

// Se llama en cuanto la cola de audio se vacía del todo (setMouthOpen(0)
// sin analizador, ver más abajo): vuelve a la idle neutra. Puede llegar
// tanto desde "talking" (fin de turno mientras se hablaba con normalidad)
// como desde "talking_pause" (el turno terminó justo durante una pausa
// real a media frase) -- en ambos casos el destino es el mismo, la idle.
function stopTalkingAnimation() {
  if (currentGestureState !== "talking" && currentGestureState !== "talking_pause") return;
  currentGestureState = "idle";
  pausedFromAction = null;
  pauseTracker.reset();
  speechBeats = [];
  speechBeatIndex = 0;
  crossFadeBody(actionIdle);
}

// Cruza de vuelta a un gesto de hablar tras una pausa real (ver
// updateBodySpeechSync): excluye el que estaba activo justo antes de
// pausar (pausedFromAction) para que no sea siempre el mismo el que se vea
// al reanudar. Sin rate-limit: volver de una pausa real debe gesticular sí
// o sí, aunque haya habido un beat de puntuación hace poco.
function resumeTalkingGesture(duration) {
  rotateTalkingGesture(pausedFromAction, duration);
  pausedFromAction = null;
}

// Fuerza un cambio de gesto de hablar (disparado por un beat de puntuación
// mientras se sigue hablando con normalidad) respetando GESTURE_MIN_SWITCH_MS:
// si el cuerpo acaba de cambiar de gesto hace muy poco (otro beat, o un
// clip que terminó su pase justo entonces) este disparo simplemente no hace
// nada, para no encadenar dos crossfades pegados y que se vea "tembloroso".
function switchTalkingGesture(duration) {
  if (runningSeconds - lastGestureSwitchAt < GESTURE_MIN_SWITCH_MS / 1000) return;
  rotateTalkingGesture(currentBodyAction, duration);
}

// Se llama al cruzar cada beat de puntuación del segmento en curso (ver
// updateBodySpeechSync). Coma: no fuerza cambio de gesto -- sería demasiado
// frecuente y se vería nervioso -- solo adelanta la detección de la pausa
// real que suele venir justo después (requestSoftWindow). Punto/exclamación/
// interrogación: si se sigue hablando con normalidad, fuerza un cambio de
// gesto visible ahí mismo -- esto es lo que rompe la sensación de "piñón
// fijo" cuando un turno entero cabe en un único pase de talking*.fbx y antes
// no cambiaba de postura hasta que ese pase terminaba por su cuenta. Las
// preguntas usan un crossfade algo más vivo (QUESTION_CROSSFADE_SECONDS)
// como único proxy de "énfasis" disponible sin gestos dedicados de pregunta.
function onSpeechBeat(type) {
  pauseTracker.requestSoftWindow(BEAT_SOFT_WINDOW_SECONDS);
  if (type === "comma") return;
  if (currentGestureState === "talking") {
    switchTalkingGesture(type === "question" ? QUESTION_CROSSFADE_SECONDS : GESTURE_CROSSFADE_SECONDS);
  }
}

// ---------- Sincronía de cuerpo con el habla (por frame) ----------
// `speaking` es el mismo booleano que updateMouth() ya calculaba para el
// AGC del lip-sync (ver renderLoop): una sola fuente de verdad sobre si hay
// voz real ESTE frame, compartida entre boca y cuerpo.
function updateBodySpeechSync(speaking, dt) {
  if (!isTalking) return; // sin turno en curso, nada que sincronizar

  // 1) Beats de puntuación pendientes del segmento en curso (ver
  // beginSpeechSegment/setSpeechSegmentDuration): se disparan en cuanto el
  // audio real alcanza su instante calculado, en orden, sin poder saltarse
  // ninguno aunque un frame lento haga que currentTime avance de golpe por
  // encima de varios a la vez.
  if (Number.isFinite(externalCurrentTime)) {
    while (
      speechBeatIndex < speechBeats.length &&
      externalCurrentTime >= speechBeats[speechBeatIndex].time
    ) {
      onSpeechBeat(speechBeats[speechBeatIndex].type);
      speechBeatIndex++;
    }
  }

  // 2) Pausa real por volumen, con histéresis (ver createPauseTracker).
  const { paused, changed } = pauseTracker.update(dt, speaking);
  if (!changed) return;
  if (paused) {
    if (currentGestureState === "talking") {
      pausedFromAction = currentBodyAction;
      currentGestureState = "talking_pause";
      crossFadeBody(actionIdle, { duration: PAUSE_CROSSFADE_SECONDS });
    }
  } else if (currentGestureState === "talking_pause") {
    currentGestureState = "talking";
    resumeTalkingGesture(PAUSE_CROSSFADE_SECONDS);
  }
}

function renderLoop() {
  rafHandle = requestAnimationFrame(renderLoop);
  // dt acotado: al volver de una pestaña oculta el primer delta es enorme.
  const dt = Math.min(clock.getDelta(), 0.1);
  runningSeconds += dt;
  if (mixer) mixer.update(dt);
  const speaking = updateMouth();
  updateBodySpeechSync(speaking, dt);
  renderer.render(scene, camera);
}

// Pausa el render loop con la pestaña oculta (batería/CPU en el móvil del
// alumno); lo retoma solo si el montaje ya se completó.
function handleVisibilityChange() {
  if (document.hidden) {
    if (rafHandle) cancelAnimationFrame(rafHandle);
    rafHandle = null;
  } else if (renderer && !rafHandle) {
    clock.getDelta(); // descarta el hueco de tiempo con la pestaña oculta
    renderLoop();
  }
}

// Carga el modelo sobre el <canvas> dado y arranca el render loop. Puede
// rechazar (glb no encontrado, WebGL no disponible, CDN caído...); quien
// llame DEBE capturarlo y dejar el sistema 2D como está — este módulo
// nunca debe poder romper el chat.
export async function mountAvatar3D(canvas) {
  canvasEl = canvas;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  clock = new THREE.Clock();

  // Iluminación cálida a juego con la estética "pizarra de aula"
  // (marrón/crema), con la luz clave cerca del eje de cámara y algo alta
  // para que la cara se lea sin sombra dura bajo nariz/mentón.
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a2a12, 1.3));
  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(0.4, 1.35, 1.8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffe9c7, 0.6);
  fill.position.set(-1.1, 0.6, 1.0);
  scene.add(fill);

  // El .glb (14 MB) e Idle.fbx (~1.6 MB) se piden EN PARALELO: Idle.fbx es
  // ahora la idle real del cuerpo (ver cabecera del archivo) y debe estar
  // lista antes del primer frame para no dejar al avatar en pose de bind
  // mientras se descarga — pedirla en paralelo con el .glb, que de largo
  // tarda más, no añade apenas latencia sobre lo que ya había.
  const loader = new GLTFLoader();
  const fbxLoader = new FBXLoader();
  const [gltf, idleClip] = await Promise.all([
    loader.loadAsync(MODEL_URL),
    loadMixamoClip(fbxLoader, GESTURE_IDLE_URL),
  ]);
  const root = gltf.scene;
  scene.add(root);
  loadedRoot = root;

  // El culling por frustum de three.js calcula la esfera acotante de cada
  // SkinnedMesh a partir de la geometría SIN animar (pose de bind): si un
  // gesto lo posa fuera de esa esfera original (brazos muy levantados, la
  // cámara muy cerca...) three.js puede darlo por "fuera de cámara" y dejar
  // de dibujarlo aunque sí se vea. Desactivarlo cuesta poco (son 6 mallas)
  // y evita ese falso negativo — es la recomendación habitual de three.js
  // para personajes con esqueleto animado.
  root.traverse((child) => {
    if (child.isMesh) child.frustumCulled = false;
  });

  const hasBakedAnimation = !!(gltf.animations && gltf.animations.length);

  if (idleClip || hasBakedAnimation) {
    mixer = new THREE.AnimationMixer(root);

    if (idleClip) {
      actionIdle = configureGestureAction(mixer.clipAction(idleClip));
    } else {
      // Idle.fbx no se pudo cargar (red, archivo movido...): fallback al
      // comportamiento anterior, la idle horneada COMPLETA del .glb
      // (cuerpo + cara), para no dejar al avatar en pose de bind.
      actionIdle = mixer.clipAction(gltf.animations[0]);
    }
    actionIdle.play();
    currentBodyAction = actionIdle;

    // Vida de cara (parpadeo, cejas, micro-mirada): solo si SÍ se usó
    // Idle.fbx para el cuerpo — si no (fallback de arriba), actionIdle YA
    // es el clip completo del .glb con la cara incluida y no hace falta
    // un canal aparte. Se clona el clip horneado y se descarta todo lo
    // que no sea morphTargetInfluences: así este canal nunca toca ningún
    // hueso (cero conflicto con idle/talking) y se reproduce
    // siempre a peso 1, para siempre, sin fadeIn/fadeOut ni relación con
    // la máquina de estados de los gestos de cuerpo.
    if (idleClip && hasBakedAnimation) {
      const faceClip = gltf.animations[0].clone();
      faceClip.tracks = faceClip.tracks.filter((t) => t.name.endsWith(".morphTargetInfluences"));
      if (faceClip.tracks.length) {
        actionFace = mixer.clipAction(faceClip);
        actionFace.play();
      }
    }

    mixer.update(0); // aplica el frame 0 antes de encuadrar
    mixer.addEventListener("finished", onGestureFinished);
    // SIN await: los 3 talking no deben retrasar ni el primer frame
    // renderizado ni el arranque del lip-sync, que no dependen de ellos. Se
    // activan solos en cuanto terminan de llegar; si tardan o fallan, el
    // avatar mientras tanto (o para siempre, si fallan) se ve exactamente
    // igual: solo con la idle en bucle.
    loadExtraGestureAnimations(fbxLoader).catch((err) => {
      console.error("avatar3d: fallo cargando las animaciones de gesto:", err);
    });
  }

  mouthGroups = {};
  mouthCurrent = {};
  for (const name of MOUTH_SHAPES) {
    mouthGroups[name] = collectMorphTargets(root, name);
    mouthCurrent[name] = 0;
  }

  // resize() ya reencuadra internamente ahora que loadedRoot está
  // asignado, así que una sola llamada fija tamaño, aspect y encuadre.
  resize();

  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  renderLoop();
  // Nota: los talking (loadExtraGestureAnimations) se cargan en segundo
  // plano SIN esperar aquí (ver más arriba), así que en este punto todavía
  // pueden no estar listos — no se incluyen en este objeto de diagnóstico
  // para no reportar falsos negativos por una carrera de red.
  return {
    mouthTargetsFound: Object.fromEntries(
      MOUTH_SHAPES.map((n) => [n, mouthGroups[n].length])
    ),
    hasIdleAnimation: !!mixer,
  };
}

// Llamar en cada frame del monitor de volumen de app.js.
//  - level: volumen real 0..1 (getAudioVolume()); solo se usa si no hay
//    analizador.
//  - analyserNode: el AnalyserNode del <audio> de TTS. Con él, el lip-sync
//    hace su propio análisis por bandas (ver updateMouth). Pasar null (o
//    nada) al parar el audio para que la boca cierre.
//  - currentTimeSeconds: currentTime (s) del <audio> que está sonando ahora
//    mismo, para disparar los beats de puntuación de ESE segmento en el
//    instante correcto (ver updateBodySpeechSync/beginSpeechSegment). Se
//    ignora si no es un número finito.
export function setMouthOpen(level, analyserNode = null, currentTimeSeconds = null) {
  externalMouthLevel = Math.max(0, level || 0);
  externalCurrentTime = Number.isFinite(currentTimeSeconds) ? currentTimeSeconds : null;
  if (analyserNode) {
    if (analyserNode !== analyser) {
      analyser = analyserNode;
      freqBuf = new Uint8Array(analyser.frequencyBinCount);
      analyserNyquist = (analyser.context && analyser.context.sampleRate ? analyser.context.sampleRate : 48000) / 2;
    }
    // app.js pasa un analizador mientras haya CUALQUIER audio de la cola
    // sonando (incluso al encadenar varios segmentos de una misma
    // respuesta): es la señal de "está hablando" para el gesto de cuerpo.
    if (!isTalking) {
      isTalking = true;
      startTalkingAnimation();
    }
  } else {
    analyser = null;
    externalCurrentTime = null;
    // app.js solo llama a setMouthOpen(0) SIN analizador cuando la cola de
    // audio se ha vaciado del todo (forceIdle=true): fin real del turno.
    if (isTalking) {
      isTalking = false;
      stopTalkingAnimation();
    }
  }
}

// Se llama desde app.js cuando la cola de audio se queda momentáneamente
// vacía PERO el backend todavía no ha marcado la respuesta como completa
// (más fragmentos en camino: solo hay un hueco de red/generación entre
// ellos -- ver responseStreaming/advance() en playNextInQueue, app.js). A
// DIFERENCIA de setMouthOpen(0) (fin de turno real), esto NO toca
// `isTalking` ni suelta el gesto de hablar: solo deja sin nivel/analizador/
// referencia temporal este instante, exactamente como una pausa real
// DENTRO de un mismo segmento (ver updateMouth/updateBodySpeechSync). La
// boca cierra sola por el decaimiento normal del envelope; el cuerpo solo
// suelta el gesto a la idle si el hueco se alarga más que
// PAUSE_ENTER_SECONDS (con el mismo crossfade largo y suave que cualquier
// otra pausa) -- así un hueco corto entre fragmentos no se nota, y si el
// siguiente segmento llega antes de eso, el próximo setMouthOpen(...) con
// analizador real retoma sin ningún salto ni "reseteo" perceptible.
export function holdSpeechGap() {
  externalMouthLevel = 0;
  externalCurrentTime = null;
  analyser = null;
}

// Se llama desde app.js justo antes de reproducir un segmento de audio
// nuevo (ver playNextInQueue), con el TEXTO de ese segmento -- se conoce de
// entrada, por WebSocket, antes de que el audio siquiera empiece a sonar.
// Solo guarda el texto y limpia los beats del segmento anterior: los beats
// de verdad no se calculan hasta setSpeechSegmentDuration(), porque
// dependen de la duración REAL del audio, que el navegador tarda un
// instante en conocer (evento "loadedmetadata").
export function beginSpeechSegment(text) {
  pendingSpeechText = typeof text === "string" ? text : "";
  speechBeats = [];
  speechBeatIndex = 0;
}

// Se llama en cuanto app.js conoce la duración real del audio del segmento
// en curso (audio.duration, tras "loadedmetadata"). Si nunca llega a
// llamarse (audio raro, navegador que no dispara el evento a tiempo) el
// segmento sencillamente no tiene beats de puntuación -- el lip-sync y la
// pausa por volumen real (la señal principal) siguen funcionando igual; los
// beats de texto son solo un afinado adicional, nunca la única señal.
export function setSpeechSegmentDuration(durationSeconds) {
  speechBeats = computeTextBeats(pendingSpeechText, durationSeconds);
  speechBeatIndex = 0;
}

// Solo para pruebas/depuración (frontend/avatar3d-preview.html la usa para
// pintar un log de gestos): instantánea de solo-lectura del estado de la
// sincronía de cuerpo con el habla. app.js en producción no la llama.
export function getSpeechSyncDebugState() {
  return {
    gestureState: currentGestureState,
    isTalking,
    paused: pauseTracker.paused,
    beatsTotal: speechBeats.length,
    beatsFired: speechBeatIndex,
  };
}

export function unmountAvatar3D() {
  if (rafHandle) cancelAnimationFrame(rafHandle);
  rafHandle = null;
  if (resizeObserver) resizeObserver.disconnect();
  resizeObserver = null;
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  if (mixer) {
    mixer.removeEventListener("finished", onGestureFinished);
    mixer.stopAllAction();
  }
  mixer = null;
  actionIdle = null;
  talkingActions = [];
  actionFace = null;
  currentBodyAction = null;
  currentGestureState = "idle";
  isTalking = false;
  runningSeconds = 0;
  lastGestureSwitchAt = -Infinity;
  pausedFromAction = null;
  pauseTracker.reset();
  pendingSpeechText = "";
  speechBeats = [];
  speechBeatIndex = 0;
  if (renderer) renderer.dispose();
  renderer = null;
  scene = null;
  camera = null;
  clock = null;
  mouthGroups = {};
  mouthCurrent = {};
  externalMouthLevel = 0;
  externalCurrentTime = null;
  analyser = null;
  freqBuf = null;
  levelEnv = 0;
  speechAvg = SPEECH_AVG_MIN;
  canvasEl = null;
  loadedRoot = null;
}
