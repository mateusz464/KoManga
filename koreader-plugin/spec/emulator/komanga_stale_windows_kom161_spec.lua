-- Tracked KOM-161 integration check (not shipped): drives the real Komanga
-- plugin (main.lua) through the real UIManager window stack to prove:
--   * opening a chapter — from Browse → Details, from Library "continue
--     reading", and from a Library offline download — closes every stacked
--     KoManga window once the CBZ hand-off succeeds, so nothing resurfaces on
--     KOReader exit;
--   * a cancelled or failed chapter fetch leaves the stack untouched (the user
--     stays where they were, with the existing Retry/InfoMessage UX);
--   * in-stack back navigation is unchanged (closing Details reveals Browse);
--   * the full path through the real ReaderUI:showReader swaps into a real CBZ
--     reader with no KoManga windows left beneath it.
describe("KoManga stale windows on reader hand-off (KOM-161)", function()
    local DocSettings, UIManager, ReaderUI
    local Komanga, FakeApi
    local komanga, shown, orig_show
    local orig_show_reader, opened_paths
    local fixture_cbz

    local fake_net = {
        run = function(_, task, opts)
            opts = opts or {}
            local data, err = task()
            if opts.on_result then
                opts.on_result(data, err)
            end
        end,
    }

    local function manga_details()
        return {
            manga = { id = "m7", sourceId = "mangadex", title = "Berserk" },
            chapters = {
                { id = "c1", name = "Chapter 1", chapterNumber = 1 },
                { id = "c2", name = "Chapter 2", chapterNumber = 2 },
            },
            readingDirection = "rtl",
        }
    end

    local function write_stub_cbz(_, dest_path)
        local f = assert(io.open(dest_path, "w"))
        f:write("stub cbz")
        f:close()
        return dest_path
    end

    -- The happy-path responses every flow shares; tests override per-case.
    local function api_responses(overrides)
        local responses = {
            listSources = function()
                return { { id = "mangadex", name = "MangaDex", lang = "en" } }
            end,
            search = function()
                return { mangas = { { id = "m7", title = "Berserk" } }, hasNextPage = false }
            end,
            getManga = manga_details,
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
            readChapterCbzToFile = write_stub_cbz,
        }
        for k, v in pairs(overrides or {}) do
            responses[k] = v
        end
        return responses
    end

    setup(function()
        require("commonrequire")
        disable_plugins()
        DocSettings = require("docsettings")
        UIManager = require("ui/uimanager")
        ReaderUI = require("apps/reader/readerui")
        local plugin_root = os.getenv("KOMANGA_PLUGIN_ROOT")
        assert.truthy(plugin_root, "KOMANGA_PLUGIN_ROOT must point at komanga.koplugin")
        package.path = plugin_root .. "/?.lua;" .. package.path
        Komanga = require("main")
        FakeApi = require("spec.support.fake_api")
        -- A real 2-page CBZ for the test that opens the real reader.
        local tmp_dir = (os.getenv("TMPDIR") or "/tmp") .. "/komanga-kom161"
        fixture_cbz = tmp_dir .. "/fixture.cbz"
        assert.are.equal(0, os.execute(table.concat({
            "rm -rf " .. tmp_dir,
            "mkdir -p " .. tmp_dir,
            "cp resources/koreader.png " .. tmp_dir .. "/p1.png",
            "cp resources/koreader.png " .. tmp_dir .. "/p2.png",
            "/usr/bin/zip -q -j " .. fixture_cbz .. " " .. tmp_dir .. "/p*.png",
        }, " && ")))
    end)

    local function make_plugin(overrides)
        komanga = Komanga:new{
            ui = { menu = { registerToMainMenu = function() end } },
        }
        komanga.net = fake_net
        komanga.api = FakeApi.new(api_responses(overrides))
    end

    -- The plugin's screens currently on UIManager's real window stack — exactly
    -- what would resurface on KOReader exit.
    local KOMANGA_SCREENS = {
        komanga_library = true,
        komanga_source_browser = true,
        komanga_manga_details = true,
    }
    local function stacked_screens()
        local found = {}
        for _, window in ipairs(UIManager._window_stack) do
            local widget = window.widget
            if widget and KOMANGA_SCREENS[widget.name] then
                found[#found + 1] = widget.name
            end
        end
        return found
    end

    local function shown_by_name(name)
        for _, widget in ipairs(shown) do
            if widget.name == name then
                return widget
            end
        end
    end

    local function shown_confirm(ok_text)
        for _, widget in ipairs(shown) do
            if widget.ok_text == ok_text then
                return widget
            end
        end
    end

    local function is_stacked(widget)
        for _, window in ipairs(UIManager._window_stack) do
            if window.widget == widget then
                return true
            end
        end
        return false
    end

    -- Browse → search → open a manga, the way the AC flow reaches Details
    -- (runSearch is the post-InputDialog step; openManga is the result-row tap).
    local function browse_to_details()
        komanga:showBrowse()
        local browser = shown_by_name("komanga_source_browser")
        assert.truthy(browser)
        browser:runSearch({ id = "mangadex", name = "MangaDex" }, "berserk")
        browser:openManga({ id = "m7", title = "Berserk" })
        local details = shown_by_name("komanga_manga_details")
        assert.truthy(details)
        return browser, details
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
            if is_stacked(widget) then
                UIManager:close(widget)
            end
        end
        UIManager.show = orig_show
        for _, path in ipairs(opened_paths) do
            os.remove(path)
        end
    end)

    it("Browse → Details → open chapter closes the whole KoManga stack", function()
        make_plugin()
        local _, details = browse_to_details()
        assert.are.same(
            { "komanga_source_browser", "komanga_manga_details" }, stacked_screens())

        details:openChapter({ id = "c2" })

        assert.are.equal(1, #opened_paths)
        assert.are.same({}, stacked_screens())
        assert.are.same({}, komanga.shown_screens)
    end)

    it("Library → continue reading closes the Library window", function()
        make_plugin{
            listLibrary = function()
                return { { mangaId = "m7", title = "Berserk",
                           nextChapter = { id = "c2", number = 2 } } }
            end,
        }
        komanga:showLibrary()
        local library = shown_by_name("komanga_library")
        assert.truthy(library)
        assert.are.same({ "komanga_library" }, stacked_screens())

        library.continue_reading({ mangaId = "m7",
            nextChapter = { id = "c2", number = 2 } })

        assert.are.equal(1, #opened_paths)
        assert.are.same({}, stacked_screens())
        assert.are.same({}, komanga.shown_screens)
    end)

    it("Library → open offline download closes the Library window", function()
        make_plugin()
        komanga:showLibrary()
        local library = shown_by_name("komanga_library")
        assert.truthy(library)

        library.open_download({ mangaId = "m7", chapterId = "c2",
            fileName = "c2.cbz", title = "Berserk", chapterNumber = 2 })

        assert.are.equal(1, #opened_paths)
        assert.are.same({}, stacked_screens())
        assert.are.same({}, komanga.shown_screens)
    end)

    it("a cancelled chapter fetch leaves Details and Browse open", function()
        make_plugin{
            readChapterCbzToFile = function()
                return nil, { kind = "cancelled" }
            end,
        }
        local _, details = browse_to_details()

        details:openChapter({ id = "c2" })

        assert.are.same({}, opened_paths)
        assert.are.same(
            { "komanga_source_browser", "komanga_manga_details" }, stacked_screens())
        assert.are.equal(2, #komanga.shown_screens)
    end)

    it("a failed chapter fetch offers Retry with the stack intact", function()
        make_plugin{
            readChapterCbzToFile = function()
                return nil, { kind = "transport", message = "wifi asleep" }
            end,
        }
        local _, details = browse_to_details()

        details:openChapter({ id = "c2" })

        assert.are.same({}, opened_paths)
        assert.truthy(shown_confirm("Retry"), "Retry dialog expected on a failed fetch")
        assert.are.same(
            { "komanga_source_browser", "komanga_manga_details" }, stacked_screens())
        assert.are.equal(2, #komanga.shown_screens)
    end)

    it("back navigation is unchanged: closing Details reveals Browse", function()
        make_plugin()
        local _, details = browse_to_details()

        details.close_callback()

        assert.are.same({ "komanga_source_browser" }, stacked_screens())
        assert.are.equal(1, #komanga.shown_screens)
    end)

    it("the real showReader swaps into the reader with no KoManga windows beneath", function()
        make_plugin{
            readChapterCbzToFile = function(_, dest_path)
                local src = assert(io.open(fixture_cbz, "rb"))
                local bytes = src:read("*a")
                src:close()
                local dst = assert(io.open(dest_path, "wb"))
                dst:write(bytes)
                dst:close()
                return dest_path
            end,
        }
        local _, details = browse_to_details()
        ReaderUI.showReader = orig_show_reader

        details:openChapter({ id = "c2" })
        fastforward_ui_events()

        local readerui = ReaderUI.instance
        assert.truthy(readerui, "a ReaderUI instance should be running after the hand-off")
        assert.are.equal(2, readerui.document:getPageCount())
        assert.are.equal("c2", readerui.doc_settings:readSetting("komanga_chapter_id"))
        assert.are.same({}, stacked_screens())
        assert.are.same({}, komanga.shown_screens)

        local file = readerui.document.file
        readerui:onClose()
        assert.are.same({}, stacked_screens())
        DocSettings:open(file):purge()
        os.remove(file)
    end)
end)
