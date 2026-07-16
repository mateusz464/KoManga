describe("KoManga source mode picker", function()
    local SourceBrowser, UIManager

    setup(function()
        require("commonrequire")
        local root = assert(os.getenv("KOMANGA_PLUGIN_ROOT"))
        package.path = root .. "/?.lua;" .. root .. "/?/init.lua;" .. package.path
        SourceBrowser = require("ui.source_browser")
        UIManager = require("ui/uimanager")
    end)

    local function picker(source)
        local shown
        local old_show = UIManager.show
        UIManager.show = function(_, widget) shown = widget end
        SourceBrowser.promptMode({}, source)
        UIManager.show = old_show
        return shown
    end

    it("offers all four modes for a latest-capable source", function()
        local dialog = picker({ id = "one", name = "One", supportsLatest = true })
        assert.are.equal("Popular", dialog.buttons[1][1].text)
        assert.are.equal("Latest", dialog.buttons[1][2].text)
        assert.are.equal("Genres", dialog.buttons[2][1].text)
        assert.are.equal("Search", dialog.buttons[2][2].text)
        dialog:free()
    end)

    it("hides Latest when the source does not support it", function()
        local dialog = picker({ id = "legacy", supportsLatest = false })
        assert.are.equal(1, #dialog.buttons[1])
        assert.are.equal("Popular", dialog.buttons[1][1].text)
        dialog:free()
    end)
end)
