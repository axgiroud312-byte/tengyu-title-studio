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


def test_failed_and_unknown_filters_are_separate(tmp_path, credentials, make_image):
    root = tmp_path / "商品"
    make_image(root / "1.jpg")
    make_image(root / "2.jpg")
    app = create_app(tmp_path / "state", token="token", credentials=credentials)
    with TestClient(app) as client:
        client.headers["Authorization"] = "Bearer token"
        scan = client.post("/api/scans", json={"directory": str(root), "mode": "images"}).json()
        saved_scan = app.state.manager.store.get("scan", scan["id"])
        for item, status in zip(saved_scan["items"], ("failed", "unknown"), strict=True):
            item["status"] = status
        app.state.manager.store.put("scan", scan["id"], saved_scan)
        batch_response = client.post("/api/batches", json={"scan_id": scan["id"], "options": {}})
        assert batch_response.status_code == 200
        for kind, identifier in (("scans", scan["id"]), ("batches", batch_response.json()["id"])):
            for status in ("failed", "unknown"):
                response = client.get(f"/api/{kind}/{identifier}/items?status={status}")
                assert response.status_code == 200
                result = response.json()
                assert result["total"] == 1
                assert [item["status"] for item in result["items"]] == [status]
                assert result["counts"]["failed"] == result["counts"]["unknown"] == 1


def test_settings_validation_is_actionable_chinese_without_input_values(tmp_path, credentials):
    app = create_app(tmp_path, token="token", credentials=credentials)
    with TestClient(app) as client:
        client.headers["Authorization"] = "Bearer token"
        response = client.put("/api/settings", json={
            "api_key": "private-key-" * 500,
            "base_url": "https://[private-address/",
            "defaults": {
                "concurrency": 11, "min_chars": 0, "max_chars": "private-number",
                "language": "", "requirements": "private-requirement-" * 1100,
            },
        })
        assert response.status_code == 422
        errors = {error["field"]: error["message"] for error in response.json()["errors"]}
        assert errors == {
            "api_key": "API 密钥不能超过 4096 个字符。",
            "base_url": "生成服务地址：请输入有效的 HTTPS 地址。",
            "defaults.concurrency": "同时处理数量不能大于 10。",
            "defaults.min_chars": "最少字符数不能小于 1。",
            "defaults.max_chars": "最多字符数请填写整数。",
            "defaults.language": "目标语言不能为空。",
            "defaults.requirements": "补充要求不能超过 20000 个字符。",
        }
        assert "private-" not in response.text
        assert "Value error" not in response.text


def test_request_validation_handles_missing_fields_ranges_and_wrong_types(tmp_path, credentials):
    app = create_app(tmp_path, token="token", credentials=credentials)
    with TestClient(app) as client:
        client.headers["Authorization"] = "Bearer token"
        cases = [
            ("POST", "/api/scans", {"mode": "images"}, "directory", "请填写商品文件夹。"),
            ("PUT", "/api/settings", {"defaults": {"min_chars": 10, "max_chars": 5}},
             "defaults", "最少字符数不能大于最多字符数。"),
            ("POST", "/api/batches/not-created/retry", {"item_ids": []},
             "item_ids", "所选商品至少需要 1 项。"),
            ("PUT", "/api/settings", {"defaults": "private-invalid-object"},
             "defaults", "生成设置格式不正确，请检查后重新提交。"),
        ]
        for method, path, body, field, message in cases:
            response = client.request(method, path, json=body)
            assert response.status_code == 422
            assert response.json()["errors"] == [{"field": field, "message": message}]
            assert "private-" not in response.text
