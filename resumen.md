# Resumen del proyecto — Tutor de Inglés MVP

Resumen escrito a partir del código real (no de otros .md). Sirve como contexto
para futuras sesiones.

## Qué es

App web de un **tutor de inglés conversacional con IA** para hispanohablantes.
El alumno chatea (texto o voz) con un "profesor" que responde por escrito y con
voz (TTS), corrige errores de forma natural y propone temas. Hay un panel de
profesor para gestionar alumnos, ver actividad y asignar retos/tareas.

## Estado actual (2026-09-13)

- **Avatar 3D con gestos Mixamo**: terminado, probado en el navegador y
  **pusheado** a `hugo967/profesor` (commit `154a6f7`) — ver sección "Avatar 3D"
  más abajo para el detalle de la máquina de estados y la rotación de gestos.
- **Auditoría de bugs de frontend/backend**: terminada, verificada (tests +
  smoke test real + pruebas aisladas) y **pusheada** a ambos repos —
  `hugo967/profesor` (commit `154a6f7`) y `hugo967/tutor-ingles-backend`
  (commit `b5b27af`) — ver sección "Auditoría de bugs" más abajo. Render
  redespliega solo con el push al repo de backend.
- **Integración con Moodle**: el código está completo y no ha cambiado, pero
  **no está configurada** en este entorno (no hay `MOODLE_URL`/`MOODLE_TOKEN`/
  `MOODLE_COURSE_ID` en `backend/.env`) — la pestaña Ejercicios devuelve 503.
  Ver la sección "Integración Moodle" más abajo para el checklist exacto de lo
  que hace falta para dejarla conectada.
- **Pendiente / conocido, sin tocar todavía**: `backend/.env` está versionado
  en el repo `tutor-ingles-backend` con `GROQ_API_KEY` y `SUPABASE_SERVICE_KEY`
  en texto plano (ver "Deuda / cosas a saber" más abajo) — rotar esas claves y
  sacar `.env` del historial de git sigue pendiente de decisión del usuario.

## Estructura de repos (IMPORTANTE)

Son **dos repos git independientes**, uno anidado dentro del otro:

- Raíz `C:\Users\hugoc\Desktop\profesor` → repo **frontend** (`github.com/hugo967/profesor`), rama `main`.
  Contiene `frontend/` y este `resumen.md`. `PROJECT_STATUS.md` aparece como borrado (`D`) en git status.
- `backend/` → repo **backend** aparte (`github.com/hugo967/tutor-ingles-backend`), rama `main`.
  `backend/` está en el `.gitignore` de la raíz. **Nunca hacer `git add backend/` desde la raíz.**

Para commitear backend hay que `cd backend` y operar en ese repo.

## Despliegue

- **Frontend**: GitHub Pages (se sirve desde una subcarpeta, p. ej. `/profesor/frontend/`).
  Por eso el enrutado del modal usa **hash** (`#progreso`, `#retos`…) y todas las
  rutas de API se construyen con `apiUrl()` contra la URL absoluta de Render.
- **Backend**: Render (`https://tutor-ingles-backend.onrender.com`), hardcodeado en
  `app.js` como `RENDER_BACKEND_URL`. Override con `localStorage.backend_url`.
- Render **borra el disco en cada redeploy** → nada de estado en ficheros locales;
  todo lo persistente va a Supabase.
- Cuando FastAPI encuentra `frontend/` (local), lo sirve como estáticos + rutas SPA
  (`/progreso`, `/historial`, `/ejercicios`, `/retos`, `/profesor`). En Render esa
  carpeta no existe, así que ese bloque no se activa.
- CORS: permite siempre `*.github.io` por regex; extra vía `ALLOWED_ORIGINS`.

## Stack

- **Backend**: Python + FastAPI, un WebSocket (`/ws/chat`) + API REST. `uvicorn`.
  - **Groq** (`AsyncGroq`): LLM del chat (`GROQ_MODEL`, por defecto `llama-3.3-70b-versatile`)
    y transcripción Whisper (`whisper-large-v3-turbo`). Misma `GROQ_API_KEY`.
  - **edge-tts**: text-to-speech (voz `en-US-AndrewNeural`, masculina; configurable
    con `TTS_VOICE`), devuelve MP3 en base64.
  - **Supabase** (Postgres) vía `supabase-py` (cliente **síncrono**).
  - **bcrypt** directo (no passlib, que estaba roto con bcrypt>=4.1) para hashes de contraseña.
  - `httpx` para Moodle.
- **Frontend**: HTML + CSS + **JS vanilla ES module** (`app.js`, ~2200 líneas), sin build.
  Chart.js por CDN (jsDelivr) para la gráfica del panel de profesor. Estética "pizarra
  de aula" (fuente Patrick Hand, colores marrón/verde). Avatar: modelo 3D (Avaturn)
  en WebGL vía **Three.js por CDN** (`avatar3d.js`), sin build (ver sección
  "Avatar 3D" más abajo).

## Async / rendimiento (clave)

`supabase-py` y `bcrypt` son **síncronos y bloqueantes**. Todo acceso a BD pasa por
`db._exec()` que hace `asyncio.to_thread(query.execute)`; el hashing/verificación de
contraseña también se offloadan con `asyncio.to_thread`. Sin esto, un `.execute()`
dentro de una corrutina congela el event loop entero (todos los WebSockets/HTTP).
Groq tiene `timeout=45s` + `max_retries=2`; TTS tiene `asyncio.wait_for` a 30s.

## Modelo de datos (Supabase)

- `users`: id (uuid), username (único), role (`student`/`teacher`), level (`A1`..`B2`),
  `password_hash` (nullable; añadido con `sql/add_password_hash.sql`).
  Usernames `profesor` y `teacher` → rol teacher automático (`TEACHER_USERNAMES`).
- `chat_sessions`: user_id, title, `level`, `context`, started_at, ended_at.
- `chat_messages`: session_id, role (`user`/`assistant`), content, `audio_base64`, created_at.
- `exercises`: teacher_id, title, type (`tarea`/`reto`), level, `content` (jsonb:
  description, due_date, assigned_to_name), assigned_to, is_published.
- `exercise_progress`: user_id, exercise_id, status (`pending`/`in_progress`/`completed`),
  attempts, score, timestamps.
- `topic_history`: (user_id, context, topic_key) único — temas proactivos ya dados,
  para no repetirlos. Esquema en `sql/create_topic_history.sql`.

**Los scripts SQL de `backend/sql/` se ejecutan a mano en el SQL Editor de Supabase**
(no se puede correr DDL con la service_role key vía PostgREST).

## Autenticación

- Login por **usuario + contraseña** (`POST /api/auth/login`), valida hash bcrypt.
  401 genérico siempre (no filtra qué usernames existen). **No hay autorregistro.**
- El frontend guarda `username`, `user_id`, `role_param` en `localStorage`. Sin sesión
  → pantalla de login. Logout borra localStorage y recarga.
- Las cuentas de alumno las crea **solo el profesor**: `POST /api/teacher/create-student`.
- API REST se autentica con cabecera **`X-User-Id`** (acepta uuid o username →
  `resolve_user_id`). Endpoints `/api/teacher/*` comprueban `role == "teacher"`.
- El WebSocket se identifica con `?username=` en la URL; ya NO crea usuarios.
- `seed_profesor.py`: script puntual para crear/actualizar `profesor` / `1234`.

## WebSocket `/ws/chat` — el corazón de la app

Estado **solo en memoria por conexión**: `messages` (lista para el LLM, `messages[0]`
es el system prompt), `session_id`, `current_level`, `current_context`,
`active_exercise`, `active_moodle_exercise`. Al reconectar se pierde → hay lógica de
**rehidratación** (`rehydrate_session_state`): recarga los mensajes de esa sesión
desde Supabase, descarta lo que hubiera en memoria (`del messages[1:]`) y restaura
level/context guardados en `chat_sessions`.

Mensajes entrantes (JSON con `type`):
- `config`: fija level/context. Si trae `session_id` de una sesión válida del usuario
  y el backend no la tiene cargada → la retoma (rehidrata). Reconstruye el system
  prompt, responde `config_ok` con la config **real resuelta**. Cambiar de contexto
  de verdad (no reconexión, no solo nivel) → descarta historial, suelta la sesión.
  Entrar en un modo proactivo → dispara tema del día.
- `exercise_start` / `exercise_end`: Retos asignados por el profesor.
- `moodle_exercise_start` / `moodle_exercise_end`: prácticas leídas de Moodle.
- mensaje normal (`{message, session_id, input_type}`): turno de conversación.

Un Reto y una práctica de Moodle **no pueden estar activos a la vez** (arrancar uno
cierra el otro). Los turnos dentro de un Reto o práctica de Moodle **no se guardan**
en `chat_sessions`/`chat_messages` (decisión deliberada: no se pueden reanudar desde
el Historial).

Mensajes salientes: `welcome`, `config_ok`, `session`, `proactive_loading`, `typing`,
`{text, audio_base64}` (respuesta normal), `exercise_ack`, `exercise_completed`
(con `saved`), `moodle_exercise_ack`, `moodle_exercise_done`, `error`.

`input_type: "voice"` → el backend antepone `[VOICE]` al mensaje que ve el LLM (no se
guarda ni se muestra) para que **no exija mayúsculas/puntuación** en mensajes hablados.

## Prompt del tutor (`SYSTEM_PROMPT` en main.py)

Reglas destiladas: respuestas cortas (1-3 frases), naturales, **una sola pregunta por
turno**, nunca combinar traducción + pregunta. Corregir solo errores reales y solo el
más importante, de forma natural (prohibido "It should be X, not Y"). Pero **no dejar
pasar errores básicos** (concordancia, 3ª persona -s, tiempos). Todo en inglés salvo
la línea de consigna, que **siempre va en español** con el formato exacto
`¿Cómo dirías "..." en inglés?` (prohibido dar la frase inglesa a traducir/repetir).
Si el alumno se va de tema, reconducir con educación. Excepción A1: puede añadir
traducciones cortas al español.

`LEVEL_HINTS` (A1-B2), `CONTEXT_HINTS` (conversacion_libre, gramatica, vocabulario,
entrevista_trabajo, recepcionista_hotel, viajes).

### Temas proactivos

En modos `conversacion_libre`, `gramatica`, `vocabulario` (`PROACTIVE_TOPIC_CONTEXTS`)
el tutor **toma la iniciativa**: elige un tema de `TOPIC_CATALOG` que el alumno no
haya visto (`topic_history`), lo presenta con voz propia + audio, y antepone
`Today's topic is: {title}.`. Catálogo: 24 temas conversación libre, 12 gramática,
12 vocabulario. Modo "Default" (`context=""`) → no hay iniciativa, responde con
`DEFAULT_MODE_NUDGE_TEXT` (texto fijo, sin Groq/TTS) pidiendo elegir un modo.

### Tags de control del LLM

- `[RETO_COMPLETADO]` — el LLM lo emite cuando juzga (por su cuenta, no porque el
  alumno lo pida) que el reto está superado tras 2-3 intercambios válidos. Se detecta
  con regex tolerante, se limpia del texto y se marca `completed` en `exercise_progress`.
- `[MOODLE_DONE]` — igual, al terminar la última pregunta de una práctica GIFT.

## Integración Moodle (`moodle_client.py`, `gift_parser.py`)

**Solo lectura, sin persistencia.** Lee en caliente los `.gift`/`.txt` del curso vía
Web Services (`core_course_get_contents`) con caché en memoria de ~60s. El `wstoken`
nunca llega al frontend; el `id` que ve el cliente es un hash SHA1 corto del fileurl.
Config: `MOODLE_URL`, `MOODLE_TOKEN`, `MOODLE_COURSE_ID`; si falta alguna → la
pestaña Ejercicios responde 503.

`gift_parser.parse_gift()`: parser pragmático de GIFT (opción múltiple, V/F, respuesta
corta, ensayo). No implementa la spec completa a propósito (sin categorías, matching,
numeric con tolerancia, ni escapado avanzado de `{}~=`).

- `.txt` → material de repaso, el tutor lo enseña conversacionalmente.
- `.gift` → el tutor guía pregunta a pregunta, una a una, sin revelar respuestas antes.

### Checklist para dejarla conectada (estado: código listo, sin configurar)

Son exactamente **3 variables de entorno**, ninguna más (ver `backend/.env.example`):

| Variable | Qué es | Dónde se saca |
|---|---|---|
| `MOODLE_URL` | Raíz del sitio Moodle, **sin** `/webservice/...` (ej. `https://moodle.mi-centro.es`) | La URL de tu Moodle |
| `MOODLE_TOKEN` | Token de un servicio externo con `core_course_get_contents` habilitada | Administración del sitio → Servicios web → Gestionar tokens |
| `MOODLE_COURSE_ID` | ID numérico del curso | En la URL del curso: `.../course/view.php?id=123` → `123` |

**Requisitos que hay que preparar en el propio Moodle (rol administrador) antes de
tener el token:**
1. Administración del sitio → General → Servicios web → **Habilitar los servicios
   web** + habilitar el **protocolo REST**.
2. Servicios web → **Servicios externos**: crear uno nuevo (o reutilizar uno) con
   la función `core_course_get_contents` añadida.
3. Servicios web → **Gestionar tokens**: generar un token para un usuario con
   acceso de lectura al curso, asociado a ese servicio externo → eso da
   `MOODLE_TOKEN`.
4. Subir los materiales como ficheros `.gift` (cuestionarios) o `.txt` (repaso)
   en cualquier sección del curso (recurso tipo "Archivo") — son los únicos dos
   tipos que lista `moodle_client.list_course_files`.

**Una vez tengas los 3 valores**, hay que ponerlos en dos sitios (no solo uno):
- `backend/.env` en local (para probar con `uvicorn` antes de subir nada).
- El panel de Render del servicio (Environment) para producción — Render no lee
  el `.env` del repo para las variables que ya tiene definidas ahí (ver
  `load_dotenv(override=not os.getenv("RENDER"))` en `main.py`), así que hace
  falta darlas de alta también ahí para que el redeploy las recoja.

Sin necesidad de tocar ni una línea de código: en cuanto esas 3 variables estén
puestas (y el backend se reinicie / redespliegue), la pestaña Ejercicios deja de
dar 503 y empieza a listar lo que haya en el curso.

## API REST (main.py)

- `POST /api/auth/login`, `POST /api/teacher/create-student`
- `GET /api/history` (lista sesiones con mensajes), `GET/DELETE /api/history/{session_id}`
- `GET/POST /api/exercises`, `POST /api/exercises/{id}/progress`, `GET /api/progress`
- `POST /api/transcribe` (multipart: audio + context_label + last_tutor_message → Whisper;
  máx 8MB, idioma forzado a inglés, prompt de sesgo con el tema y lo último que dijo el tutor)
- `GET /api/moodle/exercises`
- `GET /api/teacher/summary` (tarjetas + actividad 7 días + tabla de alumnos)
- `POST /api/teacher/reset-password`
- `GET /api/teacher/history/{student_id}`, `GET /api/teacher/exercises/{student_id}`

## Frontend `app.js` — puntos notables

- **Reconexión WS**: backoff exponencial 2.5s→20s, avisos de sistema una sola vez por
  corte (no spam). Al reconectar reenvía `config` con `session_id` para retomar.
- **Micrófono**: motor principal = grabar con `MediaRecorder` → `POST /api/transcribe`
  (Whisper). Fallback = Web Speech API del navegador (`en-US` forzado antes de cada
  `start()`). El micro solo se detiene y envía con **pulsación manual** (escucha
  continua, reanuda solo si el motor corta por silencio). Si `/api/transcribe` falla
  una vez → pasa a Web Speech el resto de la sesión.
- **Avatar**: `playAudio()` conecta el `<audio>` de TTS a un `AnalyserNode`;
  `monitorVolume()` (rAF) llama a `Avatar3D.setMouthOpen(volume, analyser)` en cada
  frame para el lip-sync. `avatar3d.js` se carga siempre (sin flag), con `.catch()`
  como red de seguridad. Ver sección "Avatar 3D" más abajo para el detalle completo.
- **Modal de ajustes**: pestañas Progreso / Historial / Ejercicios / Retos-Tareas /
  Vista Profesor (esta última solo teachers; Retos solo alumnos). Enrutado por hash,
  con `popstate`. Lógica repartida entre el `<script>` inline de `index.html`
  (activateTab/openTab) y `app.js` (funciones `loadXxx` expuestas en `window`).
- "Nuevo Chat" / cambiar de modo / abrir sesión del historial: cortan el audio,
  limpian el chat, sueltan `currentSessionId`.
- Responsive móvil (`<=768px`): reorganiza solo la franja superior con CSS grid +
  `display: contents`, sin tocar el desktop.

## Avatar 3D (WebGL/Three.js) — sistema único

El avatar es un modelo 3D renderizado en el navegador (`frontend/avatar3d.js`), con
**coste de servidor cero** y **sin build** (Three.js 0.160.0 por CDN vía
`<script type="importmap">` en `index.html`; GLTFLoader por URL completa del mismo
CDN/versión para no duplicar instancias). **El sistema anterior de vídeo 2D con
chroma key ya no existe** (borrados `callado.png`, `hablando.mp4`, el filtro SVG
`#chroma-key-green`, `.avatar-media`, `setAvatarSpeaking()` y el flag `?avatar=3d`).
Se mantiene `aula.jpg` como fondo difuminado (`.avatar-wrap::before`), que además es
lo único que se ve si WebGL o el `.glb` fallan (el `import("./avatar3d.js")` tiene
`.catch()`: el chat sigue funcionando sin cara).

- **Modelo**: `frontend/avatar/model.glb` (~14.5MB), exportado de **Avaturn**
  (avaturn.me). Nomenclatura tipo Mixamo para huesos (`Head`, `Neck`, `LeftArm`,
  `Spine`/`Spine1`/`Spine2`, `LeftEye`/`RightEye`…) y blendshapes **ARKit**
  (`jawOpen`, `mouthOpen`, `eyeBlinkLeft`, visemas `viseme_*`) — misma familia que
  Ready Player Me, NO Character Creator. Sin compresión meshopt/draco (GLTFLoader lo
  carga tal cual). Verificado parseando los chunks del GLB con un script Node.
- **Animación idle + gestos de cuerpo (Mixamo)**: el cuerpo ya NO usa la animación
  horneada del `.glb` — usa clips sueltos de Mixamo (`.fbx`, en `frontend/avatar/`):
  `Idle.fbx` (reposo/respirar, sustituye a la idle del `.glb`), `idle_cambio.fbx`
  (rompe la rigidez cada 10-15s, un solo pase) y `talking1/2/3.fbx` (variaciones de
  gesto mientras el tutor habla). La primera se elige **totalmente al azar**
  (`startTalkingAnimation`); si el turno dura más que un pase del gesto (respuestas
  largas), cada uno se reproduce una sola vez (`loopOnce`) y al terminar
  (`onGestureFinished`) se cruza a otro distinto —nunca el que acaba de terminar—
  con el mismo crossfade de `GESTURE_CROSSFADE_SECONDS`, así que van rotando
  mientras siga habiendo audio en cola (ver `pickTalkingAction`). Con un solo
  gesto de hablar cargado (fallo de red en los otros dos) no hay entre qué rotar:
  se queda en bucle simple, como antes. Los 4 `.fbx` se remapean (quitar prefijo `mixamorigN` de
  cada hueso, quitar la pista `.position` de `Hips` por el desajuste cm/metros con
  el `.glb`) para casar con el esqueleto del `.glb` sin retargeting completo.
  `Idle.fbx` se pide **en paralelo** con el `.glb` (para no dejar al avatar en pose
  de bind mientras carga); `idle_cambio`+`talking1-3` se cargan después, en segundo
  plano, sin bloquear el primer frame.
  - **Máquina de estados simple**: idle / idle_cambio / talking1-3 son "compañeros"
    del mismo canal de cuerpo — en todo momento hay exactamente uno activo y como
    mucho otro cruzando (`crossFadeBody`: fadeOut explícito del saliente + fadeIn
    explícito del entrante, misma duración, mismo instante). Al ser un crossfade
    simétrico entre pares, la suma de pesos es 1 en todo momento **por
    construcción**, sin ningún cálculo especial.
  - **Cara aparte**: `Idle.fbx` es mocap puro (sin blendshapes), así que el
    parpadeo/cejas/micro-mirada del `.glb` horneado se conserva en un canal
    independiente (`actionFace`, clip clonado filtrando solo pistas
    `.morphTargetInfluences`), siempre a peso 1, sin relación con la máquina de
    estados de cuerpo (fallback: si `Idle.fbx` no carga, se usa la idle completa
    del `.glb` — cuerpo + cara en una sola acción, como antes).
  - El lip-sync sigue sin tocarse: se superpone encima sobreescribiendo los
    influences de boca después de cada `mixer.update()`.
  - **Gotcha de three.js a recordar**: `AnimationAction.setEffectiveWeight(w)` fija
    `action.weight = w` **para siempre** (no solo el valor leído una vez) — y
    `_updateWeight()` calcula cada frame `weight = action.weight * interpolanteDelFade`.
    Poner `setEffectiveWeight(0)` "para que arranque limpio" deja `action.weight`
    clavado a 0 y ningún `fadeIn()` posterior puede volver a subirlo (0 × cualquier
    cosa = 0): el gesto queda mudo para siempre. No hace falta tocar el peso a mano
    en ningún sitio de este sistema; el valor de fábrica (1) más `fadeIn`/`fadeOut`
    ya hacen lo correcto.
- **Lip-sync** (`updateMouth()`): edge-tts no da marcas de viseme, así que es
  análisis del audio en tiempo real. `app.js` pasa a `setMouthOpen(volume, analyser)`
  el volumen RMS (`getAudioVolume()`) y el `AnalyserNode`.
  - La **apertura** sale del **RMS** (señal lineal, buen rango dinámico). Los bytes
    de `getByteFrequencyData` están comprimidos en dB → se quedan planos y altos
    toda la frase → si se usan para amplitud, la boca se queda abierta fija (bug
    real al cambiar la voz TTS). Solo se usan como proporción entre bandas para el
    **timbre** (forma de labios).
  - Cadena: envolvente silábica asimétrica sobre el RMS → **AGC** (normaliza contra
    la media móvil "con voz" → independiente del volumen absoluto de la voz, cambiar
    de voz TTS no descalibra) → curva gamma → `jawOpen`+`mouthOpen`;
    `mouthFunnel`/`mouthPucker` según el timbre; `mouthSmile`/`cheekPuff` muy
    sutiles. Todo con `THREE.MathUtils.lerp` por frame como pulido final.
  - Constantes con nombre al principio del bloque `// ---------- Lip-sync ----------`.
    Calibrado contra audio TTS real (Andrew y Jenny) pasando por el pipeline WebAudio
    en Chrome headless.
- **Encuadre de cámara (`frameCameraOnBust`)**: por posición de huesos (`Head` +
  hombros/brazos), NO por bounding box (los `SkinnedMesh` no tienen bbox fiable
  hasta el primer render). Fuerza `root.updateMatrixWorld(true)` antes de leer.
  Encuadra de un poco de aire sobre el pelo hasta un pelín por encima del ombligo
  (hueso `Spine`); **ancla el borde superior** y el sobrante por aspect ratio va
  hacia abajo (más torso), nunca a más aire sobre la cabeza. Se recalcula en cada
  `resize()`. Constantes `FRAME_*`.

### Despliegue

Cambio de frontend (GitHub Pages, redespliega solo al hacer push a `main` desde la
raíz). El `model.glb` pesa ~14.5MB; los 4 `.fbx` de gestos (`Idle`, `idle_cambio`,
`talking1-3`) suman ~4.5MB más. Si se reexportan varias veces conviene valorar Git
LFS para no inflar el historial. `frontend/avatar3d-preview.html` es una página
de prueba local (no se despliega, se puede borrar) para ver el modelo sin el
backend.

## Config / entorno (`backend/.env`, ver `.env.example`)

`GROQ_API_KEY`, `GROQ_MODEL`, `TTS_VOICE`, `TRANSCRIBE_MODEL`, `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY` (service_role, solo backend), `ALLOWED_ORIGINS`,
`MOODLE_URL`, `MOODLE_TOKEN`, `MOODLE_COURSE_ID`. Opcionales de tuning:
`GROQ_TIMEOUT_SECONDS`, `TTS_TIMEOUT_SECONDS`.

## Tests

`backend/tests/test_auth.py`: pruebas del login **contra la Supabase real** (sin mocks),
requiere `profesor`/`1234` existente. `requirements-dev.txt`: pytest, httpx.

## Deuda / cosas a saber

- `backend/main.py` es un archivo único de ~1900 líneas; toda la lógica del WS está ahí.
- `ias_funcionando.py`: script suelto para listar modelos Groq disponibles.
- El logging del backend es deliberadamente verboso (`logger.exception`) porque Render
  captura stdout como consola del servicio: ahí aparece la causa real de fallos de
  Groq/TTS/Supabase que el alumno solo ve como error genérico.
- ⚠️ **`backend/.env` está versionado en git** (`git ls-files` lo confirma, dentro
  de `hugo967/tutor-ingles-backend`), con `GROQ_API_KEY` y `SUPABASE_SERVICE_KEY`
  (la *service_role*, con acceso total a la BD) en texto plano en el historial de
  commits. Pendiente de que el usuario decida: rotar ambas claves y sacar `.env`
  del repo (`git rm --cached backend/.env` + `.gitignore`), y valorar si hace
  falta purgar el historial según la visibilidad del repo.

## Auditoría de bugs (2026-09-13)

Repaso completo de `frontend/` y `backend/` en busca de errores de ejecución,
selectores DOM rotos, código muerto y fallos silenciosos en WS/Supabase/Three.js.
Corregido y verificado (tests + smoke test real por WebSocket contra Supabase/Groq
reales, más pruebas aisladas con mocks para los dos bugs de más impacto):

- **IDOR en `GET /api/history/{session_id}`** (backend/main.py): no comprobaba
  propiedad de la sesión — cualquier usuario autenticado podía leer los mensajes
  de la conversación de otro alumno con solo conocer/adivinar el UUID. Ahora exige
  ser el dueño o un profesor (la Vista Profesor reutiliza este mismo endpoint).
- **Pérdida silenciosa de `score`** en `POST /api/exercises/{id}/progress`: al
  marcar un reto "en curso" (sin mandar `score`) se sobrescribía a `null` en
  Supabase cualquier puntuación ya guardada. Ahora solo se toca si el cliente lo
  manda explícitamente.
- **`loadUserProgress()` en app.js** apuntaba a un `#progressContent` inexistente
  (el panel real lo pinta `loadProgreso()`, inline en index.html) y no la llamaba
  nadie: eliminada (dead code).
- Fallback hardcodeado `"alumno1"` en `getCurrentUser()` (usuario de pruebas de
  antes de que existiera login real): eliminado.
- Orden de reconexión del WebSocket (`socket.onopen` en app.js): si había un Reto
  o práctica de Moodle activos pero sin `session_id` previo, se mandaba `config`
  antes que `exercise_start`/`moodle_exercise_start`, lo que podía disparar un
  tema propuesto nuevo por encima del Reto en curso al reconectar. Ahora se avisa
  primero del Reto/Moodle activo.
- Funciones de DB nunca llamadas desde ningún sitio (`get_or_create_user`,
  `get_exercise`, `update_exercise`, `delete_exercise`, `list_users`) y sus
  imports huérfanos en main.py: eliminadas.
