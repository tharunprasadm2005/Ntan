import os
import pymongo

MONGODB_URI = os.environ.get("MONGODB_URI", "mongodb://127.0.0.1:27017/?replicaSet=rs0")
DB_NAME = os.environ.get("MONGODB_DB_NAME", "ntan_inventory")

def reset():
    print(f"Connecting to MongoDB at {MONGODB_URI}...")
    client = pymongo.MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
    db = client[DB_NAME]
    
    collections = db.list_collection_names()
    print(f"Found {len(collections)} collections in database '{DB_NAME}': {collections}")
    
    # Drop database
    client.drop_database(DB_NAME)
    print(f"Successfully dropped database '{DB_NAME}'. All accounts, users, inventory, and operational records have been wiped clean.")
    print("When you register your new account on the app, a fresh clean company workspace will be created from scratch.")

if __name__ == "__main__":
    reset()

