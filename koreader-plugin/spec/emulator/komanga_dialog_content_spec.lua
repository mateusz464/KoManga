-- Headless verification for the KoManga AniList dialog blank-body bug.
-- ButtonDialog:addWidget reinit()s the dialog and frees earlier parentless
-- widgets, so text added across multiple addWidget calls repaints blank.
-- The fix composes all content into ONE VerticalGroup added once.
describe("KoManga ButtonDialog added-widget rendering", function()
    local ButtonDialog, TextBoxWidget, VerticalGroup, VerticalSpan, Font
    local Blitbuffer, Screen

    setup(function()
        require("commonrequire")
        ButtonDialog = require("ui/widget/buttondialog")
        TextBoxWidget = require("ui/widget/textboxwidget")
        VerticalGroup = require("ui/widget/verticalgroup")
        VerticalSpan = require("ui/widget/verticalspan")
        Font = require("ui/font")
        Blitbuffer = require("ffi/blitbuffer")
        Screen = require("device").screen
    end)

    local function textWidget(text, width)
        return TextBoxWidget:new{
            text = text,
            width = width,
            alignment = "center",
            face = Font:getFace("infofont"),
        }
    end

    local function newDialog()
        return ButtonDialog:new{
            title = "Manage AniList",
            title_align = "center",
            dismissable = false,
            buttons = {
                {
                    { text = "Unlink", callback = function() end },
                    { text = "Close", callback = function() end },
                },
            },
        }
    end

    local function darkPixels(dialog)
        local bb = Blitbuffer.new(Screen:getWidth(), Screen:getHeight())
        bb:fill(Blitbuffer.COLOR_WHITE)
        dialog:paintTo(bb, 0, 0)
        local count = 0
        for y = 0, bb:getHeight() - 1, 2 do
            for x = 0, bb:getWidth() - 1, 2 do
                if bb:getPixel(x, y):getColor8().a < 128 then
                    count = count + 1
                end
            end
        end
        return count
    end

    it("renders body text when added as one VerticalGroup (the fix)", function()
        local baseline = newDialog()
        local base_pixels = darkPixels(baseline)
        baseline:free()

        local dialog = newDialog()
        local width = dialog:getAddedWidgetAvailableWidth()
        dialog:addWidget(VerticalGroup:new{
            textWidget("Linked account: mateusz", width),
            VerticalSpan:new{ width = 12 },
        })
        local pixels = darkPixels(dialog)
        dialog:free()

        assert.is_true(pixels > base_pixels * 1.1,
            ("expected body text to add dark pixels: base=%d fixed=%d")
                :format(base_pixels, pixels))
    end)

    it("renders multi-line content added as one VerticalGroup", function()
        local baseline = newDialog()
        local base_pixels = darkPixels(baseline)
        baseline:free()

        local dialog = newDialog()
        local width = dialog:getAddedWidgetAvailableWidth()
        local content = VerticalGroup:new{}
        for _, line in ipairs({
            "AniList linked: mateusz",
            "You can close this screen.",
        }) do
            table.insert(content, textWidget(line, width))
            table.insert(content, VerticalSpan:new{ width = 12 })
        end
        dialog:addWidget(content)
        local pixels = darkPixels(dialog)
        dialog:free()

        assert.is_true(pixels > base_pixels * 1.1,
            ("expected linked-body text to add dark pixels: base=%d fixed=%d")
                :format(base_pixels, pixels))
    end)

    it("documents the bug: text across multiple addWidget calls goes blank", function()
        local dialog = newDialog()
        local width = dialog:getAddedWidgetAvailableWidth()
        local group_dialog = newDialog()
        group_dialog:addWidget(VerticalGroup:new{
            textWidget("Linked account: mateusz", width),
            VerticalSpan:new{ width = 12 },
        })
        local fixed_pixels = darkPixels(group_dialog)
        group_dialog:free()

        dialog:addWidget(textWidget("Linked account: mateusz", width))
        dialog:addWidget(VerticalSpan:new{ width = 12 })
        local buggy_pixels = darkPixels(dialog)
        dialog:free()

        assert.is_true(buggy_pixels < fixed_pixels,
            ("expected multi-addWidget text to render blank: buggy=%d fixed=%d")
                :format(buggy_pixels, fixed_pixels))
    end)
end)
