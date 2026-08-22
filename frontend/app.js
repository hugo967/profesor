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
// Transcripción acumulada durante una sesión de escucha continua del
// micrófono (ver initRecognition): se rellena mientras `listening` es
// true y se envía entera de una vez al parar, no frase a frase.
let voiceTranscript = "";
let reconnectTimer = null;
let user_id = null;
let currentSessionId = null;
window.currentSessionId = null;
let activeExercise = null;
window.activeExercise = null;
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
function showTalkingAvatar() {
  if (avatarIdleEl) avatarIdleEl.classList.add("hidden");
  if (avatarTalkingEl) {
    avatarTalkingEl.classList.remove("hidden");
    avatarTalkingEl.currentTime = 0;
    avatarTalkingEl.play().catch((err) => console.error("No se pudo reproducir el vídeo del avatar:", err));
  }
}

function showIdleAvatar() {
  if (avatarTalkingEl) {
    avatarTalkingEl.pause();
    avatarTalkingEl.classList.add("hidden");
  }
  if (avatarIdleEl) avatarIdleEl.classList.remove("hidden");
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
// Audio
// ============================================================
function playAudio(base64) {
  if (!base64) return;
  const audio = new Audio("data:audio/mpeg;base64," + base64);

  audio.onended = showIdleAvatar;
  audio.onerror = () => {
    console.error("Error al reproducir audio");
    showIdleAvatar();
  };

  showTalkingAvatar();
  audio.play().catch((err) => {
    console.error("Error al reproducir audio:", err);
    showIdleAvatar();
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
      addSystem("✓ " + configFeedback(data.level, data.context));
      return;
    }

    if (data.type === "session") {
      currentSessionId = data.session_id;
      window.currentSessionId = data.session_id;
      return;
    }

    if (data.type === "exercise_ack") {
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
      addSystem("⚠️ " + data.message);
      return;
    }

    hideTypingIndicator();
    addMessage("tutor", data.text);
    playAudio(data.audio_base64);
  };

  socket.onclose = () => {
    setStatus("Desconectado", false);
    addSystem("Conexión perdida. Reintentando…");
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

    if (chatEl) chatEl.innerHTML = "";
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
function sendText(text) {
  text = (text || "").trim();
  if (!text) return;
  addMessage("tu", text);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ message: text, session_id: currentSessionId }));
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
function initRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    addSystem("⚠️ Tu navegador no soporta reconocimiento de voz");
    if (speakBtn) speakBtn.disabled = true;
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  // Micrófono como control manual activo/inactivo: continuous=true evita
  // que el navegador corte la escucha por una simple pausa/silencio entre
  // frases. Solo para de escuchar cuando el alumno vuelve a pulsar el
  // botón (ver click handler más abajo -> recognition.stop()).
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
    // onend llega tanto al parar manualmente (recognition.stop()) como
    // tras un error del motor de voz: en ambos casos es el punto único
    // donde se envía, ya con todos los resultados finales entregados.
    listening = false;
    updateButton();
    if (voiceTranscript) {
      sendText(voiceTranscript);
      voiceTranscript = "";
    }
  };

  recognition.onerror = (event) => {
    console.error("Error de reconocimiento:", event.error);
    // No se actualiza aquí ni el botón ni el envío: el navegador dispara
    // "end" a continuación de "error", y onend ya se encarga de ambos.
  };
}

if (speakBtn) {
  speakBtn.addEventListener("click", () => {
    if (!recognition) return;
    if (listening) {
      recognition.stop();
      return;
    }
    voiceTranscript = "";
    recognition.start();
    listening = true;
    updateButton();
  });
}

function updateButton() {
  if (!speakBtn || !btnLabel) return;
  speakBtn.classList.toggle("listening", listening);
  speakBtn.textContent = listening ? "🛑" : "🎤";
  btnLabel.textContent = listening ? "Escuchando… habla en inglés" : "Pulsa para hablar";
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

function startExerciseById(exerciseId) {
  const exercises = window.__lastExercises || [];
  const ex = exercises.find(e => e.id === exerciseId);
  if (ex) startExercise(ex);
}

window.startExercise = startExercise;
window.startExerciseById = startExerciseById;

async function loadSpecificSession(sessionId) {
  const current_user = getCurrentUser();

  try {
    const res = await fetch(apiUrl(`/api/history/${sessionId}`), {
      headers: { "X-User-Id": current_user }
    });
    const messages = await res.json();

    currentSessionId = sessionId;
    window.currentSessionId = sessionId;

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

async function loadExercisesList() {
  const current_user = getCurrentUser();
  const exercisesContent = document.getElementById("exercisesContent");
  if (!exercisesContent) return;

  try {
    const res = await fetch(apiUrl("/api/exercises"), {
      headers: { "X-User-Id": current_user }
    });
    const data = await res.json();
    if (data && data.length > 0) {
      exercisesContent.innerHTML = `<ul>` + data.map(ex => `<li><b>${ex.title}</b> (${ex.level}) - ${ex.type}</li>`).join("") + `</ul>`;
    } else {
      exercisesContent.innerHTML = "<p>No hay ejercicios disponibles.</p>";
    }
  } catch (err) {
    console.error("Error cargando ejercicios:", err);
    exercisesContent.innerHTML = "<p>Error al cargar los ejercicios.</p>";
  }
}

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