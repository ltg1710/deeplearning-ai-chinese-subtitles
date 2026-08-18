#!/usr/bin/env python3
"""
Generate final extension icons from composer parameters.

Reads icons/composer_params.json and renders the DeepLearning.AI emblem
plus a standard circular five-star badge at 16/32/48/128 px.

Star geometry follows GB 12982-2004: regular pentagram with outer/inner
radius ratio sin18/sin54 = 0.381966, one point up. Small stars are
positioned/rotated so one point faces the big star center.
"""
import json
import math
import os
from PIL import Image, ImageDraw

try:
    LANCZOS = Image.Resampling.LANCZOS
except AttributeError:
    LANCZOS = Image.LANCZOS

ICON_DIR = os.path.dirname(os.path.abspath(__file__))
PARAMS_FILE = os.path.join(ICON_DIR, "composer_params.json")
EMBLEM_FILE = os.path.join(ICON_DIR, "dlai-icon.png")

with open(PARAMS_FILE, "r", encoding="utf-8") as f:
    PARAMS = json.load(f)


def star_points(cx, cy, R, rot_deg=0):
    """Return polygon points for a standard pentagram."""
    r = R * 0.381966  # sin(18)/sin(54)
    outer = []
    inner = []
    for i in range(5):
        a = math.radians(-90 + i * 72 + rot_deg)
        outer.append((cx + R * math.cos(a), cy + R * math.sin(a)))
        a = math.radians(-90 + 36 + i * 72 + rot_deg)
        inner.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    pts = []
    for i in range(5):
        pts.append(outer[i])
        pts.append(inner[i])
    return pts


def five_star_group(bigR):
    """Return list of (cx, cy, R, rot) for big + four small stars.

    Layout derived from GB 12982-2004 unit coordinates, centered and
    scaled to fit a 100x100 viewBox.
    """
    scale = bigR / 3.0
    # Unit centers; big star at (5,5) R=3, small stars R=1
    small_centers = [(10, 2), (12, 4), (12, 7), (10, 9)]
    big_unit = (5, 5)

    def map_pt(ux, uy):
        return (50 + (ux - 7.5) * scale, 50 + (uy - 5.5) * scale)

    items = []
    bcx, bcy = map_pt(*big_unit)
    items.append((bcx, bcy, 3 * scale, 0))

    for sx, sy in small_centers:
        cx, cy = map_pt(sx, sy)
        # angle from small star center toward big star center
        angle = math.degrees(math.atan2(big_unit[1] - sy, big_unit[0] - sx))
        # default star has a point at -90; rotate so a point faces big center
        rot = angle + 90
        items.append((cx, cy, 1 * scale, rot))
    return items


def render(target_size, params):
    """Render a target_size x target_size icon using 8x supersampling."""
    ss = 8
    N = target_size * ss
    emblem = Image.open(EMBLEM_FILE).convert("RGBA")

    # --- high-res canvas ---
    canvas = Image.new("RGBA", (N, N), (0, 0, 0, 0))

    # paste emblem (contain)
    ew, eh = emblem.size
    ar = ew / eh
    if ar > 1:
        dw, dh = N, int(N / ar)
    else:
        dw, dh = int(N * ar), N
    emblem_resized = emblem.resize((dw, dh), LANCZOS)
    canvas.paste(emblem_resized, ((N - dw) // 2, (N - dh) // 2), emblem_resized)

    draw = ImageDraw.Draw(canvas)

    # --- star badge ---
    cx = N / 2 + params["offXPct"] / 100 * N
    cy = N / 2 + params["offYPct"] / 100 * N
    d = params["sizePct"] / 100 * N
    r = d / 2

    # background circle
    bbox = [cx - r, cy - r, cx + r, cy + r]
    draw.ellipse(bbox, fill=params["bg"])

    # white outline (width tuned per final size)
    if params.get("outline", False):
        outline_final = {16: 1.0, 32: 1.5, 48: 2.0, 128: 3.0}.get(target_size, 2.0)
        outline_width = outline_final * ss
        draw.ellipse(bbox, outline="#FFFFFF", width=int(round(outline_width)))

    # stars
    k = d / 100  # viewBox 100 -> pixels
    if params.get("small", False):
        stars = five_star_group(22.5)
    else:
        stars = [(50, 50, 34, 0)]

    for st_cx, st_cy, st_R, st_rot in stars:
        px = cx + (st_cx - 50) * k
        py = cy + (st_cy - 50) * k
        R = st_R * k
        pts = star_points(px, py, R, st_rot + params.get("rot", 0))
        draw.polygon(pts, fill=params["star"])

    # --- downsample ---
    return canvas.resize((target_size, target_size), LANCZOS)


def main():
    sizes = [16, 32, 48, 128]
    for s in sizes:
        img = render(s, PARAMS)
        out = os.path.join(ICON_DIR, f"icon{s}.png")
        img.save(out, format="PNG")
        print(f"saved {out}")

    # also a 512 preview for quick checking
    preview = render(512, PARAMS)
    preview.save(os.path.join(ICON_DIR, "preview_512.png"), format="PNG")
    print("saved preview_512.png")


if __name__ == "__main__":
    main()
