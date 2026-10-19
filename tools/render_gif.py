"""Renders docs/village.gif from the game's own frames.

Copies tools/scene.ts into tests/ for one run of `claude plugin test`, reads the frames it prints (each a base64
Raster: per cell a little-endian u32 triplet codepoint, foreground, background) and draws them into an animated GIF
inside a small terminal-window frame. Run from the repository root:

    python tools/render_gif.py
"""

import base64
import shutil
import struct
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
COLS, ROWS = 80, 20
CELL_W, CELL_H = 9, 18
FONT_SIZE = 15
FRAME_MS = 130
DEFAULT_FG, DEFAULT_BG = (0xE8, 0xE6, 0xE3), (0x1E, 0x1E, 0x1E)
FONTS = Path('C:/Windows/Fonts')

primary = ImageFont.truetype(str(FONTS / 'CascadiaMono.ttf'), FONT_SIZE)
fallback = ImageFont.truetype(str(FONTS / 'seguisym.ttf'), FONT_SIZE)
title_font = ImageFont.truetype(str(FONTS / 'CascadiaMono.ttf'), 13)


def glyph_bytes(font, ch):
    probe = Image.new('L', (32, 32))
    ImageDraw.Draw(probe).text((4, 4), ch, font=font, fill=255)
    return probe.tobytes()


PRIMARY_MISSING = glyph_bytes(primary, '\U000F0000')
glyph_font = {}


def font_for(ch):
    if ch not in glyph_font:
        has = glyph_bytes(primary, ch) != PRIMARY_MISSING
        glyph_font[ch] = primary if has else fallback
    return glyph_font[ch]


def color(value, default):
    if value == 0x01000000:
        return default
    return ((value >> 16) & 255, (value >> 8) & 255, value & 255)


def draw_block(draw, ch, x, y, fg):
    """Block elements drawn as exact rectangles, so roofs and shading line up pixel-perfect."""
    w, h = CELL_W, CELL_H
    rects = {
        '█': [(0, 0, w, h)], '▀': [(0, 0, w, h // 2)], '▄': [(0, h // 2, w, h)],
        '▌': [(0, 0, w // 2, h)], '▐': [(w // 2, 0, w, h)],
        '▗': [(w // 2, h // 2, w, h)], '▖': [(0, h // 2, w // 2, h)],
    }
    if ch in rects:
        for (x0, y0, x1, y1) in rects[ch]:
            draw.rectangle([x + x0, y + y0, x + x1 - 1, y + y1 - 1], fill=fg)
        return True
    if ch in '░▒':
        step = 2 if ch == '░' else 1
        for py in range(0, h, 2):
            for px in range((py // 2) % 2, w, 2 * step):
                draw.point((x + px, y + py), fill=fg)
        return True
    return False


def render(cells, caption):
    pad, bar, foot = 10, 26, 24
    width, height = COLS * CELL_W + 2 * pad, ROWS * CELL_H + bar + foot + pad
    img = Image.new('RGB', (width, height), (0x2B, 0x2B, 0x2B))
    draw = ImageDraw.Draw(img)
    # window chrome
    for i, c in enumerate([(0xFF, 0x5F, 0x57), (0xFE, 0xBC, 0x2E), (0x28, 0xC8, 0x40)]):
        draw.ellipse([12 + i * 18, 8, 22 + i * 18, 18], fill=c)
    draw.text((width // 2, 13), 'claude  ·  /village', font=title_font, fill=(0xB0, 0xB0, 0xB0), anchor='mm')
    ox, oy = pad, bar
    for r in range(ROWS):
        for c in range(COLS):
            k = (r * COLS + c) * 3
            cp, fgv, bgv = cells[k], cells[k + 1], cells[k + 2]
            x, y = ox + c * CELL_W, oy + r * CELL_H
            fg, bg = color(fgv, DEFAULT_FG), color(bgv, DEFAULT_BG)
            draw.rectangle([x, y, x + CELL_W - 1, y + CELL_H - 1], fill=bg)
            if cp in (0, 32):
                continue
            ch = chr(cp)
            if draw_block(draw, ch, x, y, fg):
                continue
            draw.text((x + CELL_W / 2, y + CELL_H / 2), ch, font=font_for(ch), fill=fg, anchor='mm')
    draw.text((width // 2, oy + ROWS * CELL_H + foot // 2 + 2), caption, font=title_font, fill=(0xE6, 0xC3, 0x4A), anchor='mm')
    return img


def main():
    temp = ROOT / 'tests' / 'zz_scene.test.ts'
    shutil.copy(ROOT / 'tools' / 'scene.ts', temp)
    try:
        run = subprocess.run('claude plugin test .', cwd=ROOT, shell=True, capture_output=True, text=True, encoding='utf-8')
    finally:
        temp.unlink(missing_ok=True)
    caption, frames = '', []
    # the test runner prints a test's console output on stderr
    for line in (run.stdout + '\n' + run.stderr).splitlines():
        if line.startswith('SCENE '):
            caption = line[6:]
        elif line.startswith('FRAME '):
            raw = base64.b64decode(line[6:])
            cells = struct.unpack(f'<{len(raw) // 4}I', raw)
            frames.append(render(cells, caption))
    if not frames:
        sys.exit('No frames recorded:\n' + run.stdout[-2000:] + run.stderr[-2000:])
    out = ROOT / 'docs' / 'village.gif'
    out.parent.mkdir(exist_ok=True)
    palette = [f.quantize(colors=255, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE) for f in frames]
    palette[0].save(out, save_all=True, append_images=palette[1:], duration=FRAME_MS, loop=0, optimize=True, disposal=1)
    print(f'{len(frames)} frames -> {out} ({out.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
