-- KRP-305 — Async networking & wifi gating. The single path every view uses to
-- run an API call (CLAUDE.md §5/§7): it gates on wifi (NetworkMgr) and runs the
-- blocking fetch off the UI thread behind a dismissable loading dialog (Trapper),
-- so a slow call never freezes the panel and a call with wifi off prompts/enables
-- wifi instead of failing silently. No view or state module touches NetworkMgr or
-- Trapper directly — they call Net:run and get the (data, err) back via callback.
--
-- All KOReader-API coupling (Trapper, NetworkMgr) is confined here, so an upgrade
-- breaks few modules (CLAUDE.md §12) and the collaborators are injected (§9) so
-- busted can drive the gating/wrapping logic with fakes (no KOReader, no sockets).

local Net = {}
Net.__index = Net

-- Lazily build the runtime collaborators so the module imports cleanly under
-- busted (which has no KOReader loaded); specs inject their own fakes instead.
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
--   task    : a function() -> (data, err) that performs the actual ApiClient call.
--             It runs in a forked sub-process (Trapper), so it must not touch the
--             UI, settings, or wifi — pure fetch + decode only (which is exactly
--             what api/client.lua does). Its return values are marshalled back.
--   opts    : { text = loading message, on_result = function(data, err) }.
--
-- Flow: ensure we're online (NetworkMgr prompts/enables wifi if not), then wrap
-- the fetch in a coroutine showing a dismissable loading dialog. If the user
-- dismisses it, on_result is called with a { kind = "cancelled" } error rather
-- than leaving the panel blank. on_result always runs through api/client.lua's
-- (data, err) contract, so callers (and Auth:handleError for 401s) treat a
-- gated/cancelled call exactly like any other.
function Net:run(task, opts)
    opts = opts or {}
    local loading_text = opts.text or "Loading…"
    local on_result = opts.on_result

    -- runWhenOnline runs the callback now if already online, otherwise routes
    -- through NetworkMgr's wifi prompt/enable and runs it once connected — so an
    -- offline call is never a silent failure.
    self.network_mgr:runWhenOnline(function()
        self.trapper:wrap(function()
            -- The fetch runs in a sub-process so the UI thread keeps ticking and
            -- the loading dialog stays dismissable; completed is false if the
            -- user tapped to cancel.
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
    end)
end

return Net
