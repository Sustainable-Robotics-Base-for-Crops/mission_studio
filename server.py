#!/usr/bin/env python3
"""
Public HTTP server with pluggable architecture.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import os
import socketserver
import time
from http import HTTPStatus
from urllib.parse import parse_qs, unquote, urlparse
import http.server

from backend.config.flags import is_enabled, wants_ui_shell_v2
from backend.config.settings import Settings
from backend.config.static_assets import studio_asset_headers
from backend.middleware.error_middleware import ErrorMiddleware
from backend.runtime import EditorRuntime


mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")

logger = logging.getLogger("trajectory_editor")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


class TrajectoryHandler(http.server.BaseHTTPRequestHandler):
    """
    Main handler, powered by AppContext (including plugins).
    """

    _initialized = False
    _context = None
    _trajectory_controller = None
    _auth_middleware = None
    _html_generation_service = None
    _geocoding_service = None
    _auth_required = False

    @classmethod
    def initialize_services(cls) -> None:
        if cls._initialized:
            return
        cls._initialized = True
        runtime = EditorRuntime.build()
        cls._context = runtime.context
        cls._auth_required = runtime.auth_required
        cls._geocoding_service = runtime.geocoding_service
        cls._trajectory_controller = runtime.trajectory_controller
        cls._auth_middleware = runtime.auth_middleware
        cls._html_generation_service = runtime.html_generation_service

    def __init__(self, *args, **kwargs):
        self.__class__.initialize_services()
        self.web_root = Settings.WEB_ROOT
        super().__init__(*args, **kwargs)

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.OK)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Storage-Mode")
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.end_headers()

    def _dispatch(self, method: str) -> None:
        start_time = time.time()
        parsed_path = urlparse(self.path)
        path = parsed_path.path
        try:
            # Allows plugins to add their own routes.
            plugin_handler = self.__class__._context.extra_routes.get((method, path))
            if plugin_handler is not None:
                self._call_plugin_handler(plugin_handler, method)
                return

            is_authenticated, user_id = self.__class__._auth_middleware.check_auth(
                dict(self.headers), self.client_address, path
            )
            if not is_authenticated and path.startswith("/api/"):
                self.send_error(HTTPStatus.UNAUTHORIZED, "Authentication required")
                return

            if method == "GET":
                self._handle_get(path, parsed_path, user_id)
            elif method == "POST":
                self._handle_post(path, user_id)
            elif method == "PUT":
                self._handle_put(path, parsed_path, user_id)
            elif method == "DELETE":
                self._handle_delete(path, parsed_path, user_id)
            else:
                self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)
        except Exception as exc:
            code, message = ErrorMiddleware.handle_error(exc)
            self.send_error(code, message)
        finally:
            if path.startswith("/api/"):
                logger.debug(
                    "[API] %s %s %.2fms", method, path, (time.time() - start_time) * 1000
                )

    def _call_plugin_handler(self, handler, method: str) -> None:
        if method in {"POST", "PUT"}:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length > 0 else b""
            payload = json.loads(body.decode("utf-8")) if body else {}
            status, data = handler(payload, dict(self.headers), self.client_address)
        else:
            status, data = handler(dict(self.headers), self.client_address)
        self._send_json_response(status, data)

    def _handle_get(self, path: str, parsed_path, user_id: str | None) -> None:
        if path in {"/", "/login"}:
            if self.__class__._auth_required:
                # If the user is already authenticated, there's no need to stay on the login screen.
                if user_id and user_id != "anonymous":
                    self.send_response(HTTPStatus.FOUND)
                    self.send_header("Location", "/app")
                    self.end_headers()
                    return

                # Show the plugin's login page (if present).
                html_content = self.__class__._html_generation_service.render_template(
                    "login.html",
                    user_id=None,
                    extra_context={"recaptcha_site_key": os.getenv("RECAPTCHA_SITE_KEY", "")},
                )
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                payload = html_content.encode("utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return

            # Without private auth, / and /login redirect to the public app.
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", "/app")
            self.end_headers()
            return

        if path == "/app":
            # When authentication is required, /app is protected by server-side redirect.
            if self.__class__._auth_required and not user_id:
                self.send_response(HTTPStatus.FOUND)
                self.send_header("Location", "/login")
                self.end_headers()
                return
            query_params = parse_qs(parsed_path.query)
            if wants_ui_shell_v2(query_params):
                html_content = self.__class__._html_generation_service.generate_studio_html(
                    user_id or "anonymous"
                )
            else:
                html_content = self.__class__._html_generation_service.generate_html(
                    user_id or "anonymous"
                )
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            payload = html_content.encode("utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if path == "/studio" or path.startswith("/studio/"):
            if self.__class__._auth_required and not user_id:
                self.send_response(HTTPStatus.FOUND)
                self.send_header("Location", "/login")
                self.end_headers()
                return
            if self._serve_studio_asset(path):
                return
            html_content = self.__class__._html_generation_service.generate_studio_html(
                user_id or "anonymous"
            )
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            payload = html_content.encode("utf-8")
            self.send_header("Content-Length", str(len(payload)))
            # The shell carries the build stamp of the bundle, so it must never be cached.
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
            return
        if path == "/app-logo":
            # The logo can live outside the public folder so each deployment provides its file via APP_LOGO_PATH.
            self._serve_file_path(Settings.get_app_logo_file_path())
            return
        if path == "/api/trajectories":
            query_params = parse_qs(parsed_path.query)
            code, response_data = self.__class__._trajectory_controller.list_trajectories(
                user_id, query_params
            )
            self._send_json_response(code, response_data)
            return
        if path == "/api/geocoding/search":
            query_params = parse_qs(parsed_path.query)
            query = query_params.get("q", [""])[0]
            try:
                results = self.__class__._geocoding_service.search(query)
                self._send_json_response(HTTPStatus.OK, {"results": results})
            except ValueError as exc:
                logger.warning("[api] geocoding search failed: %s", exc)
                self._send_json_response(HTTPStatus.BAD_REQUEST, {"error": str(exc), "results": []})
            return
        if path.startswith("/api/trajectories/"):
            filename = unquote(path.split("/api/trajectories/")[1])
            query_params = parse_qs(parsed_path.query)
            code, response_data = self.__class__._trajectory_controller.load_trajectory(
                filename, user_id, query_params
            )
            self._send_json_response(code, response_data)
            return
        self._serve_static_file(path)

    def _handle_post(self, path: str, user_id: str | None) -> None:
        if path == "/api/trajectories/validate":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length > 0 else b"{}"
            request_data = json.loads(body.decode("utf-8"))
            # Pre-validation without writing: used before direct local export.
            code, response_data = self.__class__._trajectory_controller.validate_trajectory(request_data)
            self._send_json_response(code, response_data)
            return

        if path != "/api/trajectories":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        request_data = json.loads(body.decode("utf-8"))
        code, response_data = self.__class__._trajectory_controller.save_trajectory(
            request_data=request_data,
            user_id=user_id or "anonymous",
            headers=dict(self.headers),
        )
        self._send_json_response(code, response_data)

    def _handle_put(self, path: str, parsed_path, user_id: str | None) -> None:
        if not path.startswith("/api/trajectories/"):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        filename = unquote(parsed_path.path.split("/api/trajectories/")[1])
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        request_data = json.loads(body.decode("utf-8"))
        request_data["filename"] = filename
        code, response_data = self.__class__._trajectory_controller.save_trajectory(
            request_data=request_data,
            user_id=user_id or "anonymous",
            headers=dict(self.headers),
        )
        self._send_json_response(code, response_data)

    def _handle_delete(self, path: str, parsed_path, user_id: str | None) -> None:
        if not path.startswith("/api/trajectories/"):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        filename = unquote(parsed_path.path.split("/api/trajectories/")[1])
        code, response_data = self.__class__._trajectory_controller.delete_trajectory(
            filename, user_id
        )
        self._send_json_response(code, response_data)

    def _send_json_response(self, code: int, data) -> None:
        # Allows a plugin to request cookie headers via the body.
        # IMPORTANT: `data` can be a dict OR a list (e.g., /api/trajectories).
        # Never force `dict(data)` otherwise a list of dicts becomes
        # {"type":"vehicles"} due to Python's coercion.
        response_data = data
        set_cookie = None
        delete_cookie = None
        if isinstance(response_data, dict):
            response_data = dict(response_data)
            set_cookie = response_data.pop("setCookie", None)
            delete_cookie = response_data.pop("deleteCookie", None)
        payload = json.dumps(response_data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Credentials", "true")
        if set_cookie:
            self.send_header("Set-Cookie", set_cookie)
        if delete_cookie:
            self.send_header("Set-Cookie", delete_cookie)
        self.end_headers()
        self.wfile.write(payload)

    def _serve_static_file(self, path: str) -> None:
        clean_path = path.lstrip("/")
        if ".." in clean_path:
            self.send_error(HTTPStatus.FORBIDDEN)
            return

        # First try the plugin static dirs (e.g., /_plugins/<plugin_name>/*).
        for prefix, plugin_dir in self.__class__._context.static_dirs.items():
            if path.startswith(prefix + "/"):
                rel = path[len(prefix) + 1 :]
                plugin_file = os.path.join(plugin_dir, rel)
                return self._serve_file_path(plugin_file)

        local_file = os.path.join(self.web_root, clean_path)
        return self._serve_file_path(local_file)

    def _serve_studio_asset(self, path: str) -> bool:
        """
        Serve a hashed-free Vite asset from public/studio/. Returns True if the
        request was handled as a file (found or 404 for a missing asset).
        """
        relative = path[len("/studio") :].lstrip("/")
        if not relative:
            return False
        # SPA routes have no file extension; assets always do (studio.js, studio.css).
        basename = os.path.basename(relative)
        if "." not in basename:
            return False
        if ".." in relative:
            self.send_error(HTTPStatus.FORBIDDEN)
            return True
        asset_path = os.path.join(self.web_root, "studio", relative)
        if not os.path.isfile(asset_path):
            self.send_error(HTTPStatus.NOT_FOUND)
            return True
        self._serve_file_path(asset_path, headers=studio_asset_headers(basename))
        return True

    def _serve_file_path(self, file_path: str, headers: dict[str, str] | None = None) -> None:
        if not os.path.exists(file_path) or not os.path.isfile(file_path):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type, _ = mimetypes.guess_type(file_path)
        if content_type is None:
            content_type = "application/octet-stream"
        with open(file_path, "rb") as handle:
            payload = handle.read()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(payload)


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def run_server(port: int | None = None) -> None:
    cfg = Settings.get_server_config()
    host = cfg["host"]
    port = port or cfg["port"]
    if is_enabled("BACKEND_FASTAPI", default=False):
        from backend.api.app import run_fastapi

        run_fastapi(host, port)
        return
    with ReusableTCPServer((host, port), TrajectoryHandler) as httpd:
        logger.info("Public server running on http://%s:%s", host, port)
        logger.info("Plugins dir: %s", Settings.PLUGINS_DIR or "(none)")
        httpd.serve_forever()


if __name__ == "__main__":
    run_server()
