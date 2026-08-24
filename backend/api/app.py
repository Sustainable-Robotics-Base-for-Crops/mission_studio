"""
FastAPI transport (L5a). Default remains ``http.server`` until BACKEND_FASTAPI=true.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import os
from contextlib import asynccontextmanager
from http import HTTPStatus
from urllib.parse import parse_qs, urlparse

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response

from backend.api.http import client_address, handler_headers, json_from_handler
from backend.config.static_assets import studio_asset_headers
from backend.api.legacy import build_legacy_router
from backend.api.v1 import build_v1_router
from backend.config.flags import wants_ui_shell_v2
from backend.config.settings import Settings
from backend.runtime import EditorRuntime

mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")

logger = logging.getLogger("trajectory_editor")


class _PluginRoute:
    """ASGI adapter for AppContext.register_route handlers."""

    def __init__(self, method: str, handler):
        self.method = method.upper()
        self.handler = handler

    async def __call__(self, request: Request) -> Response:
        headers = handler_headers(request)
        address = client_address(request)
        if self.method in {"POST", "PUT"}:
            raw = await request.body()
            payload = {}
            if raw:
                parsed = json.loads(raw.decode("utf-8"))
                payload = parsed if isinstance(parsed, dict) else {}
            status, data = self.handler(payload, headers, address)
        else:
            status, data = self.handler(headers, address)
        return json_from_handler(status, data)


def _mount_plugin_routes(app: FastAPI, runtime: EditorRuntime) -> None:
    for (method, path), handler in runtime.context.extra_routes.items():
        adapter = _PluginRoute(method, handler)
        app.add_api_route(
            path,
            adapter,
            methods=[method.upper()],
            include_in_schema=False,
        )


def _html(content: str) -> HTMLResponse:
    return HTMLResponse(content, status_code=HTTPStatus.OK)


def _file_response(file_path: str, headers: dict[str, str] | None = None) -> Response:
    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        return Response(status_code=HTTPStatus.NOT_FOUND)
    media_type, _ = mimetypes.guess_type(file_path)
    return FileResponse(
        file_path,
        media_type=media_type or "application/octet-stream",
        headers=headers,
    )


def _serve_plugin_or_public(runtime: EditorRuntime, path: str) -> Response:
    if ".." in path.lstrip("/"):
        return Response(status_code=HTTPStatus.FORBIDDEN)
    for prefix, plugin_dir in runtime.context.static_dirs.items():
        if path.startswith(prefix + "/"):
            rel = path[len(prefix) + 1 :]
            return _file_response(os.path.join(plugin_dir, rel))
    return _file_response(os.path.join(Settings.WEB_ROOT, path.lstrip("/")))


def _serve_studio_asset(path: str) -> Response | None:
    relative = path[len("/studio") :].lstrip("/")
    if not relative:
        return None
    basename = os.path.basename(relative)
    if "." not in basename:
        return None
    if ".." in relative:
        return Response(status_code=HTTPStatus.FORBIDDEN)
    asset_path = os.path.join(Settings.WEB_ROOT, "studio", relative)
    if not os.path.isfile(asset_path):
        return Response(status_code=HTTPStatus.NOT_FOUND)
    return _file_response(asset_path, headers=studio_asset_headers(basename))


def create_app(runtime: EditorRuntime | None = None) -> FastAPI:
    runtime = runtime or EditorRuntime.build(sqlite_path=Settings.sqlite_path())

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if runtime.job_queue is not None:
            runtime.job_queue.start_worker()
        yield
        if runtime.job_queue is not None:
            runtime.job_queue.stop_worker()
        if runtime.database is not None:
            runtime.database.close()

    app = FastAPI(title="trajectory_editor", docs_url=None, redoc_url=None, lifespan=lifespan)

    @app.options("/{full_path:path}")
    def cors_preflight() -> Response:
        return Response(
            status_code=HTTPStatus.OK,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Storage-Mode",
                "Access-Control-Allow-Credentials": "true",
            },
        )

    _mount_plugin_routes(app, runtime)
    app.include_router(build_legacy_router(runtime))
    app.include_router(build_v1_router(runtime))

    @app.get("/login")
    @app.get("/")
    def root_or_login(request: Request) -> Response:
        headers = handler_headers(request)
        _ok, user_id = runtime.auth_middleware.check_auth(
            headers, client_address(request), request.url.path
        )
        if runtime.auth_required:
            if user_id and user_id != "anonymous":
                return RedirectResponse("/app", status_code=HTTPStatus.FOUND)
            html_content = runtime.html_generation_service.render_template(
                "login.html",
                user_id=None,
                extra_context={"recaptcha_site_key": os.getenv("RECAPTCHA_SITE_KEY", "")},
            )
            return _html(html_content)
        return RedirectResponse("/app", status_code=HTTPStatus.FOUND)

    @app.get("/app")
    def app_shell(request: Request) -> Response:
        headers = handler_headers(request)
        is_authenticated, user_id = runtime.auth_middleware.check_auth(
            headers, client_address(request), request.url.path
        )
        if runtime.auth_required and not user_id:
            return RedirectResponse("/login", status_code=HTTPStatus.FOUND)
        if not is_authenticated and runtime.auth_required:
            return RedirectResponse("/login", status_code=HTTPStatus.FOUND)
        query_params = parse_qs(urlparse(str(request.url)).query)
        if wants_ui_shell_v2(query_params):
            html_content = runtime.html_generation_service.generate_studio_html(
                user_id or "anonymous"
            )
        else:
            html_content = runtime.html_generation_service.generate_html(
                user_id or "anonymous"
            )
        return _html(html_content)

    @app.get("/studio")
    @app.get("/studio/{full_path:path}")
    def studio_shell(request: Request) -> Response:
        headers = handler_headers(request)
        is_authenticated, user_id = runtime.auth_middleware.check_auth(
            headers, client_address(request), request.url.path
        )
        if runtime.auth_required and not user_id:
            return RedirectResponse("/login", status_code=HTTPStatus.FOUND)
        if not is_authenticated and runtime.auth_required:
            return RedirectResponse("/login", status_code=HTTPStatus.FOUND)
        asset = _serve_studio_asset(request.url.path)
        if asset is not None:
            return asset
        response = _html(
            runtime.html_generation_service.generate_studio_html(user_id or "anonymous")
        )
        # The shell carries the build stamp of the bundle, so it must never be cached.
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/app-logo")
    def app_logo() -> Response:
        return _file_response(Settings.get_app_logo_file_path())

    @app.get("/{full_path:path}")
    def static_or_not_found(full_path: str) -> Response:
        return _serve_plugin_or_public(runtime, "/" + full_path)

    return app


def run_fastapi(host: str, port: int) -> None:
    import uvicorn

    app = create_app()
    logger.info("Public FastAPI server running on http://%s:%s", host, port)
    logger.info("Plugins dir: %s", Settings.PLUGINS_DIR or "(none)")
    uvicorn.run(app, host=host, port=port, log_level="info")
