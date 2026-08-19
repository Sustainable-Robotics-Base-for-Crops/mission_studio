"""Project coverage swaths to JSON Agri v3 ``row_line`` sections."""

from __future__ import annotations

from typing import Any

from backend.coverage.geometry import MIN_SWATH_M, round3, swath_length

COLUMNS = ["x", "y", "speed", "working_zone", "punctual"]
DEFAULT_SPEED_MPS = 0.5


def swath_to_section(
    start: tuple[float, float],
    end: tuple[float, float],
    speed: float = DEFAULT_SPEED_MPS,
) -> dict[str, Any] | None:
    if swath_length(start, end) < MIN_SWATH_M:
        return None
    return {
        "section_type": "row_line",
        "columns": list(COLUMNS),
        "values": [
            [round3(start[0]), round3(start[1]), speed, 1, {}],
            [round3(end[0]), round3(end[1]), speed, 1, {}],
        ],
    }


def swaths_to_sections(
    swaths: list[tuple[tuple[float, float], tuple[float, float]]],
    speed: float = DEFAULT_SPEED_MPS,
) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    for start, end in swaths:
        section = swath_to_section(start, end, speed)
        if section is not None:
            sections.append(section)
    return sections


def path_to_section(
    points: list[tuple[float, float]],
    speed: float = DEFAULT_SPEED_MPS,
    section_type: str = "row_path",
) -> dict[str, Any] | None:
    values: list[list[Any]] = []
    for x, y in points:
        row = [round3(x), round3(y), speed, 1, {}]
        if values:
            prev = values[-1]
            if prev[0] == row[0] and prev[1] == row[1]:
                continue
        values.append(row)
    if len(values) < 2:
        return None
    return {
        "section_type": section_type,
        "columns": list(COLUMNS),
        "values": values,
    }


def paths_to_sections(
    paths: list[list[tuple[float, float]]],
    speed: float = DEFAULT_SPEED_MPS,
) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    for path in paths:
        section = path_to_section(path, speed)
        if section is not None:
            sections.append(section)
    return sections


def total_length_m(swaths: list[tuple[tuple[float, float], tuple[float, float]]]) -> float:
    return round3(sum(swath_length(start, end) for start, end in swaths))
