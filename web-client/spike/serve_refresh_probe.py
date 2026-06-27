#!/usr/bin/env python3
"""
Throwaway helper for the KWC-103 device spike (e-ink rendering & refresh).

Same idea as serve_probe.py (KWC-102): serve a self-contained probe page to the
Kobo over the LAN and accept the results back via POST, so nothing has to be
copy/pasted off the panel. KWC-103 additionally needs *real, panel-sized images*
of controlled byte budgets to measure image draw latency and find a per-page
size budget — those are generated here with the stdlib only (no Pillow needed).

  GET  /              -> serves kwc-103-refresh-probe.html
  GET  /imgmeta       -> JSON list of the generated test images + their byte sizes
  GET  /img/<key>     -> the generated image bytes (cached); ?bust=N forces uncached
  POST /report        -> writes the JSON body to kwc-103-results.json (+ .txt summary)

Run from this folder:
    python3 serve_refresh_probe.py
Then open  http://<this-mac-lan-ip>:8000/  in the Kobo browser.

Image generation: grayscale PNGs at the panel resolution (1072x1448, from
docs/device.md KWC-101). Byte size is controlled by what fraction of scanlines
are random noise (incompressible) vs flat near-white — a crude but effective way
to span a realistic range of manga-page weights without any image library. JPEG
variants are added *only if* Pillow happens to be installed (PNG is the API
`eink` default, so PNG is the case that actually matters for this client).
"""

import json
import os
import struct
import sys
import zlib
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PROBE = os.path.join(HERE, "kwc-103-refresh-probe.html")
RESULTS_JSON = os.path.join(HERE, "kwc-103-results.json")
RESULTS_TXT = os.path.join(HERE, "kwc-103-results.txt")
PORT = int(os.environ.get("PORT", "8000"))

# Panel resolution confirmed on-device in docs/device.md (KWC-101).
PANEL_W = 1072
PANEL_H = 1448


# 5x7 bitmap font (digits only — all we draw is the big page number).
FONT5x7 = {
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
}

WHITE = 0xFF
BLACK = 0x00


def _fill_rect(buf, w, h, x0, y0, x1, y1, val):
    x0 = max(0, x0); y0 = max(0, y0); x1 = min(w, x1); y1 = min(h, y1)
    if x1 <= x0 or y1 <= y0:
        return
    row = bytes([val]) * (x1 - x0)
    for y in range(y0, y1):
        base = y * w
        buf[base + x0:base + x1] = row


def _draw_text(buf, w, h, text, x, y, scale, val):
    cx = x
    for ch in text:
        glyph = FONT5x7.get(ch)
        if glyph is not None:
            for ry in range(7):
                for rx in range(5):
                    if glyph[ry][rx] == "1":
                        _fill_rect(buf, w, h,
                                   cx + rx * scale, y + ry * scale,
                                   cx + (rx + 1) * scale, y + (ry + 1) * scale, val)
        cx += 6 * scale  # 5px glyph + 1px gap


def _encode_gray_png(width, height, pixels):
    """PNG-encode a width*height grayscale pixel buffer (filter 0 per row)."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type 0 (None)
        raw += pixels[y * width:(y + 1) * width]
    compressed = zlib.compress(bytes(raw), 6)

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        out += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return out

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)  # 8-bit grayscale
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")


def make_page_png(width, height, page_no, noise_rows, seed=42):
    """A *recognizable* mock manga page: black frame, big page number, count
    squares, solid bars and a checkerboard (so ghosting is obvious by eye), plus
    a random-noise "art" band whose height (noise_rows) drives the byte size.
    """
    import random
    rnd = random.Random(seed)
    buf = bytearray([WHITE]) * (width * height)

    # 1) noise "art" band first (drives file weight) — drawn UNDER the structure
    #    so heavy tiers can be large yet still recognizable. Inset within the frame.
    band_top = 300
    band_bottom = min(height - 10, band_top + max(0, noise_rows))
    for y in range(band_top, band_bottom):
        line = bytes(rnd.getrandbits(8) for _ in range(width - 80))
        base = y * width + 40
        buf[base:base + (width - 80)] = line

    # 2) white header panel painted over the noise, so the number stays legible
    _fill_rect(buf, width, height, 10, 10, width - 10, 290, WHITE)

    # outer frame
    _fill_rect(buf, width, height, 0, 0, width, 10, BLACK)
    _fill_rect(buf, width, height, 0, height - 10, width, height, BLACK)
    _fill_rect(buf, width, height, 0, 0, 10, height, BLACK)
    _fill_rect(buf, width, height, width - 10, 0, width, height, BLACK)

    # big page number, top-left
    _draw_text(buf, width, height, str(page_no), 70, 60, 30, BLACK)

    # `page_no` solid count squares, top-right (redundant cue)
    for i in range(page_no):
        x = width - 90 - i * 90
        _fill_rect(buf, width, height, x, 60, x + 70, 130, BLACK)

    # two solid bars in the body (over the art) — strong ghost bait, clear of the number
    _fill_rect(buf, width, height, 60, 320, width - 60, 360, BLACK)
    _fill_rect(buf, width, height, 60, 390, width - 60, 430, BLACK)

    # checkerboard footer — fine detail, exposes partial-refresh residue
    cb_top = height - 200
    cell = 40
    _fill_rect(buf, width, height, 10, cb_top - 10, width - 10, height - 10, WHITE)
    for gy in range((height - 10 - cb_top) // cell):
        for gx in range(width // cell):
            if (gx + gy) % 2 == 0:
                x0 = gx * cell
                y0 = cb_top + gy * cell
                _fill_rect(buf, width, height, x0, y0, x0 + cell, y0 + cell, BLACK)

    return _encode_gray_png(width, height, buf)


def try_make_jpeg_from_png(png_bytes, quality):
    """Re-encode a generated PNG to JPEG if Pillow is available, else None."""
    try:
        from PIL import Image
    except Exception:
        return None
    import io
    img = Image.open(io.BytesIO(png_bytes)).convert("L")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def build_images():
    """Generate the test set once at startup. Keyed by URL slug."""
    print("Generating panel-sized mock pages (%dx%d)..." % (PANEL_W, PANEL_H), flush=True)
    images = {}
    order = []

    def add(key, label, content_type, data):
        images[key] = {"label": label, "content_type": content_type, "data": data}
        order.append(key)
        print("  %-10s %-22s %8d bytes (%.0f KB)" % (key, label, len(data), len(data) / 1024.0), flush=True)

    # PNG weight tiers — recognizable mock pages, byte size driven by the height
    # of the noise "art" band. PNG is the format the API `eink` profile emits.
    tiers = [
        ("png-s", "PNG light page", 1, 120),
        ("png-m", "PNG medium page", 2, 480),
        ("png-l", "PNG dense page", 3, 820),
        ("png-xl", "PNG heavy page", 4, 1200),
    ]
    png_m_bytes = None
    for key, label, page_no, noise_rows in tiers:
        data = make_page_png(PANEL_W, PANEL_H, page_no, noise_rows)
        add(key, label, "image/png", data)
        if key == "png-m":
            png_m_bytes = data

    # JPEG comparison of the same medium page, only if Pillow is present.
    jpg = try_make_jpeg_from_png(png_m_bytes, 80) if png_m_bytes else None
    if jpg is not None:
        add("jpeg-m", "JPEG q80 page (=page 2)", "image/jpeg", jpg)
    else:
        print("  (Pillow not installed -> skipping JPEG variant; PNG is the eink default anyway)", flush=True)

    return images, order


IMAGES, IMG_ORDER = build_images()


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
        path = self.path.split("?")[0]
        if path == "/imgmeta":
            meta = []
            for key in IMG_ORDER:
                entry = IMAGES[key]
                meta.append({
                    "key": key,
                    "label": entry["label"],
                    "content_type": entry["content_type"],
                    "bytes": len(entry["data"]),
                })
            self._send(200, json.dumps({"images": meta}), "application/json; charset=utf-8")
            return
        if path.startswith("/img/"):
            key = path[len("/img/"):]
            entry = IMAGES.get(key)
            if entry is None:
                self._send(404, "no such image: %s" % key)
                return
            self._send(200, entry["data"], entry["content_type"])
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

        print("\n========== KWC-103 RESULTS RECEIVED %s ==========" % stamp, flush=True)
        print("UA: %s" % data.get("userAgent", "(none)"), flush=True)
        print("Saved: %s" % RESULTS_JSON, flush=True)
        print("Saved: %s" % RESULTS_TXT, flush=True)
        print("------------------------------------------------------", flush=True)
        print(summary, flush=True)
        print("======================================================\n", flush=True)

        self._send(200, "ok - results saved on the laptop")

    def log_message(self, fmt, *args):
        sys.stderr.write("[probe] %s - %s\n" % (self.address_string(), fmt % args))


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("Serving KWC-103 refresh probe on http://0.0.0.0:%d/" % PORT, flush=True)
    print("Open this on the Kobo:  http://<this-mac-lan-ip>:%d/" % PORT, flush=True)
    print("Waiting for the device to POST results... (Ctrl-C to stop)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.", flush=True)


if __name__ == "__main__":
    main()
