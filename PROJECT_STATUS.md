# Estado del Proyecto — Tutor de Inglés MVP

## 1. Resumen del Proyecto y Arquitectura Actual

Tutor de inglés conversacional pensado para integrarse en Moodle (login por `?username=` en la URL), con un avatar 3D animado y voz, orientado a dos roles: **Alumno** y **Profesor**.

**Backend** (`backend/`)
- FastAPI (`main.py`) sirviendo tanto la API REST como un WebSocket de chat (`/ws/chat`) y el frontend estático (`StaticFiles` montado en `/`).
- IA conversacional vía Groq (`AsyncGroq`, modelo configurable por `GROQ_MODEL`), con un `SYSTEM_PROMPT` base más hints dinámicos por nivel (A1–B2) y por contexto (conversación libre, gramática, vocabulario, entrevista de trabajo, recepcionista de hotel, viajes).
- Texto a voz con `edge-tts`, devuelto como audio en base64 junto con la respuesta del tutor.
- Persistencia en **Supabase** (Postgres) a través de `db.py`, usando la `service_role key` (cliente con privilegios de backend, nunca expuesta al frontend).
- Autenticación ligera basada en cabecera `X-User-Id` (acepta UUID o username) resuelta en `resolve_user_id`/`get_current_user_id`; no hay contraseñas, es un modelo pensado para confiar en el login externo de Moodle.

**Frontend** (`frontend/`)
- `index.html` + `app.js` (módulo ES, sin build step, importa Three.js desde CDN/import maps).
- Avatar 3D (`model.glb`, `idle.glb`, `Talking.glb`) renderizado con Three.js, con animaciones idle/talking, lipsync aproximado vía análisis de volumen del audio (`AnalyserNode`) y mezclador de morph targets.
- Chat por texto y voz (`SpeechRecognition` del navegador) sobre el WebSocket.
- Modal de "Ajustes" con pestañas ruteadas (`/progreso`, `/historial`, `/ejercicios`, `/retos`, `/profesor`) sincronizadas con `history.pushState`.
- Detección de rol de profesor tanto por username reservado (`profesor`/`teacher`) como por el rol real devuelto por el backend al conectar (mensaje `welcome`), lo que oculta/muestra pestañas dinámicamente.

Commits recientes relevantes: `3e39492` (index.html inicial), `17bdbfe` (extracción de CSS/JS a `style.css`/`script.js`) y `4ee054c` (botón de configuración). El estado actual en curso reemplaza `script.js`/`style.css` por `app.js` (CSS inline en `index.html`) y añade la carpeta `backend/` completa.

## 2. Funcionalidades Completadas

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

## 3. Tareas Pendientes / Próximos Pasos

- **Mostrar los retos asignados dentro del historial del alumno en la vista del Profesor.** Actualmente `viewStudentHistory` (`app.js`) solo consume `GET /api/teacher/history/{student_id}`, que devuelve `chat_sessions` — y como los retos están desacoplados del historial (ver arriba), el profesor no ve ahí qué retos se asignaron ni su estado (`pending`/`in_progress`/`completed`). Falta:
  - Un endpoint (o ampliar `get_teacher_summary`/nuevo `GET /api/teacher/exercises/{student_id}`) que devuelva `exercise_progress` + datos del ejercicio para un alumno.
  - Integrar esa info en `viewStudentHistory` (p. ej. una sección "Retos asignados" junto a las conversaciones) para que el profesor tenga visión completa del alumno en un único sitio.
- **Pestaña "Ejercicios" del alumno**: en `index.html` sigue con el placeholder `"Próximamente"`; decidir si se fusiona con "Retos / Tareas" o se implementa por separado (`loadExercisesList` ya existe en `app.js` pero no está conectada a esa pestaña).
- **Gestión de ejercicios por el profesor**: hoy solo se pueden crear (`POST /api/exercises`); faltan editar/eliminar/despublicar desde el panel.
- **Versionar el esquema de Supabase y las políticas RLS** (actualmente solo viven en el dashboard de Supabase) para poder reproducir el entorno y auditar permisos.
- **Revisar `get_ai_response` en `main.py`**: la rama de "carga alta" (`active_connections_count > 10`) tiene tres caminos que hacen exactamente lo mismo (llamar a Groq sin diferencias reales); si el objetivo era limitar/priorizar peticiones bajo carga, esa lógica está sin terminar.
- **Autenticación real**: el modelo actual confía ciegamente en el `username` que llega por query param o cabecera `X-User-Id` (sin verificación de identidad más allá de existir en `users`); evaluar si Moodle puede firmar/validar ese usuario antes de producción.
