"""Offline responsive smoke test for the v2 operations dashboard."""
from datetime import datetime, timedelta
from functools import partial
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
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
        expect(page.locator("#recommendations")).to_contain_text("발행자 자동 배정 보류")

        # Fresh: ten minutes after capture the feed-card metric drives the dashboard.
        page.clock.set_fixed_time(captured + timedelta(minutes=10))
        page.reload()
        expect(page.locator("#message")).to_contain_text("최신 저장 자료", timeout=10_000)
        expect(page.locator("#verified-count")).to_have_text(f"{verified_total}/12")
        if latest["recommendation"]["assignments"] and verified_total == 12:
            expect(page.locator("#recommendations")).to_contain_text("VERIFIED")
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

