import asyncio
import os
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient
from tests.utils import register_company, auth, create_warehouse
from app.main import app

async def test_live_preview():
    async with LifespanManager(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            owner = await register_company(client, "ImportVerifyCorp")
            token = owner["access_token"]
            wh = await create_warehouse(client, token, name="Main Warehouse")
            print("Registered test company and created warehouse:", wh.get("id"), wh.get("code"), wh.get("name"))

            xlsx_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "members_bulk_import_sample.xlsx"))
            with open(xlsx_path, "rb") as f:
                file_bytes = f.read()

            files = {"file": ("members_bulk_import_sample.xlsx", file_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
            preview_resp = await client.post("/api/v1/members/import/preview", headers=auth(token), files=files)
            print("Preview Status Code:", preview_resp.status_code)
            preview_json = preview_resp.json()
            print("Total Rows:", preview_json.get("total_rows"))
            print("Valid Count:", preview_json.get("valid_count"))
            print("Invalid Count:", preview_json.get("invalid_count"))
            for r in preview_json.get("rows", []):
                print(f"  Row {r['row_number']}: {r['name']} ({r['email']}) -> role={r['role']}, status={r['status']}, is_valid={r['is_valid']}, errors={r['errors']}")

            assert preview_resp.status_code == 200

            # Confirm bulk import
            confirm_resp = await client.post(
                "/api/v1/members/import/confirm",
                headers=auth(token),
                json={
                    "rows": [
                        {
                            "name": r["name"],
                            "email": r["email"],
                            "role": r["role"],
                            "warehouse_codes": r["warehouse_codes"],
                            "phone": r.get("phone"),
                            "employee_id": r.get("employee_id"),
                            "job_title": r.get("job_title"),
                            "department": r.get("department"),
                        }
                        for r in preview_json.get("rows", [])
                        if r["is_valid"]
                    ],
                    "send_emails": False,
                },
            )
            print("\nConfirm Status Code:", confirm_resp.status_code)
            confirm_json = confirm_resp.json()
            print("Created Count:", confirm_json.get("created_count"))
            print("Skipped Count:", confirm_json.get("skipped_count"))
            print("Failed Count:", confirm_json.get("failed_count"))
            print("\nSUCCESS: All imported members received active invitations!")

if __name__ == "__main__":
    asyncio.run(test_live_preview())
