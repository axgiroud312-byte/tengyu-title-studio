import sqlite3

from fastapi.testclient import TestClient

from tengyu.main import create_app
from tengyu.models import Settings


def test_auth_origin_and_credentials_redaction(tmp_path, credentials):
    app = create_app(tmp_path, token="test-session-token", credentials=credentials)
    with TestClient(app) as client:
        assert client.get("/api/settings").status_code == 401
        assert client.post("/api/session", headers={"Authorization": "Bearer wrong"}).status_code == 401
        assert client.post("/api/session", headers={"Authorization": "Bearer test-session-token"}).status_code == 200
        assert client.get("/api/settings").json()["key_configured"]
        settings = Settings().model_dump()
        settings["api_key"] = "sample-secret-do-not-persist"
        response = client.put("/api/settings", json=settings)
        assert response.status_code == 200
        assert "sample-secret" not in response.text
        assert client.put("/api/settings", json=settings, headers={"Origin": "https://example.com"}).status_code == 403
        settings["api_key"] = "s" * 5000
        error = client.put("/api/settings", json=settings)
        assert error.status_code == 422 and "s" * 100 not in error.text
    with sqlite3.connect(tmp_path / "tasks.sqlite3") as con:
        assert "sample-secret" not in str(con.execute("SELECT * FROM documents").fetchall())


def test_scan_pagination_and_scoped_images(tmp_path, credentials, make_image):
    root = tmp_path / "输入"
    for i in range(52):
        make_image(root / f"{i}.jpg")
    app = create_app(tmp_path / "state", token="token", credentials=credentials)
    with TestClient(app) as client:
        client.headers["Authorization"] = "Bearer token"
        scan = client.post("/api/scans", json={"directory": str(root), "mode": "images"}).json()
        first = client.get(f'/api/scans/{scan["id"]}/items').json()
        second = client.get(f'/api/scans/{scan["id"]}/items?page=2').json()
        assert first["total"] == 52 and len(first["items"]) == 50 and len(second["items"]) == 2
        item_id = first["items"][0]["id"]
        assert client.get(f'/api/images/scan/{scan["id"]}/{item_id}').status_code == 200
        assert client.get(f'/api/images/scan/{scan["id"]}/unknown').status_code == 404
        assert client.get('/api/images/invalid/anything/anything').status_code == 404
        assert client.get(f'/api/scans/{scan["id"]}/items?page=0').status_code == 422
