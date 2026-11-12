"""Offline responsive smoke test for the v2 operations dashboard."""
from datetime import datetime, timedelta
from copy import deepcopy
from functools import partial
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
import re
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


server = ThreadingHTTPServer(
    ("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT / "web"))
)
Thread(target=server.serve_forever, daemon=True).start()

try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=os.environ.get("SERP_CHROME_PATH") or None,
            args=["--no-sandbox"],
        )
        context = browser.new_context(accept_downloads=True, viewport={"width": 390, "height": 844})
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        latest = json.loads((ROOT / "web" / "ops-data" / "latest.json").read_text(encoding="utf-8"))
        captured = datetime.fromisoformat(latest["captured_at_kst"])
        verified_total = sum(
            1 for record in latest["queries"].values()
            if record["surfaces"]["INTEGRATED_FEED_BLOG_CARDS_TOP10"]["status"] == "VERIFIED"
        )

        # Stale: three hours after capture nothing is confirmed and assignment is held.
        page.clock.set_fixed_time(captured + timedelta(hours=3))
        page.goto(f"http://127.0.0.1:{server.server_port}/keyword-ops.html")
        expect(page.locator("#message")).to_contain_text("최신 저장 자료", timeout=10_000)
        expect(page.locator("#verified-count")).to_have_text("0/12")
        expect(page.locator("#team-count")).to_have_text("0/2")
        expect(page.locator("#recommendations")).to_contain_text("최신 검색 결과가 없어 현재 발행은 보류합니다.")

        # Fresh: ten minutes after capture the feed-card metric drives the dashboard.
        page.clock.set_fixed_time(captured + timedelta(minutes=10))
        page.reload()
        expect(page.locator("#message")).to_contain_text("최신 저장 자료", timeout=10_000)
        expect(page.locator("#verified-count")).to_have_text(f"{verified_total}/12")
        if latest["recommendation"].get("assignment_mode") != "TWO_PERSON_KEYWORD_TEAMS":
            expect(page.locator("#recommendations")).to_contain_text("이전 1인 배정 자료입니다.")

        # Supply a synthetic 2x2 verified recommendation even when the checked-in
        # observation was collected using the earlier one-author format.
        fixture = deepcopy(latest)
        def pair(keyword, people, blog_ids, number):
            return {
                "team_number": number, "keyword": keyword, "people": people,
                "owner_reasons": {p: "해당 키워드의 검증 결과를 기준으로 선택" for p in people},
                "blog_ids": dict(zip(people, blog_ids)),
                "titles": [
                    {"owner": owner, "blog_id": blog_id,
                     "blog_reason": "블로그별 검증 노출 결과에 따른 선택",
                     "title": f"{keyword} {owner} 전용 발행 제목",
                     "intent": "검증된 작성 방향"}
                    for owner, blog_id in zip(people, blog_ids)
                ],
                "evidence_status": "VERIFIED",
            }
        fixture["recommendation"] = {
            **fixture["recommendation"],
            "assignment_mode": "TWO_PERSON_KEYWORD_TEAMS",
            "status": "READY", "complete": True,
            "assignments": [
                pair("다이소 유심", ["영은", "수진"], ["esim99_", "jjuny1253"], 1),
                pair("LG모두의 원칩", ["건호", "하루"], ["lifeon5g_", "ntelecom59"], 2),
            ],
            "unassigned": [],
        }
        page.route("**/ops-data/latest.json*", lambda route: route.fulfill(
            status=200, content_type="application/json",
            body=json.dumps(fixture, ensure_ascii=False)))
        page.reload()
        expect(page.locator("#recommendations .team-publish-card")).to_have_count(2)
        expect(page.locator("#recommendations .team-member")).to_have_count(4)
        expect(page.locator("#team-count")).to_have_text("2/2")
        expect(page.locator("#recommendations")).to_contain_text("1팀 · 다이소 유심")
        expect(page.locator("#recommendations")).to_contain_text("2팀 · LG모두의 원칩")
        expect(page.locator("#recommendations")).to_contain_text("영은 + 수진")
        expect(page.locator("#recommendations")).to_contain_text("건호 + 하루")
        expect(page.locator("#recommendations")).to_contain_text("발행할 블로그")
        expect(page.locator("#recommendations .simple-blog-id")).to_have_count(4)
        expect(page.locator("#recommendations .simple-blog-id").first).to_have_attribute(
            "href", re.compile(r"^https://blog\.naver\.com/[a-z0-9_-]+$"))
        expect(page.locator("#keyword-cards")).to_contain_text("블로그")
        expect(page.locator("#query-details .query-detail")).to_have_count(12)
        expect(page.locator("#query-details")).to_contain_text("피드 블로그 카드 순번")
        expect(page.locator("#query-details")).to_contain_text("통합검색 블로그 글 후보")
        dimensions = page.evaluate(
            "() => ({scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth})"
        )
        assert dimensions["scroll"] <= dimensions["client"], dimensions

        urls = "\n".join(
            f"https://blog.naver.com/external_{index}/{224500000000 + index}"
            for index in range(10)
        )
        expect(page.locator("#analysis-details")).to_be_visible()
        expect(page.locator(".stats")).to_be_hidden()
        page.locator("#analysis-details > summary").click()
        expect(page.locator(".stats")).to_be_visible()
        page.locator("#manual-reviewer").fill("ui-test")
        page.locator("#manual-source").fill("https://m.search.naver.com/search.naver?query=test")
        page.locator("#manual-urls").fill(urls)
        page.locator("#manual-screenshot").set_input_files(
            {"name": "evidence.png", "mimeType": "image/png", "buffer": b"synthetic screenshot"}
        )
        with page.expect_download() as download_info:
            page.locator("#manual-form button[type=submit]").click()
        assert download_info.value.suggested_filename.startswith("naver-blog-evidence-")
        expect(page.locator("#manual-message")).to_contain_text("검증 JSON")
        assert not errors, errors
        print("KEYWORD OPS MOBILE + MANUAL EVIDENCE SMOKE PASS", dimensions)
        context.close()
        browser.close()
finally:
    server.shutdown()

