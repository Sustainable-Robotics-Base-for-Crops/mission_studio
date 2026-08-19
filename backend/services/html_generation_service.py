"""
HTML rendering service injecting plugin extensions.
"""

from __future__ import annotations

import json
import logging
from typing import Optional
from jinja2 import Environment, FileSystemLoader, TemplateNotFound
from ..config.settings import Settings

logger = logging.getLogger("trajectory_editor")


class HtmlGenerationService:
    """
    Service for generating HTML with conditional elements based on permissions.
    Uses Jinja2 for templating.
    """

    def __init__(
        self,
        permission_provider,
        templates_dirs: list[str],
        template_slots: dict[str, list[str]],
    ):
        """
        Initialize the HTML generation service.

        Args:
            permission_provider: Active permissions provider.
            templates_dirs: Ordered list of template directories.
            template_slots: Partial fragments registered by plugins.
        """
        self.permission_provider = permission_provider
        self.templates_dirs = templates_dirs
        self.template_slots = template_slots

        self.jinja_env = Environment(
            loader=FileSystemLoader(templates_dirs),
            autoescape=True,
            trim_blocks=True,
            lstrip_blocks=True,
        )

    def _build_template_context(self, user_id: Optional[str] = None) -> dict:
        """
        Build the common render context for templates.
        """
        uid = user_id or "anonymous"
        ui_config_data = self.permission_provider.get_ui_config(uid)
        ui_config = ui_config_data.get("ui", {})
        return {
            "show_cloud_buttons": ui_config.get("showCloudButtons", False),
            "show_advanced_features": ui_config.get("showAdvancedFeatures", False),
            "allowed_file_types": ui_config.get(
                "allowedFileTypes", ["draft", "mission_order", "parcel_map"]
            ),
            "user_level": ui_config.get("userLevel", 0),
            # Configurable logo for each environment to allow forks and community deployments
            # to use their own identity.
            "app_logo_url": Settings.get_app_logo_url(),
            # Complete UI configuration exposed to the frontend for hiding elements
            # dynamically added by plugins after HTML rendering.
            "ui_config_json": json.dumps({"ui": ui_config}, ensure_ascii=False),
            # Each slot contains a list of partials registered by plugins.
            "plugin_head_partials": self.template_slots.get("plugin_head_scripts", []),
            "plugin_body_pre_partials": self.template_slots.get("plugin_body_pre", []),
            "plugin_header_extra_partials": self.template_slots.get(
                "plugin_header_extra_buttons", []
            ),
            "plugin_body_script_partials": self.template_slots.get(
                "plugin_body_scripts", []
            ),
            # JSON serialization of the map config to initialize MapService on the browser side.
            "map_config_json": json.dumps(Settings.get_map_config(), ensure_ascii=False),
        }

    def render_template(
        self,
        template_name: str,
        user_id: Optional[str] = None,
        extra_context: Optional[dict] = None,
    ) -> str:
        """
        Render an arbitrary template with the common context + additional context.
        """
        template_context = self._build_template_context(user_id)
        if extra_context:
            template_context.update(extra_context)
        try:
            template = self.jinja_env.get_template(template_name)
            html_content = template.render(**template_context)
            logger.info("[HtmlGenerationService] Generated HTML (%s chars) for %s", len(html_content), template_name)
            return html_content
        except TemplateNotFound as e:
            logger.error("[HtmlGenerationService] Template %s not found: %s", template_name, e)
            return "<h1>Error: Template not found</h1>"
        except Exception as e:
            logger.error(f"[HtmlGenerationService] Error during HTML generation ({template_name}): {e}", exc_info=True)
            return "<h1>Error during page generation</h1>"

    def generate_html(self, user_id: Optional[str] = None) -> str:
        """
        Generate HTML with conditional elements based on permissions.

        Args:
            user_id: Unique user identifier (None for unauthenticated user).

        Returns:
            Generated HTML with conditional elements.
        """
        return self.render_template("index.html", user_id=user_id)

    def generate_studio_html(self, user_id: Optional[str] = None) -> str:
        """Render the Mission Studio shell (L1+). Plugin slots stay identical to /app."""
        from ..config.flags import registry

        flags = registry()
        flags["UI_SHELL_V2"] = True
        return self.render_template(
            "studio.html",
            user_id=user_id,
            extra_context={"feature_flags_json": json.dumps(flags, ensure_ascii=False)},
        )
