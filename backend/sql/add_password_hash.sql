-- Añade la columna de contraseña (hash bcrypt) a la tabla users.
-- Ejecutar en el SQL Editor de Supabase del proyecto (no hay forma de
-- correr DDL desde el backend con la service_role key vía REST/PostgREST,
-- así que este script se aplica a mano).
--
-- password_hash queda a NULL para las cuentas creadas antes de este
-- cambio (p. ej. alumno1, profesor, teacher). El backend (ver
-- POST /api/auth/login en backend/main.py) trata una cuenta sin
-- password_hash como "todavía sin contraseña": la primera contraseña que
-- se introduzca para ese username se adopta y se guarda, sin pedir la
-- clave de registro del profesor (la cuenta ya existía).

alter table users add column if not exists password_hash text;
