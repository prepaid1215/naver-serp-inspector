"""Compliant Playwright collector for Naver mobile integrated search.

The adapter stores structured metadata plus screenshot hashes. It does not
bypass access controls and it stops the whole run when a restriction appears.
"""
from __future__ import annotations

import hashlib
import re
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode

from automation.extractor import EXTRACT_JS, error_observations, observations_from_browser
from automation.models import (
    FRESHNESS_MINUTES,
    GROUPS,
    KST,
    SCHEMA,
    SURFACE_ARTICLES,
    SURFACE_SECTION,
    iso_kst,
    make_observation,
    migrate_legacy_run,
    parse_time,
)
from automation.owners import PEOPLE
from automation.scheduler import aggregate_groups, recommend
from automation.storage import append_run, atomic_write_json, normalize_history, read_json


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "web" / "ops-data"
EVIDENCE_DIR = ROOT / "monitor-evidence"
USER_AGENT = (
    "Mozilla/5.0 (Linux; Android 13; SM-S911N) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
)


def _safe_name(query: str) -> str:
    return re.sub(r"[^a-z0-9가-힣]+", "-", query.casefold()).strip("-")[:50] or "query"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect_query(page, query: str, evidence_dir: Path) -> dict:
    source_url = "https://m.search.naver.com/search.naver?" + urlencode(
        {"where": "nexearch", "query": query}
    )
    observed_at = iso_kst()
    page.goto(source_url, wait_until="domcontentloaded", timeout=35_000)
    page.wait_for_timeout(1_500)
    for _ in range(6):
        page.mouse.wheel(0, 900)
        page.wait_for_timeout(350)
    page.wait_for_timeout(400)
    raw = page.evaluate(EXTRACT_JS)

    evidence_dir.mkdir(parents=True, exist_ok=True)
    screenshot = evidence_dir / f"{_safe_name(query)}.png"
    page.screenshot(path=str(screenshot), full_page=True, animations="disabled", timeout=30_000)
    screenshot_hash = _sha256(screenshot)
    evidence = {
        "screenshot_sha256": screenshot_hash,
        "screenshot_artifact_name": screenshot.name,
        "browser": "playwright-chromium",
        "device": "mobile-emulation",
    }
    surfaces = observations_from_browser(
        raw,
        observed_at=observed_at,
        source_url=source_url,
        evidence=evidence,
    )
    return {"query": query, "surfaces": surfaces}


def _halted_record(query: str, observed_at: str, reason: str) -> dict:
    surfaces = {
        surface: make_observation(
            surface=surface,
            status="BLOCKED",
            observed_at=observed_at,
            reason=reason,
            reason_code="RUN_HALTED_AFTER_RESTRICTION",
            evidence={"viewport": "390x844"},
        )
        for surface in (SURFACE_SECTION, SURFACE_ARTICLES)
    }
    return {"query": query, "surfaces": surfaces}


def _previous_run(path: Path) -> dict:
    value = read_json(path, {})
    if isinstance(value, dict) and value.get("schema") == SCHEMA:
        return value
    if isinstance(value, dict) and value:
        return migrate_legacy_run(value)
    return {}


def collect_all(
    *,
    data_dir: Path = DATA_DIR,
    evidence_root: Path = EVIDENCE_DIR,
    delay_seconds: float = 6.0,
) -> dict:
    from playwright.sync_api import sync_playwright

    captured = datetime.now(KST)
    stamp = captured.strftime("%Y-%m-%d_%H%M%S")
    run_id = f"{captured.strftime('%Y%m%dT%H%M%S%z')}-mobile"
    evidence_dir = evidence_root / stamp
    latest_path = data_dir / "latest.json"
    history_path = data_dir / "history.json"
    previous = _previous_run(latest_path)
    queries: dict[str, dict] = {}
    errors: list[str] = []
    halted = False

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--no-sandbox"])
        try:
            context = browser.new_context(
                user_agent=USER_AGENT,
                viewport={"width": 390, "height": 844},
                device_scale_factor=2,
                is_mobile=True,
                has_touch=True,
                locale="ko-KR",
            )
            page = context.new_page()
            all_queries = [query for variants in GROUPS.values() for query in variants]
            for index, query in enumerate(all_queries):
                if halted:
                    queries[query] = _halted_record(
                        query,
                        iso_kst(),
                        "앞선 검색에서 접근 제한을 감지해 추가 요청을 보내지 않음",
                    )
                    continue
                if index:
                    time.sleep(delay_seconds)
                try:
                    record = collect_query(page, query, evidence_dir)
                except Exception as exc:  # Playwright surface errors are data, not invented ranks.
                    reason = f"{type(exc).__name__}: {str(exc)[:240]}"
                    record = {
                        "query": query,
                        "surfaces": error_observations(observed_at=iso_kst(), reason=reason),
                    }
                    errors.append(f"{query}: {reason}")
                queries[query] = record
                section = record["surfaces"][SURFACE_SECTION]
                print(query, section["status"], section.get("reason", ""), flush=True)
                if section["status"] == "BLOCKED":
                    halted = True
                    errors.append("네이버 접근 제한 감지: 후속 검색 요청 중단")
            context.close()
        finally:
            browser.close()

    reference = parse_time(iso_kst())
    groups = aggregate_groups(queries, previous, at=reference)
    old_history = normalize_history(read_json(history_path, []))
    recommendation = recommend(groups, history=old_history, at=reference)
    run = {
        "schema": SCHEMA,
        "run_id": run_id,
        "captured_at_kst": iso_kst(),
        "freshness_minutes": FRESHNESS_MINUTES,
        "collector": {
            "kind": "playwright_mobile_emulation",
            "viewport": "390x844",
            "user_agent_family": "Android Chrome",
            "rank_policy": "verified_integrated_blog_section_only",
            "restriction_policy": "stop_on_block_no_bypass",
        },
        "people": PEOPLE,
        "queries": queries,
        "groups": groups,
        "recommendation": recommendation,
        "errors": errors,
        "evidence": {
            "local_directory": str(evidence_dir.relative_to(ROOT)),
            "contains_raw_html": False,
            "public_upload_default": False,
        },
    }
    history = append_run(old_history, run)
    atomic_write_json(latest_path, run)
    atomic_write_json(history_path, history)
    counts: dict[str, int] = {}
    for record in queries.values():
        status = record["surfaces"][SURFACE_SECTION]["status"]
        counts[status] = counts.get(status, 0) + 1
    print("section_status_counts", counts, "recommendation", recommendation["status"])
    return run

