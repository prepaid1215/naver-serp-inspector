"""Pure owner aggregation, exit detection, team assignment, and title drafts."""
from __future__ import annotations

from datetime import datetime, timedelta
from itertools import combinations

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


def _recent_keyword_counts(history: object) -> dict[tuple[str, str], int]:
    """Treat recent suggestions as a diversification signal, never proof of publication."""

    records = history if isinstance(history, list) else (history or {}).get("entries", [])
    counts: dict[tuple[str, str], int] = {}
    for record in (records or [])[-12:]:
        for assignment in (record.get("recommendation") or {}).get("assignments", []):
            keyword = assignment.get("keyword")
            for person in assignment.get("people", []):
                key = (person, keyword)
                counts[key] = counts.get(key, 0) + 1
    return counts


def _owner_priority(owner: str, keyword: str, group: dict) -> tuple[int, int, str]:
    """Return a grounded priority and an owner-specific reason.

    Tier 0: absent from all three fully verified variants.
    Tier 1: present, but best observed card rank is only 8..10.
    Tier 2: missing some variants or low on at least one variant.
    Tier 3: best rank 4..7.
    Tier 4: already visible near the top; diversify search intent.
    """
    rows = group.get("matches", {}).get(owner, [])
    if not rows:
        return (0, 10, "관련 검색어 3개를 모두 확인했지만 블로그 카드 상위 10개에서 글을 찾지 못해 신규 노출을 우선합니다.")

    ranks = [int(row["rank"]) for row in rows if isinstance(row.get("rank"), int)]
    if not ranks:
        return (4, 1, "검증된 자료에서 순번을 확인할 수 없어 다른 검색 의도로 확장하는 초안을 제안합니다.")

    best, worst = min(ranks), max(ranks)
    seen_queries = {row.get("query") for row in rows}
    query_count = len(group.get("queries", [])) or 3
    absent_variants = max(0, query_count - len(seen_queries))
    if best >= 8:
        return (1, best, f"관련 검색어에서 가장 좋은 관측 순번도 블로그 카드 {best}번째입니다. 8~10번째 노출을 보강할 글을 권합니다.")
    if absent_variants:
        return (2, worst, f"관련 검색어 {query_count}개 중 {len(seen_queries)}개에서만 상위 10개에 글이 보입니다. 아직 보이지 않는 검색 의도를 보강합니다.")
    if worst >= 8:
        return (2, worst, f"일부 검색어에서 블로그 카드 {worst}번째로 관측돼 해당 검색 의도를 보강합니다.")
    if best >= 4:
        return (3, best, f"관련 검색어의 가장 좋은 관측 순번이 블로그 카드 {best}번째입니다. 노출을 더 높일 수 있는 다른 각도의 글을 권합니다.")
    return (4, best, f"이미 블로그 카드 상위권({best}번째)에 글이 있어 같은 내용을 반복하기보다 다른 검색 의도로 확장합니다.")


def _recent_blog_recommendations(history: object) -> dict[tuple[str, str], int]:
    """Previous suggestions help rotate IDs, but are NOT proof of publishing."""
    rows = history if isinstance(history, list) else (history or {}).get("entries", [])
    counts: dict[tuple[str, str], int] = {}
    for run in (rows or [])[-12:]:
        for item in (run.get("recommendation") or {}).get("assignments", []):
            chosen = item.get("blog_ids") or {}
            for owner, blog_id in chosen.items():
                if owner in PEOPLE and blog_id in PEOPLE[owner]:
                    key = (owner, blog_id)
                    counts[key] = counts.get(key, 0) + 1
    return counts


def _choose_blog_id(
    owner: str, keyword: str, groups: dict[str, dict], recent: dict[tuple[str, str], int]
) -> tuple[str, str]:
    """Pick the weakest visible blog ID, without treating absent posts as unindexed.

    Only fully verified groups contribute evidence. Same-keyword exposure has
    priority; ties favor IDs suggested less often, then weaker visibility in
    other verified keywords, then stable configured order.
    """
    blog_ids = PEOPLE[owner]
    group = groups[keyword]
    group_rows = (group.get("matches") or {}).get(owner, [])

    def matches_for(blog_id: str, source_group: dict) -> list[dict]:
        return [row for row in ((source_group.get("matches") or {}).get(owner) or [])
                if row.get("blog_id") == blog_id]

    choices = []
    for pos, blog_id in enumerate(blog_ids):
        target = matches_for(blog_id, group)
        target_queries = {row.get("query") for row in target if row.get("query")}
        all_queries = set()
        for group_name, verified_group in groups.items():
            if verified_group.get("complete") is not True or verified_group.get("status") != "VERIFIED":
                continue
            for row in matches_for(blog_id, verified_group):
                if row.get("query"):
                    all_queries.add((group_name, row["query"]))
        best = min((int(row["rank"]) for row in target
                    if isinstance(row.get("rank"), int) and 1 <= row["rank"] <= 10),
                   default=11)
        score = (len(target_queries), recent.get((owner, blog_id), 0),
                 len(all_queries), -best, pos)
        choices.append((score, blog_id, len(target_queries), best))
    _, blog_id, visible_variants, best = min(choices, key=lambda row: row[0])

    if len(blog_ids) == 1:
        reason = "이 담당자가 등록한 블로그 ID는 하나이므로 해당 계정에서 발행합니다."
    elif visible_variants == 0:
        others_appear = any(row.get("blog_id") != blog_id for row in group_rows)
        if others_appear:
            reason = (f"같은 담당자의 다른 블로그는 관련 검색어에 나타났지만, "
                      f"이 블로그는 상위 10개에서 보이지 않아 노출 보강 대상으로 선택했습니다.")
        else:
            reason = (f"등록한 블로그들이 모두 이 키워드의 상위 10개에 보이지 않아 "
                      f"다른 검증 키워드의 노출과 최근 추천 이력을 비교해 선택했습니다.")
    else:
        reason = (f"이 블로그는 관련 검색어 {visible_variants}/{len(group.get('queries') or []) or 3}개에서만 "
                  f"노출됐고 가장 좋은 관측 순번은 {best}번째입니다. 다른 계정보다 보강이 필요한 블로그입니다.")
    return blog_id, reason


def _team_points(owner: str, keyword: str, group: dict) -> int:
    """Score a candidate without conflating team membership with observed rank."""
    tier, rank, _ = _owner_priority(owner, keyword, group)
    return {0: 1000, 1: 350, 2: 135, 3: 45, 4: 5}[tier] + (rank if tier else 0)


def recommend(
    groups: dict[str, dict],
    *,
    history: object = None,
    at: datetime | None = None,
) -> dict:
    """Allocate two DIFFERENT verified keywords to two disjoint two-person teams.

    Evaluate all keyword pairings and owner partitions, not just the first two
    people who are absent. This keeps all four authors in the operation even
    when one is already visible on the proposed keyword.
    """
    eligible = [(keyword, group) for keyword, group in groups.items()
                if keyword in GROUPS and group.get("complete") is True
                and group.get("status") == "VERIFIED"]
    available_owners = tuple(PEOPLE)
    recent = _recent_keyword_counts(history)
    recent_blogs = _recent_blog_recommendations(history)
    used_titles = _used_titles(history)

    def pairing_score(keyword_a: str, team_a: tuple[str, ...],
                      keyword_b: str | None = None, team_b: tuple[str, ...] = ()) -> tuple:
        pairs = [(keyword_a, team_a)]
        if keyword_b:
            pairs.append((keyword_b, team_b))
        priority_sum = sum(_team_points(owner, keyword, groups[keyword])
                           for keyword, team in pairs for owner in team)
        never_visible = sum(
            _owner_priority(owner, keyword, groups[keyword])[0] == 0
            for keyword, team in pairs for owner in team
        )
        weak = sum(
            _owner_priority(owner, keyword, groups[keyword])[0] == 1
            for keyword, team in pairs for owner in team
        )
        repeated = sum(recent.get((owner, keyword), 0)
                       for keyword, team in pairs for owner in team)
        # On an equal score, prefer balanced verified absences, fewer repeat
        # suggestions, and original configured keyword order for stability.
        indexes = tuple(sorted(list(GROUPS).index(key) for key, _ in pairs))
        return (priority_sum, never_visible, weak, -repeated,
                tuple(-idx for idx in indexes))

    choice: list[tuple[str, tuple[str, str]]] = []
    if len(eligible) >= 2:
        best = None
        # Four people, two unique keywords, exactly two authors on each keyword.
        for (keyword_a, _), (keyword_b, _) in combinations(eligible, 2):
            for team_a in combinations(available_owners, 2):
                team_b = tuple(owner for owner in available_owners if owner not in team_a)
                score = pairing_score(keyword_a, team_a, keyword_b, team_b)
                if best is None or score > best:
                    best = score
                    choice = [(keyword_a, team_a), (keyword_b, team_b)]
    elif len(eligible) == 1:
        keyword, _ = eligible[0]
        team = max(combinations(available_owners, 2),
                   key=lambda members: pairing_score(keyword, members))
        choice = [(keyword, team)]

    # Put the keyword with the greatest team-wide need first.
    choice.sort(key=lambda row: (-sum(_team_points(owner, row[0], groups[row[0]])
                                       for owner in row[1]), list(GROUPS).index(row[0])))
    assignments: list[dict] = []
    used_people: set[str] = set()
    for team_number, (keyword, people) in enumerate(choice, start=1):
        assert len(people) == 2 and not (set(people) & used_people)
        used_people.update(people)
        blog_choices = {
            owner: _choose_blog_id(owner, keyword, groups, recent_blogs)
            for owner in people
        }
        titles = _title_rows(keyword, list(people), used_titles)
        for title in titles:
            blog_id, blog_reason = blog_choices[title["owner"]]
            title["blog_id"] = blog_id
            title["blog_url"] = f"https://blog.naver.com/{blog_id}"
            title["blog_reason"] = blog_reason
        assignments.append({
            "team_number": team_number,
            "keyword": keyword,
            "people": list(people),
            "titles": titles,
            "blog_ids": {owner: blog_choices[owner][0] for owner in people},
            "blog_reasons": {owner: blog_choices[owner][1] for owner in people},
            "owner_reasons": {owner: _owner_priority(owner, keyword, groups[keyword])[2]
                              for owner in people},
            "owner_priorities": {owner: _owner_priority(owner, keyword, groups[keyword])[0]
                                 for owner in people},
            "reason": "동일 핵심 키워드를 두 사람이 서로 다른 글과 각자 지정된 블로그에 발행",
            "evidence_status": "VERIFIED",
        })

    teams_count = len(assignments)
    status = "READY" if teams_count == 2 else ("PARTIAL" if teams_count else "PENDING")
    note = (
        "2개 키워드에 2명씩, 총 4명 배정 완료" if teams_count == 2
        else "검증된 서로 다른 키워드가 한 개뿐이어서 1팀만 추천하고 나머지 2명은 보류"
        if teams_count == 1 else "검증된 검색 자료가 없어 2인 팀 배정을 보류"
    )
    return {
        "assignment_mode": "TWO_PERSON_KEYWORD_TEAMS",
        "target_teams": 2,
        "status": status,
        "ready": bool(assignments),
        "complete": teams_count == 2,
        "slot_at_kst": next_publish_slot(at),
        "assignments": assignments,
        "unassigned": [owner for owner in PEOPLE if owner not in used_people],
        "note": note,
        "title_policy": "같은 키워드에 두 사람이 각기 다른 제목·구성으로 발행하는 규칙 기반 초안",
    }
