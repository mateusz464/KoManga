-- KRP-406 — [TEST] Cover thumbnails (logic).
--
-- Pins the non-UI contract of state/covers.lua: the bounded-prefetch planner
-- (CLAUDE.md §8 — never one request per row), the dedup of already-handled covers,
-- the fetch/apply split (off-thread fetch, parent-side apply, mirroring the other
-- state modules), and degrade-to-text on a missing/failed cover. The actual
-- bitmap decode + on-panel render is the UI's job and a [DEVICE] concern; here we
-- only assert the logic, mocking at the api/ boundary (a fake fetchCover).

local Covers = require("state.covers")

-- An ApiClient stand-in: fetchCover(id) consults `bytes_by_id` (id -> string) and
-- returns the same (bytes, err) contract as the real client. ids absent from the
-- map (or mapped to false) fail like a 404 cover. Records every id requested.
local function fake_api(bytes_by_id)
    bytes_by_id = bytes_by_id or {}
    local api = { requested = {} }
    function api:fetchCover(id)
        self.requested[#self.requested + 1] = id
        local bytes = bytes_by_id[id]
        if bytes then
            return bytes, nil
        end
        return nil, { kind = "http", status = 404 }
    end
    return api
end

describe("Covers", function()
    describe("bounded prefetch planning", function()
        it("plans no more than the configured window per pass", function()
            local covers = Covers.new(fake_api(), { window = 3 })
            local batch = covers:plan({ "a", "b", "c", "d", "e" })

            assert.are.same({ "a", "b", "c" }, batch)
        end)

        it("keeps display order when selecting the window", function()
            local covers = Covers.new(fake_api(), { window = 2 })
            assert.are.same({ "x", "y" }, covers:plan({ "x", "y", "z" }))
        end)

        it("does not re-plan a cover it has already taken (dedup)", function()
            local covers = Covers.new(fake_api(), { window = 10 })
            covers:plan({ "a", "b" })

            -- "a"/"b" are already pending; only the new ids are returned.
            assert.are.same({ "c", "d" }, covers:plan({ "a", "b", "c", "d" }))
        end)

        it("does not re-plan a cover that already resolved (ready or failed)", function()
            local covers = Covers.new(fake_api{ a = "PNGa" }, { window = 10 })
            local batch = covers:plan({ "a", "b" })
            covers:apply(covers:fetch(batch)) -- a -> ready, b -> failed

            assert.are.same({}, covers:plan({ "a", "b" }))
        end)

        it("refills the window with fresh ids once room is freed", function()
            local covers = Covers.new(fake_api{ a = "A", b = "B" }, { window = 2 })
            covers:apply(covers:fetch(covers:plan({ "a", "b" })))

            -- a/b done; the next pass can take two more.
            assert.are.same({ "c", "d" }, covers:plan({ "a", "b", "c", "d", "e" }))
        end)
    end)

    describe("fetch / apply", function()
        it("only fetches the ids it is given (the planned batch)", function()
            local api = fake_api{ a = "A", b = "B", c = "C" }
            local covers = Covers.new(api, { window = 2 })
            covers:fetch(covers:plan({ "a", "b", "c" }))

            assert.are.same({ "a", "b" }, api.requested)
        end)

        it("makes fetched covers ready with their bytes", function()
            local covers = Covers.new(fake_api{ a = "PNGa" }, { window = 5 })
            covers:apply(covers:fetch(covers:plan({ "a" })))

            assert.is_true(covers:isReady("a"))
            assert.are.equal("PNGa", covers:getBytes("a"))
        end)
    end)

    describe("degrade to text", function()
        it("marks a missing cover failed rather than erroring the pass", function()
            local covers = Covers.new(fake_api{ a = "A" }, { window = 5 })
            covers:apply(covers:fetch(covers:plan({ "a", "missing" })))

            -- the present cover still resolves...
            assert.is_true(covers:isReady("a"))
            assert.are.equal("A", covers:getBytes("a"))
            -- ...and the missing one degrades to text, never left pending.
            assert.is_true(covers:isFailed("missing"))
            assert.is_nil(covers:getBytes("missing"))
        end)

        it("reports no bytes for a cover that hasn't resolved yet", function()
            local covers = Covers.new(fake_api(), { window = 5 })
            covers:plan({ "a" }) -- pending, not yet fetched

            assert.is_false(covers:isReady("a"))
            assert.is_false(covers:isFailed("a"))
            assert.is_nil(covers:getBytes("a"))
        end)
    end)
end)
