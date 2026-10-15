"""Offline tests for Windows capture. No Naver searches are performed."""
from __future__ import annotations

import json
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from threading import Event
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "desktop"))
from api import DesktopAPI
from collector import (
    CollectionBlocked,
    collect,
    file_keyword,
    validate_inputs,
)


class FakePage:
    def __init__(self, body="검색 결과 정상 표시"):
        self.body = body
        self.visited = []
        self.mouse = types.SimpleNamespace(wheel=lambda *args: None)
    def goto(self, url, **kwargs):
        self.visited.append(url)
    def wait_for_timeout(self, ms):
        pass
    def locator(self, selector):
        return types.SimpleNamespace(inner_text=lambda **kwargs: self.body)
    def content(self):
        return '<html><body><div class="api_subject_bx">검색 결과</div></body></html>'
    def screenshot(self, path, **kwargs):
        Path(path).write_bytes(b'fake PNG bytes')


class FakeContext:
    def __init__(self, page):
        self.page = page
        self.closed = False
    def new_page(self):
        return self.page
    def close(self):
        self.closed = True


class FakeBrowser:
    def __init__(self, body="검색 결과 정상 표시"):
        self.body = body
        self.pages = []
        self.contexts = []
        self.closed = False
    def new_context(self, **kwargs):
        page = FakePage(self.body)
        self.pages.append(page)
        context = FakeContext(page)
        self.contexts.append((context, kwargs))
        return context
    def close(self):
        self.closed = True


class FakePlaywright:
    def __init__(self, browser):
        self.chromium = types.SimpleNamespace(launch=lambda **kwargs: browser)
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False


class CollectorTests(unittest.TestCase):
    def test_keyword_limits_and_dedupe(self):
        self.assertEqual(validate_inputs([' 선불폰   개통 ', '선불폰 개통'], ['pc','mo'])[0], ['선불폰 개통'])
        with self.assertRaises(ValueError):
            validate_inputs(['x']*0, ['pc'])
        with self.assertRaises(ValueError):
            validate_inputs([str(x) for x in range(11)], ['pc'])
        with self.assertRaises(ValueError):
            validate_inputs(['ok'], ['bad'])
        self.assertNotIn('/', file_keyword('선불폰 개통/확인:PC'))

    def test_fake_2_device_capture_archive(self):
        browser = FakeBrowser()
        fake = types.ModuleType('playwright.sync_api')
        fake.sync_playwright = lambda: FakePlaywright(browser)
        with tempfile.TemporaryDirectory() as tmp, patch.dict(sys.modules, {'playwright.sync_api': fake}):
            observed = []
            # No actual waiting for the test; it's fine to bypass the wait in a fake.
            class FastEvent(Event):
                def wait(self, timeout=None):
                    return self.is_set()
            result = collect(['선불폰 개통'], ['pc','mo'], Path(tmp), FastEvent(),
                             lambda *args: observed.append(args))
            self.assertEqual(result['status'], 'completed')
            self.assertEqual(result['saved'], 2)
            self.assertTrue((Path(tmp) / 'serp_evidence.zip').is_file())
            self.assertTrue((Path(tmp) / 'manifest.json').is_file())
            self.assertEqual(len(browser.contexts),2)
            self.assertEqual(browser.contexts[0][1]['viewport']['width'],1366)
            self.assertEqual(browser.contexts[1][1]['viewport']['width'],390)
            self.assertIn('search.naver.com',browser.pages[0].visited[0])
            self.assertIn('m.search.naver.com',browser.pages[1].visited[0])
            self.assertEqual(observed[-1][0],'completed')
            self.assertTrue(browser.closed)

    def test_captcha_halts_whole_run(self):
        browser = FakeBrowser('자동입력 방지 제한')
        fake = types.ModuleType('playwright.sync_api')
        fake.sync_playwright = lambda: FakePlaywright(browser)
        with tempfile.TemporaryDirectory() as tmp, patch.dict(sys.modules, {'playwright.sync_api': fake}):
            result = collect(['선불폰 개통'], ['pc', 'mo'], Path(tmp), Event(), lambda *_: None)
            self.assertEqual(result['status'],'blocked')
            self.assertEqual(result['saved'],0)
            self.assertEqual(len(browser.pages),1)

    def test_desktop_api_rejects_arbitrary_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            api=DesktopAPI(root=Path(tmp))
            with self.assertRaises(ValueError):
                api.read_collected_html('secret.html')
            self.assertFalse(api.start_collect([],['pc'])['ok'])
            self.assertEqual(api.collect_status()['state'],'idle')


if __name__ == '__main__':
    unittest.main()
