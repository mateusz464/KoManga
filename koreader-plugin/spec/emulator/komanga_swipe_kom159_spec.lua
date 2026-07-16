-- Tracked KOM-159 integration check (not shipped): drives a real ReaderUI +
-- ReaderPaging through InputContainer's touch-zone dispatch to prove the KoManga
-- swipe override takes precedence over paging_swipe when enabled and falls
-- through byte-identically when disabled or on a non-KoManga document.
describe("KoManga swipe override integration (KOM-159)", function()
    local sample_pdf = "spec/front/unit/data/sample.pdf"
    local DocumentRegistry, DocSettings, ReaderUI, Screen, Geom
    local SwipeOverride
    local readerui
    local enabled

    local fake_settings = {
        isSwipeLtrNextEnabled = function()
            return enabled
        end,
    }

    local function swipe(direction)
        return {
            ges = "swipe",
            direction = direction,
            pos = Geom:new{
                x = math.floor(Screen:getWidth() / 2),
                y = math.floor(Screen:getHeight() / 2),
                w = 0, h = 0,
            },
            time = 0,
        }
    end

    local Event

    setup(function()
        require("commonrequire")
        disable_plugins()
        DocumentRegistry = require("document/documentregistry")
        DocSettings = require("docsettings")
        ReaderUI = require("apps/reader/readerui")
        Screen = require("device").screen
        Geom = require("ui/geometry")
        Event = require("ui/event")
        local plugin_root = os.getenv("KOMANGA_PLUGIN_ROOT")
        assert.truthy(plugin_root, "KOMANGA_PLUGIN_ROOT must point at komanga.koplugin")
        package.path = plugin_root .. "/?.lua;" .. package.path
        SwipeOverride = require("ui/swipe_override")
    end)

    before_each(function()
        DocSettings:open(sample_pdf):purge()
        readerui = ReaderUI:new{
            dimen = Screen:getSize(),
            document = DocumentRegistry:openDocument(sample_pdf),
        }
        assert.is_true(readerui.document:getPageCount() >= 2)
        -- Match the KoManga launcher's sidecar: paged mode + whole-page zoom.
        readerui:handleEvent(Event:new("SetScrollMode", false))
        readerui.zooming:setZoomMode("page")
        readerui.doc_settings:saveSetting("komanga_chapter_id", "kom159-test")
        SwipeOverride.register{ ui = readerui, settings = fake_settings }
        enabled = false
    end)

    after_each(function()
        readerui:onClose()
        DocSettings:open(sample_pdf):purge()
        readerui = nil
    end)

    it("ON + LTR: east (left → right) swipe advances instead of going back", function()
        enabled = true
        readerui.view.inverse_reading_order = false
        assert.are.equal(1, readerui.paging.current_page)
        readerui:onGesture(swipe("east"))
        assert.are.equal(2, readerui.paging.current_page)
    end)

    it("ON + LTR: west swipe goes back", function()
        enabled = true
        readerui.view.inverse_reading_order = false
        readerui.paging:onGotoPage(2)
        readerui:onGesture(swipe("west"))
        assert.are.equal(1, readerui.paging.current_page)
    end)

    it("ON + RTL: east swipe advances (same as stock RTL)", function()
        enabled = true
        readerui.view.inverse_reading_order = true
        assert.are.equal(1, readerui.paging.current_page)
        readerui:onGesture(swipe("east"))
        assert.are.equal(2, readerui.paging.current_page)
    end)

    it("OFF + LTR: falls through to stock paging (east goes back)", function()
        enabled = false
        readerui.view.inverse_reading_order = false
        readerui.paging:onGotoPage(2)
        readerui:onGesture(swipe("east"))
        assert.are.equal(1, readerui.paging.current_page)
    end)

    it("OFF + RTL: falls through to stock paging (east advances)", function()
        enabled = false
        readerui.view.inverse_reading_order = true
        assert.are.equal(1, readerui.paging.current_page)
        readerui:onGesture(swipe("east"))
        assert.are.equal(2, readerui.paging.current_page)
    end)

    it("ON + non-KoManga document: stock behaviour is untouched", function()
        enabled = true
        readerui.doc_settings:delSetting("komanga_chapter_id")
        readerui.view.inverse_reading_order = false
        readerui.paging:onGotoPage(2)
        readerui:onGesture(swipe("east"))
        assert.are.equal(1, readerui.paging.current_page)
    end)

    it("ON: vertical swipes fall through (menus keep working)", function()
        enabled = true
        readerui.view.inverse_reading_order = false
        local before = readerui.paging.current_page
        readerui:onGesture(swipe("north"))
        assert.are.equal(before, readerui.paging.current_page)
    end)

    it("exposes a persisted checkmark toggle in the file-manager menu", function()
        local Komanga = require("main")
        local state = false
        local fake_self = {
            settings = {
                isSwipeLtrNextEnabled = function() return state end,
                setSwipeLtrNextEnabled = function(_, v) state = v end,
                isTrackerLinked = function() return false end,
            },
            trackerMenuText = Komanga.trackerMenuText,
        }
        local menu_items = {}
        Komanga.addToMainMenu(fake_self, menu_items)
        local toggle
        for _, item in ipairs(menu_items.komanga.sub_item_table) do
            if item.text:find("swiping") then
                toggle = item
            end
        end
        assert.truthy(toggle, "swipe toggle missing from KoManga menu")
        assert.is_false(toggle.checked_func())
        toggle.callback()
        assert.is_true(toggle.checked_func())
        toggle.callback()
        assert.is_false(toggle.checked_func())
    end)
end)
