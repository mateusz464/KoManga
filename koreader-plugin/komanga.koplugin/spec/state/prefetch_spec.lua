-- KRP-504 — [TEST] On-demand streaming / prefetch window (logic).
--
-- Defines the contract for state/prefetch.lua (implemented in KRP-505 alongside
-- the streaming reader): the pure state behind the "read without downloading the
-- whole chapter" refinement. It is framework-free so busted drives it with no
-- KOReader loaded (CLAUDE.md §4 — logic tickets are strict TDD; §5 — state/ is
-- pure), and it reaches the network only through an injected ApiClient, mocked
-- HERE at the api/ boundary via FakeApi (CLAUDE.md §5 — state never touches
-- socket.http).
--
-- It owns the two non-UI concerns this ticket carries (the KRP-504 acceptance
-- criteria):
--   1. BOUNDED, POSITION-DRIVEN PREFETCH (CLAUDE.md §8): given the page the reader
--      is displaying, fetch that page plus a bounded window of pages AHEAD of it,
--      so the next page is already fetched on a turn — but never fan out into one
--      request per page in the chapter. The window is `opts.window` pages ahead
--      (config.prefetch_window, default 2); plan(current) covers positions
--      [current, current+window] clamped to the chapter, in reading order.
--   2. NO REFETCH: a page already fetched (ready) or in flight (pending) is never
--      re-requested, so advancing the reader only fetches the newly entered page
--      and displaying an already-fetched page costs no network round-trip. A
--      FAILED page, unlike a cover (KRP-406), is retryable — a manga page can't
--      degrade to text, so a later pass re-plans it.
--
-- Like the other state modules it splits a pure `fetch` (the blocking API calls,
-- safe to run off the UI thread in net.lua's forked sub-process) from an `apply`
-- (mutates this cache in the parent, since the fork can't mutate across it). The
-- planner (`plan`) and reads stay in the parent too. Page bytes themselves are
-- opaque to this module — decoding + on-panel paint is the reader's job (KRP-505,
-- device).
--
-- The public API is POSITION-based (1-based page numbers, what the reader knows);
-- internally a position maps to the chapter's page id, which is what the API
-- fetches. Wire shape is the per-page bytes the ApiClient returns for a page id,
-- mirroring fetchCover (KRP-406):
--   fetchPage(pageId) -> (bytes, nil) | (nil, err)
-- Errors are the typed table api/client.lua maps (KRP-301): { kind, status?, ... }.

local Prefetch = require("state.prefetch")
local FakeApi = require("spec.support.fake_api")

-- A chapter's page ids in reading (display) order: p1, p2, ... pN.
local function PAGES(n)
    local ids = {}
    for i = 1, n do
        ids[i] = "p" .. i
    end
    return ids
end

-- A FakeApi whose fetchPage(id) returns bytes for ids present in `bytes_by_id`
-- (id -> string) and a 404-style error otherwise (a missing/undownloadable page).
-- Every requested id is recorded on api.calls, so a test can count round-trips.
local function api_with(bytes_by_id)
    bytes_by_id = bytes_by_id or {}
    return FakeApi.new{
        fetchPage = function(id)
            local bytes = bytes_by_id[id]
            if bytes then
                return bytes, nil
            end
            return nil, { kind = "http", status = 404 }
        end,
    }
end

-- Bytes for every page id p1..pN, so a happy-path fetch always resolves.
local function all_bytes(n)
    local map = {}
    for i = 1, n do
        map["p" .. i] = "P" .. i
    end
    return map
end

-- The ordered list of page ids that were actually fetched through the api, across
-- every pass so far — the network round-trips this module caused.
local function fetched_ids(api)
    local ids = {}
    for _, call in ipairs(api.calls) do
        if call.method == "fetchPage" then
            ids[#ids + 1] = call.args[1]
        end
    end
    return ids
end

describe("Prefetch (reader page-prefetch window) state", function()
    describe("bounded, position-driven window planning", function()
        it("plans the displayed page plus `window` pages ahead, in reading order", function()
            local prefetch = Prefetch.new(api_with(), PAGES(10), { window = 2 })

            -- Displaying page 3 → fetch 3 (to show) and the next 2 ahead.
            assert.are.same({ "p3", "p4", "p5" }, prefetch:plan(3))
        end)

        it("clamps the window at the last page of the chapter", function()
            local prefetch = Prefetch.new(api_with(), PAGES(10), { window = 2 })

            -- From page 9 the window would reach page 11; the chapter ends at 10.
            assert.are.same({ "p9", "p10" }, prefetch:plan(9))
        end)

        it("plans only the last page when it is the one displayed", function()
            local prefetch = Prefetch.new(api_with(), PAGES(10), { window = 2 })

            assert.are.same({ "p10" }, prefetch:plan(10))
        end)

        it("defaults the window to config's prefetch_window (2 pages ahead)", function()
            local prefetch = Prefetch.new(api_with(), PAGES(10))

            -- No opts → the documented default of 2 ahead → 3 pages from page 1.
            assert.are.same({ "p1", "p2", "p3" }, prefetch:plan(1))
        end)

        it("reports the chapter's page count", function()
            local prefetch = Prefetch.new(api_with(), PAGES(7), { window = 2 })

            assert.are.equal(7, prefetch:pageCount())
        end)
    end)

    describe("no refetch of pages already fetched or in flight", function()
        it("does not re-plan a page still in flight (pending)", function()
            local prefetch = Prefetch.new(api_with(), PAGES(10), { window = 2 })

            prefetch:plan(1) -- p1,p2,p3 now pending

            -- Displaying page 2: p2,p3 are already pending; only p4 is new.
            assert.are.same({ "p4" }, prefetch:plan(2))
        end)

        it("does not re-plan a page already fetched (ready) — no round-trip to display it", function()
            local api = api_with(all_bytes(10))
            local prefetch = Prefetch.new(api, PAGES(10), { window = 2 })

            prefetch:apply(prefetch:fetch(prefetch:plan(1))) -- p1,p2,p3 ready

            -- Re-displaying page 1: everything in the window is already ready.
            assert.are.same({}, prefetch:plan(1))
        end)

        it("fetches only the newly entered page as the reader advances", function()
            local api = api_with(all_bytes(10))
            local prefetch = Prefetch.new(api, PAGES(10), { window = 2 })

            -- Open at page 1: window p1,p2,p3 fetched.
            prefetch:apply(prefetch:fetch(prefetch:plan(1)))
            -- Turn to page 2: p2,p3 overlap the prior window; only p4 enters.
            prefetch:apply(prefetch:fetch(prefetch:plan(2)))

            assert.are.same({ "p1", "p2", "p3", "p4" }, fetched_ids(api))
        end)

        it("costs no network round-trip to read back an already-fetched page", function()
            local api = api_with(all_bytes(10))
            local prefetch = Prefetch.new(api, PAGES(10), { window = 2 })

            prefetch:apply(prefetch:fetch(prefetch:plan(1)))
            local before = #fetched_ids(api)

            -- The reader paints page 2 from cache; no fetch is triggered.
            assert.are.equal("P2", prefetch:getBytes(2))
            assert.is_true(prefetch:isReady(2))
            assert.are.equal(before, #fetched_ids(api))
        end)
    end)

    describe("fetch / apply split (net.lua off-thread fork, KRP-305)", function()
        it("fetches exactly the planned page ids and nothing else", function()
            local api = api_with(all_bytes(10))
            local prefetch = Prefetch.new(api, PAGES(10), { window = 2 })

            prefetch:fetch(prefetch:plan(1))

            assert.are.same({ "p1", "p2", "p3" }, fetched_ids(api))
        end)

        it("mutates nothing until apply runs in the parent", function()
            local api = api_with(all_bytes(10))
            local prefetch = Prefetch.new(api, PAGES(10), { window = 2 })

            local results = prefetch:fetch(prefetch:plan(1))

            -- Fetched off-thread: the cache is untouched until applyied.
            assert.is_false(prefetch:isReady(1))
            assert.is_nil(prefetch:getBytes(1))

            prefetch:apply(results)

            assert.is_true(prefetch:isReady(1))
            assert.are.equal("P1", prefetch:getBytes(1))
        end)

        it("makes each fetched page ready with its bytes", function()
            local api = api_with(all_bytes(5))
            local prefetch = Prefetch.new(api, PAGES(5), { window = 2 })

            prefetch:apply(prefetch:fetch(prefetch:plan(1)))

            for i = 1, 3 do
                assert.is_true(prefetch:isReady(i))
                assert.are.equal("P" .. i, prefetch:getBytes(i))
            end
        end)
    end)

    describe("a failed page is retryable (not terminal, unlike a cover)", function()
        it("marks an undownloadable page failed without erroring the whole pass", function()
            -- p2 is missing; its neighbours resolve.
            local api = api_with{ p1 = "P1", p3 = "P3" }
            local prefetch = Prefetch.new(api, PAGES(10), { window = 2 })

            prefetch:apply(prefetch:fetch(prefetch:plan(1)))

            assert.is_true(prefetch:isReady(1))
            assert.are.equal("P1", prefetch:getBytes(1))
            assert.is_true(prefetch:isFailed(2))
            assert.is_nil(prefetch:getBytes(2))
            assert.is_true(prefetch:isReady(3))
        end)

        it("re-plans a failed page on a later pass, but not a ready one", function()
            local api = api_with{ p1 = "P1", p3 = "P3" }
            local prefetch = Prefetch.new(api, PAGES(10), { window = 2 })

            prefetch:apply(prefetch:fetch(prefetch:plan(1))) -- p1 ready, p2 failed, p3 ready

            -- A later pass over the same window retries only the failed page.
            assert.are.same({ "p2" }, prefetch:plan(1))
        end)
    end)

    describe("read-only state", function()
        it("reports no bytes for a page that has not resolved yet", function()
            local prefetch = Prefetch.new(api_with(), PAGES(10), { window = 2 })

            prefetch:plan(1) -- p1 pending, not yet fetched

            assert.is_false(prefetch:isReady(1))
            assert.is_false(prefetch:isFailed(1))
            assert.is_nil(prefetch:getBytes(1))
        end)
    end)
end)
