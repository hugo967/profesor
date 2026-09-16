# Resumen del proyecto — Tutor de Inglés MVP

Resumen escrito a partir del código real (no de otros .md). Sirve como contexto
para futuras sesiones.

## Qué es

App web de un **tutor de inglés conversacional con IA** para hispanohablantes.
El alumno chatea (texto o voz) con un "profesor" que responde por escrito y con
voz (TTS), corrige errores de forma natural y propone temas. Hay un panel de
profesor para gestionar alumnos, ver actividad y asignar retos/tareas.

## Estado actual (2026-09-16)

### Resumen de la sesión de hoy (Moodle: integración + varios bugs reales encontrados jugando con ello en vivo)

Todo lo de hoy está **verificado en vivo** en cada paso (WebSocket real,
Groq/TTS reales, Supabase real, el Moodle real del cliente) según se iba
implementando, no solo compilado. Resumen en orden, con pointer a la sección
con el detalle completo de cada uno:

1. **Moodle multi-curso + mod_page/mod_assign**: cada alumno lee el curso que
   le asignó el profesor (ya no hay un único curso global); `moodle_client.py`
   extrae también el HTML de páginas nativas de Moodle y el enunciado real de
   tareas (`mod_assign_get_assignments`, habilitada por el cliente a media
   sesión). Ver "Integración Moodle" y sus subsecciones más abajo.
2. **Cuatro bugs reales encontrados probando el flujo end-to-end por primera
   vez** (nunca se había probado con un alumno real con curso asignado):
   - Botón "Iniciar práctica" no hacía nada (HTML del `onclick` roto por
     `JSON.stringify` dentro de un atributo con comillas dobles).
   - Con el botón ya arreglado, la práctica se quedaba con el input
     bloqueado para siempre: nada llamaba al LLM para la primera
     intervención del tutor (arreglado con `send_exercise_kickoff`,
     reutilizado también para Retos).
   - El kickoff de una tarea (mod_assign) era genérico ("Sure, go
     ahead..."): el enunciado real llegaba al prompt pero mal enmarcado.
   - Cambiar de práctica/Reto a medias mezclaba las instrucciones de ambos
     en el contexto del LLM (`del messages[1:]` que faltaba).
   Ver "Bug: ..." en "Integración Moodle" más abajo para cada uno.
3. **Prácticas de Moodle unificadas en Historial, como un chat normal**: se
   probó primero una pestaña "Progreso" separada con ventana de reanudación
   de 1h (columnas nuevas en `chat_sessions`, endpoint y UI dedicados) —
   **revertido a petición del cliente** por simplicidad: ahora se guardan
   turno a turno exactamente igual que la conversación libre o un tema
   propuesto, sin ningún concepto nuevo, y aparecen en `GET /api/history`
   mezcladas con el resto. Ver "Prácticas de Moodle guardadas como chats
   normales" más abajo.
4. **Cobertura completa del contenido de una práctica `.txt`**: el tutor ya
   no se queda enganchado al primer tema/palabra del documento — cubre todos
   los puntos a lo largo de la práctica. Ver "Cobertura completa..." más
   abajo.
5. **Bug: el tutor revelaba la traducción dentro de su propia pregunta** en
   tareas de producción libre (p. ej. "¿Cómo dirías 'We are friends' en
   inglés?", entregando la respuesta). Arreglado con la nueva regla
   `_MOODLE_FREE_PRODUCTION_CUE_RULE` (aplicada a los branches `"txt"` y
   `"assign"` de `build_moodle_exercise_prompt`): nunca inventar/revelar una
   frase objetivo en inglés, dar una pista situacional en español y dejar
   intentar al alumno antes de corregir. Ver "Bug: el tutor revelaba..." más
   abajo.
6. **Frontend: Nivel/Modo bloqueados durante una práctica de Moodle**: los
   desplegables `#level-select`/`#context-select` se deshabilitan
   (visual + funcionalmente) mientras hay una práctica de Moodle activa, y
   se reactivan solos al pulsar "Nuevo Chat" o al retomar una conversación
   libre desde Historial (hueco real que había en `loadSpecificSession`,
   arreglado de paso). Sin verificación en navegador real (Chromium no se
   pudo instalar en este entorno, sin salida a esa CDN) — verificado por
   revisión de código, `disabled`/`:disabled` son comportamiento nativo
   del navegador. Ver "Nivel/Modo bloqueados..." más abajo.

**Pendiente / conocido, sin resolver hoy**:
- `backend/.env` sigue versionado en el repo con `GROQ_API_KEY` y
  `SUPABASE_SERVICE_KEY` en texto plano (ver "Deuda / cosas a saber" más
  abajo) — rotar esas claves y sacarlo del historial de git sigue
  pendiente de decisión del usuario. Hoy además se le añadió
  `MOODLE_URL`/`MOODLE_TOKEN` en local para poder probar contra el Moodle
  real del cliente — **`backend/.env` se dejó fuera a propósito del commit
  de cierre de hoy** (no se quiso sumar un secreto más al historial de git
  mientras esa decisión sigue pendiente); sigue **igual de pendiente que
  antes** darlos de alta a mano en el panel de Render (Environment) para
  que la integración de Moodle funcione en producción.
- Falta asignar `moodle_course_id` a más alumnos aparte de `Hugo` (curso
  `id=2`, usado para todas las pruebas de hoy) desde el panel de profesor.
- Si se cambia la contraseña de `profesor` (pedido en la sesión pero NO
  ejecutado, solo se explicaron los pasos a mano), hay que actualizar
  también `backend/tests/test_auth.py` (hardcodea `profesor`/`1234`).

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
- `users.moodle_course_id` (nullable, text): curso de Moodle asignado a ese alumno
  (ver sección "Integración Moodle"). Columna añadida por
  `sql/add_moodle_course_id.sql` — **pendiente de ejecutar en Supabase**
  (2026-09-16).

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
cierra el otro). Los turnos de un Reto **no se guardan** en `chat_sessions`/
`chat_messages` mientras está activo (decisión deliberada: no se puede reanudar
desde el Historial; si se abandona a medias se archiva aparte, ver
`_archive_exercise_conversation`). Los turnos de una **práctica de Moodle SÍ se
guardan**, como un chat_session normal, desde el primer mensaje del tutor —
aparece en Historial igual que la conversación libre o un tema propuesto (ver
sección "Prácticas de Moodle guardadas como chats normales" más abajo).

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

### Multi-curso (2026-09-16): el curso ya no es global

El diseño original era **un único curso para toda la app** (`MOODLE_COURSE_ID`
global). El cliente avisó de que en su Moodle real distintos alumnos están en
distintos cursos, así que se rediseñó:

- `MOODLE_URL` y `MOODLE_TOKEN` **siguen siendo globales** (un solo sitio Moodle,
  un solo token de servicio — un token no está atado a un curso concreto).
- El curso pasa a ser **un dato por alumno**: columna `users.moodle_course_id`
  (nullable; ver `sql/add_moodle_course_id.sql`, sección "Modelo de datos"),
  que asigna el profesor desde su panel con el nuevo botón "🎓 Moodle" por
  alumno en la tabla de `frontend/app.js` (`toggleMoodleCourse`/
  `submitMoodleCourse`) → `POST /api/teacher/set-moodle-course` (mismo patrón
  que `reset-password`: protegido a `role == "teacher"`, identifica al alumno
  por `student_id` o `username`, `moodle_course_id` vacío/null lo quita).
- `GET /api/moodle/exercises` y el `moodle_exercise_start` del WebSocket ya no
  usan una variable global: leen el `moodle_course_id` del alumno autenticado
  (del `user` ya cargado en la conexión del WS, o de `get_user_by_id` en el
  endpoint REST). Si el alumno no tiene curso asignado → **409** con mensaje
  claro ("Tu profesor todavía no te ha asignado un curso de Moodle"), no el 503
  genérico (ese se reserva para cuando falta `MOODLE_URL`/`MOODLE_TOKEN`).

**Bug de aislamiento detectado y arreglado antes de implementar esto**: la
caché (`_list_cache`) y el índice de ficheros (`_file_index`) de
`moodle_client.py` eran **un único diccionario global**, no por curso — diseño
razonable mientras solo existía un curso para toda la app, pero con
multi-curso hubiera mezclado contenidos entre alumnos con curso distinto (dos
alumnos abriendo Ejercicios en la misma ventana de 60s podían recibir el
listado cacheado del curso del otro) y abría una vía de **IDOR**: un
`exercise_id` (hash de 12 caracteres del fileurl) de un curso podía resolverse
igual desde `get_file_content` aunque se pidiera con el `course_id` de otro
alumno, porque el índice no comprobaba a qué curso pertenecía. Arreglado
indexando ambos por `course_id` (`Dict[course_id, {...}]`), así un alumno
nunca puede recibir ficheros de un curso que no es el suyo.

### Módulos nativos de Moodle: mod_page y mod_assign (2026-09-16)

`list_course_files`/`get_file_content` (`moodle_client.py`) ya no solo leen ficheros
`.gift`/`.txt` adjuntos (mod_resource): también extraen texto de dos tipos de
actividad nativa de Moodle que no son un fichero descargable normal:

- **mod_page**: el cuerpo de la página llega en `contents` como un fichero HTML
  "virtual" (típicamente `index.html`, `mimetype: text/html`) — se descarga igual
  que cualquier fichero y se le quita el marcado con un extractor propio basado en
  `html.parser.HTMLParser` de la stdlib (`_html_to_text`, sin dependencias nuevas):
  descarta `<script>`/`<style>`, convierte etiquetas de bloque (`p`, `br`, `li`,
  `div`, `h1-h6`, `tr`) en saltos de línea.
- **mod_assign**: el enunciado no aparece en `contents` en absoluto, solo en el
  campo `description` del módulo — y Moodle únicamente lo manda si el profesor
  marcó "Mostrar descripción en la página del curso". Se genera una entrada
  sintética (sin `fileurl`, contenido ya resuelto en la propia respuesta de
  `core_course_get_contents`) cuando esa descripción existe; si no existe, la
  tarea simplemente no aparece en Ejercicios.

**Verificado contra el Moodle real del cliente (curso `id=2`)**: al inspeccionar
`core_course_get_contents` para ese curso, "Possessive_vocabulary" y "Possesive
Pronouns" resultaron ser **mod_resource con un `.txt` adjunto** (no mod_page como
se pensaba) — ya cubiertos por el código *anterior* a este cambio, sin necesidad
de la lógica nueva. La tarea "Escriu 5 frases amb el verb To Be" sí es mod_assign;
en un primer momento no tenía `description` en `core_course_get_contents` (el
profesor no había marcado "Mostrar descripción en la página del curso") y
`mod_assign_get_assignments` no estaba habilitada en el servicio externo del
cliente (`accessexception`).

**Resuelto (2026-09-16)**: el usuario añadió `mod_assign_get_assignments` al
servicio "TutorIA" en Moodle. `moodle_client.py` ahora la usa como fuente
principal del enunciado (`_fetch_assign_intros`, indexado por `cmid` = el mismo
`id` de módulo de `core_course_get_contents`), con el campo `description` de
`core_course_get_contents` como *fallback* solo por si algún día esa función no
está disponible para otro cliente. Re-probado en vivo contra el curso 2: la
entrada de la tarea ya sale con su enunciado real, `"Usa la teva imaginació i
escriu 5 frases amb el verb To Be"` (intro en catalán tal cual está en Moodle,
pasada por `_html_to_text`) — sin `fileurl` (viene inline de
`mod_assign_get_assignments`, no hay fichero que descargar).

### Bug: el botón "Iniciar práctica" no hacía nada (2026-09-16)

Al probar las 3 prácticas end-to-end (los dos `.txt` + la tarea de assign) en la
pestaña Ejercicios, pulsar "Iniciar práctica" no arrancaba la conversación con el
avatar -- para las 3, no solo la de assign. Causa: `loadMoodleExercises()` en
`frontend/app.js` montaba el `onclick` del botón con
`title:${JSON.stringify(ex.title)}`, que envuelve el título en comillas dobles
*literales*; esas comillas caían dentro de un atributo `onclick="..."` delimitado
también con comillas dobles, así que el HTML del botón quedaba cortado en la
primera comilla y el `onclick` resultante era JS inválido (no lanzaba error
visible, simplemente no hacía nada al pulsar). Bug preexistente a esta sesión,
nunca se había probado antes porque no había ningún alumno con
`moodle_course_id` asignado hasta ahora. Arreglado usando el mismo patrón de
escapado que ya usa el resto de `app.js` (comillas simples + `.replace(/'/g,
"\\'")`, igual que `safeName` en las filas de alumnos) en vez de
`JSON.stringify`. Confirmado con `node --check` y renderizando el markup a mano
con los 3 títulos reales del curso. El backend (`moodle_client.py`/`main.py`) ya
funcionaba bien para la entrada de assign sin `fileurl` -- probado en vivo antes
de este fix, no era la causa.

### Bug: "Iniciar práctica"/"Iniciar Reto" se quedaban pillados sin hablar (2026-09-16)

Después del fix del botón, la práctica sí arrancaba (banner + mensaje "Práctica
iniciada") pero se quedaba ahí: el avatar nunca decía nada y el input se quedaba
bloqueado para siempre. Causa real, en el **backend**, no en `app.js`: los
manejadores `exercise_start` y `moodle_exercise_start` (`main.py`) solo mandaban
su `*_ack` y ya está -- a diferencia de los temas proactivos
(`send_proactive_topic_message`), nada llamaba al LLM para generar la primera
intervención del tutor. Como el frontend hace `lockTurn()` al arrancar un Reto/
práctica (comentario ya existente: "el tutor va a presentar el Reto en voz
alta") y el único sitio que desbloquea el input es `stopVolumeMonitor
({forceIdle:true})` tras reproducir el audio de un turno, sin ningún mensaje
`{text, audio_base64}` (ni error) el input se quedaba bloqueado sin ninguna red
de seguridad -- a diferencia de los temas proactivos, que sí tienen un timeout
de 45s. `app.js`/`startMoodleExercise` en sí estaba bien: recibía `{id, title}`
correctamente y el mensaje que ya manejaba (`{text, audio_base64}`) es
exactamente el mismo formato que ya procesa el bloque genérico de respuesta del
tutor (sin necesidad de tocar el frontend).

Arreglado con `send_exercise_kickoff()` (nueva función en `main.py`, mismo
patrón que `send_proactive_topic_message`: `get_ai_response(messages)` con solo
el system prompt del Reto/práctica ya construido, sin mensaje de alumno, más
`text_to_speech_base64` y `messages.append(...)` para que el turno quede en el
historial en memoria) -- se llama justo después de cada `*_ack`. Si falla
(Groq/TTS caídos), manda `{"type":"error", ...}` (dispara la misma red de
desbloqueo que ya usa el resto del chat) y aborta el Reto/práctica devolviendo
`messages[0]` al prompt normal, en vez de dejar el backend con un Reto "activo"
fantasma. Probado en vivo con un smoke test real por WebSocket (login como
`Hugo`, que ya tiene `moodle_course_id=2` asignado) contra Groq/TTS reales:
tanto `moodle_exercise_start` (la tarea de assign) como `exercise_start` (un
Reto sintético) ya mandan `*_ack` → `typing` → `{text, audio_base64}` con
contenido real.

### Bug: el kickoff de una tarea mod_assign no sabía qué pedir (2026-09-16)

Con el fix anterior el avatar ya hablaba primero, pero para la tarea de assign
decía algo genérico ("Sure, go ahead and translate that sentence") en vez de
pedir lo que de verdad marca el enunciado. Causa: `moodle_exercise_start`
metía el contenido de CUALQUIER entrada no-GIFT (ficheros `.txt` de repaso
reales, y también el enunciado corto de un mod_assign) bajo el mismo
`kind: "txt"`, y `build_moodle_exercise_prompt` lo enmarca como "reference
material... teach it conversationally, ask questions about it" -- un marco
pensado para un documento de lectura largo, no para una instrucción de una
frase como "Usa la teva imaginació i escriu 5 frases amb el verb To Be". El
contenido SÍ llegaba completo al prompt (no era un problema de datos vacíos);
el problema era el marco/instrucciones alrededor.

Arreglado etiquetando el origen desde `moodle_client.py` (la entrada generada
a partir de `mod_assign_get_assignments`/`description` lleva ahora
`"kind": "assign"`) y propagando esa distinción hasta un tercer branch nuevo
en `build_moodle_exercise_prompt` (`kind == "assign"`): le dice al LLM que
lo que sigue es el enunciado real de una tarea (posiblemente en otro idioma),
que se lo explique al alumno en inglés y lo guíe a producirlo paso a paso
(nunca resolverlo por él), con el mismo tag `[MOODLE_DONE]` al terminar. El
endpoint `GET /api/moodle/exercises` y el frontend también distinguen el tipo
`"assign"` (antes cualquier no-GIFT salía como "material de repaso"; ahora
una tarea sale como "tarea"). Probado en vivo por WebSocket: el kickoff ahora
dice *"Your teacher wants you to write five simple sentences in English that
use the verb 'to be'... ¿Cómo dirías "Yo soy estudiante" en inglés?"*.

### Cambiar de tarea a medias ya no mezcla instrucciones (2026-09-16)

`exercise_start`/`moodle_exercise_start` reemplazaban `messages[0]` (el system
prompt) pero nunca limpiaban `messages[1:]` -- si el alumno arrancaba una
práctica nueva (o un Reto) mientras otra ya llevaba turnos intercambiados
(sin pasar por `_end`), esos turnos viejos se quedaban en el historial en
memoria que ve el LLM, mezclados con el system prompt del ejercicio nuevo: el
tutor podía arrastrar instrucciones de la tarea anterior a la nueva.

Arreglado en `main.py`: `exercise_start`/`moodle_exercise_start` hacen ahora
`del messages[1:]` incondicionalmente antes de fijar el prompt del ejercicio
nuevo, para que el LLM lo arranque sin ningún turno anterior en el contexto.
Para un Reto (`active_exercise`) abandonado a medias, sus turnos se archivan
antes con `_archive_exercise_conversation()` (nunca se guardan en vivo, así
que sin esto se perderían del todo) como una sesión propia ya cerrada
(`chat_sessions`/`chat_messages`, título `"Práctica: {título}"`), visible
desde Historial igual que cualquier otra conversación. Para una práctica de
Moodle abandonada no hace falta archivar nada: se guarda en vivo desde el
principio (ver más abajo), así que basta con dejar de referenciarla.

En `frontend/app.js`, `startExercise`/`startMoodleExercise` limpian la
pizarra del chat (mismo patrón que el botón "Nuevo Chat": `stopCurrentAudio()`
+ `hideProactiveLoading()` + vaciar `chatEl`) antes de arrancar el
Reto/práctica nuevo, para que se vea como una conversación realmente nueva y
no arrastre visualmente los mensajes del ejercicio anterior.

Probado en vivo por WebSocket: tarea de assign ("to be") con un turno de
alumno intercambiado → cambio a la práctica de vocabulario de posesivos sin
terminar la anterior → el kickoff de la práctica nueva habla de bicicletas/
posesión (el contenido real de ese `.txt`), sin ninguna mención a "to be".

### Prácticas de Moodle guardadas como chats normales (2026-09-16)

Se probó primero una separación en una pestaña "Progreso" aparte (sesiones
etiquetadas con columnas nuevas en Supabase, ventana de 1h para retomar,
endpoint y pestaña dedicados) — **revertido a petición del cliente** por
simplicidad: quería las prácticas de Moodle tratadas exactamente igual que
la conversación libre o un tema propuesto, sin ningún concepto nuevo que
aprender. La migración SQL de esa vía (`add_moodle_session_fields.sql`)
nunca llegó a ejecutarse en Supabase, así que revertir no dejó ninguna
columna huérfana.

Diseño actual, final: `moodle_exercise_start` (`main.py`) crea la sesión con
`create_chat_session()` normal y corriente (mismo `title` de siempre,
`"Práctica: {título}"`, sin ninguna columna ni marca especial) ya desde el
kickoff, para que hasta la primera frase del tutor quede guardada aunque el
alumno no llegue a responder nada. Cada turno posterior se persiste con
`_persist_message_bg()` -- el mismo mecanismo en segundo plano que ya usaba
la conversación libre, en los dos mismos puntos del código (turno del
alumno, turno del tutor), solo que condicionado a `moodle_session_id` (la
variable en memoria de esta conexión) en vez de al `session_id` de chat
libre. Al cambiar de práctica/Reto, terminarla (`moodle_exercise_end`) o
completarla (`[MOODLE_DONE]`) simplemente se deja de referenciar
(`moodle_session_id = None`) -- **sin** llamar a `end_chat_session()`: mismo
trato que la conversación libre, que tampoco cierra explícitamente su sesión
al cambiar de Contexto, solo dispara al desconectar (`_safe_end_session`).

Resultado: **cero conceptos nuevos**. Las prácticas de Moodle aparecen en
`GET /api/history` mezcladas con el resto de conversaciones, ordenadas por
fecha igual que todo, y se abren con el mismo `loadSpecificSession()`/`GET
/api/history/{session_id}` que ya usaba el Historial (sin cambios en ese
código: nunca resetea ni borra nada, solo reproduce los mensajes guardados en
el chat). El reconnect del WebSocket con una práctica de Moodle activa volvió
también a su comportamiento original (reinicia la práctica desde cero al
reconectar, [[ws-reconnect-resume]] sigue aplicando igual que a los Retos) --
la conversación previa a la desconexión queda igualmente a salvo en
Historial, solo que el hilo en memoria que ve el LLM no se retoma.

Verificado en vivo (WebSocket real + Supabase real): la sesión de una
práctica queda como una fila normal de `chat_sessions` (`ended_at` nunca se
toca mientras sigue "activa" en memoria, igual que el chat libre), sus
turnos en orden en `chat_messages`, y aparece correctamente listada en `GET
/api/history` y legible completa vía `GET /api/history/{session_id}`.

### Cobertura completa del contenido de una práctica .txt (2026-09-16)

El branch `"txt"` de `build_moodle_exercise_prompt` decía "teach it
conversationally, ask questions about it" sin más -- en la práctica el
tutor solía quedarse enganchado al primer tema/palabra del documento
(p. ej. las primeras palabras de una lista de vocabulario) sin llegar nunca
a las demás en una conversación de duración normal. Reescrito para pedirle
explícitamente al LLM que, antes de la primera respuesta, descomponga el
material en sus temas/puntos distintos, y que a lo largo de TODA la
práctica vaya cubriéndolos uno a uno -- con una transición natural (nunca
un salto brusco ni un anuncio tipo "ahora vamos con el punto 2") en cuanto
un punto ya se ha practicado razonablemente, priorizando cubrir terreno
frente a alargarse en uno solo. Solo afecta al branch "txt" (repaso libre);
"gift" (preguntas concretas) y "assign" (una tarea puntual) ya tenían su
propia lógica de progresión y no la necesitaban.

### Bug: el tutor revelaba la traducción dentro de su propia pregunta (2026-09-16)

En tareas de producción libre (p. ej. la de assign "escribe 5 frases con el
verbo to be"), el tutor a veces decía cosas como *"¿Cómo dirías 'We are
friends' en inglés?"* -- entregando la respuesta en inglés dentro de la
propia pregunta en español. Causa: la regla de `SYSTEM_PROMPT` para pedir
que el alumno traduzca algo (`¿Cómo dirías "..." en inglés?`, con una frase
en ESPAÑOL dentro de las comillas) está pensada para traducir una frase
concreta que el tutor ya tiene en mente -- pero en una tarea de producción
libre (el alumno inventa su propia frase, no traduce una dada) no hay
ninguna frase española real que poner ahí, así que el modelo se inventaba
un "objetivo" en inglés y lo metía en las comillas, violando sin darse
cuenta la regla que se supone debía seguir.

Arreglado con una nueva regla compartida (`_MOODLE_FREE_PRODUCTION_CUE_RULE`
en `main.py`), añadida a los branches `"txt"` y `"assign"` de
`build_moodle_exercise_prompt` (los dos que pueden pedir producción libre;
`"gift"` no, tiene respuestas concretas): le explica al modelo que el cue de
traducción no aplica aquí, que NUNCA invente ni revele una frase objetivo en
inglés (ni siquiera "por ejemplo, podrías decir..."), y que en su lugar dé
una pista situacional en español sin la traducción, dejando que el alumno
intente su propia frase antes de corregir -- con el ejemplo exacto que pidió
el cliente ("Para la primera frase, ¿cómo describirías a un amigo o cómo te
presentarías usando el verbo 'to be'?").

Probado en vivo por WebSocket, 3 arranques limpios de la tarea de assign
("to be"): las 3 veces el tutor usó ese patrón situacional casi textual, sin
revelar ninguna frase en inglés, y esperó la frase del alumno antes de
valorarla.

### Nivel/Modo bloqueados durante una práctica de Moodle (2026-09-16, frontend)

Los desplegables "Nivel" y "Contexto / Objetivo" de la barra superior
(`#level-select`/`#context-select`) ahora se deshabilitan (`disabled` +
opacidad reducida/cursor `not-allowed` vía CSS) mientras hay una práctica de
Moodle activa: cambiarlos no tendría ningún efecto real hasta terminar la
práctica, porque su system prompt (`build_moodle_exercise_prompt`) sustituye
por completo al de nivel/contexto mientras dura. Los Retos (`active_exercise`)
**no** bloquean estos selects -- solo se pidió para prácticas de Moodle.

Implementado extendiendo `updateExerciseBadge()` (`app.js`) en vez de añadir
llamadas nuevas: esa función ya se invoca en todos los puntos donde
`activeMoodleExercise` cambia (arrancar la práctica, `moodle_exercise_done`,
"Nuevo Chat"), así que el lock/desbloqueo queda sincronizado gratis en todos
ellos. El único hueco real era `loadSpecificSession()` (retomar una
conversación libre desde el Historial): antes no daba por terminada una
práctica de Moodle que estuviera activa, así que ahora también manda
`moodle_exercise_end`/`exercise_end` y limpia el estado en memoria, igual que
ya hacía "Nuevo Chat" -- sin esto, los selects se habrían quedado
bloqueados (y el backend habría seguido tratando el siguiente mensaje como
parte de la práctica) al retomar un chat libre desde ahí.

**Sin verificación visual en navegador real**: se intentó instalar Chromium
para Playwright y probar el flujo completo de verdad (login como `Hugo` vía
`localStorage`, sin necesitar su contraseña ya que ni el login por
`localStorage` ni el WebSocket la comprueban, arrancar una práctica,
capturar pantalla), pero la descarga del binario (`cdn.playwright.dev`)
falló repetidamente por timeout de red en este entorno -- no hay salida a
esa CDN. Queda verificado por revisión de código: `disabled` en un
`<select>` nativo y `select:disabled` en CSS son comportamiento estándar del
navegador sin lógica propia que pueda fallar, y se repasó a mano cada punto
donde `activeMoodleExercise` cambia para confirmar que `updateExerciseBadge()`
se llama siempre ahí. Pendiente de que el usuario lo confirme a ojo en el
navegador.

`gift_parser.parse_gift()`: parser pragmático de GIFT (opción múltiple, V/F, respuesta
corta, ensayo). No implementa la spec completa a propósito (sin categorías, matching,
numeric con tolerancia, ni escapado avanzado de `{}~=`).

- `.txt` → material de repaso, el tutor lo enseña conversacionalmente.
- `.gift` → el tutor guía pregunta a pregunta, una a una, sin revelar respuestas antes.

### Checklist para dejarla conectada (estado: código listo, falta configurar y probar)

Ya no son 3 variables de entorno — son **2 variables globales + 1 dato por alumno**:

| Qué | Qué es | Dónde se saca / se pone |
|---|---|---|
| `MOODLE_URL` (env, global) | Raíz del sitio Moodle, **sin** `/webservice/...` | La URL de tu Moodle |
| `MOODLE_TOKEN` (env, global) | Token de un servicio externo con `core_course_get_contents` habilitada | Administración del sitio → Servicios web → Gestionar tokens |
| `users.moodle_course_id` (por alumno, en Supabase) | ID numérico del curso de Moodle de ESE alumno | Panel de profesor → botón "🎓 Moodle" de cada fila |

**Requisitos que hay que preparar en el propio Moodle (rol administrador) antes de
tener el token:**
1. Administración del sitio → General → Servicios web → **Habilitar los servicios
   web** + habilitar el **protocolo REST**.
2. Servicios web → **Servicios externos**: crear uno nuevo (o reutilizar uno) con
   la función `core_course_get_contents` añadida.
3. Servicios web → **Gestionar tokens**: generar un token para un usuario con
   acceso de lectura al curso, asociado a ese servicio externo → eso da
   `MOODLE_TOKEN`. **Importante en multi-curso**: ese usuario tiene que tener
   acceso de lectura a TODOS los cursos que se vayan a asignar a algún alumno,
   no solo a uno — si no, Moodle devolverá un error de permisos para los demás.
4. Subir los materiales como ficheros `.gift` (cuestionarios) o `.txt` (repaso)
   en cualquier sección del curso (recurso tipo "Archivo") — son los únicos dos
   tipos que lista `moodle_client.list_course_files`.

**Estado real a 2026-09-16** (datos ya proporcionados por el cliente: sitio
`https://perseverando.easytalk.info/education`, token
`895e9c441d3a00a4c76492e08c2f3e08`, curso de ejemplo `id=2`):

1. ✅ Código implementado (backend + endpoint + panel de profesor).
2. ✅ `MOODLE_URL`/`MOODLE_TOKEN` puestos en `backend/.env` **local**.
3. ⬜ Falta darlos de alta también en el panel de Render del servicio
   (Environment) — Render no lee el `.env` del repo para las variables que ya
   tiene definidas ahí (ver `load_dotenv(override=not os.getenv("RENDER"))` en
   `main.py`), así que sin este paso el redeploy no las recoge. `backend/.env`
   se dejó **fuera a propósito** del commit de cierre de hoy (no reforzar el
   problema ya conocido de secretos versionados, ver "Deuda / cosas a saber"),
   así que este paso manual en Render sigue haciendo falta sí o sí.
4. ✅ `sql/add_moodle_course_id.sql` ejecutado en el SQL Editor de Supabase
   (confirmado en vivo: la columna `users.moodle_course_id` existe y
   funciona en la Supabase real del cliente).
5. ✅ `moodle_course_id=2` asignado al alumno `Hugo` desde el panel de
   profesor — usado para todas las pruebas end-to-end de hoy. Falta
   asignárselo también al resto de alumnos reales cuando corresponda.
6. ✅ Commiteado y pusheado a ambos repos (`hugo967/profesor` /
   `hugo967/tutor-ingles-backend`) en el cierre de la sesión de hoy.

## API REST (main.py)

- `POST /api/auth/login`, `POST /api/teacher/create-student`
- `GET /api/history` (lista sesiones con mensajes), `GET/DELETE /api/history/{session_id}`
- `GET/POST /api/exercises`, `POST /api/exercises/{id}/progress`, `GET /api/progress`
- `POST /api/transcribe` (multipart: audio + context_label + last_tutor_message → Whisper;
  máx 8MB, idioma forzado a inglés, prompt de sesgo con el tema y lo último que dijo el tutor)
- `GET /api/moodle/exercises` (curso del alumno autenticado; 409 si no tiene
  `moodle_course_id` asignado, 503 si falta `MOODLE_URL`/`MOODLE_TOKEN`)
- `GET /api/teacher/summary` (tarjetas + actividad 7 días + tabla de alumnos,
  incluye `moodle_course_id` de cada uno)
- `POST /api/teacher/reset-password`
- `POST /api/teacher/set-moodle-course` (asigna/quita el `moodle_course_id` de
  un alumno; solo profesor — añadido 2026-09-16)
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
  `monitorVolume()` (rAF) llama a `Avatar3D.setMouthOpen(volume, analyser, currentTime)`
  en cada frame para el lip-sync y los beats de puntuación del cuerpo. `avatar3d.js`
  se carga siempre (sin flag), con `.catch()` como red de seguridad. Ver sección
  "Avatar 3D" más abajo para el detalle completo.
- **Input bloqueado mientras el tutor tiene el turno** (2026-09-14, `lockTurn()`/
  `unlockTurn()`): desde que se manda un mensaje/se arranca un Reto o práctica de
  Moodle/empieza un tema proactivo, hasta que el tutor termina de hablar DEL TODO
  (incluidos los huecos entre segmentos de una misma respuesta) — el desbloqueo real
  pasa por un único punto, `stopVolumeMonitor({forceIdle:true})`, ya la señal
  existente de "no queda audio pendiente". Con salvaguardas de desbloqueo ante
  error del WS, desconexión o timeout del tema proactivo, para que nunca se quede
  bloqueado para siempre.
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

### Sincronía de gestos con el habla (2026-09-14)

Antes, el gesto de hablar activo corría "a piñón fijo": rotaba solo cuando su
propio clip terminaba, sin mirar el audio ni el texto. `updateBodySpeechSync()`
en `avatar3d.js` añade dos señales, combinadas con la lógica pura de
`frontend/avatar-speech-sync.js` (testeada con Node normal, sin three.js/DOM —
`node frontend/avatar-speech-sync.test.mjs`, 21 tests):

- **Pausa real por volumen** (`createPauseTracker`): histéresis sobre el mismo
  RMS que ya usa el lip-sync — un silencio sostenido suelta el gesto a la idle;
  al volver la voz, cruza a otro gesto de hablar.
- **Beats de puntuación del texto** (`computeTextBeats`): reparte comas/puntos/
  interrogaciones del texto de cada segmento en proporción sobre la duración
  real del audio (edge-tts no da marcas por palabra); en cada punto/pregunta
  fuerza un cambio de gesto, la coma solo adelanta la detección de la pausa.

Calibración (2026-09-14, a petición del cliente: el primer ajuste se sentía
"nervioso"/artificial): crossfades largos (~0.7-0.9s), pausa real exigida
~1.1s (no reacciona a huecos cortos entre palabras) y mínimo 3.5s entre
cambios de gesto. Todas las constantes están en el bloque
`// ---------- Sincronía de cuerpo con el habla ----------` de `avatar3d.js`.
`frontend/avatar3d-preview.html` tiene un modo de prueba con texto+audio real
y un panel "Gestos" que loguea cada transición (marca en rojo dos cambios a
menos de 250ms, indicio de tirón) para verificar a ojo sin tocar el backend.

**Fix de los huecos entre fragmentos de audio (2026-09-14, commit `798dc7f`)**:
cuando la respuesta llega troceada, un hueco de red/generación entre un
segmento y el siguiente (la cola de audio se vacía un instante) se confundía
con el fin real del turno -- se soltaba el gesto a idle y, al llegar el
siguiente trozo, se elegía uno nuevo al azar: el "corte/reseteo" que se veía
en el avatar entre fragmentos. Arreglado con:
- `app.js`: nuevo flag `responseStreaming` (true mientras la respuesta
  troceada no ha recibido su segmento `final:true`) para distinguir, cuando
  la cola se vacía, entre un hueco (quedan más fragmentos) y el fin de turno
  real -- con una red de seguridad de 45s por si el siguiente trozo nunca
  llega, y un reset completo (`stopCurrentAudio()`) si hay un error de
  WebSocket o se cae la conexión a mitad de una respuesta.
- `avatar3d.js`: nueva `Avatar3D.holdSpeechGap()` -- a diferencia de
  `setMouthOpen(0)` (parada dura), no toca `isTalking` ni suelta el gesto;
  pasa por la MISMA histéresis de pausa real de arriba (~1.1s), así que un
  hueco corto mantiene la pose de hablar de forma fluida y uno largo de
  verdad sí cruza a idle con el mismo crossfade suave.

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
`MOODLE_URL`, `MOODLE_TOKEN`. Opcionales de tuning: `GROQ_TIMEOUT_SECONDS`,
`TTS_TIMEOUT_SECONDS`.

`MOODLE_COURSE_ID` **ya no existe** como variable de entorno (2026-09-16): el
curso de Moodle es ahora un dato por alumno (`users.moodle_course_id`), no
global — ver "Integración Moodle" más arriba.

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
  falta purgar el historial según la visibilidad del repo. El `.env` local de
  trabajo (no commiteado, ver "Checklist para dejarla conectada") ya tiene
  además `MOODLE_TOKEN` del cliente -- un motivo más para no seguir posponiendo
  esta rotación/limpieza.

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
