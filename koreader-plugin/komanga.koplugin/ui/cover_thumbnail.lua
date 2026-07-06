-- Turns raw cover bytes into a KOReader ImageWidget (RenderImage decodes, ImageWidget
-- scales). Decoding is wrapped so a corrupt payload degrades to text (nil).
local ImageWidget = require("ui/widget/imagewidget")
local RenderImage = require("ui/renderimage")

local CoverThumbnail = {}

-- Returns nil when bytes are absent or won't decode — the caller's signal to render text.
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
