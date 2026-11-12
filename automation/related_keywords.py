"""Reviewable related-search suggestions found on the visible Naver results page.

Discovery is NOT verification. Only a maintainer-approved query in the
version-controlled keyword registry becomes a scheduled search.
"""
from __future__ import annotations

from automation.models import GROUPS


def normalized_query(value: object) -> str:
    if not isinstance(value, str):
        return ""
    text = " ".join(value.strip().split())
    if not 2 <= len(text) <= 60:
        return ""
    if any(ord(char) < 32 for char in text):
        return ""
    return text


def related_from_page(value: object, source_query: str) -> list[str]:
    if not isinstance(value, list):
        return []
    source = normalized_query(source_query).casefold()
    seen = set()
    output = []
    for item in value[:80]:
        query = normalized_query(item)
        folded = query.casefold()
        if not query or folded == source or folded in seen:
            continue
        output.append(query)
        seen.add(folded)
        if len(output) == 20:
            break
    return output


def aggregate_related_candidates(records: dict[str, dict]) -> list[dict]:
    configured = {term.casefold() for values in GROUPS.values() for term in values}
    grouping = {term: name for name, values in GROUPS.items() for term in values}
    candidates: dict[tuple[str, str], dict] = {}
    for query, result in records.items():
        group = grouping.get(query)
        if not group:
            continue
        for suggestion in related_from_page(result.get("related_queries"), query):
            key = (group, suggestion.casefold())
            if suggestion.casefold() in configured:
                continue
            if key not in candidates:
                candidates[key] = {
                    "group": group,
                    "query": suggestion,
                    "sources": [],
                    "source": "observed_visible_naver_related_search",
                    "status": "PROPOSED",
                    "note": "네이버 화면에서 발견한 검색어 후보. 운영자 승인 전까지 정기 검색에 포함하지 않음",
                }
            if query not in candidates[key]["sources"]:
                candidates[key]["sources"].append(query)
    return sorted(candidates.values(), key=lambda entry: (-len(entry["sources"]), entry["group"], entry["query"]))[:100]
