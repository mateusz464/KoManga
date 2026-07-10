-- QR-specific image decoder. Unlike covers, the QR endpoint is contracted as PNG;
-- reject other payloads so KOReader never falls through to its SVG renderer.
local ImageWidget = require("ui/widget/imagewidget")
local RenderImage = require("ui/renderimage")

local QrImage = {}

local PNG_SIGNATURE = "\137PNG\r\n\26\n"

function QrImage.build(bytes, width, height)
    if not bytes or bytes == "" then
        return nil, nil
    end
    if bytes:sub(1, #PNG_SIGNATURE) ~= PNG_SIGNATURE then
        return nil, { kind = "image" }
    end
    local ok, bb = pcall(function()
        return RenderImage:renderImageData(bytes, #bytes, false, width, height)
    end)
    if not ok or not bb then
        return nil, { kind = "image" }
    end
    return ImageWidget:new{
        image = bb,
        image_disposable = true,
        width = width,
        height = height,
        scale_factor = 0,
    }, nil
end

return QrImage
