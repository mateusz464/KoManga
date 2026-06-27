# End-to-end smoke test (API-803)

A final acceptance pass over a *running* deployment: it exercises the whole
reading path — **auth → search → manga → page (`eink`/`raw`) → download →
progress** — through a single base URL. Point it at the **public Cloudflare
Tunnel hostname** to validate the deployed surface (API-802), or at the
loopback-published `http://127.0.0.1:3000` (API-801) to validate the stack
itself without the tunnel.

There are two halves, as the ticket requires: a **scripted** run
(`api/scripts/smoke-test.ts`) and a **manual** checklist (curl) for spot checks.

## What it proves (the acceptance criteria)

1. **Every step succeeds through the public hostname with auth.** `/health` is
   public; every `/api/*` call carries `Authorization: Bearer <AUTH_TOKEN>`, and
   the script asserts a missing/wrong credential is rejected with `401`.
2. **`eink` returns a processed image; `raw` returns source.** The same page is
   fetched under both profiles: `raw` is a lossless passthrough; `eink` is
   greyscale and resized to fit (never enlarged), and its bytes differ from
   `raw`.
3. **Progress persists across two separate client sessions.** One request
   writes the reading position; a second, independent request reads back the
   identical position — progress is server-side and device-agnostic (no device
   id is stored or returned).

## Prerequisites

- The stack is up and **Healthy** (`docker compose up -d`), and — for the public
  run — the Cloudflare Tunnel is connected (see `cloudflare-tunnel.md`).
- A Suwayomi source with at least one searchable manga that has chapters/pages
  (e.g. add a manga to the Local source, or install an extension and search it).
- `AUTH_TOKEN` — the single-user secret the API was started with.

## Scripted run

From `api/`:

```sh
# Against the public tunnel hostname (the real acceptance run):
AUTH_TOKEN='<your secret>' BASE_URL='https://manga.example.com' npm run smoke

# Against the local loopback publish (validate the stack without the tunnel):
AUTH_TOKEN='<your secret>' npm run smoke   # BASE_URL defaults to http://127.0.0.1:3000
```

Configuration (env vars):

| Var              | Default                  | Meaning                                              |
| ---------------- | ------------------------ | ---------------------------------------------------- |
| `BASE_URL`       | `http://127.0.0.1:3000`  | Deployment base URL (the tunnel hostname for real).  |
| `AUTH_TOKEN`     | _(required)_             | Single-user bearer secret.                           |
| `SMOKE_SOURCE`   | first source listed      | Source id to search.                                 |
| `SMOKE_QUERY`    | `""`                     | Search query (use one with hits on your source).     |
| `SMOKE_MANGA_ID` | _(none)_                 | Pin a manga id, skipping search-driven discovery.    |

The script exits `0` when every step passes and prints a `✓` per check; on the
first failure it prints `❌ … step N: <reason>` and exits non-zero. If your
source returns nothing for the default empty query, set `SMOKE_QUERY` to a term
with hits or pin `SMOKE_MANGA_ID`.

## Manual checklist (curl)

Replace `$BASE` and `$TOKEN`, and the ids from each prior step.

```sh
BASE=https://manga.example.com
TOKEN='<your secret>'

# Auth: public health, guarded API.
curl -s "$BASE/health"                                   # 200, no auth
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/sources"            # 401
curl -s "$BASE/api/sources" -H "Authorization: Bearer $TOKEN"          # 200

# Search → manga → chapter → pages.
curl -s "$BASE/api/search?source=<SRC>&q=<QUERY>" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/api/manga/<MANGA_ID>"              -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/api/chapter/<CHAP_ID>/pages"       -H "Authorization: Bearer $TOKEN"

# Page: eink is processed (smaller, greyscale), raw is source.
curl -s "$BASE/api/page/<CHAP_ID>:0?profile=raw"  -H "Authorization: Bearer $TOKEN" -o raw.img
curl -s "$BASE/api/page/<CHAP_ID>:0?profile=eink" -H "Authorization: Bearer $TOKEN" -o eink.img
file raw.img eink.img    # eink: greyscale/compact format, smaller dimensions

# Download → list → fetch the stored CBZ.
curl -s -X POST "$BASE/api/chapter/<CHAP_ID>/download?mangaId=<MANGA_ID>&profile=eink" \
  -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/api/downloads"                     -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/api/downloads/<CHAP_ID>"           -H "Authorization: Bearer $TOKEN" -o chapter.cbz
unzip -t chapter.cbz    # valid archive

# Progress: write (session 1), then read back (session 2 — a fresh invocation).
curl -s -X PUT "$BASE/api/progress/<MANGA_ID>" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"chapterId":"<CHAP_ID>","page":3,"updatedAt":'"$(date +%s%3N)"'}'
curl -s "$BASE/api/progress/<MANGA_ID>"           -H "Authorization: Bearer $TOKEN"   # page 3
```
