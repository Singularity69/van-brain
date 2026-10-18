"""Draw the app icons (no dependencies). Run: python tools/make-icons.py"""
import os
import struct
import zlib

BG = (11, 18, 32)
BODY = (226, 232, 240)
TUBE = (30, 41, 59)
BUBBLE = (34, 197, 94)
LINE = (148, 163, 184)


def png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(px[y * w * 3:(y + 1) * w * 3]) for y in range(h))
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(data)


def draw(size, pad):
    """pad: fraction of the canvas kept clear around the artwork (for maskable)."""
    px = bytearray(size * size * 3)
    s = size * (1 - 2 * pad) / 100.0  # artwork drawn on a 100x100 grid
    o = size * pad

    def inside_round_rect(x, y, x0, y0, x1, y1, r):
        cx = min(max(x, x0 + r), x1 - r)
        cy = min(max(y, y0 + r), y1 - r)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r and x0 <= x <= x1 and y0 <= y <= y1

    for j in range(size):
        for i in range(size):
            # 3x3 supersampling for smooth edges
            acc = [0, 0, 0]
            for sj in range(3):
                for si in range(3):
                    x = (i + (si + 0.5) / 3 - o) / s
                    y = (j + (sj + 0.5) / 3 - o) / s
                    c = BG
                    # caravan body
                    if inside_round_rect(x, y, 14, 30, 80, 70, 10):
                        c = BODY
                    # drawbar to the right
                    if 80 <= x <= 92 and abs(y - 60) <= 2.2:
                        c = BODY
                    if (x - 92) ** 2 + (y - 60) ** 2 <= 9:
                        c = BODY
                    # wheel
                    if (x - 47) ** 2 + (y - 72) ** 2 <= 64:
                        c = TUBE if (x - 47) ** 2 + (y - 72) ** 2 > 12 else LINE
                    # bubble-level tube on the side
                    if inside_round_rect(x, y, 22, 41, 72, 55, 7):
                        c = TUBE
                    if (x - 47) ** 2 + (y - 48) ** 2 <= 22:
                        c = BUBBLE
                    if abs(x - 40) <= 0.6 and 42 <= y <= 54 or abs(x - 54) <= 0.6 and 42 <= y <= 54:
                        c = LINE
                    acc = [a + b for a, b in zip(acc, c)]
            k = (j * size + i) * 3
            px[k:k + 3] = bytes(int(a / 9) for a in acc)
    return px


here = os.path.join(os.path.dirname(__file__), '..', 'icons')
os.makedirs(here, exist_ok=True)
for name, size, pad in [('icon-180.png', 180, 0.02), ('icon-192.png', 192, 0.02),
                        ('icon-512.png', 512, 0.02), ('icon-512-maskable.png', 512, 0.12)]:
    png(os.path.join(here, name), size, size, draw(size, pad))
    print('wrote', name)
