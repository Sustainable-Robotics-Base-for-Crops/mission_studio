"""Native folder chooser for the locally hosted Mission Studio."""

from __future__ import annotations

import platform
import subprocess
from typing import Optional


def pick_folder(prompt: str = "Choisir un dossier de ferme") -> Optional[str]:
    """
    Open the host operating system's folder chooser.

    Mission Studio is served locally, so the backend needs the absolute path:
    browser directory handles deliberately do not expose it. ``None`` means that
    the user cancelled the dialog.
    """
    if platform.system() == "Darwin":
        escaped_prompt = prompt.replace("\\", "\\\\").replace('"', '\\"')
        script = f'POSIX path of (choose folder with prompt "{escaped_prompt}")'
        try:
            result = subprocess.run(
                ["osascript", "-e", script],
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError:
            return None
        return result.stdout.strip().rstrip("/") or None

    try:
        import tkinter
        from tkinter import filedialog
    except ImportError as reason:
        raise RuntimeError("native folder chooser is unavailable") from reason

    root = tkinter.Tk()
    root.withdraw()
    try:
        selected = filedialog.askdirectory(title=prompt, mustexist=True)
    finally:
        root.destroy()
    return selected or None
