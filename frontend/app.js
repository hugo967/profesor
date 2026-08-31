// Tutor de Inglés MVP — lógica del frontend

// ---------- Configuración ----------
// Sesión leída EXCLUSIVAMENTE de localStorage, rellenada por el login real
// (usuario + contraseña) en POST /api/auth/login — ver más abajo. No se lee
// ningún parámetro de la URL para autoiniciar sesión: sin sesión guardada,
// se muestra siempre la pantalla de login.
let username = localStorage.getItem('username') || '';
let roleParam = (localStorage.getItem('role_param') || '').toLowerCase();

// El rol de profesor viene del backend (Supabase) en el momento del login
// real, nunca se infiere del nombre de usuario.
let isTeacher = roleParam === "teacher";
window.isTeacher = isTeacher;

// ---------- URL del backend (API + WebSocket) ----------
// El backend (FastAPI) puede servirse desde el mismo origen que este
// frontend (local con `uvicorn`, o desplegado en Render sirviendo también
// los estáticos) o desde un origen distinto (frontend en GitHub Pages,
// backend en Render). Se resuelve una única vez aquí y se reutiliza tanto
// para las peticiones REST (apiUrl) como para el WebSocket (WS_URL).
//
// ⚠️ Si el frontend se aloja en GitHub Pages, sustituye este valor por la
// URL pública real del servicio de Render (Settings → General → URL).
const RENDER_BACKEND_URL = "https://tutor-ingles-backend.onrender.com";

function detectApiBaseUrl() {
  // Vía de escape para pruebas/depuración: fuerza manualmente el backend
  // sin tocar código, p. ej. desde la consola del navegador:
  //   localStorage.setItem('backend_url', 'https://mi-backend.onrender.com')
  const override = localStorage.getItem("backend_url");
  if (override) return override.replace(/\/+$/, "");

  const host = window.location.hostname;

  // GitHub Pages: el frontend vive en otro origen que el backend de Render,
  // así que no se puede "derivar" la URL — hay que tenerla configurada.
  if (host.endsWith("github.io")) return RENDER_BACKEND_URL;

  // Local (uvicorn sirviendo frontend+backend en el mismo puerto) o
  // desplegado en Render sirviendo ambos desde el mismo origen: usar
  // siempre window.location.origin.
  return window.location.origin;
}

const API_BASE_URL = detectApiBaseUrl();

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}
// Expuesto en window para que el <script> inline de index.html (no es un
// módulo, así que no puede hacer `import`/`export` con este archivo) pueda
// construir rutas de API con la misma URL base de Render, en vez de hacer
// fetch a rutas relativas como '/api/progress' (que en GitHub Pages
// resuelven contra el propio dominio de GitHub Pages y devuelven 404).
window.apiUrl = apiUrl;

const wsProtocol = API_BASE_URL.startsWith("https:") ? "wss:" : "ws:";
const wsHost = API_BASE_URL.replace(/^https?:\/\//, "");
const WS_URL = username ? `${wsProtocol}//${wsHost}/ws/chat?username=${encodeURIComponent(username)}` : `${wsProtocol}//${wsHost}/ws/chat`;

// ============================================================
// Login por usuario y contraseña (sin autorregistro)
// ============================================================
// Vía única de acceso a la app (ver #login-screen en index.html): el
// alumno/profesor escribe su usuario y contraseña; el backend valida el
// hash bcrypt y, si no coincide con ninguna cuenta, responde 401 con un
// mensaje genérico. No hay forma de crear una cuenta desde aquí: las
// cuentas de alumno las da de alta el profesor desde su panel (Vista
// Profesor → Crear Nuevo Alumno, ver más abajo).
const loginScreenEl = document.getElementById("login-screen");
const loginFormEl = document.getElementById("login-form");
const loginUsernameInputEl = document.getElementById("login-username-input");
const loginPasswordInputEl = document.getElementById("login-password-input");
const loginFeedbackEl = document.getElementById("login-feedback");
const loginSubmitBtnEl = document.getElementById("login-submit-btn");

function hideLoginScreen() {
  if (loginScreenEl) loginScreenEl.classList.add("hidden");
}

function showLoginScreen() {
  if (loginScreenEl) loginScreenEl.classList.remove("hidden");
}

if (username) {
  hideLoginScreen();
} else {
  showLoginScreen();
}

async function attemptLogin(candidateUsername, password) {
  // Ruta relativa (sin protocolo/host fijo): funciona igual en local y
  // desplegado en Render, sea cual sea el dominio.
  const res = await fetch(apiUrl("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: candidateUsername, password }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function completeLogin(data) {
  localStorage.setItem("username", data.username);
  localStorage.setItem("user_id", data.user_id);
  localStorage.setItem("role_param", data.role === "teacher" ? "teacher" : "");
  // Recarga para que todo el módulo (WS_URL, isTeacher, etc., que son
  // const calculadas una sola vez arriba) se reevalúe desde cero ya con la
  // sesión guardada.
  location.reload();
}

if (loginFormEl) {
  loginFormEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const candidateUsername = (loginUsernameInputEl.value || "").trim();
    const password = loginPasswordInputEl ? loginPasswordInputEl.value : "";
    if (!candidateUsername || !password) return;

    if (loginFeedbackEl) loginFeedbackEl.textContent = "Comprobando…";
    if (loginSubmitBtnEl) loginSubmitBtnEl.disabled = true;

    try {
      const { ok, data } = await attemptLogin(candidateUsername, password);

      if (ok) {
        completeLogin(data);
        return;
      }

      throw new Error(data.detail || "Usuario o contraseña incorrectos");
    } catch (err) {
      if (loginFeedbackEl) {
        loginFeedbackEl.textContent = "⚠️ " + err.message;
        loginFeedbackEl.style.color = "#b23b3b";
      }
    } finally {
      if (loginSubmitBtnEl) loginSubmitBtnEl.disabled = false;
    }
  });
}

// ============================================================
// Cerrar sesión
// ============================================================
function logout() {
  localStorage.removeItem("username");
  localStorage.removeItem("user_id");
  localStorage.removeItem("role_param");
  // Si había una pestaña del modal abierta (#progreso, #retos, ...), se
  // limpia el hash sin tocar el pathname antes de recargar. Así la
  // recarga siempre respeta la subruta actual del sitio (p. ej.
  // /profesor/frontend/ en GitHub Pages) en vez de arriesgarse a recargar
  // una URL con una ruta absoluta que ya no existiera -> 404.
  if (location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
  }
  location.reload();
}
window.logout = logout;

const logoutBtnEl = document.getElementById("logout-btn");
if (logoutBtnEl) {
  logoutBtnEl.addEventListener("click", logout);
}

// ---------- Estado ----------
let socket = null;
let recognition = null;

let listening = false;
// El motor de voz de Chrome/Edge corta la escucha por su cuenta tras unos
// segundos de silencio AUNQUE recognition.continuous sea true. Cuando eso
// pasa mientras el alumno sigue en modo escucha (`listening` = true y sin
// haber pulsado para parar), reanudamos el micro en recognition.onend en
// vez de enviar. `manualStop` marca la única salida válida: que el alumno
// vuelva a pulsar el botón del micrófono.
let manualStop = false;
// Transcripción acumulada durante una sesión de escucha continua del
// micrófono (ver initRecognition): se rellena mientras `listening` es
// true (a través de posibles reanudaciones automáticas) y se envía entera
// de una vez SOLO cuando el alumno para manualmente, no frase a frase.
let voiceTranscript = "";
// Motor de voz principal: grabar el audio en el navegador (MediaRecorder)
// y transcribirlo en el backend con Whisper vía Groq (POST /api/transcribe).
// Es mucho más preciso y consistente entre navegadores que la Web Speech
// API, que queda solo como fallback (ver initRecognition / canRecordAudio).
// El navegador puede grabar audio (getUserMedia + MediaRecorder). Si no,
// se usa directamente la Web Speech API.
const canRecordAudio = !!(
  navigator.mediaDevices &&
  navigator.mediaDevices.getUserMedia &&
  window.MediaRecorder
);
let mediaRecorder = null;
let micStream = null;
let recordedChunks = [];
let recording = false;
let startingRecording = false;
let transcribing = false;
let recordStopTimer = null;
// Si /api/transcribe falla, se marca y el micrófono pasa a usar la Web
// Speech API del navegador el resto de la sesión.
let serverTranscriptionDown = false;
// Parada de seguridad de la grabación: un clip larguísimo casi siempre es
// que el alumno se olvidó de pulsar para enviar.
const MAX_RECORDING_MS = 45000;
// Última frase del tutor: se manda como sesgo a /api/transcribe para
// orientar a Whisper hacia el vocabulario que toca.
let lastTutorMessage = "";
let reconnectTimer = null;
let user_id = null;
let currentSessionId = null;
window.currentSessionId = null;
let activeExercise = null;
window.activeExercise = null;
let activeMoodleExercise = null;
window.activeMoodleExercise = null;
const currentConfig = { level: "", context: "" };

// ---------- DOM ----------
const chatEl = document.getElementById("chat");
const statusEl = document.getElementById("status");
const speakBtn = document.getElementById("speak-btn");
const btnLabel = document.getElementById("btn-label");
const avatarIdleEl = document.getElementById("avatar-idle");
const avatarTalkingEl = document.getElementById("avatar-talking");
const textInput = document.getElementById("text-input");
const sendBtn = document.getElementById("send-btn");
const levelSelect = document.getElementById("level-select");
const levelTestBtn = document.getElementById("level-test-btn");
const contextSelect = document.getElementById("context-select");
const testModal = document.getElementById("test-modal");
const testQuestionsEl = document.getElementById("test-questions");
const testCancelBtn = document.getElementById("test-cancel");
const testSubmitBtn = document.getElementById("test-submit");
const helpBtn = document.getElementById("help-btn");
const helpModal = document.getElementById("help-modal");
const helpCloseBtn = document.getElementById("help-close");
const newChatBtn = document.getElementById("new-chat-btn");

// ============================================================
// Avatar 2D (imagen fija en reposo / vídeo en bucle al hablar)
// ============================================================
// Ligeramente por debajo de 1.0: a velocidad normal los gestos del vídeo
// se veían demasiado rápidos/nerviosos: se ven más naturales y pausados
// un poco ralentizados.
const AVATAR_VIDEO_PLAYBACK_RATE = 0.6;
if (avatarTalkingEl) avatarTalkingEl.playbackRate = AVATAR_VIDEO_PLAYBACK_RATE;

// Volumen (0-1, salida de getAudioVolume()) por debajo del cual se
// considera que la profesora no está vocalizando en ese instante —
// pausas y silencios dentro del propio audio, aunque el <audio> siga
// técnicamente en reproducción. Mismo umbral ya calibrado antes para
// distinguir "boca cerrada" del volumen real de la voz.
const AVATAR_SILENCE_THRESHOLD = 0.05;

let avatarSpeaking = false;

// Cambia el elemento visible (vídeo/imagen) SIN tocar nunca currentTime:
// al detectar silencio, avatarTalkingEl.pause() lo deja congelado en el
// fotograma exacto en el que estaba; al retomar la voz, play() continúa
// desde ahí. Así, aunque la profesora haga varias pausas al hablar, se ve
// como una única toma continua en vez de un vídeo que se reinicia cada
// vez. El único sitio que reinicia currentTime a 0 es el "ended" del
// audio (ver playAudio), que marca el final real de la frase.
function setAvatarSpeaking(speaking) {
  if (speaking === avatarSpeaking) return;
  avatarSpeaking = speaking;
  if (speaking) {
    if (avatarIdleEl) avatarIdleEl.classList.add("hidden");
    if (avatarTalkingEl) {
      avatarTalkingEl.classList.remove("hidden");
      avatarTalkingEl.playbackRate = AVATAR_VIDEO_PLAYBACK_RATE;
      avatarTalkingEl.play().catch((err) => console.error("No se pudo reproducir el vídeo del avatar:", err));
    }
  } else {
    if (avatarTalkingEl) {
      avatarTalkingEl.pause();
      avatarTalkingEl.classList.add("hidden");
    }
    if (avatarIdleEl) avatarIdleEl.classList.remove("hidden");
  }
}

// ---- Web Audio API: mide el volumen real del audio en reproducción ----
let audioContext = null;
let analyser = null;
let analyserData = null;
let volumeMonitorHandle = null;

function ensureAudioContext() {
  if (!audioContext) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioContext = new AC();
  }
  if (audioContext && audioContext.state === "suspended") {
    audioContext.resume();
  }
  return audioContext;
}

function getAudioVolume() {
  if (!analyser || !analyserData) return 0;
  analyser.getByteTimeDomainData(analyserData);
  let sum = 0;
  for (let i = 0; i < analyserData.length; i++) {
    const v = (analyserData[i] - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / analyserData.length) * 2.4);
}

// Conecta un <audio> concreto al analizador. Solo se puede llamar una vez
// por elemento (createMediaElementSource lanza si se repite), pero
// playAudio() crea un Audio() nuevo en cada mensaje, así que nunca se
// reutiliza. Hay que reconectar el analyser a destination explícitamente:
// en cuanto el audio pasa por el grafo de Web Audio, deja de sonar por su
// cuenta si no se enruta de nuevo hasta la salida.
function connectAnalyser(audio) {
  const ctx = ensureAudioContext();
  if (!ctx) return false;
  try {
    const source = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserData = new Uint8Array(analyser.fftSize);
    source.connect(analyser);
    analyser.connect(ctx.destination);
    return true;
  } catch (e) {
    console.error("No se pudo analizar el audio:", e);
    analyser = null;
    analyserData = null;
    return false;
  }
}

// Un tick por frame (~16 ms a 60 Hz) es de sobra para que el avatar
// reaccione "al instante" a la forma de onda real, sin necesidad de un
// setInterval aparte.
function monitorVolume() {
  setAvatarSpeaking(getAudioVolume() >= AVATAR_SILENCE_THRESHOLD);
  volumeMonitorHandle = requestAnimationFrame(monitorVolume);
}

function startVolumeMonitor() {
  if (volumeMonitorHandle) return;
  monitorVolume();
}

// forceIdle=false se usa solo al interrumpir un audio con uno nuevo: corta
// la monitorización del audio viejo sin forzar la imagen fija, para que si
// el nuevo audio ya está hablando no haya un parpadeo de por medio.
function stopVolumeMonitor({ forceIdle = true } = {}) {
  if (volumeMonitorHandle) {
    cancelAnimationFrame(volumeMonitorHandle);
    volumeMonitorHandle = null;
  }
  analyser = null;
  analyserData = null;
  if (forceIdle) setAvatarSpeaking(false);
}

// ============================================================
// Chat
// ============================================================
function addMessage(role, text) {
  if (!chatEl) return;
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.textContent = text;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addSystem(text) {
  if (!chatEl) return;
  const div = document.createElement("div");
  div.className = "msg sys";
  div.textContent = text;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

// ============================================================
// Toast flotante (avisos breves que no deben ocupar sitio fijo en la
// pizarra, p. ej. "Configuración aplicada": ver "config_ok" más abajo)
// ============================================================
let toastEl = null;
let toastHideTimer = null;
let toastRemoveTimer = null;

function showToast(text, duration = 2000) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    document.body.appendChild(toastEl);
  }
  clearTimeout(toastHideTimer);
  clearTimeout(toastRemoveTimer);

  toastEl.textContent = text;
  // Fuerza un reflow antes de volver a añadir "visible": si el toast
  // anterior seguía desvaneciéndose, sin esto el navegador podría fusionar
  // el remove+add de la clase y no reiniciar la transición de entrada.
  toastEl.classList.remove("visible");
  void toastEl.offsetWidth;
  toastEl.classList.add("visible");

  toastHideTimer = setTimeout(() => {
    toastEl.classList.remove("visible");
    // Espera a que termine la transición de salida (ver CSS) antes de
    // quitarlo del DOM del todo.
    toastRemoveTimer = setTimeout(() => {
      if (toastEl) {
        toastEl.remove();
        toastEl = null;
      }
    }, 300);
  }, duration);
}

let typingIndicator = null;

function showTypingIndicator() {
  if (typingIndicator || !chatEl) return;
  typingIndicator = document.createElement("div");
  typingIndicator.className = "msg tutor typing-indicator";
  typingIndicator.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  chatEl.appendChild(typingIndicator);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function hideTypingIndicator() {
  if (typingIndicator) {
    typingIndicator.remove();
    typingIndicator = null;
  }
}

// ============================================================
// Indicador de carga del tema proactivo (Gramática/Vocabulario/
// Conversación libre)
// ============================================================
// Se muestra desde que el backend avisa (mensaje {"type":
// "proactive_loading"}) de que va a generar el primer mensaje de
// iniciativa, hasta que ese mensaje llega completo (texto + audio) por el
// canal normal, o hasta que salte el aviso de error/timeout: bloquea el
// input mientras tanto para que el alumno no pueda escribir a mitad de la
// carga y acabe cruzando los hilos con la respuesta que está por llegar.
let proactiveLoadingEl = null;
let proactiveLoadingTimeout = null;

function setInputLocked(locked) {
  if (textInput) textInput.disabled = locked;
  if (sendBtn) sendBtn.disabled = locked;
  // Si no hay ni grabación de audio ni Web Speech API, el botón ya está
  // deshabilitado de forma permanente (ver initRecognition): no lo
  // "reactivamos" por error al desbloquear.
  if (speakBtn && (recognition || canRecordAudio)) speakBtn.disabled = locked;
}

function showProactiveLoading() {
  if (!proactiveLoadingEl && chatEl) {
    proactiveLoadingEl = document.createElement("div");
    proactiveLoadingEl.className = "msg sys proactive-loading";
    proactiveLoadingEl.textContent = "🧑‍🏫 El profesor está pensando el tema del día…";
    chatEl.appendChild(proactiveLoadingEl);
    chatEl.scrollTop = chatEl.scrollHeight;
  }
  setInputLocked(true);

  // Red de seguridad: si por lo que sea nunca llega el mensaje (p. ej. un
  // fallo de Groq/TTS ya registrado en el backend pero sin aviso al
  // frontend en ese caso concreto), no se deja el input bloqueado
  // indefinidamente.
  clearTimeout(proactiveLoadingTimeout);
  proactiveLoadingTimeout = setTimeout(() => {
    hideProactiveLoading();
    addSystem("⚠️ El tema tardó demasiado en cargar. Ya puedes escribir con normalidad.");
  }, 20000);
}

function hideProactiveLoading() {
  if (proactiveLoadingEl) {
    proactiveLoadingEl.remove();
    proactiveLoadingEl = null;
  }
  clearTimeout(proactiveLoadingTimeout);
  proactiveLoadingTimeout = null;
  setInputLocked(false);
}

// ============================================================
// Audio
// ============================================================
// Audio de TTS actualmente en curso: solo sus eventos pueden controlar el
// avatar. Si llega un mensaje nuevo antes de que el anterior termine, se
// descarta el audio viejo (y se le quitan los listeners) para que su
// "pause" no interfiera con el estado del avatar del audio nuevo.
let currentAvatarAudio = null;

// Corta en seco el audio TTS que estuviera sonando (o todavía cargando/
// decodificando, aunque no haya llegado a sonar): quita los listeners
// antes de pausar para que su "pause" no dispare backToIdle() dos veces
// ni interfiera con un audio nuevo, y limpia src para abandonar cualquier
// descarga/decodificación en curso del dato base64.
// forceIdle=false se usa solo al interrumpir un audio con uno nuevo (ver
// playAudio): si el audio nuevo ya trae voz, su propio monitor de volumen
// lo detectará enseguida, sin parpadeo de por medio a la imagen fija.
function stopCurrentAudio({ forceIdle = true } = {}) {
  if (currentAvatarAudio) {
    currentAvatarAudio.onpause = null;
    currentAvatarAudio.onended = null;
    currentAvatarAudio.onerror = null;
    currentAvatarAudio.onplaying = null;
    currentAvatarAudio.pause();
    currentAvatarAudio.src = "";
    currentAvatarAudio = null;
  }
  stopVolumeMonitor({ forceIdle });
  // Corte duro (no una simple interrupción por un audio nuevo): al igual
  // que el final natural de una frase, deja el vídeo listo desde el
  // principio para la próxima vez que hable.
  if (forceIdle && avatarTalkingEl) avatarTalkingEl.currentTime = 0;
}

function playAudio(base64) {
  if (!base64) return;

  stopCurrentAudio({ forceIdle: false });

  const audio = new Audio("data:audio/mpeg;base64," + base64);
  currentAvatarAudio = audio;

  // "pause" cubre tanto el final natural (el navegador siempre dispara
  // "pause" justo antes de "ended") como cualquier corte prematuro: en
  // cualquier caso, vuelta inmediata e imperceptible a la imagen fija.
  const backToIdle = () => {
    stopVolumeMonitor();
    if (currentAvatarAudio === audio) currentAvatarAudio = null;
  };
  audio.onpause = backToIdle;
  // "ended" (fin real de la frase, nunca una simple pausa por silencio o
  // por interrupción) es el único momento en el que el vídeo se rebobina:
  // así la siguiente vez que hable arranca limpio desde el principio en
  // vez de seguir donde se quedó una respuesta anterior. "pause" ya se ha
  // encargado de ocultar el vídeo justo antes (el navegador siempre
  // dispara "pause" antes de "ended").
  audio.onended = () => {
    if (avatarTalkingEl) avatarTalkingEl.currentTime = 0;
  };
  audio.onerror = () => {
    console.error("Error al reproducir audio");
    backToIdle();
  };

  // Mientras haya analizador, es el volumen real (ver monitorVolume) el
  // que decide, frame a frame, si se ve el vídeo o la imagen fija — no el
  // simple hecho de que el <audio> esté en estado "playing". Sin Web
  // Audio disponible (navegador muy antiguo o API bloqueada), se cae al
  // comportamiento anterior: vídeo mientras el audio esté sonando.
  if (connectAnalyser(audio)) {
    startVolumeMonitor();
  } else {
    audio.onplaying = () => setAvatarSpeaking(true);
  }

  audio.play().catch((err) => {
    console.error("Error al reproducir audio:", err);
    backToIdle();
  });
}

// ============================================================
// WebSocket
// ============================================================
function setStatus(text, connected) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = connected ? "#9fe6a0" : "#ffc1a8";
}

function connect() {
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    setStatus("Conectado", true);
    addSystem("Conectado al tutor 🎧");
    if (currentConfig.level || currentConfig.context) sendConfig();
    if (activeExercise) {
      socket.send(JSON.stringify({ type: "exercise_start", exercise: activeExercise }));
    }
    if (activeMoodleExercise) {
      // Al reconectar se pierde el estado en memoria de la conexión
      // anterior (active_moodle_exercise vivía solo ahí, sin persistencia):
      // se vuelve a pedir el mismo fichero desde cero, así que el tutor
      // reinicia la práctica en vez de continuar por donde iba.
      socket.send(JSON.stringify({ type: "moodle_exercise_start", exercise_id: activeMoodleExercise.id }));
    }
  };

  socket.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    if (data.error) {
      addSystem("⚠️ " + data.error);
      return;
    }

    if (data.type === "welcome") {
      user_id = data.user_id;
      window.currentUserId = data.user_id;
      localStorage.setItem('user_id', data.user_id);
      if (data.role === "teacher" && !isTeacher) {
        isTeacher = true;
        window.isTeacher = true;
        updateTeacherTabVisibility();
      }
      addSystem(`✓ Conectado como ${data.username}`);
      return;
    }

    if (data.type === "config_ok") {
      // Toast flotante en vez de addSystem(): es un aviso menor y frecuente
      // (se dispara cada vez que se cambia nivel/contexto) que no debe
      // dejar un mensaje fijo ocupando sitio en la pizarra.
      showToast("✓ " + configFeedback(data.level, data.context));
      return;
    }

    if (data.type === "session") {
      currentSessionId = data.session_id;
      window.currentSessionId = data.session_id;
      return;
    }

    if (data.type === "proactive_loading") {
      showProactiveLoading();
      return;
    }

    if (data.type === "exercise_ack") {
      return;
    }

    if (data.type === "moodle_exercise_ack") {
      const count = data.total_questions ? ` (${data.total_questions} preguntas)` : "";
      addSystem(`📘 Práctica iniciada: ${data.title}${count}`);
      return;
    }

    if (data.type === "moodle_exercise_done") {
      activeMoodleExercise = null;
      window.activeMoodleExercise = null;
      updateExerciseBadge();
      addSystem(`🎉 ¡Práctica completada! ${data.title ? `"${data.title}"` : ""}`);
      return;
    }

    if (data.type === "exercise_completed") {
      activeExercise = null;
      window.activeExercise = null;
      updateExerciseBadge();
      if (data.saved === false) {
        // El backend no pudo guardar exercise_progress: no mostramos el
        // mensaje de éxito para no ocultar que el profesor no lo verá
        // reflejado en su panel. Se anima a reintentar desde "Retos".
        addSystem(`⚠️ Reto completado, pero no se pudo guardar el progreso. ${data.title ? `"${data.title}"` : ""} Vuelve a intentarlo desde la pestaña Retos.`);
      } else {
        addSystem(`🎉 ¡Reto Superado! ${data.title ? `"${data.title}"` : ""}`);
        alert("🎉 ¡Reto Superado! 🎉");
      }
      if (typeof window.loadRetos === "function") {
        window.loadRetos();
      }
      return;
    }

    if (data.type === "typing") {
      showTypingIndicator();
      return;
    }

    if (data.type === "error") {
      hideTypingIndicator();
      hideProactiveLoading();
      addSystem("⚠️ " + data.message);
      return;
    }

    hideTypingIndicator();
    hideProactiveLoading();
    addMessage("tutor", data.text);
    lastTutorMessage = data.text || "";
    playAudio(data.audio_base64);
  };

  socket.onclose = () => {
    setStatus("Desconectado", false);
    addSystem("Conexión perdida. Reintentando…");
    hideProactiveLoading();
    scheduleReconnect();
  };

  socket.onerror = () => {};
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 2500);
}

function sendConfig() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "config", config: currentConfig }));
  }
}

function optionLabel(select, value) {
  if (!select) return value;
  for (const opt of select.options) {
    if (opt.value === value) return opt.textContent;
  }
  return value;
}

function configFeedback(level, context) {
  const parts = [];
  if (level) parts.push(`nivel ${optionLabel(levelSelect, level)}`);
  if (context) parts.push(`contexto: ${optionLabel(contextSelect, context)}`);
  return parts.length
    ? "Configuración aplicada: " + parts.join(" · ")
    : "Configuración aplicada";
}

if (levelSelect) {
  levelSelect.addEventListener("change", () => {
    currentConfig.level = levelSelect.value;
    sendConfig();
  });
}

if (contextSelect) {
  contextSelect.addEventListener("change", () => {
    currentConfig.context = contextSelect.value;
    sendConfig();
  });
}

// ============================================================
// Test de nivel
// ============================================================
const TEST_QUESTIONS = [
  {
    q: "¿Cuánto tiempo llevas estudiando inglés?",
    options: [
      { label: "Nunca o casi nunca lo he estudiado", points: 1 },
      { label: "Unos meses", points: 2 },
      { label: "Un par de años", points: 3 },
      { label: "Muchos años o lo uso a diario", points: 4 },
    ],
  },
  {
    q: "¿Entiendes películas o series en inglés?",
    options: [
      { label: "No, necesito subtítulos en español", points: 1 },
      { label: "Con subtítulos en inglés", points: 2 },
      { label: "Casi sin subtítulos", points: 3 },
      { label: "Sin subtítulos, sin problema", points: 4 },
    ],
  },
  {
    q: "¿Cómo te sientes al hablar en inglés?",
    options: [
      { label: "No puedo mantener una conversación", points: 1 },
      { label: "Solo frases sencillas", points: 2 },
      { label: "Temas variados con algunos errores", points: 3 },
      { label: "Fluido y con vocabulario amplio", points: 4 },
    ],
  },
];

function levelFromScore(total) {
  if (total <= 4) return "A1";
  if (total <= 6) return "A2";
  if (total <= 9) return "B1";
  return "B2";
}

function openLevelTest() {
  let html = "";
  TEST_QUESTIONS.forEach((item, i) => {
    html += `<div class="test-question"><div class="q">${i + 1}. ${item.q}</div>`;
    item.options.forEach((opt) => {
      html += `<label><input type="radio" name="q${i}" value="${opt.points}"> ${opt.label}</label>`;
    });
    html += `</div>`;
  });
  if (testQuestionsEl) testQuestionsEl.innerHTML = html;
  if (testModal) testModal.classList.remove("hidden");
}

function closeLevelTest() {
  if (testModal) testModal.classList.add("hidden");
}

if (levelTestBtn) levelTestBtn.addEventListener("click", openLevelTest);
if (testCancelBtn) testCancelBtn.addEventListener("click", closeLevelTest);

if (testSubmitBtn) {
  testSubmitBtn.addEventListener("click", () => {
    let total = 0;
    let answered = 0;
    TEST_QUESTIONS.forEach((_, i) => {
      const selected = document.querySelector(`input[name="q${i}"]:checked`);
      if (selected) {
        total += parseInt(selected.value, 10);
        answered++;
      }
    });
    if (answered < TEST_QUESTIONS.length) {
      addSystem("⚠️ Responde a todas las preguntas para conocer tu nivel");
      return;
    }
    const level = levelFromScore(total);
    if (levelSelect) levelSelect.value = level;
    currentConfig.level = level;
    sendConfig();
    closeLevelTest();
    addSystem(`Nivel sugerido: ${level}. Ajustado automáticamente.`);
  });
}

// ============================================================
// Ayuda y Modales
// ============================================================
if (helpBtn && helpModal) {
  helpBtn.addEventListener("click", () => helpModal.classList.remove("hidden"));
}
if (helpCloseBtn && helpModal) {
  helpCloseBtn.addEventListener("click", () => helpModal.classList.add("hidden"));
}
if (helpModal) {
  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) helpModal.classList.add("hidden");
  });
}

if (newChatBtn) {
  newChatBtn.addEventListener("click", () => {
    // Corta en seco cualquier audio TTS que estuviera sonando o
    // todavía cargando/decodificando, y cualquier indicador de carga del
    // tema proactivo que hubiera quedado a medias (si no, chatEl se
    // vacía a continuación y su nodo quedaría huérfano con el input
    // bloqueado para siempre): el avatar debe callarse al instante y el
    // alumno debe poder escribir de inmediato en el chat nuevo.
    stopCurrentAudio();
    hideProactiveLoading();

    // No borra nada en Supabase: solo deja de referenciar la sesión
    // actual. La siguiente vez que se envíe un mensaje, el backend
    // creará una sesión nueva (ver socket "session" y sendText()).
    currentSessionId = null;
    window.currentSessionId = null;

    if (activeExercise) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "exercise_end" }));
      }
      activeExercise = null;
      window.activeExercise = null;
      updateExerciseBadge();
    }

    if (activeMoodleExercise) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "moodle_exercise_end" }));
      }
      activeMoodleExercise = null;
      window.activeMoodleExercise = null;
      updateExerciseBadge();
    }

    if (chatEl) chatEl.innerHTML = "";

    // Resetea el selector de Contexto/Objetivo al modo "Default" (valor
    // vacío, sin iniciativa propia): un chat nuevo no debe quedarse
    // bloqueado en el modo del chat anterior, obliga a elegir uno limpio.
    // Se reenvía la config al backend para que su estado interno
    // (current_context) quede sincronizado con lo que ahora muestra el
    // desplegable.
    if (contextSelect) contextSelect.value = "";
    currentConfig.context = "";
    sendConfig();

    addSystem("Nueva conversación. Escribe o habla para empezar.");
    showMainChatView();
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (helpModal) helpModal.classList.add("hidden");
    if (testModal) testModal.classList.add("hidden");
  }
});

// ============================================================
// Mensajes de texto
// ============================================================
// inputType viaja al backend como "input_type" (ver websocket_chat en
// main.py): "voice" cuando viene del micrófono (ver recognition.onend más
// abajo) o "text" cuando el alumno lo ha escrito a mano. El tutor lo usa
// para no exigir mayúsculas/puntuación en mensajes hablados, que por
// naturaleza no las llevan.
function sendText(text, inputType = "text") {
  text = (text || "").trim();
  if (!text) return;
  addMessage("tu", text);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ message: text, session_id: currentSessionId, input_type: inputType }));
  } else {
    addSystem("⚠️ Sin conexión, no se envió el mensaje");
  }
}

if (sendBtn && textInput) {
  sendBtn.addEventListener("click", () => {
    sendText(textInput.value);
    textInput.value = "";
    textInput.focus();
  });
}

if (textInput) {
  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      sendText(textInput.value);
      textInput.value = "";
    }
  });
}

// ============================================================
// Reconocimiento de voz
// ============================================================
// El alumno SIEMPRE habla en inglés por el micrófono: esta app es un tutor
// de inglés y lo único que se transcribe es la frase inglesa que produce el
// alumno (las pistas en español las escribe el tutor en el chat, nunca se
// dictan). Por eso el idioma de reconocimiento es fijo y estricto: en-US.
// Se fuerza en una constante y se REASIGNA antes de cada .start() para que
// ni el idioma del navegador, ni una extensión, ni una reanudación
// automática puedan dejar el motor escuchando en es-ES y colar falsos
// amigos fonéticos (p. ej. "carpet" -> "carpeta", "actually" -> "actualmente").
// Si algún día hubiera un modo en el que el alumno deba hablar español,
// este es el único punto a cambiar: pasar el idioma que toque a
// startRecognition() en función del contexto activo.
const RECOGNITION_LANG = "en-US";

// Arranca el motor asegurando SIEMPRE el idioma correcto justo antes.
// Devuelve true si el start() no lanzó (puede fallar si el motor todavía
// no ha soltado el recurso de la sesión anterior).
function startRecognition() {
  if (!recognition) return false;
  recognition.lang = RECOGNITION_LANG;
  try {
    recognition.start();
    return true;
  } catch (e) {
    console.error("recognition.start() falló:", e);
    return false;
  }
}

function initRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    // Sin Web Speech API. Si el navegador sí puede grabar audio, el
    // micrófono sigue funcionando por la vía de /api/transcribe (Whisper),
    // así que no se avisa ni se deshabilita nada.
    recognition = null;
    if (!canRecordAudio) {
      addSystem("⚠️ Tu navegador no soporta el micrófono");
      if (speakBtn) speakBtn.disabled = true;
    }
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = RECOGNITION_LANG;
  recognition.interimResults = false;
  // continuous=true reduce los cortes por pausas cortas, pero NO garantiza
  // que el motor no se detenga solo tras un silencio largo. La escucha
  // continua real la fuerza recognition.onend reanudando mientras el
  // alumno no haya pulsado para parar (ver manualStop).
  recognition.continuous = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    // Con continuous=true, onresult puede dispararse varias veces (una
    // por cada frase que el motor de voz da por finalizada) mientras el
    // micrófono sigue activo. Se van acumulando esos fragmentos finales
    // en voiceTranscript sin enviar ni tocar el chat todavía.
    let finalChunk = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalChunk += result[0].transcript;
      }
    }
    finalChunk = finalChunk.trim();
    if (finalChunk) {
      voiceTranscript = voiceTranscript ? `${voiceTranscript} ${finalChunk}` : finalChunk;
    }
  };

  recognition.onend = () => {
    // El motor se ha detenido. Puede ser por: (a) el alumno pulsó el botón
    // para parar (manualStop=true), (b) corte automático por silencio con
    // el alumno aún en modo escucha, o (c) un error transitorio.
    // En los casos (b) y (c) reanudamos: el micro debe seguir abierto
    // hasta la acción manual, y no se envía nada.
    if (listening && !manualStop) {
      // startRecognition() reasigna recognition.lang = RECOGNITION_LANG en
      // cada reanudación: si no, un corte por silencio podría devolver el
      // motor a escuchar en el idioma por defecto del navegador.
      if (startRecognition()) return;
      // start() puede fallar si el motor aún no ha soltado el recurso;
      // un reintento breve suele bastar.
      setTimeout(() => {
        if (listening && !manualStop && !startRecognition()) {
          console.error("No se pudo reanudar el micrófono");
          listening = false;
          updateButton();
        }
      }, 250);
      return;
    }

    // Parada manual (o fin definitivo): ahora sí se envía todo lo
    // acumulado durante la sesión de escucha, de una sola vez.
    listening = false;
    manualStop = false;
    updateButton();
    if (voiceTranscript) {
      sendText(voiceTranscript, "voice");
      voiceTranscript = "";
    }
  };

  recognition.onerror = (event) => {
    console.error("Error de reconocimiento:", event.error);
    // Errores fatales: sin permiso de micrófono o sin dispositivo de
    // captura. Reanudar en bucle no serviría de nada -> se corta y se
    // avisa. (El "end" que viene detrás encontrará listening=false y no
    // reanudará ni enviará.)
    if (
      event.error === "not-allowed" ||
      event.error === "service-not-allowed" ||
      event.error === "audio-capture"
    ) {
      listening = false;
      manualStop = false;
      voiceTranscript = "";
      updateButton();
      addSystem("⚠️ No se pudo acceder al micrófono (permiso denegado o sin dispositivo)");
      return;
    }
    // El resto (no-speech, network, aborted) son transitorios: onend viene
    // a continuación y, si el alumno sigue en modo escucha, reanuda.
  };
}

// ============================================================
// Grabación de voz -> transcripción en el backend (Whisper / Groq)
// ============================================================
// Motor PRINCIPAL del micrófono. Se graba el audio con MediaRecorder y se
// envía a POST /api/transcribe, que lo transcribe con Whisper forzando el
// idioma inglés (el alumno siempre habla inglés por el micro). Mucho más
// preciso y consistente que la Web Speech API del navegador, que queda de
// fallback (ver la rama `recognition` del handler del botón).

function pickAudioMime() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

async function ensureMicStream() {
  if (micStream && micStream.active) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  return micStream;
}

async function startRecording() {
  if (recording || startingRecording) return true;
  startingRecording = true;
  let stream;
  try {
    stream = await ensureMicStream();
  } catch (e) {
    console.error("getUserMedia falló:", e);
    startingRecording = false;
    addSystem("⚠️ No se pudo acceder al micrófono (permiso denegado o sin dispositivo)");
    return false;
  }

  const mime = pickAudioMime();
  try {
    mediaRecorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
  } catch (e) {
    console.error("MediaRecorder falló:", e);
    startingRecording = false;
    return false;
  }

  recordedChunks = [];
  mediaRecorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) recordedChunks.push(ev.data);
  };
  mediaRecorder.onstop = () => {
    clearTimeout(recordStopTimer);
    const type = mediaRecorder.mimeType || mime || "audio/webm";
    const blob = new Blob(recordedChunks, { type });
    recordedChunks = [];
    recording = false;
    if (!blob.size) {
      transcribing = false;
      updateButton();
      return;
    }
    transcribeAndSend(blob);
  };

  mediaRecorder.start();
  recording = true;
  startingRecording = false;
  recordStopTimer = setTimeout(() => {
    if (recording) stopRecording();
  }, MAX_RECORDING_MS);
  return true;
}

function stopRecording() {
  clearTimeout(recordStopTimer);
  if (!mediaRecorder || !recording) return;
  // El envío ocurre en onstop; feedback inmediato mientras tanto.
  transcribing = true;
  updateButton();
  try {
    mediaRecorder.stop();
  } catch (e) {
    console.error("mediaRecorder.stop() falló:", e);
  }
}

async function transcribeAndSend(blob) {
  transcribing = true;
  updateButton();

  const form = new FormData();
  const ext = blob.type.includes("mp4")
    ? "m4a"
    : blob.type.includes("ogg")
    ? "ogg"
    : "webm";
  form.append("audio", blob, `voz.${ext}`);
  if (currentConfig.context) {
    form.append("context_label", optionLabel(contextSelect, currentConfig.context));
  }
  if (lastTutorMessage) form.append("last_tutor_message", lastTutorMessage);

  try {
    const res = await fetch(apiUrl("/api/transcribe"), {
      method: "POST",
      headers: { "X-User-Id": getCurrentUser() },
      body: form,
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const text = (data.text || "").trim();
    transcribing = false;
    updateButton();
    if (text) {
      sendText(text, "voice");
    } else {
      addSystem("🎤 No te he entendido, prueba a hablar otra vez.");
    }
  } catch (e) {
    console.error("Fallo transcribiendo:", e);
    transcribing = false;
    updateButton();
    if (recognition) {
      // A partir de ahora, micrófono por Web Speech API del navegador.
      serverTranscriptionDown = true;
      addSystem("⚠️ Falló la transcripción del servidor; se usará el reconocimiento del navegador. Pulsa el micrófono para repetir.");
    } else {
      addSystem("⚠️ No se pudo transcribir el audio. Inténtalo de nuevo o escribe el mensaje.");
    }
  }
}

if (speakBtn) {
  speakBtn.addEventListener("click", async () => {
    // Pulsar el micro es un gesto de usuario: aprovecha para arrancar/
    // reanudar el AudioContext cuanto antes, así ya está listo cuando
    // llegue el audio TTS de la respuesta.
    ensureAudioContext();
    if (transcribing) return; // ocupado convirtiendo voz -> texto

    // Motor principal: grabación + /api/transcribe.
    if (canRecordAudio && !serverTranscriptionDown) {
      if (recording) {
        stopRecording();
      } else {
        await startRecording();
        updateButton();
      }
      return;
    }

    // Fallback: Web Speech API del navegador.
    if (!recognition) return;
    if (listening) {
      // Única forma de detener la escucha y enviar: esta pulsación.
      // manualStop evita que recognition.onend reanude el micro.
      manualStop = true;
      listening = false;
      updateButton(); // feedback inmediato aunque 'stop' tarde en cerrar
      try { recognition.stop(); } catch (e) {}
      return;
    }
    voiceTranscript = "";
    manualStop = false;
    listening = true;
    // startRecognition() fija recognition.lang = RECOGNITION_LANG antes de
    // arrancar. Si lanza (p. ej. ya estaba arrancando) no es un problema.
    startRecognition();
    updateButton();
  });
}

function updateButton() {
  if (!speakBtn || !btnLabel) return;
  if (!recognition && !canRecordAudio) return; // micrófono no disponible
  const active = listening || recording;
  speakBtn.classList.toggle("listening", active);
  speakBtn.disabled = transcribing;
  speakBtn.textContent = transcribing ? "⏳" : active ? "🛑" : "🎤";
  btnLabel.textContent = transcribing
    ? "Transcribiendo…"
    : active
    ? "Escuchando… pulsa 🛑 para enviar"
    : "Pulsa para hablar";
}

// ============================================================
// Pestañas del Modal de Ajustes
// ============================================================
// Nota: el cambio de pestaña y la carga de cada panel (progreso,
// historial, ejercicios, profesor) los gestiona el script inline
// de index.html (activateTab/openTab). Este módulo solo expone
// las funciones de carga de datos que ese script invoca.

function getCurrentUser() {
  if (typeof user_id !== "undefined" && user_id) return user_id;
  return localStorage.getItem('user_id') || username || localStorage.getItem('username') || "alumno1";
}

function updateTeacherTabVisibility() {
  const teacherTabBtn = document.querySelector('.tab-btn[data-tab="tab-profesor"]');
  if (teacherTabBtn) teacherTabBtn.classList.toggle("hidden", !isTeacher);

  // Retos/Tareas es exclusivo de la vista Alumno: se oculta por completo
  // para profesores (ver también el guard de rutas en index.html).
  const retosTabBtn = document.querySelector('.tab-btn[data-tab="tab-retos"]');
  if (retosTabBtn) retosTabBtn.classList.toggle("hidden", isTeacher);
}

updateTeacherTabVisibility();

async function loadUserProgress() {
  const current_user = getCurrentUser();
  const progressContent = document.getElementById("progressContent");
  if (!progressContent) return;

  try {
    const res = await fetch(apiUrl("/api/progress"), {
      headers: { "X-User-Id": current_user }
    });
    const data = await res.json();
    if (data && data.length > 0) {
      progressContent.innerHTML = `<ul>` + data.map(p => `<li>Ejercicio ID: ${p.exercise_id} - Estado: ${p.status} - Puntuación: ${p.score || 0}</li>`).join("") + `</ul>`;
    } else {
      progressContent.innerHTML = "<p>No hay registros de progreso todavía para " + current_user + ".</p>";
    }
  } catch (err) {
    console.error("Error cargando progreso:", err);
    progressContent.innerHTML = "<p>Error al cargar el progreso.</p>";
  }
}

async function loadChatHistory() {
  const current_user = getCurrentUser();
  const historyContent = document.getElementById("historyContent");
  if (!historyContent) return;

  historyContent.innerHTML = "<p>Cargando historial...</p>";

  try {
    const res = await fetch(apiUrl("/api/history"), {
      headers: { "X-User-Id": current_user }
    });
    const sessions = await res.json();

    if (sessions && sessions.length > 0) {
      historyContent.innerHTML = `
        <ul class="history-list" style="list-style: none; padding: 0; margin: 0;">
          ${sessions.map((s, index) => {
            const dateStr = s.started_at ? new Date(s.started_at).toLocaleDateString() : '';
            const sessionTitle = s.title || `Conversación #${sessions.length - index}`;
            const id = s.id;

            return `
              <li data-session-id="${id}" style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <button onclick="window.loadSpecificSession('${id}')"
                        style="flex: 1; min-width: 0; text-align: left; padding: 10px 12px; background: rgba(0,0,0,0.05); border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; cursor: pointer;">
                  💬 <strong>${sessionTitle}</strong>
                  <span style="font-size: 0.8em; color: #666; float: right;">${dateStr}</span>
                </button>
                <button onclick="window.deleteSession('${id}')" title="Eliminar conversación"
                        style="flex: none; width: 28px; height: 28px; border-radius: 50%; border: none; background: #e05656; color: #fff; font-weight: bold; line-height: 1; cursor: pointer;">✕</button>
              </li>
            `;
          }).join("")}
        </ul>
      `;
    } else {
      historyContent.innerHTML = "<p>No hay conversaciones guardadas todavía para " + current_user + ".</p>";
    }
  } catch (err) {
    console.error("Error cargando historial:", err);
    historyContent.innerHTML = "<p>Error al cargar el historial de conversaciones.</p>";
  }
}

// Cierra el modal de ajustes (si está abierto) para volver a la vista
// principal del chat.
function showMainChatView() {
  const modal = document.getElementById("settings-modal");
  if (modal) modal.classList.add("hidden");
  // Solo se limpia el hash (#progreso, #historial, ...), nunca el pathname:
  // en GitHub Pages el sitio vive en una subcarpeta (p. ej.
  // /profesor/frontend/) y pushState a una ruta absoluta como "/" la
  // pierde, dejando la URL apuntando a una página inexistente (404).
  if (["#progreso", "#historial", "#ejercicios", "#retos", "#profesor"].includes(location.hash)) {
    history.pushState({}, "", location.pathname + location.search);
  }
}

function updateExerciseBadge() {
  const badge = document.getElementById("exercise-badge");
  if (!badge) return;
  if (activeExercise) {
    badge.textContent = `🎯 Reto en curso: ${activeExercise.title}`;
    badge.classList.remove("hidden");
  } else if (activeMoodleExercise) {
    badge.textContent = `📘 Práctica: ${activeMoodleExercise.title}`;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
    badge.textContent = "";
  }
}

function startExercise(ex) {
  if (!ex || !ex.id) return;

  activeExercise = {
    id: ex.id,
    title: ex.title || "",
    level: ex.level || "",
    description: (ex.content && ex.content.description) || "",
  };
  window.activeExercise = activeExercise;
  // Un Reto y una práctica de Moodle no pueden estar activos a la vez
  // (ver backend: exercise_start también limpia active_moodle_exercise).
  activeMoodleExercise = null;
  window.activeMoodleExercise = null;

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "exercise_start", exercise: activeExercise }));
  }

  // Marca el ejercicio como iniciado (no bloqueante: no impide arrancar el reto si falla).
  const current_user = getCurrentUser();
  fetch(apiUrl(`/api/exercises/${ex.id}/progress`), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": current_user },
    body: JSON.stringify({ status: "in_progress" }),
  }).catch(err => console.error("Error marcando el reto como iniciado:", err));

  updateExerciseBadge();
  addSystem(`🎯 Reto iniciado: ${activeExercise.title}`);
  showMainChatView();
}

// ============================================================
// Ejercicios (prácticas leídas en directo de Moodle, sin persistencia:
// ver GET /api/moodle/exercises y moodle_exercise_start en el backend)
// ============================================================
function startMoodleExercise(ex) {
  if (!ex || !ex.id) return;

  activeMoodleExercise = { id: ex.id, title: ex.title || "" };
  window.activeMoodleExercise = activeMoodleExercise;
  // Mismo criterio que al revés en startExercise: no pueden coexistir.
  activeExercise = null;
  window.activeExercise = null;

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "moodle_exercise_start", exercise_id: ex.id }));
  } else {
    addSystem("⚠️ Sin conexión, no se pudo iniciar la práctica");
    return;
  }

  updateExerciseBadge();
  showMainChatView();
}

window.startMoodleExercise = startMoodleExercise;

async function loadMoodleExercises() {
  const current_user = getCurrentUser();
  const exercisesContent = document.getElementById("exercisesContent");
  if (!exercisesContent) return;

  exercisesContent.innerHTML = "<p>Cargando…</p>";
  try {
    const res = await fetch(apiUrl("/api/moodle/exercises"), {
      headers: { "X-User-Id": current_user }
    });
    if (res.status === 503) {
      exercisesContent.innerHTML = "<p>La integración con Moodle no está configurada todavía.</p>";
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    window.__lastMoodleExercises = data;
    if (!data || !data.length) {
      exercisesContent.innerHTML = "<p>No hay prácticas activas en Moodle ahora mismo.</p>";
      return;
    }

    const rows = data.map(ex => {
      const meta = ex.type === "gift"
        ? (ex.question_count != null ? `${ex.question_count} preguntas` : "preguntas")
        : "material de repaso";
      return `<li data-exercise-id="${ex.id}"><strong>${ex.title}</strong> — ${meta} `
        + `<button type="button" onclick="window.startMoodleExercise({id:'${ex.id}', title:${JSON.stringify(ex.title)}})">▶️ Iniciar práctica</button></li>`;
    }).join("");
    exercisesContent.innerHTML = `<ul class="help-list">${rows}</ul>`;
  } catch (err) {
    console.error("Error cargando ejercicios de Moodle:", err);
    exercisesContent.innerHTML = "<p>⚠️ No se pudieron cargar las prácticas de Moodle.</p>";
  }
}

window.loadMoodleExercises = loadMoodleExercises;

function startExerciseById(exerciseId) {
  const exercises = window.__lastExercises || [];
  const ex = exercises.find(e => e.id === exerciseId);
  if (ex) startExercise(ex);
}

window.startExercise = startExercise;
window.startExerciseById = startExerciseById;

async function loadSpecificSession(sessionId) {
  const current_user = getCurrentUser();

  // Igual que "Nuevo Chat": al cambiar de conversación, el avatar debe
  // callarse al instante y cualquier indicador de carga del tema
  // proactivo que hubiera quedado a medias se descarta (chatEl se vacía
  // más abajo, así que su nodo quedaría huérfano con el input bloqueado
  // para siempre si no se limpia aquí).
  stopCurrentAudio();
  hideProactiveLoading();

  try {
    const res = await fetch(apiUrl(`/api/history/${sessionId}`), {
      headers: { "X-User-Id": current_user }
    });
    const messages = await res.json();

    currentSessionId = sessionId;
    window.currentSessionId = sessionId;

    // Al cambiar a otra conversación no se conoce (desde aquí) el modo
    // con el que se dio originalmente, así que el desplegable de
    // Contexto/Objetivo se resetea al modo "Default" (sin iniciativa)
    // en vez de dejarlo mostrando el modo de la conversación anterior:
    // obliga a elegir de nuevo un modo antes de poder seguir hablando.
    // A diferencia de antes, sí se reenvía la config al backend: al ser
    // "Default" no proactivo, no dispara ningún tema nuevo encima de la
    // conversación ya existente, solo sincroniza current_context.
    if (contextSelect) contextSelect.value = "";
    currentConfig.context = "";
    sendConfig();

    if (chatEl) {
      chatEl.innerHTML = "";

      messages.forEach(msg => {
        const text = msg.content || "";
        const role = msg.role === "user" ? "tu" : "tutor";
        addMessage(role, text);
      });
    }

    addSystem("✓ Conversación retomada");
    showMainChatView();

  } catch (err) {
    console.error("Error al retomar la conversación:", err);
    alert("No se pudo reanudar esta conversación.");
  }
}

window.loadSpecificSession = loadSpecificSession;

async function deleteSession(sessionId) {
  const confirmed = confirm("¿Eliminar esta conversación? No se puede deshacer.");
  if (!confirmed) return;

  const current_user = getCurrentUser();

  try {
    const res = await fetch(apiUrl(`/api/history/${sessionId}`), {
      method: "DELETE",
      headers: { "X-User-Id": current_user }
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);

    const row = document.querySelector(`li[data-session-id="${sessionId}"]`);
    if (row) row.remove();

    if (currentSessionId === sessionId) {
      currentSessionId = null;
      window.currentSessionId = null;
      if (chatEl) chatEl.innerHTML = "";
      addSystem("La conversación eliminada era la activa. Chat vacío.");
    }

    const historyContent = document.getElementById("historyContent");
    if (historyContent && !historyContent.querySelector("li")) {
      historyContent.innerHTML = "<p>No hay conversaciones guardadas todavía para " + current_user + ".</p>";
    }
  } catch (err) {
    console.error("Error al eliminar la conversación:", err);
    alert("No se pudo eliminar la conversación.");
  }
}

window.deleteSession = deleteSession;


// ============================================================
// Panel de Profesor (#teacher-dashboard)
// ============================================================
let activityChartInstance = null;

async function loadTeacherDashboard() {
  const current_user = getCurrentUser();
  const tbody = document.getElementById("teacher-students-tbody");
  if (tbody) tbody.innerHTML = "<tr><td colspan=\"5\">Cargando…</td></tr>";

  try {
    const res = await fetch(apiUrl("/api/teacher/summary"), {
      headers: { "X-User-Id": current_user }
    });
    if (res.status === 403) {
      if (tbody) tbody.innerHTML = "<tr><td colspan=\"5\">⛔ Acceso restringido solo a profesores.</td></tr>";
      return;
    }
    if (!res.ok) throw new Error(`Error ${res.status}`);

    const data = await res.json();
    const students = data.students || [];
    const totals = data.totals || {};
    const dailyActivity = data.daily_activity || [];

    const totalEl = document.getElementById("teacher-total-students");
    const levelEl = document.getElementById("teacher-avg-level");
    const msgTodayEl = document.getElementById("teacher-messages-today");
    if (totalEl) totalEl.textContent = totals.total_students ?? students.length;
    if (levelEl) levelEl.textContent = totals.avg_level || "–";
    if (msgTodayEl) msgTodayEl.textContent = totals.messages_today ?? 0;

    renderActivityChart(dailyActivity);
    renderStudentsTable(students, tbody);
    populateAssignStudentSelect(students);
  } catch (err) {
    console.error("Error cargando el panel de profesor:", err);
    if (tbody) tbody.innerHTML = "<tr><td colspan=\"5\">Error al cargar los datos.</td></tr>";
  }
}

function renderActivityChart(dailyActivity) {
  const canvas = document.getElementById("activityChart");
  if (!canvas || typeof Chart === "undefined") return;

  const labels = dailyActivity.map(d =>
    new Date(`${d.date}T00:00:00`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric" })
  );
  const counts = dailyActivity.map(d => d.count);

  if (activityChartInstance) {
    activityChartInstance.data.labels = labels;
    activityChartInstance.data.datasets[0].data = counts;
    activityChartInstance.update();
    return;
  }

  activityChartInstance = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Mensajes por día",
        data: counts,
        backgroundColor: "#9c6b33",
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderStudentsTable(students, tbody) {
  if (!tbody) return;
  if (!students.length) {
    tbody.innerHTML = "<tr><td colspan=\"5\">No hay alumnos registrados todavía.</td></tr>";
    return;
  }
  tbody.innerHTML = students.map(s => {
    const lastConnection = s.last_connection ? new Date(s.last_connection).toLocaleString() : "—";
    const safeName = (s.name || "").replace(/'/g, "\\'");
    return `
      <tr>
        <td>${s.name}</td>
        <td>${s.level}</td>
        <td>${lastConnection}</td>
        <td>${s.message_count ?? 0}</td>
        <td>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <button class="btn-history" onclick="window.viewStudentHistory('${s.id}', '${safeName}')">Ver Historial</button>
            <button class="btn-history" onclick="window.toggleResetPassword('${s.id}')">🔑 Restablecer contraseña</button>
          </div>
        </td>
      </tr>
      <tr id="reset-pw-row-${s.id}" class="hidden">
        <td colspan="5">
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 6px 0;">
            <input type="password" id="reset-pw-input-${s.id}"
                   placeholder="Nueva contraseña para ${s.name}"
                   style="flex: 1; min-width: 180px; padding: 6px 8px; border: 2px solid #c9a05e; border-radius: 6px; background: #f7f3e6; font-family: inherit;"
                   onkeydown="if (event.key === 'Enter') { event.preventDefault(); window.submitResetPassword('${s.id}', '${safeName}'); }">
            <button type="button" class="btn-history" onclick="window.submitResetPassword('${s.id}', '${safeName}')">Guardar</button>
            <button type="button" class="btn-history" onclick="window.toggleResetPassword('${s.id}')">Cancelar</button>
          </div>
          <p id="reset-pw-feedback-${s.id}" style="margin: 4px 0 0; font-size: 0.85em;"></p>
        </td>
      </tr>
    `;
  }).join("");
}

function toggleResetPassword(studentId) {
  const row = document.getElementById(`reset-pw-row-${studentId}`);
  if (!row) return;
  row.classList.toggle("hidden");
  if (!row.classList.contains("hidden")) {
    const input = document.getElementById(`reset-pw-input-${studentId}`);
    if (input) {
      input.value = "";
      input.focus();
    }
    const feedback = document.getElementById(`reset-pw-feedback-${studentId}`);
    if (feedback) feedback.textContent = "";
  }
}
window.toggleResetPassword = toggleResetPassword;

async function submitResetPassword(studentId, studentName) {
  const input = document.getElementById(`reset-pw-input-${studentId}`);
  const feedback = document.getElementById(`reset-pw-feedback-${studentId}`);
  const newPassword = input ? input.value : "";

  if (!newPassword) {
    if (feedback) {
      feedback.textContent = "⚠️ Escribe una contraseña.";
      feedback.style.color = "#b23b3b";
    }
    return;
  }

  const current_user = getCurrentUser();
  if (feedback) {
    feedback.textContent = "Guardando…";
    feedback.style.color = "#5a4630";
  }

  try {
    // Ruta relativa: funciona igual en local y desplegado en Render.
    const res = await fetch(apiUrl("/api/teacher/reset-password"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": current_user },
      body: JSON.stringify({ student_id: studentId, new_password: newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);

    if (feedback) {
      feedback.textContent = `✓ Contraseña de ${studentName} actualizada.`;
      feedback.style.color = "#3a6b3a";
    }
    if (input) input.value = "";
    setTimeout(() => {
      const row = document.getElementById(`reset-pw-row-${studentId}`);
      if (row) row.classList.add("hidden");
    }, 1200);
  } catch (err) {
    console.error("Error restableciendo la contraseña:", err);
    if (feedback) {
      feedback.textContent = "⚠️ " + err.message;
      feedback.style.color = "#b23b3b";
    }
  }
}
window.submitResetPassword = submitResetPassword;

function populateAssignStudentSelect(students) {
  const select = document.getElementById("assign-student");
  if (!select) return;
  const options = students.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
  select.innerHTML = `<option value="">Selecciona un alumno…</option>${options}`;
}

// Descripción/intentos/fecha del reto completado que se despliega al
// pulsar sobre él. IMPORTANTE: los turnos de chat dentro de un reto activo
// nunca se guardan en chat_sessions/chat_messages (ver backend/main.py,
// is_exercise_message) — es una decisión de diseño deliberada para que un
// reto no se pueda "reanudar" desde el Historial. Por eso este panel no
// puede mostrar una transcripción real palabra por palabra: no existe tal
// dato en la base de datos. Se muestra en su lugar el detalle disponible
// (descripción, intentos, fecha de finalización) y se explica el motivo.
function renderRetoTranscript(ex) {
  const progress = ex.progress || {};
  const description = (ex.content && ex.content.description) || "Sin descripción.";
  const completedAt = progress.completed_at ? new Date(progress.completed_at).toLocaleString() : "-";
  const attempts = progress.attempts ?? 0;
  return `
    <p style="margin: 0 0 4px;"><strong>Descripción:</strong> ${description}</p>
    <p style="margin: 0 0 4px;"><strong>Completado el:</strong> ${completedAt} · <strong>Intentos:</strong> ${attempts}</p>
    <p style="margin: 0; font-style: italic;">⚠️ No hay transcripción de chat guardada para este reto: las conversaciones dentro de un reto activo se evalúan como una prueba puntual y no se guardan en el historial de conversaciones.</p>
  `;
}

function toggleRetoTranscript(exerciseId) {
  const panel = document.getElementById(`reto-transcript-${exerciseId}`);
  if (!panel) return;

  if (!panel.classList.contains("hidden")) {
    panel.classList.add("hidden");
    return;
  }

  if (!panel.dataset.loaded) {
    const ex = (window.__teacherExercisesById || {})[exerciseId];
    panel.innerHTML = ex
      ? renderRetoTranscript(ex)
      : "<p>⚠️ No se encontraron los datos de este reto.</p>";
    panel.dataset.loaded = "1";
  }
  panel.classList.remove("hidden");
}
window.toggleRetoTranscript = toggleRetoTranscript;

function renderAssignedExercises(exercises) {
  // Nunca debe lanzar: si un elemento llega con forma inesperada (p. ej.
  // null, o sin content/progress), esta función igualmente debe devolver
  // un string. Si lanzara, viewStudentHistory() se quedaría a medio
  // construir su innerHTML y la sección de retos jamás se inyectaría.
  try {
    window.__teacherExercisesById = {};

    if (!exercises || !exercises.length) {
      return "<p>No hay retos ni tareas asignadas.</p>";
    }
    const rows = exercises.map(ex => {
      ex = ex || {};
      if (ex.id) window.__teacherExercisesById[ex.id] = ex;

      const status = ex.progress ? ex.progress.status : "pending";
      const statusLabel = status === "completed" ? "✅ Completado"
        : status === "in_progress" ? "🕓 En curso"
        : "⏳ Pendiente";
      const due = ex.content && ex.content.due_date ? ` · vence ${ex.content.due_date}` : "";

      // Solo los retos completados tienen algo que desplegar (descripción +
      // intentos + fecha); los pendientes/en curso no tienen esa info aún.
      const isCompleted = status === "completed" && ex.id;
      const toggleAttr = isCompleted
        ? ` onclick="window.toggleRetoTranscript('${ex.id}')" style="cursor: pointer;"`
        : "";
      const toggleHint = isCompleted ? " ▾" : "";
      const transcriptPanel = isCompleted
        ? `<div id="reto-transcript-${ex.id}" class="hidden" style="margin-top: 8px; padding: 8px 10px; background: rgba(0,0,0,0.04); border-radius: 6px; font-size: 0.85em; color: #444;"></div>`
        : "";

      return `
        <li style="margin-bottom: 6px; padding: 8px 10px; background: rgba(0,0,0,0.05); border: 1px solid rgba(0,0,0,0.1); border-radius: 8px;"${toggleAttr}>
          🎯 <strong>${ex.title || "Sin título"}</strong>
          <span style="font-size: 0.8em; color: #666; float: right;">${statusLabel}${toggleHint}</span>
          <div style="font-size: 0.85em; color: #666;">Nivel ${ex.level || "-"} · ${ex.type || "-"}${due}</div>
          ${transcriptPanel}
        </li>
      `;
    }).join("");
    return `<ul class="history-list" style="list-style: none; padding: 0; margin: 0 0 10px;">${rows}</ul>`;
  } catch (err) {
    console.error("Error renderizando retos/tareas asignados:", err);
    return "<p>⚠️ No se pudieron mostrar los retos/tareas.</p>";
  }
}

function renderStudentSessions(sessions, studentName) {
  if (!sessions || !sessions.length) {
    return "<p>No hay conversaciones guardadas.</p>";
  }
  const safeName = studentName.replace(/'/g, "\\'");
  return `
    <ul class="history-list" style="list-style: none; padding: 0; margin: 0 0 10px;">
      ${sessions.map((s, index) => {
        const dateStr = s.started_at ? new Date(s.started_at).toLocaleDateString() : "";
        const title = s.title || `Conversación #${sessions.length - index}`;
        const msgCount = (s.chat_messages || []).length;
        return `
          <li style="margin-bottom: 6px;">
            <button onclick="window.viewStudentSession('${s.id}', '${safeName}')"
                    style="width: 100%; text-align: left; padding: 8px 10px; background: rgba(0,0,0,0.05); border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; cursor: pointer;">
              💬 <strong>${title}</strong>
              <span style="font-size: 0.8em; color: #666; float: right;">${dateStr} · ${msgCount} msj</span>
            </button>
          </li>
        `;
      }).join("")}
    </ul>
  `;
}

async function viewStudentHistory(studentId, studentName) {
  const current_user = getCurrentUser();
  const historyView = document.getElementById("teacher-history-view");
  if (!historyView) return;

  historyView.classList.remove("hidden");
  historyView.innerHTML = `<p>Cargando datos de ${studentName}…</p>`;

  const [exercisesResult, historyResult] = await Promise.allSettled([
    fetch(apiUrl(`/api/teacher/exercises/${studentId}`), { headers: { "X-User-Id": current_user } })
      .then(res => { if (!res.ok) throw new Error(`Error ${res.status}`); return res.json(); }),
    fetch(apiUrl(`/api/teacher/history/${studentId}`), { headers: { "X-User-Id": current_user } })
      .then(res => { if (!res.ok) throw new Error(`Error ${res.status}`); return res.json(); }),
  ]);

  if (exercisesResult.status === "rejected") {
    console.error("Error cargando retos/tareas del alumno:", exercisesResult.reason);
  }
  if (historyResult.status === "rejected") {
    console.error("Error cargando historial del alumno:", historyResult.reason);
  }

  // Cada sección se calcula en su propio try/catch: si renderStudentSessions
  // (u otra cosa) lanzara una excepción no capturada, el bloque siguiente
  // (la asignación única de innerHTML) nunca se ejecutaría y la sección de
  // Retos/Tareas tampoco se inyectaría, aunque su propio HTML ya estuviera
  // calculado bien. Aislar los fallos por sección evita ese arrastre.
  let exercisesHtml;
  try {
    exercisesHtml = exercisesResult.status === "fulfilled"
      ? renderAssignedExercises(exercisesResult.value)
      : "<p>⚠️ Error al cargar los retos/tareas.</p>";
  } catch (err) {
    console.error("Error renderizando retos/tareas asignados:", err);
    exercisesHtml = "<p>⚠️ Error al mostrar los retos/tareas.</p>";
  }

  let sessionsHtml;
  try {
    sessionsHtml = historyResult.status === "fulfilled"
      ? renderStudentSessions(historyResult.value, studentName)
      : "<p>⚠️ Error al cargar el historial.</p>";
  } catch (err) {
    console.error("Error renderizando el historial:", err);
    sessionsHtml = "<p>⚠️ Error al mostrar el historial.</p>";
  }

  // La sección de retos se inyecta siempre, en su propio nodo, ANTES de
  // tocar el historial: así, aunque algo posterior fallara, "Retos /
  // Tareas Asignados" ya estaría en el DOM.
  historyView.innerHTML = `
    <div id="teacher-history-exercises">
      <h4>Retos / Tareas Asignados — ${studentName}</h4>
      ${exercisesHtml}
    </div>
    <div id="teacher-history-sessions">
      <h4 style="margin-top: 14px;">Historial de Conversaciones — ${studentName}</h4>
      ${sessionsHtml}
      <div id="teacher-history-session-detail" class="hidden"></div>
    </div>
    <button onclick="window.closeTeacherHistoryView()">Cerrar</button>
  `;
}

// Pinta la conversación abierta dentro de #teacher-history-session-detail
// (un contenedor propio dentro de #teacher-history-sessions), en vez de
// sobrescribir todo #teacher-history-view: así abrir un chat nunca borra
// ni oculta la sección de "Retos / Tareas Asignados" ni la lista de
// conversaciones que queda justo encima.
async function viewStudentSession(sessionId, studentName) {
  const current_user = getCurrentUser();
  const detailEl = document.getElementById("teacher-history-session-detail");
  if (!detailEl) return;

  detailEl.classList.remove("hidden");
  detailEl.innerHTML = "<p>Cargando conversación…</p>";

  try {
    const res = await fetch(apiUrl(`/api/history/${sessionId}`), {
      headers: { "X-User-Id": current_user }
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    const messages = await res.json();

    detailEl.innerHTML = `
      <h4 style="margin-top: 14px;">Conversación de ${studentName}</h4>
      <div style="max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
        ${messages.map(m => `<div><strong>${m.role === "user" ? studentName : "Tutor"}:</strong> ${m.content || ""}</div>`).join("")}
      </div>
      <button onclick="window.closeStudentSessionDetail()">Cerrar conversación</button>
    `;
  } catch (err) {
    console.error("Error cargando la conversación:", err);
    detailEl.innerHTML = `
      <p>⚠️ Error al cargar la conversación.</p>
      <button onclick="window.closeStudentSessionDetail()">Cerrar</button>
    `;
  }
}

// Cierra solo el panel de la conversación abierta, dejando intactos tanto
// "Retos / Tareas Asignados" como la lista de conversaciones.
function closeStudentSessionDetail() {
  const detailEl = document.getElementById("teacher-history-session-detail");
  if (detailEl) {
    detailEl.classList.add("hidden");
    detailEl.innerHTML = "";
  }
}
window.closeStudentSessionDetail = closeStudentSessionDetail;

function closeTeacherHistoryView() {
  const historyView = document.getElementById("teacher-history-view");
  if (historyView) {
    historyView.classList.add("hidden");
    historyView.innerHTML = "";
  }
}

const assignTaskForm = document.getElementById("assign-task-form");
if (assignTaskForm) {
  assignTaskForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const feedback = document.getElementById("assign-task-feedback");
    const current_user = getCurrentUser();

    const studentSelect = document.getElementById("assign-student");
    const studentId = studentSelect ? studentSelect.value : "";
    const studentName = studentSelect && studentSelect.selectedIndex >= 0
      ? studentSelect.options[studentSelect.selectedIndex].textContent
      : "";
    const title = document.getElementById("assign-title").value.trim();
    const level = document.getElementById("assign-level").value;
    const type = document.getElementById("assign-type").value;
    const description = document.getElementById("assign-description").value.trim();
    const due = document.getElementById("assign-due").value;

    if (!studentId || !title) {
      if (feedback) feedback.textContent = "⚠️ Elige un alumno y escribe un título.";
      return;
    }

    try {
      const res = await fetch(apiUrl("/api/exercises"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": current_user },
        body: JSON.stringify({
          title,
          type,
          level,
          assigned_to: studentId,
          content: {
            description,
            due_date: due || null,
            assigned_to_name: studentName,
          },
        }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);

      if (feedback) feedback.textContent = `✓ "${title}" asignada a ${studentName}.`;
      assignTaskForm.reset();
    } catch (err) {
      console.error("Error asignando la tarea:", err);
      if (feedback) feedback.textContent = "⚠️ No se pudo asignar la tarea.";
    }
  });
}

// ============================================================
// Crear Nuevo Alumno (Vista Profesor) — única vía de alta de cuentas
// ============================================================
const createStudentForm = document.getElementById("create-student-form");
if (createStudentForm) {
  createStudentForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const feedback = document.getElementById("create-student-feedback");
    const current_user = getCurrentUser();

    const newUsername = document.getElementById("create-student-username").value.trim();
    const newPassword = document.getElementById("create-student-password").value;

    if (!newUsername || !newPassword) {
      if (feedback) feedback.textContent = "⚠️ Indica un nombre de usuario y una contraseña.";
      return;
    }

    try {
      // Ruta relativa: funciona igual en local y desplegado en Render.
      const res = await fetch(apiUrl("/api/teacher/create-student"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": current_user },
        body: JSON.stringify({ username: newUsername, password: newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);

      if (feedback) feedback.textContent = `✓ Alumno "${data.username}" creado. Ya puede iniciar sesión con la contraseña que le diste.`;
      createStudentForm.reset();
      if (typeof window.loadTeacherDashboard === "function") {
        window.loadTeacherDashboard();
      }
    } catch (err) {
      console.error("Error creando el alumno:", err);
      if (feedback) feedback.textContent = "⚠️ " + err.message;
    }
  });
}

window.loadTeacherDashboard = loadTeacherDashboard;
window.viewStudentHistory = viewStudentHistory;
window.viewStudentSession = viewStudentSession;
window.closeTeacherHistoryView = closeTeacherHistoryView;

// ============================================================
// Arranque Único
// ============================================================
// Sin sesión guardada en localStorage (sin login real hecho) no se arranca
// nada: se deja la pantalla de login visible y ya está.
if (username) {
  connect();
  initRecognition();
}

// Al final de index.js
window.loadChatHistory = loadChatHistory;