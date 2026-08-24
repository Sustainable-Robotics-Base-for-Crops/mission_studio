#!/usr/bin/env python3
"""
Smoke test: the editor starts and serves a usable page.

This catches the class of breakage that unit tests miss — a template that no
longer renders, a plugin slot that disappeared, a missing static asset — which
is exactly what would break the iOS WebView without any test turning red.

Run locally:
    .venv/bin/python scripts/smoke_server.py
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STARTUP_TIMEOUT_S = 20

# Markers the shell must expose. They are the anchors the private plugins and the
# native applications rely on; losing one is a contract break, not a cosmetic change.
REQUIRED_MARKERS = [
    'id="app"',
    'id="map"',
    "pluginHeaderActions",
    "trajectoryEditorMapConfig",
    "trajectoryEditorUiConfig",
    "window.setLanguage",
]

REQUIRED_ASSETS = [
    "/css/styles.css",
    "/js/app.js",
    "/js/core/i18n.js",
    "/js/core/plugins.js",
    "/js/utils/GeometryUtils.js",
    "/js/controllers/TrajectoryEditor.js",
]

STUDIO_MARKERS = [
    'id="root"',
    "pluginHeaderActions",
    "trajectoryEditorMapConfig",
    "trajectoryEditorUiConfig",
    "window.setLanguage",
    "js/core/plugins.js",
    "js/core/i18n.js",
    "/studio/assets/studio.js",
]

STUDIO_ASSETS = [
    "/studio/assets/studio.js",
    "/studio/assets/studio.css",
]


def find_free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def fetch(url: str, timeout: float = 5.0) -> tuple[int, str]:
    with urllib.request.urlopen(url, timeout=timeout) as response:  # noqa: S310 - local only
        return response.status, response.read().decode("utf-8", errors="replace")


def wait_until_up(base_url: str, process: subprocess.Popen) -> None:
    deadline = time.monotonic() + STARTUP_TIMEOUT_S
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise SystemExit(
                f"server exited early with code {process.returncode}\n"
                f"{(process.stdout.read() if process.stdout else '')}"
            )
        try:
            fetch(f"{base_url}/app", timeout=2.0)
            return
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            last_error = exc
            time.sleep(0.3)
    raise SystemExit(f"server did not become ready within {STARTUP_TIMEOUT_S}s ({last_error})")


def check(condition: bool, label: str, failures: list[str]) -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}")
        failures.append(label)


def main() -> int:
    port = find_free_port()
    base_url = f"http://127.0.0.1:{port}"

    # The port is passed through run_server() rather than the PORT environment
    # variable: Settings loads the local .env with override=True, so a developer
    # .env would silently win over the environment and the smoke test would try
    # to bind the port of an already running editor.
    env = {
        **os.environ,
        "DEBUG": "false",
        # Validate against the vendored schema so the smoke test also proves the
        # save path can enforce the robot contract, with or without a local .env.
        "AGRI_SCHEMA_PATH": str(REPO_ROOT / "tests" / "schema" / "Agri.json"),
    }

    print(f"starting server on {base_url}")
    process = subprocess.Popen(
        [sys.executable, "-c", f"import server; server.run_server({port})"],
        cwd=REPO_ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    failures: list[str] = []
    try:
        wait_until_up(base_url, process)

        print("checking the editor page")
        status, body = fetch(f"{base_url}/app")
        check(status == 200, f"GET /app returns 200 (got {status})", failures)
        for marker in REQUIRED_MARKERS:
            check(marker in body, f"page contains {marker!r}", failures)

        print("checking static assets")
        for asset in REQUIRED_ASSETS:
            try:
                asset_status, _ = fetch(f"{base_url}{asset}")
            except urllib.error.HTTPError as exc:
                asset_status = exc.code
            check(asset_status == 200, f"GET {asset} returns 200 (got {asset_status})", failures)

        print("checking the trajectory API")
        try:
            api_status, api_body = fetch(f"{base_url}/api/trajectories")
        except urllib.error.HTTPError as exc:
            api_status, api_body = exc.code, ""
        check(api_status == 200, f"GET /api/trajectories returns 200 (got {api_status})", failures)
        if api_status == 200:
            try:
                json.loads(api_body)
                check(True, "GET /api/trajectories returns JSON", failures)
            except json.JSONDecodeError:
                check(False, "GET /api/trajectories returns JSON", failures)

        print("checking that /app stays the legacy editor by default")
        check("TrajectoryEditor.js" in body, "/app still loads TrajectoryEditor.js", failures)
        check("/studio/assets/studio.js" not in body, "/app does not load the v2 bundle", failures)

        studio_js = REPO_ROOT / "public" / "studio" / "assets" / "studio.js"
        if not studio_js.is_file():
            print("skipping studio checks: run `npm run build` first")
        else:
            print("checking the Mission Studio shell")
            studio_status, studio_body = fetch(f"{base_url}/studio")
            check(studio_status == 200, f"GET /studio returns 200 (got {studio_status})", failures)
            for marker in STUDIO_MARKERS:
                check(marker in studio_body, f"studio page contains {marker!r}", failures)
            stamp = f"/studio/assets/studio.js?v={int(studio_js.stat().st_mtime)}"
            check(
                stamp in studio_body,
                "studio page stamps the bundle URL with the build version",
                failures,
            )
            for asset in STUDIO_ASSETS:
                try:
                    asset_status, _ = fetch(f"{base_url}{asset}")
                except urllib.error.HTTPError as exc:
                    asset_status = exc.code
                check(
                    asset_status == 200,
                    f"GET {asset} returns 200 (got {asset_status})",
                    failures,
                )
            query_status, query_body = fetch(f"{base_url}/app?ui=v2")
            check(query_status == 200, f"GET /app?ui=v2 returns 200 (got {query_status})", failures)
            check(
                "/studio/assets/studio.js" in query_body,
                "/app?ui=v2 serves the v2 shell",
                failures,
            )
            ds_status, ds_body = fetch(f"{base_url}/studio/design-system")
            check(
                ds_status == 200,
                f"GET /studio/design-system returns 200 (got {ds_status})",
                failures,
            )
            check(
                "/studio/assets/studio.js" in ds_body,
                "/studio/design-system serves the v2 shell",
                failures,
            )
            studio_js_text = studio_js.read_text(encoding="utf-8", errors="replace")
            check(
                "data-ds-lot" in studio_js_text,
                "studio bundle contains the design-system catalogue marker",
                failures,
            )
            check(
                "maplibre" in studio_js_text.lower() and "data-map-engine" in studio_js_text,
                "studio bundle contains the MapLibre canvas",
                failures,
            )
            check(
                "data-tool" in studio_js_text and "draw_line" in studio_js_text,
                "studio bundle contains the draw-line tool",
                failures,
            )
            check(
                "data-field-inspector" in studio_js_text
                and "data-fields-edit-toolbar" in studio_js_text,
                "studio bundle contains the field inspector",
                failures,
            )
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()

    print()
    if failures:
        print(f"{len(failures)} smoke check(s) failed:")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print("all smoke checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
