-- KRP-501 — [TEST] Chapter acquisition & page mapping (logic).
--
-- Defines the contract for state/reader.lua (implemented alongside the reader
-- glue in KRP-502): the pure state behind acquiring a chapter for reading via
-- the CBZ + ReaderUI path. It is framework-free so busted drives it with no
-- KOReader loaded (CLAUDE.md §4 — logic tickets are strict TDD; §5 — state/ is
-- pure), reaching the network only through an injected ApiClient, mocked HERE at
-- the api/ boundary via FakeApi (CLAUDE.md §5 — state never touches socket.http).
--
-- It owns three jobs (the KRP-501 acceptance criteria):
--   1. Acquire the chapter's `eink` CBZ via the API download endpoint. That goes
--      through ApiClient:downloadChapter — the eink-only path (api/client.lua
--      appends ?profile=eink; the URL is covered by the api-client spec, KRP-301).
--      This client never builds a `raw` CBZ (CLAUDE.md §6).
--   2. Track build/download status (pending | completed | failed): only a
--      completed build is "ready"; a failed build is surfaced as an error so the
--      UI can offer retry; a transport/HTTP error leaves nothing acquired.
--   3. Map the API page index ↔ CBZ page index. API page indices are 0-based
--      (chapter-service serves `<chapterId>:<index>`); KOReader's CBZ reader is
--      1-based, so the mapping is a fixed ±1 offset. KRP-502 uses it to seek to a
--      resumed position and to translate the current page back for progress push.
--
-- Acquisition mirrors state/details.lua's split into a pure `fetch*` (the
-- blocking API call, returning api/client.lua's (data, err)) and an `apply*`
-- (mutates state); the synchronous `acquire` the specs drive is their
-- composition. The split exists because net.lua runs the fetch in a forked
-- sub-process (KRP-305) which can't mutate this table across the fork, so the UI
-- runs the fetch through net and applies the result in the parent (KRP-502).
--
-- Wire shapes are the unwrapped { data } envelopes api/client.lua returns
-- (KRP-302), per the shared API contract (RFC §5.2/§7, POST /api/chapter/:id/
-- download and GET /api/downloads/:chapterId):
--   downloadChapter(chapterId, mangaId) ->
--     ({ chapterId, mangaId, cbzPath, status = "pending"|"completed"|"failed",
--        createdAt }, nil) | (nil, err)
--   cbzUrl(chapterId) -> a URL string (pure builder; the bytes are fetched by
--     KRP-502, off the api/ boundary).
-- Errors are the typed table api/client.lua maps (KRP-301): { kind, status?, ... }.

local Reader = require("state.reader")
local FakeApi = require("spec.support.fake_api")

local MANGA_ID = "m7"
local CHAPTER_ID = "c2"
local CBZ_URL = "https://host/api/downloads/c2"

-- A completed download record. A builder, not a constant, so every call hands
-- back a FRESH table (test isolation — an impl that mutates it can't corrupt a
-- value a later test reuses).
local function RECORD(status)
    return {
        chapterId = CHAPTER_ID,
        mangaId = MANGA_ID,
        cbzPath = "/data/cbz/c2.cbz",
        status = status or "completed",
        createdAt = 1700,
    }
end

local HTTP_ERROR = { kind = "http", status = 500, code = "INTERNAL" }
local TRANSPORT_ERROR = { kind = "transport", message = "wifi asleep" }

-- A FakeApi wired with a canned download result and a pure cbzUrl builder. cbzUrl
-- is the real ApiClient's signature (chapterId -> URL); the fake just echoes a
-- known URL so getCbzUrl is assertable.
local function api_with(download)
    return FakeApi.new{
        downloadChapter = download,
        cbzUrl = function(chapterId) return "https://host/api/downloads/" .. chapterId end,
    }
end

describe("reader (chapter acquisition) state", function()
    describe("acquiring the eink CBZ", function()
        it("downloads the chapter through the eink-only download endpoint", function()
            local api = api_with(function() return RECORD("completed") end)
            local reader = Reader.new(api, MANGA_ID, CHAPTER_ID)

            local ok, err = reader:acquire()

            assert.is_true(ok)
            assert.is_nil(err)
            -- Acquisition goes through downloadChapter (which always requests
            -- profile=eink) with this chapter + its manga — never getChapterPages
            -- or any raw path.
            assert.are.equal(1, #api.calls)
            assert.are.equal("downloadChapter", api.calls[1].method)
            assert.are.equal(CHAPTER_ID, api.calls[1].args[1])
            assert.are.equal(MANGA_ID, api.calls[1].args[2])
        end)

        it("is ready and exposes the stored-CBZ URL once the build is completed", function()
            local api = api_with(function() return RECORD("completed") end)
            local reader = Reader.new(api, MANGA_ID, CHAPTER_ID)

            reader:acquire()

            assert.is_true(reader:isReady())
            assert.is_false(reader:isFailed())
            assert.are.equal("completed", reader:getStatus())
            assert.are.equal(CBZ_URL, reader:getCbzUrl())
            assert.is_nil(reader:getError())
        end)

        it("is not ready and offers no CBZ URL before acquisition", function()
            local api = api_with(function() return RECORD("completed") end)
            local reader = Reader.new(api, MANGA_ID, CHAPTER_ID)

            assert.is_false(reader:isReady())
            assert.is_nil(reader:getStatus())
            assert.is_nil(reader:getCbzUrl())
            assert.is_nil(reader:getError())
        end)
    end)

    describe("status tracking", function()
        it("tracks a still-building (pending) status as not-yet-ready, not an error", function()
            local api = api_with(function() return RECORD("pending") end)
            local reader = Reader.new(api, MANGA_ID, CHAPTER_ID)

            local ok = reader:acquire()

            assert.is_true(ok)
            assert.are.equal("pending", reader:getStatus())
            assert.is_false(reader:isReady())
            assert.is_false(reader:isFailed())
            assert.is_nil(reader:getCbzUrl())
            assert.is_nil(reader:getError())
        end)

        it("surfaces a failed build as an error and stays not-ready", function()
            local api = api_with(function() return RECORD("failed") end)
            local reader = Reader.new(api, MANGA_ID, CHAPTER_ID)

            local ok, err = reader:acquire()

            assert.is_false(ok)
            assert.is_not_nil(err)
            assert.is_true(reader:isFailed())
            assert.is_false(reader:isReady())
            assert.are.equal("failed", reader:getStatus())
            assert.is_nil(reader:getCbzUrl())
            assert.is_not_nil(reader:getError())
        end)

        it("surfaces a transport/HTTP error and acquires nothing", function()
            local api = api_with(function() return nil, TRANSPORT_ERROR end)
            local reader = Reader.new(api, MANGA_ID, CHAPTER_ID)

            local ok, err = reader:acquire()

            assert.is_false(ok)
            assert.are.same(TRANSPORT_ERROR, err)
            assert.are.same(TRANSPORT_ERROR, reader:getError())
            assert.is_false(reader:isReady())
            assert.is_false(reader:isFailed())
            assert.is_nil(reader:getStatus())
            assert.is_nil(reader:getCbzUrl())
        end)

        it("clears a prior error on a successful re-acquire", function()
            local boom = true
            local api = api_with(function()
                if boom then return nil, HTTP_ERROR end
                return RECORD("completed")
            end)
            local reader = Reader.new(api, MANGA_ID, CHAPTER_ID)

            reader:acquire()
            assert.are.same(HTTP_ERROR, reader:getError())
            assert.is_false(reader:isReady())

            boom = false
            local ok = reader:acquire()

            assert.is_true(ok)
            assert.is_nil(reader:getError())
            assert.is_true(reader:isReady())
            assert.are.equal(CBZ_URL, reader:getCbzUrl())
        end)
    end)

    describe("fetch / apply split (net.lua off-thread fork, KRP-305)", function()
        -- net.lua runs the blocking fetch in a forked sub-process and applies the
        -- result in the parent (a fork can't mutate this table). So acquire() must
        -- be exactly fetchDownload() (pure, off-thread) composed with applyDownload()
        -- (parent-side mutation) — the same contract every other state module keeps.
        it("fetchDownload makes the API call and mutates nothing", function()
            local api = api_with(function() return RECORD("completed") end)
            local reader = Reader.new(api, MANGA_ID, CHAPTER_ID)

            local data, err = reader:fetchDownload()

            assert.is_nil(err)
            assert.are.equal("completed", data.status)
            assert.are.equal("downloadChapter", api.calls[1].method)
            -- Pure: no state mutated until applyDownload runs in the parent.
            assert.is_false(reader:isReady())
            assert.is_nil(reader:getStatus())
        end)

        it("applyDownload records the fetched result in the parent", function()
            local api = api_with(function() return RECORD("completed") end)
            local reader = Reader.new(api, MANGA_ID, CHAPTER_ID)

            local ok = reader:applyDownload(RECORD("completed"), nil)

            assert.is_true(ok)
            assert.is_true(reader:isReady())
            assert.are.equal(CBZ_URL, reader:getCbzUrl())
        end)
    end)

    describe("API page index ↔ CBZ page index mapping", function()
        -- API page indices are 0-based; KOReader's CBZ reader is 1-based.
        it("maps an API page index to its 1-based CBZ page", function()
            assert.are.equal(1, Reader.apiPageToCbzPage(0))
            assert.are.equal(6, Reader.apiPageToCbzPage(5))
        end)

        it("maps a CBZ page back to its 0-based API page index", function()
            assert.are.equal(0, Reader.cbzPageToApiPage(1))
            assert.are.equal(5, Reader.cbzPageToApiPage(6))
        end)

        it("round-trips a page index through both directions", function()
            for apiIndex = 0, 9 do
                assert.are.equal(apiIndex, Reader.cbzPageToApiPage(Reader.apiPageToCbzPage(apiIndex)))
            end
        end)
    end)
end)
