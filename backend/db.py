"""
Módulo de acceso a datos con Supabase (Postgres).
Todas las credenciales se leen desde variables de entorno.
"""
import os
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

from dotenv import load_dotenv
from supabase import create_client, Client

# --- Cargar .env explícitamente desde la carpeta backend/ ---
BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")

# --- Cliente Supabase (service_role: solo backend) ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise RuntimeError(
        "Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en .env. "
        "Crea el archivo .env en backend/ con ambas variables."
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ============================================================
# USERS
# ============================================================
# Usernames reservados para pruebas: entran automáticamente como profesor.
TEACHER_USERNAMES = {"profesor", "teacher"}


async def get_or_create_user(username: str, role: str = "student") -> Dict[str, Any]:
    """
    Busca usuario por username; si no existe, lo crea.
    Pensado para login vía Moodle: username llega por URL/query param.
    """
    effective_role = "teacher" if username.strip().lower() in TEACHER_USERNAMES else role

    res = supabase.table("users").select("*").eq("username", username).execute()
    if res.data:
        existing = res.data[0]
        if effective_role == "teacher" and existing.get("role") != "teacher":
            res = (
                supabase.table("users")
                .update({"role": "teacher"})
                .eq("id", existing["id"])
                .execute()
            )
            return res.data[0]
        return existing

    new_user = {
        "username": username,
        "role": effective_role,
        "level": "A1",
    }
    res = supabase.table("users").insert(new_user).execute()
    return res.data[0]


async def get_user_by_id(user_id: str) -> Optional[Dict]:
    res = supabase.table("users").select("*").eq("id", user_id).execute()
    return res.data[0] if res.data else None


async def get_user_by_username(username: str) -> Optional[Dict]:
    res = supabase.table("users").select("*").eq("username", username).execute()
    return res.data[0] if res.data else None


async def update_user_level(user_id: str, level: str) -> Dict:
    res = supabase.table("users").update({"level": level.upper()}).eq("id", user_id).execute()
    return res.data[0]


async def create_user_with_password(
    username: str, password_hash: str, role: str = "student"
) -> Dict[str, Any]:
    """
    Crea un usuario nuevo con su hash de contraseña ya calculado (ver
    backend/security.py). A diferencia de get_or_create_user (pensado para
    el login sin contraseña vía Moodle), esta función siempre inserta —
    la llama el flujo de registro después de comprobar que el username no
    existía todavía.
    """
    effective_role = "teacher" if username.strip().lower() in TEACHER_USERNAMES else role
    new_user = {
        "username": username,
        "role": effective_role,
        "level": "A1",
        "password_hash": password_hash,
    }
    res = supabase.table("users").insert(new_user).execute()
    return res.data[0]


async def set_user_password(user_id: str, password_hash: str) -> Dict[str, Any]:
    res = (
        supabase.table("users")
        .update({"password_hash": password_hash})
        .eq("id", user_id)
        .execute()
    )
    return res.data[0]


# ============================================================
# CHAT SESSIONS & MESSAGES
# ============================================================
async def create_chat_session(
    user_id: str, level: str = "", context: str = "", title: str = ""
) -> str:
    session = {
        "user_id": user_id,
        "level": level.upper() if level else None,
        "context": context.lower() if context else None,
        "title": title or None,
    }
    res = supabase.table("chat_sessions").insert(session).execute()
    return res.data[0]["id"]


async def get_chat_session(session_id: str) -> Optional[Dict]:
    res = supabase.table("chat_sessions").select("*").eq("id", session_id).execute()
    return res.data[0] if res.data else None


async def end_chat_session(session_id: str):
    supabase.table("chat_sessions").update(
        {"ended_at": datetime.utcnow().isoformat()}
    ).eq("id", session_id).execute()


async def delete_chat_session(session_id: str):
    """Borra la sesión y sus mensajes asociados."""
    supabase.table("chat_messages").delete().eq("session_id", session_id).execute()
    supabase.table("chat_sessions").delete().eq("id", session_id).execute()


async def save_chat_message(
    session_id: str, role: str, content: str, audio_base64: str = None
):
    msg = {
        "session_id": session_id,
        "role": role,
        "content": content,
        "audio_base64": audio_base64,
    }
    supabase.table("chat_messages").insert(msg).execute()


async def get_user_chat_history(user_id: str, limit: int = 50) -> List[Dict]:
    """
    Devuelve las últimas sesiones con sus mensajes anidados.
    Ignora sesiones vacías (sin mensajes), p. ej. hilos abandonados
    antes de escribir el primer mensaje.
    """
    sessions = (
        supabase.table("chat_sessions")
        .select("id, title, level, context, started_at, chat_messages(role, content, created_at)")
        .eq("user_id", user_id)
        .order("started_at", desc=True)
        .limit(limit)
        .execute()
    )
    return [s for s in sessions.data if s.get("chat_messages")]


async def get_session_messages(session_id: str) -> List[Dict]:
    """
    Devuelve los mensajes asociados a una sesión en orden cronológico.
    """
    res = (
        supabase.table("chat_messages")
        .select("*")
        .eq("session_id", session_id)
        .order("created_at", desc=False)
        .execute()
    )
    return res.data if res.data else []


# ============================================================
# EXERCISES
# ============================================================
async def create_exercise(
    teacher_id: str,
    title: str,
    type_: str,
    level: str,
    content: Dict,
    assigned_to: Optional[str] = None,
) -> Dict:
    ex = {
        "teacher_id": teacher_id,
        "title": title,
        "type": type_,
        "level": level.upper(),
        "content": content,
        "assigned_to": assigned_to,
        "is_published": False,
    }
    res = supabase.table("exercises").insert(ex).execute()
    return res.data[0]


async def list_exercises(
    user_id: str, level: str = None, type_: str = None
) -> List[Dict]:
    """
    Ejercicios visibles para user_id: los publicados a todo el mundo,
    más los asignados específicamente a este alumno (aunque no estén
    publicados en el catálogo general).
    """
    q = supabase.table("exercises").select("*")
    q = q.or_(f"is_published.eq.true,assigned_to.eq.{user_id}")
    if level:
        q = q.eq("level", level.upper())
    if type_:
        q = q.eq("type", type_)
    q = q.order("created_at", desc=True)
    res = q.execute()
    return res.data or []


async def get_exercise(exercise_id: str) -> Optional[Dict]:
    res = supabase.table("exercises").select("*").eq("id", exercise_id).execute()
    return res.data[0] if res.data else None


async def update_exercise(exercise_id: str, data: Dict) -> Dict:
    data["updated_at"] = datetime.utcnow().isoformat()
    res = supabase.table("exercises").update(data).eq("id", exercise_id).execute()
    return res.data[0]


async def delete_exercise(exercise_id: str):
    supabase.table("exercises").delete().eq("id", exercise_id).execute()


# ============================================================
# EXERCISE PROGRESS
# ============================================================
async def get_or_create_progress(user_id: str, exercise_id: str) -> Dict:
    res = (
        supabase.table("exercise_progress")
        .select("*")
        .eq("user_id", user_id)
        .eq("exercise_id", exercise_id)
        .execute()
    )
    if res.data:
        return res.data[0]

    prog = {"user_id": user_id, "exercise_id": exercise_id, "status": "pending", "attempts": 0}
    res = supabase.table("exercise_progress").insert(prog).execute()
    return res.data[0]


async def update_progress(user_id: str, exercise_id: str, data: Dict) -> Dict:
    data["last_attempt_at"] = datetime.utcnow().isoformat()
    if data.get("status") == "completed":
        data["completed_at"] = datetime.utcnow().isoformat()
    res = (
        supabase.table("exercise_progress")
        .update(data)
        .eq("user_id", user_id)
        .eq("exercise_id", exercise_id)
        .execute()
    )
    return res.data[0]


async def get_user_progress(user_id: str) -> List[Dict]:
    res = (
        supabase.table("exercise_progress")
        .select("*, exercises(title, type, level)")
        .eq("user_id", user_id)
        .execute()
    )
    return res.data


# ============================================================
# TEACHER SUMMARY & USERS
# ============================================================
LEVEL_ORDER = ["A1", "A2", "B1", "B2"]


def _average_level(levels: List[str]) -> Optional[str]:
    values = [LEVEL_ORDER.index(l) for l in levels if l in LEVEL_ORDER]
    if not values:
        return None
    return LEVEL_ORDER[round(sum(values) / len(values))]


async def get_teacher_summary() -> Dict[str, Any]:
    """
    Resumen para el panel de profesor: alumnos con su última conexión y
    total de mensajes, más el conteo de mensajes de los últimos 7 días
    (para la gráfica de actividad) y los totales de las tarjetas.
    """
    users_res = (
        supabase.table("users")
        .select("id, username, level, role")
        .eq("role", "student")
        .execute()
    )
    students = users_res.data or []

    sessions_res = supabase.table("chat_sessions").select("user_id, started_at, ended_at").execute()
    sessions_by_user: Dict[str, List[Dict]] = {}
    for s in sessions_res.data or []:
        sessions_by_user.setdefault(s["user_id"], []).append(s)

    # Se trae el user_id de cada mensaje a través de la sesión a la que
    # pertenece, para poder contar mensajes por alumno y por día en una
    # sola consulta.
    messages_res = supabase.table("chat_messages").select("created_at, chat_sessions(user_id)").execute()
    messages = messages_res.data or []

    today = datetime.utcnow().date()
    last_7_days = [(today - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
    daily_counts: Dict[str, int] = {day: 0 for day in last_7_days}
    message_count_by_user: Dict[str, int] = {}

    for m in messages:
        session = m.get("chat_sessions") or {}
        uid = session.get("user_id")
        if uid:
            message_count_by_user[uid] = message_count_by_user.get(uid, 0) + 1

        created_at = m.get("created_at") or ""
        day = created_at[:10]
        if day in daily_counts:
            daily_counts[day] += 1

    result_students = []
    for u in students:
        uid = u["id"]
        user_sessions = sorted(
            sessions_by_user.get(uid, []),
            key=lambda s: s.get("started_at") or "",
            reverse=True,
        )
        last_session = user_sessions[0] if user_sessions else None
        status = "Sin sesiones"
        last_connection = None
        if last_session:
            last_connection = last_session.get("started_at")
            status = "Activo" if last_session.get("ended_at") is None else "Completado"

        result_students.append({
            "id": uid,
            "name": u["username"],
            "level": u["level"] or "A1",
            "status": status,
            "last_connection": last_connection,
            "message_count": message_count_by_user.get(uid, 0),
        })

    return {
        "students": result_students,
        "totals": {
            "total_students": len(result_students),
            "avg_level": _average_level([s["level"] for s in result_students]) or "-",
            "messages_today": daily_counts.get(today.isoformat(), 0),
        },
        "daily_activity": [{"date": d, "count": daily_counts[d]} for d in last_7_days],
    }


async def list_users():
    response = supabase.table("users").select("*").execute()
    return response.data