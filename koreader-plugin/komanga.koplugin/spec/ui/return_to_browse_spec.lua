local ReturnToBrowse = require("ui.return_to_browse")

local mangadex = { id = "mangadex", name = "MangaDex" }

local function subject()
    local scheduled = {}
    local shown = {}
    local coordinator = ReturnToBrowse.new{
        ui_manager = {
            scheduleIn = function(_, delay, callback)
                scheduled[#scheduled + 1] = { delay = delay, callback = callback }
            end,
        },
        show_browse_options = function(source)
            shown[#shown + 1] = source
        end,
    }
    return coordinator, scheduled, shown
end

-- Pinned navigation decision (KOM-172): the Menu back arrow keeps its existing
-- results → sources behaviour; the CLOSE path is the return route. Closing Browse
-- after a mode was picked, before a manga was opened for reading, re-opens the
-- selected source's mode picker. The return is one-shot: it consumes the
-- selection, and picking a mode again re-arms it.
describe("return to browse options", function()
    it("re-opens the mode picker for the remembered source when browse closes before reading", function()
        local coordinator, scheduled, shown = subject()
        coordinator:onBrowseOpened()
        coordinator:setSelection(mangadex)

        coordinator:onBrowseClosed()

        assert.are.equal(1, #scheduled)
        assert.are.equal(0, scheduled[1].delay)
        assert.are.equal(0, #shown)
        scheduled[1].callback()
        assert.are.same({ mangadex }, shown)
    end)

    it("does not return once a manga was opened for reading", function()
        local coordinator, scheduled = subject()
        coordinator:onBrowseOpened()
        coordinator:setSelection(mangadex)
        coordinator:setReading()

        coordinator:onBrowseClosed()

        assert.are.equal(0, #scheduled)
    end)

    it("is inert when browse closes from the bare sources list", function()
        local coordinator, scheduled = subject()
        coordinator:onBrowseOpened()

        coordinator:onBrowseClosed()

        assert.are.equal(0, #scheduled)
    end)

    it("consumes the selection so the returned-to session can close freely", function()
        local coordinator, scheduled = subject()
        coordinator:onBrowseOpened()
        coordinator:setSelection(mangadex)

        coordinator:onBrowseClosed()
        coordinator:onBrowseOpened()
        coordinator:onBrowseClosed()

        assert.are.equal(1, #scheduled)
    end)

    it("re-arms when a mode is picked again in the returned-to session", function()
        local coordinator, scheduled = subject()
        coordinator:onBrowseOpened()
        coordinator:setSelection(mangadex)
        coordinator:onBrowseClosed()

        coordinator:onBrowseOpened()
        coordinator:setSelection({ id = "asura", name = "Asura Scans" })
        coordinator:onBrowseClosed()

        assert.are.equal(2, #scheduled)
        scheduled[2].callback()
    end)

    it("clears stale reading state when a new browse session opens", function()
        local coordinator, scheduled = subject()
        coordinator:onBrowseOpened()
        coordinator:setSelection(mangadex)
        coordinator:setReading()
        coordinator:onBrowseClosed()

        coordinator:onBrowseOpened()
        coordinator:setSelection(mangadex)
        coordinator:onBrowseClosed()

        assert.are.equal(1, #scheduled)
    end)
end)
