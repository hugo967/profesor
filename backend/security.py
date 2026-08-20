"""
Hashing de contraseñas con bcrypt (librería bcrypt directa, no passlib).

Nota: se probó passlib[bcrypt] primero, pero la combinación
passlib==1.7.4 + bcrypt>=4.1 instalada por pip está rota en este entorno
(passlib intenta leer bcrypt.__about__.__version__, que ya no existe en
las versiones recientes de la librería bcrypt, y lanza AttributeError/
ValueError incluso en el caso de éxito). La librería bcrypt por sí sola
es mucho más simple y no tiene ese problema, así que se usa directamente.
"""
import bcrypt

# bcrypt trunca (y con versiones nuevas, lanza error) más allá de 72 bytes.
# Se trunca explícitamente antes de hashear/verificar para que contraseñas
# largas no rompan el login en vez de fallar de forma confusa.
_MAX_PASSWORD_BYTES = 72


def _truncate(password: str) -> bytes:
    return password.encode("utf-8")[:_MAX_PASSWORD_BYTES]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_truncate(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(_truncate(password), password_hash.encode("utf-8"))
    except ValueError:
        # Hash con formato inválido/corrupto: nunca autenticar.
        return False
