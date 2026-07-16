-- Tracked KOM-172 integration check (not shipped): drives the real Komanga
-- plugin (main.lua) through the real UIManager window stack to prove:
--   * closing Browse after a source + mode were picked, before any manga was
--     opened for reading, re-opens Browse with that source's mode picker
--     (ButtonDialog) over a fresh source list;
--   * the return is one-shot — dismissing the reopened picker and closing again
--     exits Browse for real;
--   * closing from the bare sources list (no mode picked) does not reopen;
--   * the reading hand-off is untouched: picking a manga and opening a chapter
--     closes the stack with no Browse window scheduled back in (KOM-162 owns
--     the return from the reader).
describe("KoManga return to browse options on close (KOM-172)", function()
    local UIManager, ReaderUI
    local Komanga, FakeApi
    local komanga, shown, orig_show
    local orig_show_reader, opened_paths

    local mangadex = { id = "mangadex", name = "MangaDex" }

    local fake_net = {
        run = function(_, task, opts)
            opts = opts or {}
            local data, err = task()
            if opts.on_result then
                opts.on_result(data, err)
            end
        end,
    }

    local function api_responses(overrides)
        local responses = {
            listSources = function()
                return { { id = "mangadex", name = "MangaDex", lang = "en" } }
            end,
            browse = function()
                return { mangas = { { id = "m7", title = "Berserk" } }, hasNextPage = false }
            end,
            getManga = function()
                return {
                    manga = { id = "m7", sourceId = "mangadex", title = "Berserk" },
                    chapters = {
                        { id = "c1", name = "Chapter 1", chapterNumber = 1 },
                        { id = "c2", name = "Chapter 2", chapterNumber = 2 },
                    },
                    readingDirection = "rtl",
                }
            end,
            getProgress = function()
                return nil, { kind = "http", status = 404 }
            end,
            listLibrary = function()
                return {}
            end,
            trackerStatus = function()
                return { state = "unmatched", account = { linked = false } }
            end,
            fetchCover = function()
                return nil, { kind = "http", status = 404 }
            end,
            readChapterCbzToFile = function(_, dest_path)
                local f = assert(io.open(dest_path, "w"))
                f:write("stub cbz")
                f:close()
                return dest_path
            end,
        }
        for k, v in pairs(overrides or {}) do
            responses[k] = v
        end
        return responses
    end

    setup(function()
        require("commonrequire")
        disable_plugins()
        UIManager = require("ui/uimanager")
        ReaderUI = require("apps/reader/readerui")
        local plugin_root = os.getenv("KOMANGA_PLUGIN_ROOT")
        assert.truthy(plugin_root, "KOMANGA_PLUGIN_ROOT must point at komanga.koplugin")
        package.path = plugin_root .. "/?.lua;" .. package.path
        Komanga = require("main")
        FakeApi = require("spec.support.fake_api")
    end)

    local function make_plugin(overrides)
        komanga = Komanga:new{
            ui = { menu = { registerToMainMenu = function() end } },
        }
        komanga.net = fake_net
        komanga.api = FakeApi.new(api_responses(overrides))
    end

    local function stacked_browsers()
        local found = {}
        for _, window in ipairs(UIManager._window_stack) do
            local widget = window.widget
            if widget and widget.name == "komanga_source_browser" then
                found[#found + 1] = widget
            end
        end
        return found
    end

    -- The KOM-165 mode picker: a ButtonDialog titled with the source name.
    local function shown_picker(from_index)
        for i = from_index or 1, #shown do
            local widget = shown[i]
            if widget.title == "MangaDex" and widget.buttons then
                return widget
            end
        end
    end

    local function pick_mode(picker, label)
        for _, row in ipairs(picker.buttons) do
            for _, button in ipairs(row) do
                if button.text == label then
                    button.callback()
                    return
                end
            end
        end
        assert(false, "no '" .. label .. "' button on the mode picker")
    end

    -- Sources list → source row → mode picker → Popular results, through the same
    -- callbacks the real taps run.
    local function browse_to_results()
        komanga:showBrowse()
        local browser = shown[#shown]
        assert.are.equal("komanga_source_browser", browser.name)
        browser:promptMode(mangadex)
        local picker = shown_picker()
        assert.truthy(picker, "mode picker expected after selecting a source")
        pick_mode(picker, "Popular")
        return browser
    end

    before_each(function()
        shown = {}
        orig_show = UIManager.show
        UIManager.show = function(self, widget, ...)
            table.insert(shown, widget)
            return orig_show(self, widget, ...)
        end
        opened_paths = {}
        orig_show_reader = ReaderUI.showReader
        ReaderUI.showReader = function(_, path)
            table.insert(opened_paths, path)
        end
    end)

    after_each(function()
        ReaderUI.showReader = orig_show_reader
        if komanga then
            komanga:closeShownScreens()
            komanga = nil
        end
        for _, widget in ipairs(shown) do
            UIManager:close(widget)
        end
        UIManager.show = orig_show
        fastforward_ui_events()
        for _, path in ipairs(opened_paths) do
            os.remove(path)
        end
    end)

    it("closing Browse after picking a mode reopens the source's mode picker", function()
        make_plugin()
        local browser = browse_to_results()
        local closed_at = #shown

        browser.close_callback()
        fastforward_ui_events()

        local browsers = stacked_browsers()
        assert.are.equal(1, #browsers)
        assert.are_not.equal(browser, browsers[1])
        local picker = shown_picker(closed_at + 1)
        assert.truthy(picker, "mode picker expected after the pre-reading close")
        -- The reopened picker still works: Popular runs a fresh browse (cover
        -- prefetch calls may follow it).
        local results_before = #komanga.api.calls
        pick_mode(picker, "Popular")
        local browsed = false
        for i = results_before + 1, #komanga.api.calls do
            if komanga.api.calls[i].method == "browse" then
                browsed = true
            end
        end
        assert.is_true(browsed)
    end)

    it("the return is one-shot: dismissing the reopened picker and closing exits", function()
        make_plugin()
        local browser = browse_to_results()

        browser.close_callback()
        fastforward_ui_events()
        local reopened = stacked_browsers()[1]
        assert.truthy(reopened)
        local picker = shown_picker()
        UIManager:close(picker)

        local closed_at = #shown
        reopened.close_callback()
        fastforward_ui_events()

        assert.are.same({}, stacked_browsers())
        assert.is_nil(shown_picker(closed_at + 1))
        assert.are.same({}, komanga.shown_screens)
    end)

    it("closing from the bare sources list does not reopen Browse", function()
        make_plugin()
        komanga:showBrowse()
        local browser = shown[#shown]
        assert.are.equal("komanga_source_browser", browser.name)

        browser.close_callback()
        fastforward_ui_events()

        assert.are.same({}, stacked_browsers())
        assert.are.same({}, komanga.shown_screens)
    end)

    it("opening a chapter to read suppresses the browse return (KOM-162 owns it)", function()
        make_plugin()
        local browser = browse_to_results()
        browser:openManga({ id = "m7", title = "Berserk" })
        local details = shown[#shown]
        assert.are.equal("komanga_manga_details", details.name)

        details:openChapter({ id = "c2" })
        fastforward_ui_events()

        assert.are.equal(1, #opened_paths)
        assert.are.same({}, stacked_browsers())
        assert.are.same({}, komanga.shown_screens)
    end)
end)
