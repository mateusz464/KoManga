-- KOM-172: when Browse is closed after a source's mode was picked but before a
-- manga was opened for reading, re-open that source's mode picker instead of
-- losing the user's place. Lives on the persistent Komanga instance because the
-- SourceBrowser widget (and its Browse state) is rebuilt on every open — the same
-- reason ui/return_to_details.lua outlives the reader. The return is one-shot:
-- onBrowseClosed consumes the selection, and picking a mode again re-arms it.
local ReturnToBrowse = {}
ReturnToBrowse.__index = ReturnToBrowse

function ReturnToBrowse.new(opts)
    return setmetatable({
        ui_manager = opts.ui_manager,
        show_browse_options = opts.show_browse_options,
        source = nil,
        reading = false,
    }, ReturnToBrowse)
end

function ReturnToBrowse:onBrowseOpened()
    self.source = nil
    self.reading = false
end

function ReturnToBrowse:setSelection(source)
    self.source = source
end

-- Once the reader hand-off starts, KOM-162's return-to-details owns the way back;
-- suppress this return so the two never double-fire.
function ReturnToBrowse:setReading()
    self.reading = true
end

function ReturnToBrowse:onBrowseClosed()
    local source = self.source
    self.source = nil
    if source and not self.reading then
        self.ui_manager:scheduleIn(0, function()
            self.show_browse_options(source)
        end)
    end
end

return ReturnToBrowse
