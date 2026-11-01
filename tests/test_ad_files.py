import io, unittest
from PIL import Image, PngImagePlugin
from station_ads import normalized_ad

class AdFileTests(unittest.TestCase):
    def encoded(self, kind='PNG', **kwargs):
        out=io.BytesIO();Image.new('RGB',(50,30),'blue').save(out,format=kind,**kwargs);return out.getvalue()

    def test_only_pixels_survive_metadata_and_appended_payload(self):
        metadata=PngImagePlugin.PngInfo();metadata.add_text('Comment','untrusted metadata')
        original=self.encoded(pnginfo=metadata)+b'UNTRUSTED-APPENDED-CONTENT'
        image=normalized_ad(original,'image.png')
        self.assertEqual(image.size,(768,228));self.assertEqual(image.mode,'RGB');self.assertFalse(image.info)
        out=io.BytesIO();image.save(out,format='PNG')
        self.assertNotIn(b'UNTRUSTED',out.getvalue());self.assertNotIn(b'untrusted metadata',out.getvalue())
        with Image.open(io.BytesIO(out.getvalue())) as rebuilt:rebuilt.verify()

    def test_executables_archives_svg_and_disguised_files_rejected(self):
        for raw,name in ((b'MZ-not-an-image','image.png'),(b'PK-not-an-image','file.png'),
                         (b'<svg><script/></svg>','image.svg'),(self.encoded(),'image.exe'),
                         (self.encoded(),'image.jpg'),(self.encoded()[:35],'image.png')):
            with self.subTest(name=name),self.assertRaises(ValueError):normalized_ad(raw,name)

    def test_still_jpeg_png_webp_accepted_and_limits_enforced(self):
        for kind,extension in (('JPEG','jpg'),('PNG','png'),('WEBP','webp')):
            self.assertEqual(normalized_ad(self.encoded(kind),'image.'+extension).size,(768,228))
        with self.assertRaises(ValueError):normalized_ad(b'x'*(3*1024*1024+1),'image.png')
        out=io.BytesIO();Image.new('RGB',(2100,2000)).save(out,format='PNG')
        with self.assertRaises(ValueError):normalized_ad(out.getvalue(),'image.png')

    def test_animated_png_is_rejected(self):
        out=io.BytesIO();first=Image.new('RGB',(10,10),'red');second=Image.new('RGB',(10,10),'blue')
        first.save(out,format='PNG',save_all=True,append_images=[second],duration=100,loop=0)
        with self.assertRaises(ValueError):normalized_ad(out.getvalue(),'image.png')
