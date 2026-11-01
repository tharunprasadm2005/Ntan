from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from .config import Settings


def create_client(settings: Settings) -> AsyncMongoClient:
    return AsyncMongoClient(settings.mongodb_uri, tz_aware=True, serverSelectionTimeoutMS=5000)


def get_database(client: AsyncMongoClient, settings: Settings) -> AsyncDatabase:
    return client[settings.mongodb_db_name]


async def ping(database: AsyncDatabase) -> bool:
    result = await database.command("ping")
    return result.get("ok") == 1
