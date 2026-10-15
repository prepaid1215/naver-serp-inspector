"""Windows desktop shell for the shared static browser app.

Uses only the loopback interface and a random ephemeral port. GUI via WebView2
(pywebview). Neither the app nor the analyzer sends search requests.
"""
from __future__ import annotations

import http.server
import socketserver
import sys
import threading
from pathlib import Path


def web_root() -> Path:
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle:
        return Path(bundle) / "web"
    return Path(__file__).resolve().parents[1] / "web"


class LocalHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def log_message(self, *_):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        super().end_headers()


class LoopbackServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = False


def main():
    import webview

    root = web_root()
    if not (root / "index.html").is_file():
        raise RuntimeError(f"웹 리소스를 찾을 수 없습니다: {root}")

    handler = lambda *args, **kwargs: LocalHandler(*args, directory=str(root), **kwargs)
    httpd = LoopbackServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    port = httpd.server_address[1]
    try:
        webview.create_window(
            "SERP Lens — 오프라인 검색 분석기",
            f"http://127.0.0.1:{port}/index.html",
            width=1320,
            height=900,
            min_size=(940, 680),
            confirm_close=False,
        )
        webview.start(gui="edgechromium", debug=False)
    finally:
        httpd.shutdown()
        httpd.server_close()


if __name__ == "__main__":
    main()
