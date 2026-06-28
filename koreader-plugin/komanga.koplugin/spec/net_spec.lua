-- KRP-305 — Async networking & wifi gating.
--
-- net.lua is mostly KOReader-API coupling (Trapper + NetworkMgr), validated for
-- feel on-device. But its dispatch logic is pure once those collaborators are
-- injected (CLAUDE.md §9), so we pin it here with fakes — no KOReader, no sockets:
--   1. Every call is gated through NetworkMgr (the single network path).
--   2. The fetch runs behind a dismissable loading dialog (Trapper), and its
--      (data, err) result is handed back via on_result.
--   3. A dismissed call yields a { kind = "cancelled" } error, never a blank panel.
--   4. An offline call routes through NetworkMgr (prompt/enable wifi) instead of
--      running the fetch and failing silently.

local Net = require("net")

-- A fake Trapper: wrap() runs the coroutine body inline; dismissableRunInSubprocess
-- records the loading text and returns a scripted (completed, data, err) without
-- forking. `dismissed = true` models the user tapping to cancel.
local function fake_trapper(opts)
    opts = opts or {}
    local rec = { wrapped = 0, loading_text = nil, task_ran = false }
    rec.trapper = {
        wrap = function(_, func)
            rec.wrapped = rec.wrapped + 1
            func()
        end,
        dismissableRunInSubprocess = function(_, task, text)
            rec.loading_text = text
            if opts.dismissed then
                return false
            end
            rec.task_ran = true
            local data, err = task()
            return true, data, err
        end,
    }
    return rec
end

-- A fake NetworkMgr: `online` decides whether runWhenOnline runs the callback now
-- (connected) or defers it to the wifi prompt/enable path (offline).
local function fake_network_mgr(online)
    local rec = { gated = 0, ran_callback = false }
    rec.mgr = {
        runWhenOnline = function(_, callback)
            rec.gated = rec.gated + 1
            if online then
                rec.ran_callback = true
                callback()
            end
            -- offline: NetworkMgr would prompt/enable wifi and run later; here we
            -- just record that gating happened and the fetch did NOT run yet.
        end,
    }
    return rec
end

describe("net (async networking & wifi gating)", function()
    it("gates every call through NetworkMgr", function()
        local tr = fake_trapper()
        local nm = fake_network_mgr(true)
        local net = Net.new{ network_mgr = nm.mgr, trapper = tr.trapper }

        net:run(function() return { ok = true } end, {})
        assert.are.equal(1, nm.gated)
    end)

    it("runs the fetch behind a loading dialog and returns its data", function()
        local tr = fake_trapper()
        local nm = fake_network_mgr(true)
        local net = Net.new{ network_mgr = nm.mgr, trapper = tr.trapper }

        local got
        net:run(function() return { title = "Berserk" }, nil end, {
            text = "Searching…",
            on_result = function(data, err) got = { data = data, err = err } end,
        })

        assert.is_true(tr.task_ran)
        assert.are.equal("Searching…", tr.loading_text)
        assert.are.equal(1, tr.wrapped)
        assert.are.same({ title = "Berserk" }, got.data)
        assert.is_nil(got.err)
    end)

    it("passes a fetch error straight through to on_result", function()
        local tr = fake_trapper()
        local nm = fake_network_mgr(true)
        local net = Net.new{ network_mgr = nm.mgr, trapper = tr.trapper }

        local got
        net:run(function() return nil, { kind = "http", status = 401 } end, {
            on_result = function(data, err) got = { data = data, err = err } end,
        })

        assert.is_nil(got.data)
        assert.are.equal("http", got.err.kind)
        assert.are.equal(401, got.err.status)
    end)

    it("reports a dismissed call as a cancelled error, not a blank result", function()
        local tr = fake_trapper{ dismissed = true }
        local nm = fake_network_mgr(true)
        local net = Net.new{ network_mgr = nm.mgr, trapper = tr.trapper }

        local got
        net:run(function() return { never = "reached" } end, {
            on_result = function(data, err) got = { data = data, err = err } end,
        })

        assert.is_false(tr.task_ran)
        assert.is_nil(got.data)
        assert.are.equal("cancelled", got.err.kind)
    end)

    it("falls back to a default loading message when none is given", function()
        local tr = fake_trapper()
        local nm = fake_network_mgr(true)
        local net = Net.new{ network_mgr = nm.mgr, trapper = tr.trapper }

        net:run(function() return {} end, {})
        assert.are.equal("Loading…", tr.loading_text)
    end)

    it("does not run the fetch when offline, but still gates through NetworkMgr", function()
        local tr = fake_trapper()
        local nm = fake_network_mgr(false)
        local net = Net.new{ network_mgr = nm.mgr, trapper = tr.trapper }

        local result_called = false
        net:run(function() return {} end, {
            on_result = function() result_called = true end,
        })

        assert.are.equal(1, nm.gated)       -- wifi gating happened (prompt/enable)
        assert.is_false(nm.ran_callback)    -- ... but we're offline,
        assert.is_false(tr.task_ran)        -- ... so the fetch never ran,
        assert.is_false(result_called)      -- ... and nothing failed silently.
    end)
end)
