"""Compact rectangular station logos matching the Library card frame."""
from io import BytesIO
from PIL import Image, ImageOps


def device_logo(raw):
    with Image.open(BytesIO(raw)) as source:
        if source.width * source.height > 20_000_000:
            raise ValueError('Image dimensions are too large')
        image = ImageOps.contain(ImageOps.exif_transpose(source).convert('RGBA'), (400, 528), method=Image.Resampling.LANCZOS)
    frame = Image.new('RGBA', (400, 528), (0, 0, 0, 0))
    frame.paste(image, ((400 - image.width) // 2, (528 - image.height) // 2))
    output = BytesIO()
    frame.save(output, format='PNG', optimize=True)
    return output.getvalue()
