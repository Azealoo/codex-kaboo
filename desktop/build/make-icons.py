#!/usr/bin/env python3
"""Draws codex-kaboo's app and tray icons.

The mark is three rising bars — a usage chart, which is what the product is — with the tallest one
in the brand green (#008300) on the app icon. Tray icons are black-on-transparent TEMPLATE images:
macOS recolours them itself for light, dark and the highlighted menu bar, and a coloured tray icon
would look wrong in at least one of those.

Regenerate with `python3 desktop/build/make-icons.py`. The outputs are committed, so a build never
needs Python or Pillow — this exists so the mark can be changed without redrawing it by hand.
"""

from __future__ import annotations

import pathlib
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw

HERE = pathlib.Path(__file__).parent
# Runtime images (the tray) ship inside the app; the icons electron-builder consumes stay here.
ASSETS = HERE.parent / "assets"
GREEN = (0, 131, 0, 255)
DARK = (17, 24, 39, 255)


def draw_mark(size: int, colours: list[tuple[int, int, int, int]], padding: float) -> Image.Image:
    """Three bars of rising height, centred in a square canvas."""
    scale = 8  # supersample, then downscale: crisp edges at 16 px without hinting by hand
    canvas = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    box = size * scale
    pad = box * padding
    inner = box - 2 * pad
    gap = inner * 0.14
    width = (inner - 2 * gap) / 3
    radius = width * 0.32
    heights = (0.42, 0.68, 1.0)

    for index, fraction in enumerate(heights):
        left = pad + index * (width + gap)
        height = inner * fraction
        top = pad + inner - height
        draw.rounded_rectangle(
            (left, top, left + width, pad + inner),
            radius=radius,
            fill=colours[index % len(colours)],
        )
    return canvas.resize((size, size), Image.LANCZOS)


def write_tray(size: int, name: str) -> None:
    """Template image: pure black, alpha carries the shape."""
    draw_mark(size, [(0, 0, 0, 255)], padding=0.09).save(ASSETS / name)


def write_app(size: int, path: pathlib.Path) -> None:
    draw_mark(size, [DARK, DARK, GREEN], padding=0.16).save(path)


def main() -> None:
    ASSETS.mkdir(exist_ok=True)
    # macOS menu bar: 16 pt, with an @2x for Retina. Electron picks the @2x automatically.
    write_tray(16, "trayTemplate.png")
    write_tray(32, "trayTemplate@2x.png")
    # Linux tray icons are not templates and are drawn at 22 px on most panels.
    draw_mark(22, [DARK, DARK, GREEN], padding=0.09).save(ASSETS / "tray-linux.png")
    draw_mark(44, [DARK, DARK, GREEN], padding=0.09).save(ASSETS / "tray-linux@2x.png")

    write_app(512, HERE / "icon.png")

    with tempfile.TemporaryDirectory() as tmp:
        iconset = pathlib.Path(tmp) / "icon.iconset"
        iconset.mkdir()
        for size in (16, 32, 64, 128, 256, 512, 1024):
            write_app(size, iconset / f"icon_{size}x{size}.png")
            if size <= 512:
                write_app(size * 2, iconset / f"icon_{size}x{size}@2x.png")
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(HERE / "icon.icns")], check=True
        )

    # .ico for Windows: the sizes the shell actually asks for.
    frames = [draw_mark(size, [DARK, DARK, GREEN], padding=0.16) for size in (16, 24, 32, 48, 256)]
    frames[-1].save(HERE / "icon.ico", sizes=[(f.width, f.height) for f in frames])
    # The Windows tray reads the same .ico the installer does.
    shutil.copy(HERE / "icon.ico", ASSETS / "icon.ico")

    written = sorted(p.name for p in [*HERE.glob("icon.*"), *ASSETS.glob("*")])
    print("wrote", ", ".join(written))


if __name__ == "__main__":
    main()
