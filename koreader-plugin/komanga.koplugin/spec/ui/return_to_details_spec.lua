local ReturnToDetails = require("ui.return_to_details")

local function doc_settings(chapter_id, manga_id)
    local values = {
        komanga_chapter_id = chapter_id,
        komanga_manga_id = manga_id,
    }
    return {
        readSetting = function(_, key)
            return values[key]
        end,
    }
end

local function subject()
    local scheduled = {}
    local shown = {}
    local coordinator = ReturnToDetails.new{
        ui_manager = {
            scheduleIn = function(_, delay, callback)
                scheduled[#scheduled + 1] = { delay = delay, callback = callback }
            end,
        },
        show_details = function(manga)
            shown[#shown + 1] = manga
        end,
    }
    return coordinator, scheduled, shown
end

describe("return to manga details", function()
    it("schedules a fresh details screen after a KoManga chapter closes", function()
        local coordinator, scheduled, shown = subject()
        coordinator:onReaderReady(doc_settings("chapter-1", "manga-1"))

        coordinator:onCloseDocument()

        assert.are.equal(1, #scheduled)
        assert.are.equal(0, scheduled[1].delay)
        assert.are.equal(0, #shown)
        scheduled[1].callback()
        assert.are.same({ { id = "manga-1" } }, shown)
    end)

    it("does not return while advancing to the next chapter", function()
        local coordinator, scheduled = subject()
        coordinator:onReaderReady(doc_settings("chapter-1", "manga-1"))
        coordinator:setAdvancing(true)

        coordinator:onCloseDocument()

        assert.are.equal(0, #scheduled)
    end)

    it("is inert for documents without both KoManga sidecar ids", function()
        local coordinator, scheduled = subject()
        coordinator:onReaderReady(doc_settings(nil, nil))

        coordinator:onCloseDocument()

        assert.are.equal(0, #scheduled)
    end)

    it("only schedules once if close is delivered more than once", function()
        local coordinator, scheduled = subject()
        coordinator:onReaderReady(doc_settings("chapter-1", "manga-1"))

        coordinator:onCloseDocument()
        coordinator:onCloseDocument()

        assert.are.equal(1, #scheduled)
    end)
end)
