-- Tracked KOM-160 live-stack check (not shipped, needs the local KoManga API
-- running): same flow as komanga_next_chapter_kom160_spec.lua but with the REAL
-- ApiClient against the real server — One Piece (manga 40, RTL), chapter 1
-- (id 41) → next chapter 2 (id 42). Continue downloads the real eink CBZ through
-- ReaderLauncher and swaps documents through the real ReaderUI:showReader.
-- Skipped silently when the API is unreachable.
describe("KoManga next-chapter prompt live stack (KOM-160)", function()
    local sample_pdf = "spec/front/unit/data/sample.pdf"
    local BASE_URL = "http://127.0.0.1:3000"
    local CREDENTIAL = "komanga-local-dev"
    local MANGA_ID = "40"
    local CHAPTER_ID = "41"
    local NEXT_CHAPTER_ID = "42"

    local DocumentRegistry, ReaderUI, Screen, Event, UIManager
    local NextChapterPrompt, api
    local readerui, shown, orig_show

    local fake_net = {
        run = function(_, task, opts)
            opts = opts or {}
            local data, err = task()
            if opts.on_result then
                opts.on_result(data, err)
            end
        end,
    }

    setup(function()
        require("commonrequire")
        disable_plugins()
        DocumentRegistry = require("document/documentregistry")
        ReaderUI = require("apps/reader/readerui")
        Screen = require("device").screen
        Event = require("ui/event")
        UIManager = require("ui/uimanager")
        local plugin_root = os.getenv("KOMANGA_PLUGIN_ROOT")
        assert.truthy(plugin_root, "KOMANGA_PLUGIN_ROOT must point at komanga.koplugin")
        package.path = plugin_root .. "/?.lua;" .. package.path
        NextChapterPrompt = require("ui/next_chapter_prompt")
        local ApiClient = require("api/client")
        api = ApiClient.new{
            base_url = BASE_URL,
            get_credential = function() return CREDENTIAL end,
        }
        G_reader_settings:saveSetting("end_document_action", "pop-up")
    end)

    it("offers, downloads and swaps into the real next chapter", function()
        local details, err = api:getManga(MANGA_ID)
        if not details then
            pending("KoManga API not reachable at " .. BASE_URL .. ": "
                .. tostring(err and err.kind))
            return
        end
        assert.are.equal("rtl", details.readingDirection)

        readerui = ReaderUI:new{
            dimen = Screen:getSize(),
            document = DocumentRegistry:openDocument(sample_pdf),
        }
        readerui:handleEvent(Event:new("SetScrollMode", false))
        readerui.zooming:setZoomMode("page")
        readerui.doc_settings:saveSetting("komanga_chapter_id", CHAPTER_ID)
        readerui.doc_settings:saveSetting("komanga_manga_id", MANGA_ID)

        shown = {}
        orig_show = UIManager.show
        UIManager.show = function(self, widget, ...)
            table.insert(shown, widget)
            return orig_show(self, widget, ...)
        end

        local prompt = NextChapterPrompt.new{
            ui = readerui,
            net = fake_net,
            api = api,
        }
        prompt:onReaderReady(readerui.doc_settings)

        readerui.paging:onGotoPage(readerui.document:getPageCount())
        readerui:handleEvent(Event:new("GotoViewRel", 1))

        local confirm
        for _, widget in ipairs(shown) do
            if widget.ok_text == "Continue" then
                confirm = widget
            end
        end
        assert.truthy(confirm, "next-chapter ConfirmBox not shown")
        assert.are.equal("Chapter finished. Continue to Chapter 2?", confirm.text)

        -- Scrub sample.pdf's sidecar before the swap flushes it.
        readerui.doc_settings:delSetting("komanga_chapter_id")
        readerui.doc_settings:delSetting("komanga_manga_id")

        confirm.ok_callback()
        UIManager:close(confirm)
        fastforward_ui_events()

        local new_instance = ReaderUI.instance
        assert.truthy(new_instance)
        assert.are_not.equal(readerui, new_instance)
        assert.truthy(new_instance.document.file:find("%.cbz$"))
        assert.is_true(new_instance.document:getPageCount() > 0)
        assert.are.equal(NEXT_CHAPTER_ID,
            new_instance.doc_settings:readSetting("komanga_chapter_id"))
        assert.are.equal(MANGA_ID,
            new_instance.doc_settings:readSetting("komanga_manga_id"))
        assert.are.equal("rtl", new_instance.doc_settings:readSetting("komanga_direction"))
        assert.is_true(new_instance.doc_settings:readSetting("inverse_reading_order"))
        assert.are.equal("page", new_instance.doc_settings:readSetting("zoom_mode"))
        assert.are.equal(1, new_instance.paging.current_page)

        UIManager.show = orig_show
        local cbz_path = new_instance.document.file
        new_instance:closeDocument()
        new_instance:onClose()
        os.remove(cbz_path)
        readerui = nil
    end)

    after_each(function()
        if orig_show then
            UIManager.show = orig_show
        end
        if readerui then
            readerui.doc_settings:delSetting("komanga_chapter_id")
            readerui.doc_settings:delSetting("komanga_manga_id")
            readerui:closeDocument()
            readerui:onClose()
            readerui = nil
        end
    end)
end)
