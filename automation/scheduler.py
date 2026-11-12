"""Pure owner aggregation, exit detection, team assignment, and title drafts."""
from __future__ import annotations

from datetime import datetime, timedelta

from automation.models import DECISION_SURFACE, GROUPS, KST, effective_status, now_kst
from automation.owners import PEOPLE, owner_matches


INTENTS: dict[str, tuple[tuple[str, str], ...]] = {
    "KT바로유심": (
        ("준비·순서", "KT바로유심 개통 전 준비물과 진행 순서 정리"),
        ("확인·질문", "KT바로유심 신청 전에 확인할 조건과 자주 묻는 질문"),
        ("문제 예방", "KT바로유심 이용 전 놓치기 쉬운 확인 사항"),
        ("초보 안내", "KT바로유심 처음 준비할 때 알아둘 핵심 단계"),
    ),
    "LG모두의 원칩": (
        ("준비·순서", "LG모두의 원칩 준비물과 개통 순서를 한눈에 정리"),
        ("확인·질문", "LG모두의 원칩 신청 전 확인 사항과 자주 묻는 질문"),
        ("선택 기준", "LG모두의 원칩 이용 전에 살펴볼 선택 기준"),
        ("초보 안내", "LG모두의 원칩 처음 준비하는 사람을 위한 단계별 안내"),
    ),
    "태블릿소유자회원번호": (
        ("입력 절차", "태블릿소유자회원번호 입력 위치와 확인 순서 정리"),
        ("오류 예방", "태블릿소유자회원번호 입력 전 자주 틀리는 항목 확인"),
        ("준비 정보", "태블릿소유자회원번호 확인에 필요한 정보와 준비 과정"),
        ("질문 정리", "태블릿소유자회원번호 관련 자주 묻는 질문 모음"),
    ),
    "다이소 유심": (
        ("준비·순서", "다이소 유심 개통 전 준비물과 진행 순서 정리"),
        ("구매·확인", "다이소 유심 구매 후 신청 전에 확인할 사항"),
        ("오류 예방", "다이소 유심 개통할 때 놓치기 쉬운 체크포인트"),
        ("초보 안내", "다이소 유심 처음 이용하는 사람을 위한 단계별 안내"),
    ),
}

SLOTS = ((9, 0), (11, 0), (14, 0))


def next_publish_slot(at: datetime | None = None) -> str:
    current = (at or now_kst()).astimezone(KST)
    for hour, minute in SLOTS:
        candidate = current.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if current <= candidate:
            return candidate.isoformat()
    tomorrow = current.replace(hour=9, minute=0, second=0, microsecond=0) + timedelta(days=1)
    return tomorrow.isoformat()


def _verified_results(
    record: dict | None, at: datetime, *, require_fresh: bool = True
) -> list[dict] | None:
    observation = (record or {}).get("surfaces", {}).get(DECISION_SURFACE)
    status = effective_status(observation, at) if require_fresh else (observation or {}).get("status")
    if status != "VERIFIED":
        return None
    results = observation.get("results", [])
    return results if len(results) == 10 else None


def aggregate_groups(
    queries: dict[str, dict],
    previous: dict | None = None,
    *,
    at: datetime | None = None,
) -> dict[str, dict]:
    """Confirm missing owners only when all three variants are fresh VERIFIED."""

    reference = (at or now_kst()).astimezone(KST)
    previous_queries = (previous or {}).get("queries", {})
    groups: dict[str, dict] = {}
    for keyword, variants in GROUPS.items():
        query_states: list[dict] = []
        matches = {owner: [] for owner in PEOPLE}
        exits: list[dict] = []
        complete = True
        for query in variants:
            current_record = queries.get(query)
            current_results = _verified_results(current_record, reference)
            current_observation = (current_record or {}).get("surfaces", {}).get(DECISION_SURFACE)
            status = effective_status(current_observation, reference)
            query_states.append({
                "query": query,
                "status": status,
                "observed_at": (current_observation or {}).get("observed_at"),
            })
            if current_results is None:
                complete = False
                continue
            current_matches = owner_matches(current_results)
            for owner, rows in current_matches.items():
                matches[owner].extend({"query": query, **row} for row in rows)

            previous_results = _verified_results(
                previous_queries.get(query), reference, require_fresh=False
            )
            if previous_results is None:
                continue
            before = owner_matches(previous_results)
            for owner in PEOPLE:
                if before[owner] and not current_matches[owner]:
                    exits.append({
                        "owner": owner,
                        "query": query,
                        "previous_ranks": [item["rank"] for item in before[owner]],
                        "status": "OBSERVED_EXIT",
                    })

        exposed = [owner for owner in PEOPLE if matches[owner]] if complete else []
        missing = [owner for owner in PEOPLE if owner not in exposed] if complete else []
        owner_states = {
            owner: (
                "EXPOSED" if matches[owner] else "NOT_FOUND"
            ) if complete else "UNKNOWN"
            for owner in PEOPLE
        }
        dropped = [owner for owner in PEOPLE if any(row["owner"] == owner for row in exits)]
        groups[keyword] = {
            "status": "VERIFIED" if complete else "UNKNOWN",
            "complete": complete,
            "queries": list(variants),
            "query_states": query_states,
            "matches": matches,
            "owner_states": owner_states,
            "exposed": exposed,
            "missing": missing,
            "dropped": dropped,
            "exits": exits,
            "decision_note": (
                "3개 변형 검색어가 모두 최신 VERIFIED"
                if complete
                else "변형 검색어 중 UNKNOWN/CANDIDATE/PARTIAL/STALE가 있어 미노출 확정 금지"
            ),
        }
    return groups


def _used_titles(history: object) -> set[str]:
    rows = history if isinstance(history, list) else (history or {}).get("entries", [])
    used: set[str] = set()
    for row in rows or []:
        for assignment in (row.get("recommendation") or {}).get("assignments", []):
            for title in assignment.get("titles", []):
                if title.get("title"):
                    used.add(title["title"])
    return used


def _title_rows(keyword: str, people: list[str], used: set[str]) -> list[dict]:
    choices = INTENTS[keyword]
    rows: list[dict] = []
    for index, owner in enumerate(people):
        intent, title = choices[index % len(choices)]
        attempt = 0
        while title in used and attempt < len(choices) - 1:
            attempt += 1
            intent, title = choices[(index + attempt) % len(choices)]
        if title in used:
            title = f"{title} — {owner} 관점"
        used.add(title)
        rows.append({
            "owner": owner,
            "intent": intent,
            "title": title,
            "source": "RULE_BASED_DRAFT",
            "editable": True,
        })
    return rows


def recommend(
    groups: dict[str, dict],
    *,
    history: object = None,
    at: datetime | None = None,
) -> dict:
    """Assign up to two non-overlapping two-person teams deterministically."""

    order = {keyword: index for index, keyword in enumerate(GROUPS)}
    ready = [
        (keyword, group)
        for keyword, group in groups.items()
        if group.get("complete") and len(group.get("missing", [])) >= 2
    ]
    ready.sort(
        key=lambda item: (
            -len(item[1].get("dropped", [])),
            abs(len(item[1].get("missing", [])) - 2),
            order[item[0]],
        )
    )
    used_people: set[str] = set()
    used_titles = _used_titles(history)
    assignments: list[dict] = []
    for keyword, group in ready:
        available = [owner for owner in PEOPLE if owner in group["missing"] and owner not in used_people]
        available.sort(key=lambda owner: (owner not in group.get("dropped", []), list(PEOPLE).index(owner)))
        if len(available) < 2:
            continue
        team = available[:2]
        assignments.append({
            "keyword": keyword,
            "people": team,
            "titles": _title_rows(keyword, team, used_titles),
            "reason": (
                "검증된 10위권 이탈 복구 우선"
                if any(owner in group.get("dropped", []) for owner in team)
                else "3개 변형 검색어 모두 VERIFIED이며 10위권 미노출"
            ),
            "evidence_status": "VERIFIED",
        })
        used_people.update(team)
        if len(assignments) == 2:
            break

    if len(assignments) == 2:
        status = "READY"
        note = "2개 팀 모두 최신 VERIFIED 근거로 제안"
    elif len(assignments) == 1:
        status = "PARTIAL"
        note = "1개 팀만 확정 가능하며 나머지는 증거 또는 가용 인원 부족으로 대기"
    else:
        status = "PENDING"
        note = "최신 VERIFIED 근거가 부족하여 발행자 자동 배정을 보류"
    return {
        "status": status,
        "ready": bool(assignments),
        "complete": len(assignments) == 2,
        "slot_at_kst": next_publish_slot(at),
        "assignments": assignments,
        "unassigned": [owner for owner in PEOPLE if owner not in used_people],
        "note": note,
        "title_policy": "규칙 기반 초안; GPT/API 연결이 없으므로 사실 추가 없이 운영자가 수정",
    }

