"""
Pruebas del endpoint POST /api/auth/login.
Usan la base de datos real de Supabase configurada en backend/.env
(no hay mocks: el objetivo es comprobar el flujo de autenticación
tal cual lo ve el frontend).
"""
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_login_profesor_credenciales_correctas():
    res = client.post(
        "/api/auth/login", json={"username": "profesor", "password": "1234"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["username"] == "profesor"
    assert body["role"] == "teacher"
    assert body["user_id"]


def test_login_password_incorrecta():
    res = client.post(
        "/api/auth/login", json={"username": "profesor", "password": "password-mala"}
    )
    assert res.status_code == 401


def test_login_usuario_inexistente():
    res = client.post(
        "/api/auth/login",
        json={"username": "usuario-que-no-existe-xyz", "password": "1234"},
    )
    assert res.status_code == 401


def test_login_sin_usuario_o_password():
    res = client.post("/api/auth/login", json={"username": "", "password": ""})
    assert res.status_code == 400
