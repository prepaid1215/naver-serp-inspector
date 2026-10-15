"""Windows/Python fallback: serve the same offline interface in the default browser.

Only 127.0.0.1 is bound. Ctrl+C exits the local server.
"""
from __future__ import annotations
import functools
import http.server
import pathlib
import threading
import webbrowser

root=pathlib.Path(__file__).resolve().parents[1]/"web"
server=http.server.ThreadingHTTPServer(("127.0.0.1",0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
url=f"http://127.0.0.1:{server.server_port}/"
threading.Timer(0.4,lambda:webbrowser.open(url)).start()
print(f"SERP Lens 실행 중: {url}\n종료하려면 Ctrl+C를 누르세요.")
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
