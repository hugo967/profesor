# Estado del Proyecto — Tutor de Inglés MVP

## 1. Resumen del Proyecto y Arquitectura Actual

Tutor de inglés conversacional con avatar 3D animado y voz, orientado a dos roles: **Alumno** y **Profesor**. Ya no depende de Moodle para identificar al usuario: tiene su propia pantalla de login con usuario y contraseña, y está **desplegado públicamente**.

**Despliegue**
- **Backend**: FastAPI en **Render** (`https://tutor-ingles-backend.onrender.com`), que sirve también la API REST, el WebSocket y (en local) el propio frontend estático.
- **Frontend**: publicado en **GitHub Pages**. `frontend/app.js` detecta dinámicamente contra qué backend hablar (`detectApiBaseUrl`): si el host termina en `github.io` usa la URL fija de Render; en cualquier otro caso (local, u otro despliegue) usa `window.location.origin`. Se puede forzar otro backend manualmente con `localStorage.setItem('backend_url', ...)`.
- **CORS**: `CORSMiddleware` en `main.py` permite siempre `https://*.github.io` (`allow_origin_regex`) más orígenes extra opcionales vía la variable de entorno `ALLOWED_ORIGINS` (lista separada por comas) configurada en Render. Cuando el backend sirve también el frontend (mismo origen), CORS no interviene.
- **Variables de entorno** (`backend/.env`, no versionado; plantilla en `backend/.env.example`): `GROQ_API_KEY`, `GROQ_MODEL`, `TTS_VOICE`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ALLOWED_ORIGINS`, y las nuevas `MOODLE_URL`/`MOODLE_TOKEN`/`MOODLE_COURSE_ID` (ver Moodle más abajo — **pendientes de recibir del cliente**, todavía sin rellenar ni en local ni en Render). Se configuran igual en el panel de variables de entorno de Render.

**Backend** (`backend/`)
- FastAPI (`main.py`) sirviendo tanto la API REST como un WebSocket de chat (`/ws/chat`) y el frontend estático (`StaticFiles` montado en `/`).
- IA conversacional vía Groq (`AsyncGroq`, modelo configurable por `GROQ_MODEL`), con un `SYSTEM_PROMPT` base más hints dinámicos por nivel (A1–B2) y por contexto (conversación libre, gramática, vocabulario, entrevista de trabajo, recepcionista de hotel, viajes).
- Texto a voz con `edge-tts`, devuelto como audio en base64 junto con la respuesta del tutor.
- Persistencia en **Supabase** (Postgres) a través de `db.py`, usando la `service_role key` (cliente con privilegios de backend, nunca expuesta al frontend).
- **Autenticación real por usuario y contraseña** (`POST /api/auth/login`): contraseñas con hash `bcrypt` (`security.py`, librería `bcrypt` directa en vez de `passlib`, ver nota en el propio archivo). No hay autorregistro público: las cuentas de alumno solo las crea un profesor autenticado (`POST /api/teacher/create-student`); el profesor puede resetear la contraseña de un alumno (`POST /api/teacher/reset-password`). El resto de endpoints siguen protegidos con la cabecera `X-User-Id` (acepta UUID o username, resuelta en `resolve_user_id`/`get_current_user_id`), que el frontend rellena tras el login.
- `backend/seed_profesor.py`: script puntual para crear/actualizar en Supabase el usuario `profesor` (rol `teacher`, contraseña `1234`) reutilizando el mismo hash de `security.py`.
- **Integración con Moodle (lectura en caliente, sin persistencia)**: `moodle_client.py` (cliente de solo lectura contra la Web Services API de Moodle, `core_course_get_contents` + descarga de ficheros, con caché en memoria de ~60s; el `wstoken` nunca sale del backend, el id que ve el frontend es un hash opaco del `fileurl`) y `gift_parser.py` (parser pragmático del formato GIFT: opción múltiple, verdadero/falso, respuesta corta y preguntas abiertas). Nada de esto toca Supabase.
- **Tests** (`backend/tests/test_auth.py`, `pytest` + `httpx`, dependencias en `requirements-dev.txt`): cubren `POST /api/auth/login` contra la Supabase real (credenciales correctas/incorrectas, usuario inexistente, campos vacíos). Confirmado que el login de `profesor` funciona end-to-end.

**Frontend** (`frontend/`)
- `index.html` + `app.js` (módulo ES, sin build step, importa Three.js desde CDN/import maps).
- **Pantalla de login** (`#login-screen`) con usuario y contraseña que llama a `POST /api/auth/login`, guarda `username`/`user_id`/rol en `localStorage` y arranca el WebSocket ya autenticado (`?username=` en la URL del WS es solo para identificar la conexión, la autenticación real ya ocurrió en el login).
- Avatar 3D (`model.glb`, `idle.glb`, `Talking.glb`) renderizado con Three.js, con animaciones idle/talking, lipsync aproximado vía análisis de volumen del audio (`AnalyserNode`) y mezclador de morph targets.
- Chat por texto y voz (`SpeechRecognition` del navegador) sobre el WebSocket.
- Modal de "Ajustes" con pestañas ruteadas (`/progreso`, `/historial`, `/ejercicios`, `/retos`, `/profesor`) sincronizadas con `history.pushState`.
- Detección de rol de profesor tanto por username reservado (`profesor`/`teacher`) como por el rol real devuelto por el backend al conectar (mensaje `welcome`), lo que oculta/muestra pestañas dinámicamente.

Commits recientes relevantes: `3e39492` (index.html inicial), `17bdbfe` (extracción de CSS/JS a `style.css`/`script.js`), `4ee054c` (botón de configuración), `e9b8959` (backend completo + CORS + detección dinámica de backend, sustituye `script.js`/`style.css` por `app.js`), `a60e94c` (fija la URL del backend de Render en el frontend) y `8307b02` (tests del login, confirma que la autenticación de `profesor` funciona).

## 2. Funcionalidades Completadas

- **Despliegue público**: backend en Render (FastAPI) y frontend en GitHub Pages, con detección dinámica del backend desde el frontend y CORS restringido a `*.github.io` + orígenes extra configurables.
- **Login real con usuario y contraseña** (`POST /api/auth/login`, hash `bcrypt`), sin autorregistro: las cuentas de alumno las crea el profesor desde su panel (`POST /api/teacher/create-student`), que también puede resetear contraseñas olvidadas (`POST /api/teacher/reset-password`). Cubierto por tests (`backend/tests/test_auth.py`) contra la Supabase real; usuario `profesor`/`1234` verificado y sembrable con `backend/seed_profesor.py`.
- **Chat con IA por texto y voz**, con avatar 3D animado y lipsync básico.
- **Configuración de nivel y contexto** de la conversación, persistida en Supabase (`users.level`) y aplicada al prompt del sistema en caliente.
- **Test de nivel** (cuestionario rápido en el frontend) que sugiere A1–B2 automáticamente.
- **Historial de conversaciones del alumno**: listar sesiones, retomar una conversación (`GET /api/history/{id}`) y eliminarla (`DELETE /api/history/{id}`), con guardado incremental de cada turno en `chat_messages`.
- **Separación de roles Alumno / Profesor**:
  - El rol se resuelve en el backend (`users.role`, con altas automáticas a `teacher` para los usernames reservados `profesor`/`teacher`) y se comunica al frontend en el mensaje `welcome` del WebSocket.
  - La pestaña "Retos / Tareas" es exclusiva de Alumno (se oculta para profesor y se redirige si se fuerza la URL `/retos`); la pestaña "Vista Profesor" solo se muestra si `isTeacher` es verdadero.
  - Los endpoints de profesor (`POST /api/exercises`, `GET /api/teacher/summary`, `GET /api/teacher/history/{student_id}`) verifican en el backend que `users.role == "teacher"` antes de responder (403 si no), no solo se ocultan en la UI.
- **Panel de Profesor**: resumen de alumnos (nivel medio, mensajes de hoy), gráfica de actividad de los últimos 7 días (Chart.js), tabla de alumnos con última conexión y nº de mensajes, y formulario para **asignar retos/tareas** a un alumno concreto (título, nivel, tipo, descripción, fecha límite).
- **Retos/Ejercicios asignables y evaluados por la IA**:
  - Ejercicios visibles para un alumno = publicados globalmente + los asignados específicamente a él (`assigned_to`).
  - Al iniciar un reto (`exercise_start`), el prompt del sistema se amplía con las reglas pedagógicas del reto activo.
  - La IA solo marca un reto como completado emitiendo el tag interno `[RETO_COMPLETADO]` tras varios intercambios pedagógicamente válidos; el prompt prohíbe explícitamente la auto-aprobación por petición directa del alumno (mitigación ya aplicada al problema descrito en la sesión anterior).
  - El backend intercepta el tag, actualiza `exercise_progress` a `completed` y notifica al frontend (`exercise_completed`), que muestra una alerta de "¡Reto Superado!".
- **Desacoplamiento de Retos respecto del Historial**: mientras hay un reto activo (`active_exercise`), los turnos de chat **no** se guardan en `chat_sessions`/`chat_messages` — se tratan como una evaluación puntual y aislada. Esto evita que un reto contamine o pueda "reanudarse" como si fuera una conversación libre del Historial.
- **Seguridad de acceso a datos vía RLS en Supabase**: las tablas se acceden desde el backend con la `service_role key` (bypassa RLS por diseño, ya que es el único cliente de confianza), mientras que el frontend nunca tiene credenciales de Supabase — todo pasa por la API FastAPI. El control de acceso por usuario/rol se aplica en la capa de aplicación: cabecera `X-User-Id` obligatoria en todos los endpoints (`get_current_user_id`), verificación de propiedad de sesión antes de borrarla (`api_delete_session`), y verificación de `role == teacher` en los endpoints de profesor. *(Nota: las políticas RLS en sí se gestionan desde el panel de Supabase y no están versionadas en este repo; conviene documentarlas o migrarlas a SQL versionado si aún no existe esa copia.)*
- **Pestaña "Ejercicios" del alumno conectada a Moodle en vivo — código completo, pendiente de credenciales reales** (requisito nuevo del cliente: sin persistencia en base de datos). Implementado de punta a punta:
  - `GET /api/moodle/exercises`: lista en caliente los `.gift`/`.txt` del curso de Moodle configurado (401 sin auth, 503 si `MOODLE_URL`/`MOODLE_TOKEN`/`MOODLE_COURSE_ID` no están rellenas, 502 si Moodle responde con error).
  - WebSocket `moodle_exercise_start`/`moodle_exercise_end`: mismo patrón que los Retos existentes (`exercise_start`/`exercise_end`), pero con un prompt propio (`build_moodle_exercise_prompt`) que embebe las preguntas GIFT (o el texto de referencia si es `.txt`) y guía al tutor a plantearlas una a una en el chat normal (texto/voz). Se cierra con el tag interno `[MOODLE_DONE]` (misma mecánica tolerante que `[RETO_COMPLETADO]`) — **a diferencia de un Reto, al completarse no hay ninguna escritura a Supabase**, solo se limpia el estado en memoria de esa conexión y se avisa al frontend.
  - Un Reto y una práctica de Moodle son mutuamente excluyentes (arrancar uno cierra el otro).
  - Frontend: `loadMoodleExercises()`/`startMoodleExercise()` en `app.js` sustituyen a la antigua `loadExercisesList()` (que existía pero no estaba conectada a ningún `#exercisesContent`); badge compartido con los Retos, se cierra sola al pulsar "Nuevo Chat" y se re-sincroniza si el WebSocket reconecta a media práctica.
  - Verificado: `gift_parser.parse_gift()` contra un fichero GIFT de ejemplo (opción múltiple, V/F, respuesta corta, ensayo — los 4 tipos parsean correctamente); `GET /api/moodle/exercises` probado contra el backend real (401 sin auth, 503 sin configurar, sin tocar Supabase).
  - **No probado con un Moodle real todavía** — ver Tareas Pendientes.

## 3. Tareas Pendientes / Próximos Pasos

- 🔴 **BLOQUEANTE — Integración con Moodle: a la espera de que el cliente nos dé 3 datos.** El código está completo y desplegado (ver Funcionalidades Completadas), pero sin probar contra un Moodle real. Necesitamos que nos pasen:
  1. `MOODLE_URL` — URL raíz del Moodle (sin ruta detrás), ej. `https://moodle.vuestrocentro.es`.
  2. `MOODLE_TOKEN` — token de un Web Service con la función `core_course_get_contents` habilitada (requiere activar Web Services + protocolo REST en el Moodle, y un usuario de servicio matriculado en el curso).
  3. `MOODLE_COURSE_ID` — id numérico del curso del que leer los `.gift`/`.txt`.

  En cuanto los tengamos: rellenar `backend/.env` (local) y las variables de entorno de Render (producción), probar `GET /api/moodle/exercises` contra el Moodle real, y validar el flujo completo desde la pestaña "Ejercicios" del frontend (listar prácticas → iniciar una → el tutor la plantea conversacionalmente → tag `[MOODLE_DONE]` la cierra). Hasta entonces la pestaña "Ejercicios" solo muestra "La integración con Moodle no está configurada todavía" (503), sin afectar al resto de la app.
- **Mostrar los retos asignados dentro del historial del alumno en la vista del Profesor.** Actualmente `viewStudentHistory` (`app.js`) solo consume `GET /api/teacher/history/{student_id}`, que devuelve `chat_sessions` — y como los retos están desacoplados del historial (ver arriba), el profesor no ve ahí qué retos se asignaron ni su estado (`pending`/`in_progress`/`completed`). Falta:
  - Un endpoint (o ampliar `get_teacher_summary`/nuevo `GET /api/teacher/exercises/{student_id}`) que devuelva `exercise_progress` + datos del ejercicio para un alumno.
  - Integrar esa info en `viewStudentHistory` (p. ej. una sección "Retos asignados" junto a las conversaciones) para que el profesor tenga visión completa del alumno en un único sitio.
- **Gestión de ejercicios por el profesor**: hoy solo se pueden crear (`POST /api/exercises`); faltan editar/eliminar/despublicar desde el panel.
- **Versionar el esquema de Supabase y las políticas RLS** (actualmente solo viven en el dashboard de Supabase) para poder reproducir el entorno y auditar permisos.
- **Revisar `get_ai_response` en `main.py`**: la rama de "carga alta" (`active_connections_count > 10`) tiene tres caminos que hacen exactamente lo mismo (llamar a Groq sin diferencias reales); si el objetivo era limitar/priorizar peticiones bajo carga, esa lógica está sin terminar.
- **Endurecer la sesión tras el login**: hoy el frontend guarda `username`/`user_id`/rol en `localStorage` tras el login y el WebSocket solo verifica que el `username` exista (`?username=` en la URL), sin volver a comprobar la contraseña ni usar un token de sesión; evaluar firmar la sesión (p. ej. JWT de corta duración) para no depender de que nadie pueda abrir el WS conociendo solo el username de otro usuario.
- **Free tier de Render**: si el backend está en el plan gratuito, se "duerme" tras inactividad y el primer request/WS tras un tiempo sin uso tarda varios segundos en responder (cold start); documentarlo o considerar un plan de pago / un ping periódico si afecta a la experiencia real de uso.
