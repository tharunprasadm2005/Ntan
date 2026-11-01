import os

import pytest
import pytest_asyncio
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient
from pymongo import AsyncMongoClient

os.environ["MONGODB_DB_NAME"] = "ntan_inventory_test"
os.environ["MONGODB_URI"] = "mongodb://127.0.0.1:27017/?replicaSet=rs0"
os.environ["JWT_SECRET"] = "test-secret-with-at-least-thirty-two-characters"
os.environ["JWT_ISSUER"] = "ntan-inventory-test"
os.environ["APP_ENV"] = "test"

from app.main import app  # noqa: E402


@pytest_asyncio.fixture
async def client():
    mongo = AsyncMongoClient(
        os.environ["MONGODB_URI"],
        tz_aware=True,
        serverSelectionTimeoutMS=5000,
    )
    await mongo.drop_database(os.environ["MONGODB_DB_NAME"])
    async with LifespanManager(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as http:
            yield http
    await mongo.drop_database(os.environ["MONGODB_DB_NAME"])
    await mongo.aclose()


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"
