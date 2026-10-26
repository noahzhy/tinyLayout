"""Generator sensor-pass decoding; no model dependencies."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from PIL import Image


class InstancePassDecoderTest(unittest.TestCase):
    def run_decoder(self,root,packet):
        script=Path(__file__).resolve().parents[1]/'scripts/decode_instance_passes.py'
        return subprocess.run([sys.executable,str(script),'--root',str(root)],input=json.dumps(packet).encode(),capture_output=True)

    def test_original_bottom_up_byte_order(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);image=Image.new('RGBA',(2,2))
            image.putdata([(1,0,0,255),(2,0,0,255),(3,0,0,255),(4,0,0,255)]);image.save(root/'ids.png')
            result=self.run_decoder(root,dict(paths=['ids.png'],width=2,height=2))
            self.assertEqual(result.returncode,0)
            self.assertEqual(list(result.stdout[::4]),[3,4,1,2])

    def test_invalid_passes_produce_no_bytes(self):
        for failure in ('outside','size','alpha'):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as directory:
                base=Path(directory);root=base/'root';root.mkdir();image=Image.new('RGBA',(2,2),(1,0,0,255))
                if failure=='alpha':image.putpixel((0,0),(1,0,0,0))
                name='../ids.png' if failure=='outside' else 'ids.png'
                image.save(base/'ids.png' if failure=='outside' else root/'ids.png')
                result=self.run_decoder(root,dict(paths=[name],width=3 if failure=='size' else 2,height=2))
                self.assertNotEqual(result.returncode,0)
                self.assertEqual(result.stdout,b'')


if __name__=='__main__':unittest.main()
