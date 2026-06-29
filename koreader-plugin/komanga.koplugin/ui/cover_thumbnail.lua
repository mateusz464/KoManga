-- KRP-406 — Cover thumbnail (UI). Turns the raw `eink` cover bytes that
-- state/covers.lua fetched (KRP-406) into a KOReader widget the menu rows can show,
-- leaning on KOReader's own image stack (CLAUDE.md §7: never hand-roll rendering):
-- RenderImage decodes the bytes into a BlitBuffer and ImageWidget scales it to the
-- row's cover slot. Decoding is wrapped so a corrupt or unexpected payload degrades
-- to text (returns nil) rather than blanking or breaking the row (KRP-406
-- acceptance). Final cover dimensions are tuned on-device (KRP-701, [DEVICE]) — the
-- caller passes the slot size.
local ImageWidget = require("ui/widget/imagewidget")
local RenderImage = require("ui/renderimage")

local CoverThumbnail = {}

-- Build a best-fit, aspect-preserving thumbnail widget from cover bytes, sized to
-- fit width×height. Returns nil when bytes are absent or won't decode, which is the
-- caller's signal to render text instead (degrade to text, never a broken row).
function CoverThumbnail.build(bytes, width, height)
    if not bytes or bytes == "" then
        return nil
    end
    local ok, bb = pcall(function()
        return RenderImage:renderImageData(bytes, #bytes)
    end)
    if not ok or not bb then
        return nil
    end
    return ImageWidget:new{
        image = bb,
        image_disposable = true, -- ImageWidget owns the BlitBuffer; freed with the widget
        width = width,
        height = height,
        scale_factor = 0, -- scale to best-fit width/height, keeping aspect ratio
    }
end

return CoverThumbnail
