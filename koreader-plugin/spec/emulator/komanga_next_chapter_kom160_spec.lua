-- Tracked KOM-160 integration check (not shipped): drives a real ReaderUI +
-- ReaderStatus + the KoManga next-chapter prompt to prove:
--   * ReaderStatus is registered before plugin modules and does NOT return true
--     from onEndOfBook, so a plugin-position handler cannot pre-empt the default
--     end-of-document dialog (the reason the prompt hooks ui.status).
--   * With the hook: paging past the end of a KoManga chapter with a known next
--     chapter offers the ConfirmBox and consumes the event; Continue opens the
--     next chapter through ReaderLauncher with the details-open sidecar contract;
--     Cancel stays put and re-offers on the next end-of-book.
--   * Last chapter / non-KoManga document / failed resolution all propagate to
--     KOReader's own end-of-document dialog untouched.
describe("KoManga next-chapter prompt integration (KOM-160)", function()
    local sample_pdf = "spec/front/unit/data/sample.pdf"
    local DocumentRegistry, DocSettings, ReaderUI, Screen, Event, UIManager
    local NextChapterPrompt, FakeApi
    local readerui, prompt, api_calls
    local shown, orig_show
    local orig_show_reader, opened_paths
    local fixture_cbz
    local old_end_document_action

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
                { id = "c3", name = "Chapter 3", chapterNumber = 3 },
            },
            readingDirection = "rtl",
        }
    end

    setup(function()
        require("commonrequire")
        disable_plugins()
        DocumentRegistry = require("document/documentregistry")
        DocSettings = require("docsettings")
        ReaderUI = require("apps/reader/readerui")
        Screen = require("device").screen
        Event = require("ui/event")
        UIManager = require("ui/uimanager")
        local plugin_root = os.getenv("KOMANGA_PLUGIN_ROOT")
        assert.truthy(plugin_root, "KOMANGA_PLUGIN_ROOT must point at komanga.koplugin")
        package.path = plugin_root .. "/?.lua;" .. package.path
        NextChapterPrompt = require("ui/next_chapter_prompt")
        FakeApi = require("spec.support.fake_api")
        old_end_document_action = G_reader_settings:readSetting("end_document_action")
        G_reader_settings:saveSetting("end_document_action", "pop-up")
        -- A real 3-page CBZ (needed where the swapped-to document actually opens).
        local tmp_dir = (os.getenv("TMPDIR") or "/tmp") .. "/komanga-kom160"
        fixture_cbz = tmp_dir .. "/fixture.cbz"
        assert.are.equal(0, os.execute(table.concat({
            "rm -rf " .. tmp_dir,
            "mkdir -p " .. tmp_dir,
            "cp resources/koreader.png " .. tmp_dir .. "/p1.png",
            "cp resources/koreader.png " .. tmp_dir .. "/p2.png",
            "cp resources/koreader.png " .. tmp_dir .. "/p3.png",
            "/usr/bin/zip -q -j " .. fixture_cbz .. " " .. tmp_dir .. "/p*.png",
        }, " && ")))
    end)

    local function open_reader(komanga_sidecar)
        readerui = ReaderUI:new{
            dimen = Screen:getSize(),
            document = DocumentRegistry:openDocument(sample_pdf),
        }
        UIManager:show(readerui)
        readerui:handleEvent(Event:new("SetScrollMode", false))
        readerui.zooming:setZoomMode("page")
        if komanga_sidecar then
            readerui.doc_settings:saveSetting("komanga_chapter_id", komanga_sidecar.chapter_id)
            readerui.doc_settings:saveSetting("komanga_manga_id", komanga_sidecar.manga_id)
        end
    end

    local function make_prompt(api_responses)
        local api = FakeApi.new(api_responses)
        api_calls = api.calls
        prompt = NextChapterPrompt.new{
            ui = readerui,
            net = fake_net,
            api = api,
        }
        prompt:onReaderReady(readerui.doc_settings)
    end

    local function end_of_book()
        readerui.paging:onGotoPage(readerui.document:getPageCount())
        readerui:handleEvent(Event:new("GotoViewRel", 1))
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
        for _, widget in ipairs(shown) do
            if widget ~= readerui and is_stacked(widget) then
                UIManager:close(widget)
            end
        end
        if readerui then
            readerui.doc_settings:delSetting("komanga_chapter_id")
            readerui.doc_settings:delSetting("komanga_manga_id")
            readerui:onClose()
            readerui = nil
        end
        UIManager.show = orig_show
        DocSettings:open(sample_pdf):purge()
        prompt = nil
    end)

    teardown(function()
        if old_end_document_action == nil then
            G_reader_settings:delSetting("end_document_action")
        else
            G_reader_settings:saveSetting(
                "end_document_action", old_end_document_action)
        end
    end)

    it("plugin-position onEndOfBook returning true cannot pre-empt ReaderStatus", function()
        open_reader(nil)
        local probe_called = false
        local EventListener = require("ui/widget/eventlistener")
        readerui:registerModule("kom160probe", EventListener:new{
            onEndOfBook = function()
                probe_called = true
                return true
            end,
        })
        end_of_book()
        assert.is_true(probe_called)
        assert.truthy(shown_by_name("end_document"),
            "ReaderStatus dialog expected despite the probe consuming the event")
    end)

    it("middle chapter: paging past the end offers the next chapter, not the default dialog", function()
        open_reader({ chapter_id = "c2", manga_id = "m7" })
        make_prompt{ getManga = manga_details }
        assert.are.equal("getManga", api_calls[1].method)
        assert.are.equal("m7", api_calls[1].args[1])

        end_of_book()

        local confirm = shown_confirm("Continue")
        assert.truthy(confirm, "next-chapter ConfirmBox not shown")
        assert.are.equal("Chapter finished. Continue to Chapter 3?", confirm.text)
        assert.is_nil(shown_by_name("end_document"))
    end)

    it("falls back to the chapter title when chapterNumber is missing", function()
        open_reader({ chapter_id = "c2", manga_id = "m7" })
        make_prompt{ getManga = function()
            local details = manga_details()
            details.chapters[3] = { id = "c3", name = "Extra: Omake" }
            return details
        end }

        end_of_book()

        local confirm = shown_confirm("Continue")
        assert.truthy(confirm)
        assert.are.equal("Chapter finished. Continue to Extra: Omake?", confirm.text)
    end)

    it("Continue opens the next chapter through the launcher with the details-open contract", function()
        open_reader({ chapter_id = "c2", manga_id = "m7" })
        local fetched = {}
        make_prompt{
            getManga = manga_details,
            readChapterCbzToFile = function(chapter_id, dest_path)
                fetched.chapter_id = chapter_id
                fetched.path = dest_path
                local f = assert(io.open(dest_path, "w"))
                f:write("stub cbz")
                f:close()
                return dest_path
            end,
        }
        end_of_book()
        local confirm = shown_confirm("Continue")
        assert.truthy(confirm)

        confirm.ok_callback()

        assert.are.equal("c3", fetched.chapter_id)
        assert.truthy(fetched.path:find("%.cbz$"))
        assert.are.same({ fetched.path }, opened_paths)
        local sidecar = DocSettings:open(fetched.path)
        assert.are.equal("c3", sidecar:readSetting("komanga_chapter_id"))
        assert.are.equal("m7", sidecar:readSetting("komanga_manga_id"))
        assert.are.equal("Berserk", sidecar:readSetting("komanga_title"))
        assert.are.equal(3, sidecar:readSetting("komanga_chapter_number"))
        assert.are.equal("rtl", sidecar:readSetting("komanga_direction"))
        assert.is_true(sidecar:readSetting("inverse_reading_order"))
        assert.are.equal("page", sidecar:readSetting("zoom_mode"))
        assert.are.equal(0, sidecar:readSetting("kopt_page_scroll"))
        os.remove(fetched.path)
        sidecar:purge()
    end)

    it("Cancel stays put and paging past the end again re-offers", function()
        open_reader({ chapter_id = "c2", manga_id = "m7" })
        make_prompt{ getManga = manga_details }
        end_of_book()
        local confirm = shown_confirm("Continue")
        assert.truthy(confirm)
        local last_page = readerui.paging.current_page

        confirm.cancel_callback()
        UIManager:close(confirm)

        assert.are.equal(last_page, readerui.paging.current_page)
        assert.are.same({}, opened_paths)
        shown = {}
        end_of_book()
        assert.truthy(shown_confirm("Continue"), "popup should re-offer after Cancel")
        assert.is_nil(shown_by_name("end_document"))
    end)

    it("a second EndOfBook while the popup is up does not stack a duplicate", function()
        open_reader({ chapter_id = "c2", manga_id = "m7" })
        make_prompt{ getManga = manga_details }
        end_of_book()
        assert.truthy(shown_confirm("Continue"))

        end_of_book()

        local count = 0
        for _, widget in ipairs(shown) do
            if widget.ok_text == "Continue" then
                count = count + 1
            end
        end
        assert.are.equal(1, count)
        assert.is_nil(shown_by_name("end_document"))
    end)

    it("a failed CBZ fetch after Continue surfaces Retry and keeps the document", function()
        open_reader({ chapter_id = "c2", manga_id = "m7" })
        make_prompt{
            getManga = manga_details,
            readChapterCbzToFile = function()
                return nil, { kind = "transport", message = "wifi asleep" }
            end,
        }
        end_of_book()
        local confirm = shown_confirm("Continue")
        assert.truthy(confirm)

        confirm.ok_callback()

        assert.are.same({}, opened_paths)
        assert.truthy(shown_confirm("Retry"), "Retry dialog expected on a failed fetch")
    end)

    it("last chapter: the default end-of-document dialog runs", function()
        open_reader({ chapter_id = "c3", manga_id = "m7" })
        make_prompt{ getManga = manga_details }

        end_of_book()

        assert.is_nil(shown_confirm("Continue"))
        assert.truthy(shown_by_name("end_document"))
    end)

    it("failed resolution: silent, and the default dialog runs", function()
        open_reader({ chapter_id = "c2", manga_id = "m7" })
        make_prompt{ getManga = function()
            return nil, { kind = "http", status = 500, code = "INTERNAL" }
        end }

        end_of_book()

        assert.is_nil(shown_confirm("Continue"))
        assert.truthy(shown_by_name("end_document"))
    end)

    it("Continue swaps documents cleanly through the real showReader", function()
        open_reader({ chapter_id = "c2", manga_id = "m7" })
        local old_doc_closed = false
        local EventListener = require("ui/widget/eventlistener")
        readerui:registerModule("kom160close_probe", EventListener:new{
            onCloseDocument = function()
                old_doc_closed = true
            end,
        })
        local fetched = {}
        make_prompt{
            getManga = manga_details,
            readChapterCbzToFile = function(_, dest_path)
                fetched.path = dest_path
                local src = assert(io.open(fixture_cbz, "rb"))
                local bytes = src:read("*a")
                src:close()
                local dst = assert(io.open(dest_path, "wb"))
                dst:write(bytes)
                dst:close()
                return dest_path
            end,
        }
        end_of_book()
        local confirm = shown_confirm("Continue")
        assert.truthy(confirm)
        ReaderUI.showReader = orig_show_reader
        -- The swap closes (and flushes) the old document; scrub its sidecar now
        -- so sample.pdf doesn't leak KoManga keys into later tests.
        readerui.doc_settings:delSetting("komanga_chapter_id")
        readerui.doc_settings:delSetting("komanga_manga_id")

        confirm.ok_callback()
        UIManager:close(confirm)
        fastforward_ui_events()

        local new_instance = ReaderUI.instance
        assert.truthy(new_instance, "a ReaderUI instance should be running after the swap")
        assert.are_not.equal(readerui, new_instance)
        assert.is_true(old_doc_closed, "the old document must close (onCloseDocument)")
        assert.are.equal(fetched.path, new_instance.document.file)
        assert.are.equal(3, new_instance.document:getPageCount())
        assert.are.equal("c3", new_instance.doc_settings:readSetting("komanga_chapter_id"))
        assert.is_true(new_instance.doc_settings:readSetting("inverse_reading_order"))
        assert.are.equal("page", new_instance.doc_settings:readSetting("zoom_mode"))
        -- Hand the new instance to after_each (the old one is already closed) and
        -- drop the spy list so after_each doesn't UIManager:close the new reader
        -- a second time (its onClose does that itself).
        readerui = new_instance
        shown = {}
        os.remove(fetched.path)
    end)

    it("non-KoManga document: inert, the default dialog runs", function()
        open_reader(nil)
        make_prompt{ getManga = manga_details }

        end_of_book()

        assert.are.same({}, api_calls)
        assert.is_nil(shown_confirm("Continue"))
        assert.truthy(shown_by_name("end_document"))
    end)
end)
