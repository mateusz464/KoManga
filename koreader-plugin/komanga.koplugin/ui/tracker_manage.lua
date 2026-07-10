local ButtonDialog = require("ui/widget/buttondialog")
local ConfirmBox = require("ui/widget/confirmbox")
local Font = require("ui/font")
local InfoMessage = require("ui/widget/infomessage")
local TextBoxWidget = require("ui/widget/textboxwidget")
local UIManager = require("ui/uimanager")
local VerticalSpan = require("ui/widget/verticalspan")
local Retry = require("ui/retry")
local _ = require("gettext")

local TrackerManage = {}
TrackerManage.__index = TrackerManage

function TrackerManage:new(opts)
    return setmetatable({
        account = opts.account,
        net = opts.net,
        auth = opts.auth,
        on_unlinked = opts.on_unlinked,
        dialog = nil,
        closed = false,
    }, self)
end

function TrackerManage:start()
    self.closed = false
    self:render()
end

function TrackerManage:close()
    self.closed = true
    if self.dialog then
        UIManager:close(self.dialog)
        self.dialog = nil
    end
end

function TrackerManage:textWidget(text, width)
    return TextBoxWidget:new{
        text = text,
        width = width,
        alignment = "center",
        face = Font:getFace("infofont"),
    }
end

function TrackerManage:render()
    if self.closed then
        return
    end
    if self.dialog then
        UIManager:close(self.dialog)
    end

    local linked = self.account:getAccount()
    local username = linked and linked.username or _("Unknown")
    self.dialog = ButtonDialog:new{
        title = _("Manage AniList"),
        title_align = "center",
        dismissable = false,
        buttons = {
            {
                { text = _("Unlink"), callback = function() self:confirmUnlink() end },
                { text = _("Close"), callback = function() self:close() end },
            },
        },
    }
    local width = self.dialog:getAddedWidgetAvailableWidth()
    self.dialog:addWidget(self:textWidget(_("Linked account: ") .. username, width))
    self.dialog:addWidget(VerticalSpan:new{ width = 12 })
    UIManager:show(self.dialog, "flashui")
end

function TrackerManage:confirmUnlink()
    UIManager:show(ConfirmBox:new{
        text = _("Unlink this AniList account?"),
        ok_text = _("Unlink"),
        ok_callback = function()
            self:unlink()
        end,
    })
end

function TrackerManage:unlink()
    Retry.run{
        net = self.net,
        auth = self.auth,
        text = _("Unlinking AniList…"),
        task = function()
            return self.account:fetchUnlink()
        end,
        on_success = function(data)
            self.account:applyUnlink(data, nil)
            self:close()
            UIManager:show(InfoMessage:new{ text = _("AniList unlinked.") })
            if self.on_unlinked then
                self.on_unlinked()
            end
        end,
    }
end

return TrackerManage
