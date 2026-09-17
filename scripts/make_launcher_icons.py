"""Home-screen icons, one per launcher.

Six identical PrismOS icons with different words under them is not a home screen
you can read at a glance — and glanceable is the entire reason for putting them
there. Each launcher gets its own artwork: the room's own accent colour, its own
mark, on the Prism near-black, with the gold hairline the app uses everywhere.

Drawn rather than photographed so they stay crisp at 192px and 512px, and kept
deliberately simple: at the size a home screen actually renders these, a detailed
glyph turns to mud.
"""
from PIL import Image, ImageDraw
import os

INK = (16, 13, 9)          # Prism warm near-black
GOLD = (203, 163, 92)

# room key -> (accent, mark). Accents are the room colours already in modes.js,
# so an icon on the home screen matches the room it opens.
LAUNCHERS = {
    'nerve':     ('#C9A84E', 'rings'),    # Nerve Center — your whole world
    'money':     ('#8FB8A8', 'bars'),     # Money — sage
    'prospect':  ('#C98A5E', 'target'),   # Prospecting — hunt
    'deals':     ('#B47EA8', 'flow'),     # Deals — pipeline
    'library':   ('#5EA9B8', 'book'),     # Library
    'brokerage': ('#9AA6C9', 'building'), # Brokerage
    'tasks':     ('#CBA35C', 'check'),    # Tasks
    'addexpense':('#8FB8A8', 'plus'),     # Add expense
}


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def draw_mark(d, kind, cx, cy, r, colour, w):
    if kind == 'rings':
        for k, rr in enumerate((r, r * 0.64, r * 0.3)):
            d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=colour, width=w if k else w + 2)
    elif kind == 'bars':
        # three rising bars: money is a trend, not a coin
        bw = r * 0.42
        for i, h in enumerate((0.55, 0.85, 1.15)):
            x = cx - r * 0.85 + i * (bw + r * 0.22)
            d.rounded_rectangle([x, cy + r * 0.55 - r * h, x + bw, cy + r * 0.55],
                                radius=bw * 0.28, fill=colour)
    elif kind == 'target':
        for k, rr in enumerate((r, r * 0.62)):
            d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=colour, width=w)
        d.ellipse([cx - r * 0.2, cy - r * 0.2, cx + r * 0.2, cy + r * 0.2], fill=colour)
    elif kind == 'flow':
        d.line([cx - r, cy + r * 0.6, cx - r * 0.2, cy - r * 0.35,
                cx + r * 0.3, cy + r * 0.2, cx + r, cy - r * 0.75],
               fill=colour, width=w, joint='curve')
        d.ellipse([cx + r * 0.72, cy - r * 1.03, cx + r * 1.28, cy - r * 0.47], fill=colour)
    elif kind == 'book':
        d.rounded_rectangle([cx - r * 0.95, cy - r * 0.8, cx + r * 0.95, cy + r * 0.8],
                            radius=r * 0.16, outline=colour, width=w)
        d.line([cx, cy - r * 0.8, cx, cy + r * 0.8], fill=colour, width=w)
    elif kind == 'building':
        d.rounded_rectangle([cx - r * 0.85, cy - r * 0.95, cx + r * 0.85, cy + r * 0.9],
                            radius=r * 0.12, outline=colour, width=w)
        for row in range(3):
            for col in range(3):
                x = cx - r * 0.5 + col * r * 0.5
                y = cy - r * 0.55 + row * r * 0.45
                d.rectangle([x - r * 0.1, y - r * 0.1, x + r * 0.1, y + r * 0.1], fill=colour)
    elif kind == 'check':
        d.rounded_rectangle([cx - r * 0.9, cy - r * 0.9, cx + r * 0.9, cy + r * 0.9],
                            radius=r * 0.22, outline=colour, width=w)
        d.line([cx - r * 0.42, cy, cx - r * 0.08, cy + r * 0.36, cx + r * 0.48, cy - r * 0.4],
               fill=colour, width=w + 2, joint='curve')
    elif kind == 'plus':
        d.line([cx - r * 0.75, cy, cx + r * 0.75, cy], fill=colour, width=w + 2)
        d.line([cx, cy - r * 0.75, cx, cy + r * 0.75], fill=colour, width=w + 2)


def make(key, accent_hex, mark, size):
    S = size
    img = Image.new('RGBA', (S * 4, S * 4), INK + (255,))   # 4x, downsampled for clean edges
    d = ImageDraw.Draw(img)
    accent = hex_rgb(accent_hex)
    s = S * 4

    # A GLOW BEHIND THE MARK, not a wash across the top. The first attempt laid
    # the room colour over the upper 62% at near-full strength and the mark
    # disappeared into it — the one thing the icon exists to show.
    glow = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    steps = 26
    for i in range(steps):
        t = i / steps
        rr = s * (0.20 + 0.30 * t)
        a = int(30 * (1 - t) ** 2)
        if a:
            gd.ellipse([s / 2 - rr, s * 0.46 - rr, s / 2 + rr, s * 0.46 + rr], fill=accent + (a,))
    img.alpha_composite(glow)

    # The mark, big enough to read at the size a home screen actually renders it.
    draw_mark(d, mark, s / 2, s * 0.46, s * 0.20, accent + (255,), max(4, s // 52))

    # The gold hairline the app uses under a header — one Prism cue, understated.
    d.line([s * 0.30, s * 0.80, s * 0.70, s * 0.80], fill=GOLD + (170,), width=max(2, s // 150))

    return img.resize((S, S), Image.LANCZOS)


out = 'public/launch'
os.makedirs(out, exist_ok=True)
for key, (accent, mark) in LAUNCHERS.items():
    for size in (192, 512):
        make(key, accent, mark, size).save(f'{out}/{key}-{size}.png')
print('wrote', len(LAUNCHERS) * 2, 'icons to', out)
