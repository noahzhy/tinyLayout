"""Decode saved synthetic instance PNGs to their original bottom-up RGBA bytes."""
import argparse
import json
from pathlib import Path
import sys
from PIL import Image


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,required=True)
    args=parser.parse_args();root=args.root.resolve()
    packet=json.load(sys.stdin)
    if set(packet)!={'paths','width','height'} or any(type(packet[k]) is not int or packet[k]<=0 for k in ('width','height')):
        raise ValueError('instance decoder requires explicit positive integer sensor dimensions')
    for index,name in enumerate(packet['paths']):
        path=(root/name).resolve();path.relative_to(root)
        with Image.open(path) as source:
            source.load()
            if source.mode not in {'RGB','RGBA'} or source.size!=(packet['width'],packet['height']):
                raise ValueError(f'{index}/{name}: instance PNG type/shape differs')
            image=source.convert('RGBA')
            if image.getchannel('A').getextrema()!=(255,255):
                raise ValueError(f'{index}/{name}: instance PNG has nonopaque alpha')
            data=image.transpose(Image.Transpose.FLIP_TOP_BOTTOM).tobytes()
        sys.stdout.buffer.write(data);sys.stdout.buffer.flush()


if __name__=='__main__':main()
