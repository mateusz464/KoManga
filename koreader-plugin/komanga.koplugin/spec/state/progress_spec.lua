-- KRP-601 — [TEST] Progress sync (logic).
--
-- Defines the contract for state/progress.lua (implemented in KRP-602, which wires
-- it to KOReader's reader page-update/close events). It is the pure, framework-free
-- state behind device-agnostic, server-side reading-progress sync: it is driven by
-- busted with no KOReader loaded (CLAUDE.md §4 — logic tickets are strict TDD; §5 —
-- state/ is pure) and reaches the network only through an injected ApiClient, mocked
-- HERE at the api/ boundary via FakeApi (CLAUDE.md §5 — state never touches
-- socket.http). A Progress instance is scoped to one (manga, chapter) — the chapter
-- the reader currently has open — so it knows which record a page turn belongs to
-- and whether stored progress is for the chapter being opened.
--
-- It owns the two concerns this ticket carries (the KRP-601 acceptance criteria):
--
--   1. PUSH ON PAGE TURN, DEBOUNCED (CLAUDE.md §6): a page turn records the reader's
--      position and syncs it to the API, but rapid turns must NOT hammer the API.
--      The rule is at-most-one push per `debounce` seconds (config.progress_debounce_
--      seconds, default 5): the first turn in a window pushes (leading edge) and
--      further turns within it are COALESCED into the latest position, held until the
--      window elapses or the reader closes. A `flush()` on the close event force-syncs
--      the last pending position regardless of the window, so resume always lands on
--      the true last page. Coalescing keeps the LATEST position (last-write-wins).
--
--   2. RESUME AT THE SYNCED POSITION: opening the chapter reads the manga's stored
--      progress and yields the page to seek to — but only when that progress belongs
--      to THIS chapter (re-reading an earlier chapter must not jump). A "never read"
--      404 is the empty state (no resume), not an error.
--
-- Like the other state modules it splits a pure `fetch*` (the blocking API call, safe
-- to run off the UI thread in net.lua's forked sub-process — KRP-305) from an
-- `apply*`/decision that runs in the parent; the push's debounce brain is pure and
-- makes NO network call itself, so the caller runs the returned body through net.lua.
--
-- Page-index mapping mirrors state/reader.lua and the API port contract: API progress
-- `page` is 0-based within the chapter; KOReader's CBZ reader is 1-based. So a reader
-- page N syncs as page N-1, and a stored page K resumes at reader page K+1.

local Progress = require("state.progress")
local Config = require("config")
local FakeApi = require("spec.support.fake_api")

local MANGA = "m7"
local CHAPTER = "ch9"

-- A controllable clock so debounce windows are exercised deterministically (no real
-- time, no sleeping): now() reads a value the test advances by hand.
local function fake_clock(start)
    local t = start or 0
    return {
        now = function() return t end,
        set = function(v) t = v end,
        advance = function(d) t = t + d end,
    }
end

-- A Progress scoped to (MANGA, CHAPTER) with an injected clock and debounce, plus a
-- FakeApi whose getProgress returns (data, err) as configured. Returns the trio so a
-- test can drive turns, advance time, and inspect the recorded api calls.
local function make(opts)
    opts = opts or {}
    local clock = fake_clock(opts.start)
    local api = FakeApi.new{ getProgress = opts.getProgress }
    local progress = Progress.new(api, MANGA, CHAPTER, {
        now = clock.now,
        debounce = opts.debounce, -- nil → module default (config)
    })
    return progress, clock, api
end

-- The putProgress calls recorded through the api boundary, in order: { mangaId, body }.
local function pushes(api)
    local out = {}
    for _, call in ipairs(api.calls) do
        if call.method == "putProgress" then
            out[#out + 1] = { mangaId = call.args[1], body = call.args[2] }
        end
    end
    return out
end

describe("Progress (reader progress sync) state", function()
    describe("pushing progress on page turns (debounced)", function()
        it("pushes on the first page turn (leading edge of the window)", function()
            local progress, clock = make{ debounce = 5 }
            clock.set(100)

            local body = progress:onPageTurn(3)

            assert.is_table(body)
            assert.are.equal(CHAPTER, body.chapterId)
            assert.are.equal(2, body.page) -- 1-based reader page 3 → 0-based api page 2
            assert.are.equal(100, body.updatedAt) -- stamped from the clock (last-write-wins)
        end)

        it("maps the reader's 1-based page to the API's 0-based page index", function()
            local progress = make{ debounce = 5 }

            local body = progress:onPageTurn(1) -- chapter start

            assert.are.equal(0, body.page)
        end)

        it("does NOT touch the network to decide a push — the decision is pure", function()
            -- The blocking PUT belongs off-thread (net.lua); onPageTurn only decides.
            local progress, _, api = make{ debounce = 5 }

            progress:onPageTurn(3)

            assert.are.equal(0, #api.calls)
        end)

        it("coalesces rapid turns within the window into no further push", function()
            local progress, clock = make{ debounce = 5 }
            clock.set(0)

            assert.is_table(progress:onPageTurn(1)) -- leading push at t=0
            clock.set(1)
            assert.is_nil(progress:onPageTurn(2)) -- within window → coalesced
            clock.set(4)
            assert.is_nil(progress:onPageTurn(3)) -- still within window → coalesced
        end)

        it("pushes again once the debounce window has elapsed", function()
            local progress, clock = make{ debounce = 5 }
            clock.set(0)
            progress:onPageTurn(1) -- leading push at t=0

            clock.set(5) -- exactly one window later
            local body = progress:onPageTurn(6)

            assert.is_table(body)
            assert.are.equal(5, body.page) -- reader page 6 → api page 5
        end)

        it("the next due push carries the LATEST coalesced position (last-write-wins)", function()
            local progress, clock = make{ debounce = 5 }
            clock.set(0)
            progress:onPageTurn(2) -- leading push (page 1)
            clock.set(1)
            progress:onPageTurn(3) -- coalesced
            clock.set(2)
            progress:onPageTurn(4) -- coalesced (latest so far)

            clock.set(6) -- window elapsed
            local body = progress:onPageTurn(9)

            assert.are.equal(8, body.page) -- the newest turn, not the coalesced ones
            assert.are.equal(6, body.updatedAt)
        end)

        it("defaults the debounce window to config.progress_debounce_seconds", function()
            local progress, clock = make{} -- no debounce opt → module default
            clock.set(0)
            progress:onPageTurn(1) -- leading push

            clock.set(Config.progress_debounce_seconds - 1)
            assert.is_nil(progress:onPageTurn(2)) -- still inside the default window

            clock.set(Config.progress_debounce_seconds)
            assert.is_table(progress:onPageTurn(3)) -- default window elapsed
        end)

        it("runs the actual PUT through the api boundary via push(body)", function()
            local progress, _, api = make{ debounce = 5 }
            local body = progress:onPageTurn(3)

            progress:push(body)

            local sent = pushes(api)
            assert.are.equal(1, #sent)
            assert.are.equal(MANGA, sent[1].mangaId)
            assert.are.same(body, sent[1].body)
        end)
    end)

    describe("flush on reader close", function()
        it("force-syncs the latest pending position regardless of the window", function()
            local progress, clock = make{ debounce = 5 }
            clock.set(0)
            progress:onPageTurn(2) -- leading push (page 1)
            clock.set(1)
            progress:onPageTurn(6) -- coalesced, unsynced (page 5)

            local body = progress:flush()

            assert.is_table(body)
            assert.are.equal(5, body.page)
        end)

        it("is a no-op when nothing has changed since the last push", function()
            local progress, clock = make{ debounce = 5 }
            clock.set(0)
            progress:onPageTurn(2) -- pushed, nothing pending afterwards

            assert.is_nil(progress:flush())
        end)

        it("is a no-op when there were no page turns at all", function()
            local progress = make{ debounce = 5 }

            assert.is_nil(progress:flush())
        end)
    end)

    describe("resuming at the synced position", function()
        it("resumes at the stored page mapped to the reader's 1-based page", function()
            local progress = make{
                getProgress = function() return { chapterId = CHAPTER, page = 4 }, nil end,
            }

            assert.are.equal(5, progress:resume()) -- api page 4 → reader page 5
        end)

        it("resumes at page 1 when the stored progress is the chapter start (page 0)", function()
            local progress = make{
                getProgress = function() return { chapterId = CHAPTER, page = 0 }, nil end,
            }

            assert.are.equal(1, progress:resume())
        end)

        it("does not resume when the stored progress is for a different chapter", function()
            local progress = make{
                getProgress = function() return { chapterId = "other", page = 4 }, nil end,
            }

            assert.is_nil(progress:resume())
        end)

        it("treats a never-read 404 as no resume (empty state, not an error)", function()
            local progress = make{
                getProgress = function() return nil, { kind = "http", status = 404 } end,
            }

            local page, err = progress:resume()
            assert.is_nil(page)
            assert.is_nil(err)
        end)

        it("surfaces a non-404 error without a resume target", function()
            local progress = make{
                getProgress = function() return nil, { kind = "http", status = 500 } end,
            }

            local page, err = progress:resume()
            assert.is_nil(page)
            assert.are.equal(500, err.status)
        end)

        it("maps a fetched record without touching the network (fetch/apply split)", function()
            -- applyResume is the pure parent-side step; it must not call the api.
            local progress, _, api = make{}

            local page = progress:applyResume({ chapterId = CHAPTER, page = 4 }, nil)

            assert.are.equal(5, page)
            assert.are.equal(0, #api.calls)
        end)

        it("fetches the stored progress through the api boundary (fetchResume)", function()
            local progress, _, api = make{
                getProgress = function() return { chapterId = CHAPTER, page = 0 }, nil end,
            }

            progress:fetchResume()

            assert.are.equal(1, #api.calls)
            assert.are.equal("getProgress", api.calls[1].method)
            assert.are.equal(MANGA, api.calls[1].args[1])
        end)
    end)
end)
