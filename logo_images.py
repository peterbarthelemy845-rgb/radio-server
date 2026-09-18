"""Small circular station logos suitable for the radio display."""
from io import BytesIO
from PIL import Image, ImageOps, ImageDraw


def device_logo(raw):
    with Image.open(BytesIO(raw)) as source:
        if source.width * source.height > 20_000_000:
            raise ValueError('Image dimensions are too large')
        image = ImageOps.fit(ImageOps.exif_transpose(source).convert('RGBA'), (128, 128), method=Image.Resampling.LANCZOS)
    mask = Image.new('L', (512, 512))
    ImageDraw.Draw(mask).ellipse((0, 0, 511, 511), fill=255)
    from PIL import ImageChops
    image.putalpha(ImageChops.multiply(image.getchannel('A'), mask.resize((128, 128), Image.Resampling.LANCZOS)))
    output = BytesIO()
    image.save(output, format='PNG', optimize=True)
    return output.getvalue()
