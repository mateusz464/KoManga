-- KRP-301 — [TEST] API client (HTTP layer).
--
-- Defines the contract for api/client.lua (implemented in KRP-302): the typed-ish
-- REST client that is the ONLY place HTTP lives (CLAUDE.md §5). These specs mock
-- at the HTTP boundary (inject a fake `transport`) — the one spec that does, per
-- KRP-103's note — and pin: per-endpoint request shaping, the Bearer auth header
-- read per request, the { data } envelope unwrap, the eink-always URL builders,
-- and error mapping (401 / non-200 / transport failure).
--
-- It matches the shared API surface (RFC §8) the web client also consumes:
--   GET    /api/sources
--   GET    /api/search?q=&source=&page=
--   GET    /api/manga/:id
--   GET    /api/chapter/:id/pages
--   GET    /api/page/:id?profile=          (URL builder; eink only)
--   POST   /api/chapter/:id/download?mangaId=&profile=
--   GET    /api/downloads
--   GET    /api/downloads/:chapterId       (CBZ bytes; URL builder)
--   GET/PUT  /api/progress/:mangaId
--   GET/PUT/DELETE /api/library[/:mangaId]
-- Success envelope: { "data": ... }; error envelope: { "error": { code, message } }.

local FakeTransport = require("spec.support.fake_transport")
local ApiClient = require("api.client")
local rapidjson = require("rapidjson")

local BASE = "https://komanga.example.com"
local TOKEN = "secret-token"

-- Build a client over a fake transport. Returns the client and the recorder so a
-- spec can both call a method and inspect the request it produced.
local function make(handler, opts)
    opts = opts or {}
    local transport, recorder = FakeTransport.new(handler or FakeTransport.ok({}))
    local client = ApiClient.new({
        base_url = opts.base_url or BASE,
        get_credential = opts.get_credential or function()
            return TOKEN
        end,
        transport = transport,
    })
    return client, recorder
end

-- The single request a method made (every method here makes exactly one).
local function sole(recorder)
    assert.are.equal(1, #recorder.requests)
    return recorder.requests[1]
end

describe("ApiClient", function()
    describe("request shaping", function()
        it("lists sources with GET /api/sources", function()
            local client, rec = make(FakeTransport.ok({ { id = "1" } }))
            local data = client:listSources()

            local req = sole(rec)
            assert.are.equal("GET", req.method)
            assert.are.equal(BASE .. "/api/sources", req.url)
            assert.are.same({ { id = "1" } }, data)
        end)

        it("searches with q, source and page query params", function()
            local client, rec = make(FakeTransport.ok({}))
            client:search({ source = "mangadex", query = "berserk", page = 2 })

            local req = sole(rec)
            assert.are.equal("GET", req.method)
            assert.is_truthy(req.url:find(BASE .. "/api/search?", 1, true))
            assert.is_truthy(req.url:find("q=berserk", 1, true))
            assert.is_truthy(req.url:find("source=mangadex", 1, true))
            assert.is_truthy(req.url:find("page=2", 1, true))
        end)

        it("omits the page param when no page is given", function()
            local client, rec = make(FakeTransport.ok({}))
            client:search({ source = "mangadex", query = "berserk" })

            assert.is_nil(sole(rec).url:find("page=", 1, true))
        end)

        it("percent-encodes the search query (spaces and reserved chars)", function()
            local client, rec = make(FakeTransport.ok({}))
            client:search({ source = "mangadex", query = "berserk & guts" })

            local req = sole(rec)
            assert.is_truthy(req.url:find("q=berserk%%20%%26%%20guts"))
            -- a raw space or '&' inside the value would break query parsing
            assert.is_nil(req.url:find("q=berserk ", 1, true))
        end)

        it("gets manga details with GET /api/manga/:id", function()
            local client, rec = make(FakeTransport.ok({ id = "42" }))
            local data = client:getManga("42")

            local req = sole(rec)
            assert.are.equal("GET", req.method)
            assert.are.equal(BASE .. "/api/manga/42", req.url)
            assert.are.same({ id = "42" }, data)
        end)

        it("gets chapter pages with GET /api/chapter/:id/pages", function()
            local client, rec = make(FakeTransport.ok({}))
            client:getChapterPages("ch9")

            local req = sole(rec)
            assert.are.equal("GET", req.method)
            assert.are.equal(BASE .. "/api/chapter/ch9/pages", req.url)
        end)

        it("downloads a chapter with POST and mangaId + eink profile", function()
            local client, rec = make(FakeTransport.ok({ status = "queued" }))
            client:downloadChapter("ch9", "m7")

            local req = sole(rec)
            assert.are.equal("POST", req.method)
            assert.is_truthy(req.url:find(BASE .. "/api/chapter/ch9/download?", 1, true))
            assert.is_truthy(req.url:find("mangaId=m7", 1, true))
            assert.is_truthy(req.url:find("profile=eink", 1, true))
        end)

        it("lists downloads with GET /api/downloads", function()
            local client, rec = make(FakeTransport.ok({}))
            client:listDownloads()

            local req = sole(rec)
            assert.are.equal("GET", req.method)
            assert.are.equal(BASE .. "/api/downloads", req.url)
        end)

        it("gets progress with GET /api/progress/:mangaId", function()
            local client, rec = make(FakeTransport.ok({}))
            client:getProgress("m7")

            local req = sole(rec)
            assert.are.equal("GET", req.method)
            assert.are.equal(BASE .. "/api/progress/m7", req.url)
        end)

        it("saves progress with PUT and a JSON body", function()
            local client, rec = make(FakeTransport.ok({}))
            client:putProgress("m7", { chapterId = "ch9", page = 12, updatedAt = 1700 })

            local req = sole(rec)
            assert.are.equal("PUT", req.method)
            assert.are.equal(BASE .. "/api/progress/m7", req.url)
            assert.are.equal("application/json", req.headers["Content-Type"])
            assert.are.same(
                { chapterId = "ch9", page = 12, updatedAt = 1700 },
                rapidjson.decode(req.body)
            )
        end)

        it("lists the library with GET /api/library", function()
            local client, rec = make(FakeTransport.ok({}))
            client:listLibrary()

            local req = sole(rec)
            assert.are.equal("GET", req.method)
            assert.are.equal(BASE .. "/api/library", req.url)
        end)

        it("follows a manga with PUT /api/library/:mangaId, capturing the title", function()
            local client, rec = make(FakeTransport.ok({}))
            client:follow("m7", 1700, "Vinland Saga")

            local req = sole(rec)
            assert.are.equal("PUT", req.method)
            assert.are.equal(BASE .. "/api/library/m7", req.url)
            -- Title captured at follow time (API-908) so the library row shows a name.
            assert.are.same({ addedAt = 1700, title = "Vinland Saga" }, rapidjson.decode(req.body))
        end)

        it("omits the title when none is given (title-less follow still valid)", function()
            local client, rec = make(FakeTransport.ok({}))
            client:follow("m7", 1700)

            local req = sole(rec)
            assert.are.same({ addedAt = 1700 }, rapidjson.decode(req.body))
        end)

        it("unfollows a manga with DELETE /api/library/:mangaId", function()
            local client, rec = make(FakeTransport.ok({}))
            client:unfollow("m7")

            local req = sole(rec)
            assert.are.equal("DELETE", req.method)
            assert.are.equal(BASE .. "/api/library/m7", req.url)
        end)

        it("joins base URL and path without a double slash", function()
            local client, rec = make(FakeTransport.ok({}), { base_url = BASE .. "/" })
            client:listSources()

            assert.are.equal(BASE .. "/api/sources", sole(rec).url)
        end)
    end)

    describe("auth header", function()
        it("attaches the credential as a Bearer token on every request", function()
            local client, rec = make(FakeTransport.ok({}))
            client:listSources()

            assert.are.equal("Bearer " .. TOKEN, sole(rec).headers["Authorization"])
        end)

        it("reads the credential per request (not cached at construction)", function()
            local current = "first"
            local client, rec = make(FakeTransport.ok({}), {
                get_credential = function()
                    return current
                end,
            })

            client:listSources()
            current = "second"
            client:listSources()

            assert.are.equal("Bearer first", rec.requests[1].headers["Authorization"])
            assert.are.equal("Bearer second", rec.requests[2].headers["Authorization"])
        end)

        it("omits the auth header when no credential is set", function()
            local client, rec = make(FakeTransport.ok({}), {
                get_credential = function()
                    return nil
                end,
            })
            client:listSources()

            assert.is_nil(sole(rec).headers["Authorization"])
        end)
    end)

    describe("eink-only URL builders", function()
        it("builds a page-image URL with profile=eink", function()
            local client = make(FakeTransport.ok({}))
            assert.are.equal(BASE .. "/api/page/p3?profile=eink", client:pageImageUrl("p3"))
        end)

        it("never requests the raw profile for a page image", function()
            local client = make(FakeTransport.ok({}))
            assert.is_nil(client:pageImageUrl("p3"):find("raw", 1, true))
        end)

        it("builds a CBZ URL for a downloaded chapter", function()
            local client = make(FakeTransport.ok({}))
            assert.are.equal(BASE .. "/api/downloads/ch9", client:cbzUrl("ch9"))
        end)

        it("never requests the raw profile when building a CBZ", function()
            local client, rec = make(FakeTransport.ok({}))
            client:downloadChapter("ch9", "m7")
            assert.is_nil(sole(rec).url:find("raw", 1, true))
        end)

        it("builds a cover-image URL with profile=eink", function()
            local client = make(FakeTransport.ok({}))
            assert.are.equal(BASE .. "/api/manga/m7/cover?profile=eink", client:coverImageUrl("m7"))
        end)

        it("never requests the raw profile for a cover image", function()
            local client = make(FakeTransport.ok({}))
            assert.is_nil(client:coverImageUrl("m7"):find("raw", 1, true))
        end)
    end)

    describe("cover image (raw bytes)", function()
        -- Distinct from JSON endpoints: the cover endpoint serves image bytes
        -- directly, so fetchCover returns the raw body, NOT the { data } envelope.
        local PNG = "\137PNG\r\n\26\nbinary\0bytes"

        local function raw_ok(body, status)
            return function()
                return { status = status or 200, body = body, headers = {} }
            end
        end

        it("GETs /api/manga/:id/cover with the eink profile", function()
            local client, rec = make(raw_ok(PNG))
            client:fetchCover("m7")

            local req = sole(rec)
            assert.are.equal("GET", req.method)
            assert.are.equal(BASE .. "/api/manga/m7/cover?profile=eink", req.url)
        end)

        it("returns the raw image bytes unchanged (no envelope unwrap, no decode)", function()
            local client = make(raw_ok(PNG))
            local bytes, err = client:fetchCover("m7")

            assert.is_nil(err)
            assert.are.equal(PNG, bytes)
        end)

        it("attaches the Bearer credential like every other call", function()
            local client, rec = make(raw_ok(PNG))
            client:fetchCover("m7")

            assert.are.equal("Bearer " .. TOKEN, sole(rec).headers["Authorization"])
        end)

        it("maps a missing cover (404) to an http error to degrade to text on", function()
            local client = make(FakeTransport.httpError(404, "NOT_FOUND", "No cover"))
            local bytes, err = client:fetchCover("m7")

            assert.is_nil(bytes)
            assert.are.equal("http", err.kind)
            assert.are.equal(404, err.status)
        end)

        it("maps a transport failure to a transport error", function()
            local client = make(FakeTransport.failing("network is unreachable"))
            local bytes, err = client:fetchCover("m7")

            assert.is_nil(bytes)
            assert.are.equal("transport", err.kind)
        end)
    end)

    describe("chapter CBZ (streamed to file)", function()
        -- A built chapter CBZ is far too large to marshal back through net.lua's
        -- forked subprocess (serialising ~tens of MB OOMs a Kobo — the child's
        -- buffer.encode fails and the caller gets nil). So the client streams the
        -- response body straight to a file on disk (sink_path) inside the
        -- subprocess and returns only the path; nothing large crosses the pipe.
        local DEST = "/tmp/komanga-test/ch9.cbz"

        it("GETs the eink cbzUrl and sinks the body to the given path", function()
            local client, rec = make(function()
                return { status = 200, body = nil, headers = {} }
            end)
            client:downloadChapterCbzToFile("ch9", DEST)

            local req = sole(rec)
            assert.are.equal("GET", req.method)
            assert.are.equal(BASE .. "/api/downloads/ch9", req.url)
            -- The transport is told where to sink; the body never comes back as a string.
            assert.are.equal(DEST, req.sink_path)
        end)

        it("returns the destination path (not bytes) on success", function()
            local client = make(function()
                return { status = 200, body = nil, headers = {} }
            end)
            local path, err = client:downloadChapterCbzToFile("ch9", DEST)

            assert.is_nil(err)
            assert.are.equal(DEST, path)
        end)

        it("attaches the Bearer credential like every other call", function()
            local client, rec = make(function()
                return { status = 200, body = nil, headers = {} }
            end)
            client:downloadChapterCbzToFile("ch9", DEST)

            assert.are.equal("Bearer " .. TOKEN, sole(rec).headers["Authorization"])
        end)

        it("maps a missing build (404) to an http error", function()
            local client = make(FakeTransport.httpError(404, "NOT_FOUND", "No download"))
            local path, err = client:downloadChapterCbzToFile("ch9", DEST)

            assert.is_nil(path)
            assert.are.equal("http", err.kind)
            assert.are.equal(404, err.status)
        end)

        it("maps a transport failure to a transport error", function()
            local client = make(FakeTransport.failing("network is unreachable"))
            local path, err = client:downloadChapterCbzToFile("ch9", DEST)

            assert.is_nil(path)
            assert.are.equal("transport", err.kind)
        end)
    end)

    describe("transient reader CBZ (streamed to file, KRP-606)", function()
        -- The reader acquires its CBZ via the transient read path — GET
        -- /api/chapter/:id/cbz — which builds and serves the eink CBZ WITHOUT
        -- persisting a download record, so plain reading never appears under
        -- "Downloaded" (only the explicit POST /download does). Same streaming-to-
        -- file rationale as the persisted path: the body is too large to marshal
        -- back through net.lua's fork, so it sinks straight to disk (sink_path).
        local DEST = "/tmp/komanga-test/read-ch9.cbz"

        it("GETs the eink transient cbz endpoint and sinks the body to the given path", function()
            local client, rec = make(function()
                return { status = 200, body = nil, headers = {} }
            end)
            client:readChapterCbzToFile("ch9", DEST)

            local req = sole(rec)
            assert.are.equal("GET", req.method)
            -- Transient read path, always eink — never POST /download, never raw.
            assert.are.equal(BASE .. "/api/chapter/ch9/cbz?profile=eink", req.url)
            assert.are.equal(DEST, req.sink_path)
        end)

        it("readCbzUrl is a pure eink-only builder", function()
            local client = make()
            assert.are.equal(BASE .. "/api/chapter/ch9/cbz?profile=eink", client:readCbzUrl("ch9"))
        end)

        it("returns the destination path (not bytes) on success", function()
            local client = make(function()
                return { status = 200, body = nil, headers = {} }
            end)
            local path, err = client:readChapterCbzToFile("ch9", DEST)

            assert.is_nil(err)
            assert.are.equal(DEST, path)
        end)

        it("attaches the Bearer credential like every other call", function()
            local client, rec = make(function()
                return { status = 200, body = nil, headers = {} }
            end)
            client:readChapterCbzToFile("ch9", DEST)

            assert.are.equal("Bearer " .. TOKEN, sole(rec).headers["Authorization"])
        end)

        it("maps a missing chapter (404) to an http error", function()
            local client = make(FakeTransport.httpError(404, "NOT_FOUND", "No chapter"))
            local path, err = client:readChapterCbzToFile("ch9", DEST)

            assert.is_nil(path)
            assert.are.equal("http", err.kind)
            assert.are.equal(404, err.status)
        end)

        it("maps a transport failure to a transport error", function()
            local client = make(FakeTransport.failing("network is unreachable"))
            local path, err = client:readChapterCbzToFile("ch9", DEST)

            assert.is_nil(path)
            assert.are.equal("transport", err.kind)
        end)
    end)

    describe("envelope unwrap", function()
        it("returns the data field, not the wrapper", function()
            local client = make(function()
                return { status = 200, body = '{"data":{"id":"42","title":"Berserk"}}', headers = {} }
            end)
            local data, err = client:getManga("42")

            assert.is_nil(err)
            assert.are.same({ id = "42", title = "Berserk" }, data)
        end)
    end)

    describe("error mapping", function()
        it("maps a 401 to an http error the auth flow can detect", function()
            local client = make(FakeTransport.httpError(401, "UNAUTHORIZED", "Missing or invalid credentials"))
            local data, err = client:listSources()

            assert.is_nil(data)
            assert.are.equal("http", err.kind)
            assert.are.equal(401, err.status)
            assert.are.equal("UNAUTHORIZED", err.code)
        end)

        it("maps a non-200 to an http error carrying status and code", function()
            local client = make(FakeTransport.httpError(404, "NOT_FOUND", "Resource not found"))
            local data, err = client:getManga("nope")

            assert.is_nil(data)
            assert.are.equal("http", err.kind)
            assert.are.equal(404, err.status)
            assert.are.equal("NOT_FOUND", err.code)
        end)

        it("maps a 500 to an http error", function()
            local client = make(FakeTransport.httpError(500, "INTERNAL", "Internal Server Error"))
            local data, err = client:listSources()

            assert.is_nil(data)
            assert.are.equal("http", err.kind)
            assert.are.equal(500, err.status)
        end)

        it("maps a transport failure to a transport error", function()
            local client = make(FakeTransport.failing("network is unreachable"))
            local data, err = client:listSources()

            assert.is_nil(data)
            assert.are.equal("transport", err.kind)
            assert.is_truthy(err.message:find("network", 1, true))
        end)

        it("maps an undecodable success body to a decode error", function()
            local client = make(function()
                return { status = 200, body = "<html>not json</html>", headers = {} }
            end)
            local data, err = client:listSources()

            assert.is_nil(data)
            assert.are.equal("decode", err.kind)
        end)
    end)
end)
