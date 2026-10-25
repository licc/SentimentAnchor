"""API 层测试（mock 后端，不触碰真实客户端）。"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from thsapi.api import create_app  # noqa: E402
from thsapi.config import AppConfig  # noqa: E402
from thsapi.service import TradingService  # noqa: E402

API_KEY = "test-key"


@pytest.fixture()
def client(tmp_path):
    cfg = AppConfig.model_validate(
        {
            "server": {"api_key": API_KEY},
            "trading": {"broker": "mock", "mode": "live"},
            "safety": {"allow_out_of_hours": True, "max_order_amount": 50000, "max_daily_orders": 10},
            "journal": {"enabled": True, "path": str(tmp_path / "orders.db")},
        }
    )
    app = create_app(cfg)
    with TestClient(app) as c:
        c.headers.update({"X-API-Key": API_KEY})
        yield c


def test_auth_required(client):
    r = client.get("/api/v1/health", headers={"X-API-Key": "bad"})
    assert r.status_code == 401
    assert r.json()["code"] == "unauthorized"


def test_health_and_account(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True and body["broker"] == "mock"

    r = client.get("/api/v1/portfolio")
    assert r.status_code == 200
    body = r.json()
    assert body["account"]["total_asset"] > 0
    assert body["positions"][0]["symbol"] == "513100"


def test_place_order_and_idempotency(client, tmp_path):
    payload = {
        "symbol": "513100",
        "side": "buy",
        "price": 1.85,
        "quantity": 100,
        "client_order_id": "cid-1",
    }
    r = client.post("/api/v1/orders", json=payload)
    assert r.status_code == 200, r.text
    first = r.json()
    assert first["ok"] is True and first["order_id"]

    r2 = client.post("/api/v1/orders", json=payload)
    assert r2.status_code == 200
    assert r2.json()["order_id"] == first["order_id"]
    assert "幂等" in r2.json()["message"]

    # 台账不再对外暴露接口，直接查 SQLite
    import sqlite3

    with sqlite3.connect(tmp_path / "orders.db") as conn:
        n = conn.execute("select count(*) from orders").fetchone()[0]
    assert n == 1


def test_order_rejects_bad_lot(client):
    r = client.post(
        "/api/v1/orders",
        json={"symbol": "513100", "side": "buy", "price": 1.85, "quantity": 150},
    )
    assert r.status_code == 400
    assert r.json()["code"] == "risk_rejected"


def test_order_rejects_too_large(client):
    r = client.post(
        "/api/v1/orders",
        json={"symbol": "513100", "side": "buy", "price": 600.0, "quantity": 1000},
    )
    assert r.status_code == 400


def test_cancel(client):
    r = client.post(
        "/api/v1/orders",
        json={"symbol": "513100", "side": "buy", "price": 1.85, "quantity": 100},
    )
    oid = r.json()["order_id"]
    r = client.post("/api/v1/cancel", json={"order_id": oid})
    assert r.status_code == 200
    assert r.json()["ok"] is True
