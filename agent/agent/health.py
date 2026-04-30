"""Minimal FastAPI health endpoint for the Proxim agent service."""
import threading
import uvicorn
from fastapi import FastAPI

app = FastAPI(title="Proxim Agent Health")
_db_connected: bool = False


def set_db_connected(value: bool) -> None:
    global _db_connected
    _db_connected = value


@app.get("/health")
async def health():
    return {
        "status": "ok" if _db_connected else "degraded",
        "daemon": "running",
        "db_connected": _db_connected,
    }


def start_health_server(port: int) -> None:
    """Start health server in a background daemon thread."""
    def run():
        uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
    thread = threading.Thread(target=run, daemon=True)
    thread.start()
