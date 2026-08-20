"""
Script puntual para crear (o actualizar) el usuario 'profesor' con
contraseña '1234' en Supabase, usando el mismo hash bcrypt que security.py.
Uso: python seed_profesor.py
"""
import asyncio

import db
from security import hash_password

USERNAME = "profesor"
PASSWORD = "1234"


async def main():
    password_hash = hash_password(PASSWORD)

    existing = await db.get_user_by_username(USERNAME)
    if existing:
        updated = await db.set_user_password(existing["id"], password_hash)
        print(f"Usuario '{USERNAME}' ya existía (id={updated['id']}); contraseña actualizada.")
    else:
        created = await db.create_user_with_password(USERNAME, password_hash, role="teacher")
        print(f"Usuario '{USERNAME}' creado (id={created['id']}) con rol '{created['role']}'.")


if __name__ == "__main__":
    asyncio.run(main())
