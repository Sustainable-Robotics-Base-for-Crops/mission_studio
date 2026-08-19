"""FastAPI application (L5a). Inactive until BACKEND_FASTAPI is true."""

from .app import create_app, run_fastapi

__all__ = ["create_app", "run_fastapi"]
