-- AniList account-linking screen: starts a server-side OAuth session, fetches
-- the protected QR PNG via net.lua, then polls until linked/expired.
local ButtonDialog = require("ui/widget/buttondialog")
local CenterContainer = require("ui/widget/container/centercontainer")
local Font = require("ui/font")
local Geom = require("ui/geometry")
local Screen = require("device").screen
local TextBoxWidget = require("ui/widget/textboxwidget")
local UIManager = require("ui/uimanager")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local QrImage = require("ui/qr_image")
local ErrorText = require("ui/errors")
local _ = require("gettext")

local QR_SIZE = math.floor(math.min(Screen:getWidth(), Screen:getHeight()) * 0.64)

local TrackerLinkView = {}
TrackerLinkView.__index = TrackerLinkView

function TrackerLinkView:new(opts)
    return setmetatable({
        link = opts.link,
        net = opts.net,
        auth = opts.auth,
        dialog = nil,
        closed = false,
    }, self)
end

function TrackerLinkView:handleError(err)
    if not err then
        return false
    end
    if err.kind == "cancelled" then
        return true
    end
    if self.auth and self.auth:handleError(err) then
        return true
    end
    return false
end

function TrackerLinkView:start()
    self.closed = false
    self:render()
    self:startSession()
end

function TrackerLinkView:startSession()
    self.net:run(function()
        return self.link:fetchStart()
    end, {
        text = _("Starting link session…"),
        on_result = function(data, err)
            if self.closed then
                return
            end
            local ok = self.link:applyStart(data, err)
            self:render()
            if ok then
                self:loadQr()
            else
                self:handleError(err)
            end
        end,
    })
end

function TrackerLinkView:loadQr()
    self.net:run(function()
        return self.link:fetchQr()
    end, {
        text = _("Loading QR code…"),
        on_result = function(bytes, err)
            if self.closed then
                return
            end
            self.link:applyQr(bytes, err)
            self:handleError(err)
            self:render()
        end,
    })
end

function TrackerLinkView:pollStatus()
    self.net:run(function()
        return self.link:fetchStatus()
    end, {
        background = true,
        on_result = function(data, err)
            if self.closed then
                return
            end
            self.link:applyStatus(data, err)
            self:handleError(err)
            self:render()
        end,
    })
end

function TrackerLinkView:retry()
    self.closed = false
    self:startSession()
end

function TrackerLinkView:close()
    self.closed = true
    self.link:cancel()
    self:closeDialog()
end

function TrackerLinkView:closeDialog()
    if self.dialog then
        UIManager:close(self.dialog)
        self.dialog = nil
    end
end

function TrackerLinkView:textWidget(text, width)
    return TextBoxWidget:new{
        text = text,
        width = width,
        alignment = "center",
        face = Font:getFace("infofont"),
    }
end

function TrackerLinkView:qrWidget(bytes, width)
    local qr, err = QrImage.build(bytes, QR_SIZE, QR_SIZE)
    if err then
        self.link:applyQr(nil, err)
    end
    if not qr then
        return nil
    end
    return CenterContainer:new{
        dimen = Geom:new{ w = width, h = QR_SIZE },
        qr,
    }
end

-- ButtonDialog:addWidget reinit()s the dialog, freeing earlier parentless
-- widgets so they repaint blank — all content must go in as ONE group.
function TrackerLinkView:addContent(dialog, lines, qr_bytes)
    local width = dialog:getAddedWidgetAvailableWidth()
    local qr = self:qrWidget(qr_bytes, width)
    local content = VerticalGroup:new{}
    for _, line in ipairs(lines) do
        table.insert(content, self:textWidget(line, width))
        table.insert(content, VerticalSpan:new{ width = 12 })
    end
    if qr then
        table.insert(content, qr)
        table.insert(content, VerticalSpan:new{ width = 12 })
    end
    dialog:addWidget(content)
end

function TrackerLinkView:showDialog(title, lines, buttons, qr_bytes)
    self:closeDialog()
    self.dialog = ButtonDialog:new{
        title = title,
        title_align = "center",
        dismissable = false,
        buttons = buttons,
    }
    self:addContent(self.dialog, lines, qr_bytes)
    UIManager:show(self.dialog, "flashui")
end

function TrackerLinkView:render()
    if self.closed then
        return
    end

    local status = self.link:getStatus()
    local err = self.link:getError()
    if status == "idle" then
        if err then
            self:showDialog(_("Link AniList"), {
                ErrorText.text(err),
            }, {
                {
                    { text = _("Retry"), callback = function() self:retry() end },
                    { text = _("Cancel"), callback = function() self:close() end },
                },
            })
        else
            self:showDialog(_("Link AniList"), {
                _("Starting AniList link…"),
            }, {
                { { text = _("Cancel"), callback = function() self:close() end } },
            })
        end
    elseif status == "pending" then
        local lines = {
            self.link:getQrBytes() and _("Scan this QR code with your phone.")
                or _("Loading QR code…"),
            _("Approve the AniList login on your phone. This screen updates automatically."),
        }
        if err then
            lines[#lines + 1] = ErrorText.text(err)
        end
        local buttons
        if err and not self.link:getQrBytes() then
            buttons = {
                {
                    { text = _("Retry QR"), callback = function() self:loadQr() end },
                    { text = _("Cancel"), callback = function() self:close() end },
                },
            }
        else
            buttons = {
                { { text = _("Cancel"), callback = function() self:close() end } },
            }
        end
        self:showDialog(_("Link AniList"), lines, buttons, self.link:getQrBytes())
    elseif status == "linked" then
        local account = self.link:getAccount()
        local line = account and account.username
            and _("AniList linked: ") .. account.username
            or _("AniList linked.")
        self:showDialog(_("AniList linked"), {
            line,
            _("You can close this screen."),
        }, {
            { { text = _("Close"), callback = function() self:close() end } },
        })
    elseif status == "expired" then
        self:showDialog(_("Link expired"), {
            _("This link session expired."),
        }, {
            {
                { text = _("Retry"), callback = function() self:retry() end },
                { text = _("Cancel"), callback = function() self:close() end },
            },
        })
    end
end

return TrackerLinkView
