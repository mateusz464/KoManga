-- KOM-159 — "turn pages by swiping left → right". KOReader's only swipe knob,
-- inverse_reading_order, flips taps AND swipes together, so instead a full-screen
-- swipe zone is registered over ReaderPaging's "paging_swipe": when the preference
-- is on, an east swipe advances and a west swipe goes back regardless of the
-- manga's direction, while tap zones stay on inverse_reading_order untouched.
-- Everything is decided per swipe (preference + sidecar read live), so a toggle
-- applies to an already-open document, and a downloaded chapter reopened from the
-- file manager is covered without going through the launcher.
local SwipeOverride = {}

-- The relative page turn a swipe maps to, or nil to fall through to KOReader's own
-- handling (which turns pages according to the manga's reading direction).
function SwipeOverride.turnFor(direction, enabled)
    if not enabled then
        return nil
    end
    if direction == "east" then
        return 1
    end
    if direction == "west" then
        return -1
    end
    return nil
end

-- opts = { ui, settings }; `ui` is the ReaderUI hosting the document.
function SwipeOverride.register(opts)
    opts.ui:registerTouchZones({
        {
            id = "komanga_swipe_ltr_next",
            ges = "swipe",
            screen_zone = { ratio_x = 0, ratio_y = 0, ratio_w = 1, ratio_h = 1 },
            overrides = { "paging_swipe" },
            handler = function(ges)
                return SwipeOverride.onSwipe(opts, ges)
            end,
        },
    })
end

function SwipeOverride.onSwipe(opts, ges)
    local ds = opts.ui.doc_settings
    if not (ds and ds:readSetting("komanga_chapter_id")) then
        return
    end
    -- Honour KOReader's global "disable swipe page turns" kill-switch, like
    -- ReaderPaging does.
    if G_reader_settings and G_reader_settings:isTrue("page_turns_disable_swipe") then
        return
    end
    local rel = SwipeOverride.turnFor(ges.direction, opts.settings:isSwipeLtrNextEnabled())
    if not rel then
        return
    end
    -- Lazily required so the module stays importable under busted.
    local Event = require("ui/event")
    opts.ui:handleEvent(Event:new("GotoViewRel", rel))
    return true
end

return SwipeOverride
