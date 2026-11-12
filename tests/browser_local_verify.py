"""Synthetic check of the Windows headed screen cross-check (no Naver access)."""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from playwright.sync_api import sync_playwright

from automation.extractor import EXTRACT_JS, observations_from_browser
from automation.local_verify import run_local_checks
from automation.models import SURFACE_FEED, validate_observation


def card(index: int, kind: str) -> str:
    if kind == "cafe":
        link = f'<a href="https://m.cafe.naver.com/club/{index}">cafe post {index} title text</a>'
    else:
        link = (
            f'<a href="https://m.blog.naver.com/writer{index}/22400000{index:04d}">'
            f"Blog post number {index} headline text</a>"
        )
    return (
        '<div class="api_subject_bx"><div class="fds-ugc-ur" style="height:220px;background:#eef">'
        f'<div class="sds-comps-profile-source">author {index}</div>{link}</div></div>'
    )


def page_html(cover: bool = False) -> str:
    kinds = ["blog", "blog", "cafe"] + ["blog"] * 8 + ["cafe", "blog", "blog"]
    cards = "".join(card(i, kind) for i, kind in enumerate(kinds, 1))
    overlay = (
        '<div style="position:absolute;left:0;top:0;width:100%;height:4000px;background:#fff;opacity:.99"></div>'
        if cover else ""
    )
    return f'<html><body style="margin:0"><div id="main_pack">{cards}</div>{overlay}</body></html>'


def run(cover: bool) -> dict:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True, executable_path=os.environ.get("SERP_CHROME_PATH") or None, args=["--no-sandbox"]
        )
        context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True)
        page = context.new_page()
        page.set_content(page_html(cover))
        raw = page.evaluate(EXTRACT_JS)
        with tempfile.TemporaryDirectory() as folder:
            shot = Path(folder) / "page.png"
            page.screenshot(path=str(shot), full_page=True)
            rerun = page.evaluate(EXTRACT_JS)
            flags = run_local_checks(page, raw, shot, rerun)
        context.close()
        browser.close()
    return {"raw": raw, "flags": flags}


good = run(False)
assert good["raw"]["feed_layout"] == "per_post_cards"
assert [c["kind"] for c in good["raw"]["feed_cards"]][:3] == ["blog", "blog", "cafe"]
assert good["raw"]["feed_cards"][0]["title"].startswith("Blog post number 1")
assert all(good["flags"][k] for k in good["flags"] if k != "checked_cards"), good["flags"]
surfaces = observations_from_browser(
    good["raw"], observed_at="2026-11-12T12:00:00+09:00", source_url="https://m.search.naver.com/x",
    evidence={"screenshot_sha256": "e" * 64}, local_audit=good["flags"],
)
feed = surfaces[SURFACE_FEED]
assert feed["status"] == "VERIFIED", feed["reason"]
assert feed["evidence"]["verification_method"] == "local_headed_visual_crosscheck"
assert validate_observation(feed) == []
assert feed["results"][2]["rank"] == 3 and feed["results"][2]["feed_rank"] == 4

covered = run(True)
assert covered["flags"]["screen_hit_test"] is False, covered["flags"]
bad = observations_from_browser(
    covered["raw"], observed_at="2026-11-12T12:00:00+09:00", source_url="https://m.search.naver.com/x",
    evidence={"screenshot_sha256": "e" * 64}, local_audit=covered["flags"],
)[SURFACE_FEED]
assert bad["status"] == "CANDIDATE" and "screen_hit_test" in bad["reason"], bad
print("LOCAL SCREEN CROSS-CHECK PASS", good["flags"])
