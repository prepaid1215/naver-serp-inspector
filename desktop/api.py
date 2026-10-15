"""pywebview JS bridge for explicitly requested local SERP collection."""
from __future__ import annotations

import base64
import os
import threading
from pathlib import Path

from collector import collect, default_root, new_run_dir, validate_inputs


class DesktopAPI:
    def __init__(self, root: Path | None = None, collector=collect):
        self.root = root or default_root()
        self.collector = collector
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._worker = None
        self._folder: Path | None = None
        self._state = "idle"
        self._completed = 0
        self._total = 0
        self._message = "수집 준비 완료"
        self._files: list[str] = []
        self._run_id = ""

    def _notify(self, status: str, done: int, total: int, message: str) -> None:
        with self._lock:
            self._state, self._completed, self._total, self._message = status, done, total, message

    def start_collect(self, keywords, devices):
        try:
            words, modes = validate_inputs(keywords, devices)
        except ValueError as exc:
            return {"ok": False, "error": str(exc)}
        with self._lock:
            if self._worker is not None and self._worker.is_alive():
                return {"ok": False, "error": "이미 수집 중입니다."}
            self._folder = new_run_dir(self.root)
            self._run_id = self._folder.name
            self._stop = threading.Event()
            self._files = []
            self._state, self._completed, self._total = "running", 0, len(words) * len(modes)
            self._message = "Edge 실행 준비 중"
            self._worker = threading.Thread(target=self._run, args=(words, modes, self._folder, self._stop), daemon=True)
            self._worker.start()
            return {"ok": True, "run_id": self._run_id}

    def _run(self, words, modes, folder, stop):
        try:
            result = self.collector(words, modes, folder, stop, self._notify)
            names = [row["html"] for row in result.get("records", [])]
            with self._lock:
                self._files = names
                self._state, self._message = result["status"], result["message"]
        except Exception as exc:
            self._notify("error", 0, len(words) * len(modes), f"프로그램 오류: {exc}")

    def collect_status(self):
        with self._lock:
            return {
                "state": self._state, "completed": self._completed, "total": self._total,
                "message": self._message, "run_id": self._run_id,
                "files": list(self._files), "folder": str(self._folder) if self._folder else "",
            }

    def stop_collect(self):
        self._stop.set()
        return {"ok": True, "message": "현재 화면 처리 후 중지합니다."}

    def read_collected_html(self, name):
        """Only read listed HTML files from the current run, not arbitrary paths."""
        with self._lock:
            if name not in self._files or not self._folder:
                raise ValueError("현재 수집에서 생성된 HTML이 아닙니다.")
            folder = self._folder
        path = folder / name
        if path.suffix.lower() != ".html" or not path.is_file() or path.stat().st_size > 50 * 1024 * 1024:
            raise ValueError("지원하지 않는 HTML 파일입니다.")
        return {"name": name, "base64": base64.b64encode(path.read_bytes()).decode("ascii")}

    def open_run_folder(self):
        with self._lock:
            folder = self._folder
        if folder and folder.is_dir() and os.name == "nt":
            os.startfile(str(folder))
            return {"ok": True}
        return {"ok": False, "error": "Windows에서 저장 폴더를 열 수 없습니다."}
