#!/usr/bin/env python3
"""
Throwaway helper for the KWC-102 device spike.

Serves the capability probe page to the Kobo over the LAN and accepts the
results back via POST, writing them to a file on this laptop — so no screenshot
or on-device copy/paste is needed.

  GET  any path  -> serves kwc-102-capability-probe.html
  POST /report   -> writes the JSON body to kwc-102-results.json (+ .txt summary)

Run from this folder:
    python3 serve_probe.py
Then open  http://<this-mac-ip>:8000/  in the Kobo browser.
"""

import base64
import json
import os
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PROBE = os.path.join(HERE, "kwc-102-capability-probe.html")
RESULTS_JSON = os.path.join(HERE, "kwc-102-results.json")
RESULTS_TXT = os.path.join(HERE, "kwc-102-results.txt")
PORT = int(os.environ.get("PORT", "8000"))

# Tiny valid 1x1 images served over real HTTP (not data: URIs) so the probe can
# test what the panel actually decodes. The data-URI approach failed on the
# device, so these are served as proper image responses instead.
IMAGES = {
    "png":  ("image/png",  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"),
    "gif":  ("image/gif",  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
    "jpeg": ("image/jpeg", "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q=="),
    "webp": ("image/webp", "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v3AgAA="),
    "avif": ("image/avif", "AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAMAAAAABNjb2xybmNseAACAAIABoAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgABogQEDQgMgkQAAAAB8dSLfI="),
}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, content_type="text/plain; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/img/"):
            fmt = self.path[len("/img/"):].split("?")[0]
            entry = IMAGES.get(fmt)
            if entry is None:
                self._send(404, "no such image: %s" % fmt)
                return
            content_type, b64 = entry
            self._send(200, base64.b64decode(b64), content_type)
            return
        try:
            with open(PROBE, "rb") as f:
                html = f.read()
        except OSError as e:
            self._send(500, "probe page not found: %s" % e)
            return
        self._send(200, html, "text/html; charset=utf-8")

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b""
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception as e:
            self._send(400, "bad JSON: %s" % e)
            return

        stamp = datetime.now().isoformat(timespec="seconds")
        data["_received_at"] = stamp
        with open(RESULTS_JSON, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        summary = data.get("summary", "")
        with open(RESULTS_TXT, "w", encoding="utf-8") as f:
            f.write(summary + "\n")

        print("\n========== RESULTS RECEIVED %s ==========" % stamp, flush=True)
        print("UA: %s" % data.get("userAgent", "(none)"), flush=True)
        print("Saved: %s" % RESULTS_JSON, flush=True)
        print("Saved: %s" % RESULTS_TXT, flush=True)
        print("------------------------------------------------------", flush=True)
        print(summary, flush=True)
        print("======================================================\n", flush=True)

        self._send(200, "ok — results saved on the laptop")

    def log_message(self, fmt, *args):
        sys.stderr.write("[probe] %s - %s\n" % (self.address_string(), fmt % args))


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("Serving KWC-102 probe on http://0.0.0.0:%d/" % PORT, flush=True)
    print("Open this on the Kobo:  http://<this-mac-lan-ip>:%d/" % PORT, flush=True)
    print("Waiting for the device to POST results... (Ctrl-C to stop)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.", flush=True)


if __name__ == "__main__":
    main()
