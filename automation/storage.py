"""Atomic JSON persistence and lossless retry/concurrent-history merging."""
from __future__ import annotations

import json
import os
from pathlib import Path

from automation.models import HISTORY_SCHEMA


def read_json(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return fallback


def atomic_write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def history_entry(run: dict) -> dict:
    groups = run.get("groups") or {}
    query_counts: dict[str, int] = {}
    for record in (run.get("queries") or {}).values():
        section = (record.get("surfaces") or {}).get("INTEGRATED_BLOG_SECTION_TOP10", {})
        status = section.get("status", "UNKNOWN")
        query_counts[status] = query_counts.get(status, 0) + 1
    return {
        "run_id": run.get("run_id"),
        "at": run.get("captured_at_kst"),
        "query_counts": query_counts,
        "summary": {
            keyword: {
                "status": group.get("status"),
                "complete": bool(group.get("complete")),
                "exposed": list(group.get("exposed") or []),
                "missing": list(group.get("missing") or []),
                "dropped": list(group.get("dropped") or []),
            }
            for keyword, group in groups.items()
        },
        "recommendation": run.get("recommendation") or {},
        "errors": list(run.get("errors") or []),
    }


def normalize_history(value: object) -> dict:
    if isinstance(value, dict) and value.get("schema") == HISTORY_SCHEMA:
        entries = value.get("entries") if isinstance(value.get("entries"), list) else []
    elif isinstance(value, list):
        entries = value
    else:
        entries = []
    return {"schema": HISTORY_SCHEMA, "entries": entries}


def merge_histories(*values: object, limit: int = 180) -> dict:
    """Union histories by run id; preserves independently completed runs."""

    merged: dict[str, dict] = {}
    for value in values:
        for entry in normalize_history(value)["entries"]:
            if not isinstance(entry, dict):
                continue
            key = str(entry.get("run_id") or entry.get("at") or "")
            if not key:
                continue
            current = merged.get(key)
            if current is None or len(json.dumps(entry, ensure_ascii=False)) >= len(
                json.dumps(current, ensure_ascii=False)
            ):
                merged[key] = entry
    entries = sorted(merged.values(), key=lambda row: (str(row.get("at") or ""), str(row.get("run_id") or "")))
    return {"schema": HISTORY_SCHEMA, "entries": entries[-limit:]}


def append_run(history: object, run: dict, limit: int = 180) -> dict:
    return merge_histories(history, {"schema": HISTORY_SCHEMA, "entries": [history_entry(run)]}, limit=limit)

