"""Apply a GitHub issue keyword request only after maintainer's approval label."""
from __future__ import annotations

import json
import os
from pathlib import Path

from automation.models import BASE_GROUPS
from automation.related_keywords import normalized_query

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "config" / "approved-keywords.json"
APPROVAL_LABEL = "serp-approved"


def approve_issue(payload: dict, data: dict) -> tuple[dict, str]:
    label = (payload.get("label") or {}).get("name")
    issue = payload.get("issue") or {}
    if payload.get("action") != "labeled" or label != APPROVAL_LABEL or issue.get("pull_request"):
        raise ValueError("보호된 승인 라벨이 필요한 요청입니다.")
    lines = {}
    for line in (issue.get("body") or "").splitlines():
        key, sep, value = line.partition(":")
        if sep and key.strip().casefold() in {"group", "query"} and key.strip().casefold() not in lines:
            lines[key.strip().casefold()] = value.strip()
    group = lines.get("group", "")
    query = normalized_query(lines.get("query", ""))
    if group not in BASE_GROUPS or not query:
        raise ValueError("지원하지 않는 그룹 또는 검색어입니다.")

    all_baseline = {value.casefold() for items in BASE_GROUPS.values() for value in items}
    if query.casefold() in all_baseline:
        return data, "already-baseline"

    groups = data.get("groups", {}) if isinstance(data, dict) else {}
    if not isinstance(groups, dict):
        groups = {}
    approved_total = sum(len(v) for v in groups.values() if isinstance(v, list))
    if approved_total >= 24:
        raise ValueError("최대 추가 검색어 24개 제한에 도달했습니다.")
    existing = {x.casefold() for values in groups.values() if isinstance(values, list)
                for x in values if isinstance(x, str)}
    if query.casefold() in existing:
        return data, "already-approved"
    current = groups.get(group) or []
    groups[group] = current + [query]
    return {"schema": "serp-approved-keywords-v1", "groups": groups}, "approved"


def main() -> int:
    path = Path(os.environ["GITHUB_EVENT_PATH"])
    payload = json.loads(path.read_text(encoding="utf-8"))
    current = json.loads(REGISTRY.read_text(encoding="utf-8")) if REGISTRY.exists() else {"groups": {}}
    new, status = approve_issue(payload, current)
    if status == "approved":
        REGISTRY.parent.mkdir(parents=True, exist_ok=True)
        REGISTRY.write_text(json.dumps(new, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(status)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
