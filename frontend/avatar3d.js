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
// DIFERENCIA CLAVE con los avatares anteriores: el .glb TRAE una animación
// idle completa de ~8 s (`avaturn_animation`) que ya anima el cuerpo entero
// y la cara — parpadeo, micro-miradas, cejas, respiración por la columna,
// balanceo sutil de brazos y dedos. Se reproduce en bucle con un
// `AnimationMixer` y el lip-sync se SUPERPONE encima: después de cada
// `mixer.update()` se sobreescriben los influences de la boca. Por eso este
// módulo ya NO hace parpadeo, mirada, respiración ni pose de brazos por
// código — todo eso viene horneado. Comprobado en el .glb que la animación
// mueve `jawOpen` como mucho a 0.04 (y ningún `viseme_*`), así que
// sobreescribir esos shapes no pelea con nada perceptible, y que `Hips` no
// se traslada (idle en el sitio, no se va de cámara).
//
// Sin compresión meshopt/draco (solo la extensión KHR_materials_ior, que
// three soporta de serie): GLTFLoader lo carga tal cual, sin decoder extra.
import * as THREE from "three";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

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

// morph targets de boca: name -> [{ mesh, index }] (recogidos en el load)
// y name -> valor suavizado actual (perseguido por lerp cada frame).
let mouthGroups = {};
let mouthCurrent = {};

// señal de audio
let externalMouthLevel = 0; // RMS 0..1 (getAudioVolume() en app.js)
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
}

function renderLoop() {
  rafHandle = requestAnimationFrame(renderLoop);
  // dt acotado: al volver de una pestaña oculta el primer delta es enorme.
  const dt = Math.min(clock.getDelta(), 0.1);
  if (mixer) mixer.update(dt);
  updateMouth();
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

  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(MODEL_URL);
  const root = gltf.scene;
  scene.add(root);
  loadedRoot = root;

  // Animación idle horneada: en bucle. Si el .glb no trajera ninguna, el
  // avatar se queda quieto en pose de bind (fallback aceptable).
  if (gltf.animations && gltf.animations.length) {
    mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(gltf.animations[0]);
    action.play();
    mixer.update(0); // aplica el frame 0 antes de encuadrar
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
export function setMouthOpen(level, analyserNode = null) {
  externalMouthLevel = Math.max(0, level || 0);
  if (analyserNode) {
    if (analyserNode !== analyser) {
      analyser = analyserNode;
      freqBuf = new Uint8Array(analyser.frequencyBinCount);
      analyserNyquist = (analyser.context && analyser.context.sampleRate ? analyser.context.sampleRate : 48000) / 2;
    }
  } else {
    analyser = null;
  }
}

export function unmountAvatar3D() {
  if (rafHandle) cancelAnimationFrame(rafHandle);
  rafHandle = null;
  if (resizeObserver) resizeObserver.disconnect();
  resizeObserver = null;
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  if (mixer) mixer.stopAllAction();
  mixer = null;
  if (renderer) renderer.dispose();
  renderer = null;
  scene = null;
  camera = null;
  clock = null;
  mouthGroups = {};
  mouthCurrent = {};
  externalMouthLevel = 0;
  analyser = null;
  freqBuf = null;
  levelEnv = 0;
  speechAvg = SPEECH_AVG_MIN;
  canvasEl = null;
  loadedRoot = null;
}
