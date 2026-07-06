-- The single path every view uses to run an API call (CLAUDE.md §5/§7): it gates on
-- wifi (NetworkMgr) and runs the blocking fetch off the UI thread behind a
-- dismissable loading dialog (Trapper), so a slow call never freezes the panel and a
-- call with wifi off prompts/enables wifi instead of failing silently. Confining all
-- Trapper/NetworkMgr coupling here keeps state/ui mockable and upgrade-resilient.

local Net = {}
Net.__index = Net

-- Lazily required so the module imports under busted; specs inject their own fakes.
local function default_network_mgr()
    return require("ui/network/manager")
end

local function default_trapper()
    return require("ui/trapper")
end

-- opts = { network_mgr?, trapper? }. Both default to the KOReader singletons.
function Net.new(opts)
    opts = opts or {}
    return setmetatable({
        network_mgr = opts.network_mgr or default_network_mgr(),
        trapper = opts.trapper or default_trapper(),
    }, Net)
end

-- Run an API call without freezing the UI.
--   task : function() -> (data, err) — the ApiClient call. It runs in a forked
--          sub-process, so it must not touch the UI, settings, or wifi (pure fetch +
--          decode, which is what api/client.lua does); its returns are marshalled back.
--   opts : { text = loading message, on_result = function(data, err), background = bool }.
--
-- A user-dismissed call yields a { kind = "cancelled" } error rather than a blank
-- panel; on_result always sees the (data, err) contract, so callers treat a
-- gated/cancelled call like any other.
--
-- background = true is the unobtrusive variant for calls that fire during another
-- activity (progress sync on page turns): it runs ONLY when already online (an
-- offline turn is skipped with a { kind = "offline" } error, never a wifi prompt)
-- and behind an invisible Trapper widget, so reading never stutters.
function Net:run(task, opts)
    opts = opts or {}
    local on_result = opts.on_result
    local background = opts.background == true
    -- Not the `and/or` idiom: `false` is falsy, so it would fall through to the text.
    local loading_text = opts.text or "Loading…"
    if background then
        loading_text = false
    end

    local function fetch()
        self.trapper:wrap(function()
            -- completed is false if the user tapped to cancel the loading dialog.
            local completed, data, err =
                self.trapper:dismissableRunInSubprocess(task, loading_text)
            if not completed then
                if on_result then
                    on_result(nil, { kind = "cancelled" })
                end
                return
            end
            if on_result then
                on_result(data, err)
            end
        end)
    end

    if background then
        if self.network_mgr:isOnline() then
            fetch()
        elseif on_result then
            on_result(nil, { kind = "offline" })
        end
        return
    end

    -- Runs now if online, else routes through the wifi prompt/enable and runs once
    -- connected — so an offline call is never a silent failure.
    self.network_mgr:runWhenOnline(fetch)
end

return Net
