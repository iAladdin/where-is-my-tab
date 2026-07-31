from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "assets" / "icons"
STORE_DIR = ROOT / "assets" / "chrome-web-store"
MASTER_ICON_PATH = ICON_DIR / "icon.png"

ICON_DIR.mkdir(parents=True, exist_ok=True)
STORE_DIR.mkdir(parents=True, exist_ok=True)


def rgba(value: str, alpha: int = 255) -> tuple[int, int, int, int]:
    r, g, b = ImageColor.getrgb(value)
    return (r, g, b, alpha)


PALETTE = {
    "sand": rgba("#f4eddc"),
    "cream": rgba("#fbf7ee"),
    "pearl": rgba("#fffdfa"),
    "mint_soft": rgba("#e8f7f0"),
    "mint": rgba("#69d7bf"),
    "accent": rgba("#0e7c70"),
    "accent_strong": rgba("#0a6259"),
    "sky": rgba("#d5ebf4"),
    "sky_soft": rgba("#b9ddea"),
    "ink": rgba("#17313a"),
    "ink_soft": rgba("#33545c"),
    "muted": rgba("#5f7379"),
    "white": rgba("#ffffff"),
    "shadow": (15, 42, 49, 110),
    "shadow_soft": (15, 42, 49, 60),
    "outline": (29, 55, 63, 34),
    "line": (21, 49, 58, 58),
    "surface": (255, 255, 255, 214),
    "surface_strong": (255, 255, 255, 236),
    "surface_soft": (255, 255, 255, 176),
    "accent_soft": (14, 124, 112, 34),
}


FONT_CANDIDATES = {
    "regular": [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    ],
    "bold": [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    ],
}


def load_master_icon(size: tuple[int, int] | None = None) -> Image.Image | None:
    if not MASTER_ICON_PATH.exists():
        return None

    image = Image.open(MASTER_ICON_PATH).convert("RGBA")
    if size is None:
        return image

    return image.resize(size, Image.Resampling.LANCZOS)


def make_icon_variant(target: int) -> Image.Image:
    base = load_master_icon((target, target))
    if base is None:
        base = draw_icon_base(max(256, target * 8)).resize((target, target), Image.Resampling.LANCZOS)

    if target <= 48:
        base = base.filter(ImageFilter.UnsharpMask(radius=1.1, percent=180, threshold=2))
    return base


def load_font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in FONT_CANDIDATES[weight]:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def interpolate_color(start: tuple[int, ...], end: tuple[int, ...], t: float) -> tuple[int, ...]:
    return tuple(lerp(start[index], end[index], t) for index in range(len(start)))


def multi_stop_color(stops: list[tuple[float, tuple[int, ...]]], t: float) -> tuple[int, ...]:
    if t <= stops[0][0]:
        return stops[0][1]
    if t >= stops[-1][0]:
        return stops[-1][1]

    for index in range(len(stops) - 1):
        start_t, start_color = stops[index]
        end_t, end_color = stops[index + 1]
        if start_t <= t <= end_t:
            local_t = 0 if end_t == start_t else (t - start_t) / (end_t - start_t)
            return interpolate_color(start_color, end_color, local_t)

    return stops[-1][1]


def vertical_gradient(size: tuple[int, int], stops: list[tuple[float, tuple[int, ...]]]) -> Image.Image:
    width, height = size
    gradient = Image.new("RGBA", size)
    draw = ImageDraw.Draw(gradient)

    for y in range(height):
        t = y / max(height - 1, 1)
        draw.line((0, y, width, y), fill=multi_stop_color(stops, t))

    return gradient


def fill_rounded_gradient(
    image: Image.Image,
    box: tuple[int, int, int, int],
    radius: int,
    stops: list[tuple[float, tuple[int, ...]]],
) -> None:
    width = max(1, box[2] - box[0])
    height = max(1, box[3] - box[1])
    gradient = vertical_gradient((width, height), stops)
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width, height), radius=radius, fill=255)
    image.paste(gradient, box[:2], mask)


def rounded_shadow(
    size: tuple[int, int],
    box: tuple[int, int, int, int],
    radius: int,
    blur: int,
    offset: tuple[int, int] = (0, 0),
    fill: tuple[int, int, int, int] = PALETTE["shadow"],
) -> Image.Image:
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    shifted = (
        box[0] + offset[0],
        box[1] + offset[1],
        box[2] + offset[0],
        box[3] + offset[1],
    )
    ImageDraw.Draw(shadow).rounded_rectangle(shifted, radius=radius, fill=fill)
    return shadow.filter(ImageFilter.GaussianBlur(max(1, blur)))


def ellipse_glow(
    size: tuple[int, int],
    box: tuple[int, int, int, int],
    fill: tuple[int, int, int, int],
    blur: int,
) -> Image.Image:
    overlay = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(overlay).ellipse(box, fill=fill)
    return overlay.filter(ImageFilter.GaussianBlur(max(1, blur)))


def width_of(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> int:
    left, _, right, _ = draw.textbbox((0, 0), text, font=font)
    return right - left


def fit_font(
    draw: ImageDraw.ImageDraw,
    text: str,
    max_width: int,
    start_size: int,
    min_size: int = 14,
    weight: str = "bold",
) -> ImageFont.ImageFont:
    for size in range(start_size, min_size - 1, -2):
        font = load_font(size, weight=weight)
        if width_of(draw, text, font) <= max_width:
            return font
    return load_font(min_size, weight=weight)


def wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont,
    max_width: int,
    max_lines: int,
) -> list[str]:
    words = text.split()
    if not words:
        return []

    lines: list[str] = []
    current: list[str] = []

    for word in words:
        trial = " ".join(current + [word])
        if not current or width_of(draw, trial, font) <= max_width:
            current.append(word)
            continue

        lines.append(" ".join(current))
        current = [word]

    if current:
        lines.append(" ".join(current))

    if len(lines) <= max_lines:
        return lines

    trimmed = lines[: max_lines - 1]
    remainder = " ".join(lines[max_lines - 1 :])
    ellipsis = remainder
    while width_of(draw, f"{ellipsis}...", font) > max_width and " " in ellipsis:
        ellipsis = ellipsis.rsplit(" ", 1)[0]
    trimmed.append(f"{ellipsis}..." if ellipsis != remainder else ellipsis)
    return trimmed


def draw_pill(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    text: str,
    font: ImageFont.ImageFont,
    fill: tuple[int, int, int, int],
    outline: tuple[int, int, int, int],
    text_fill: tuple[int, int, int, int],
    padding_x: int,
    padding_y: int,
) -> int:
    text_box = draw.textbbox((0, 0), text, font=font)
    text_width = text_box[2] - text_box[0]
    text_height = text_box[3] - text_box[1]
    width = text_width + padding_x * 2
    height = text_height + padding_y * 2

    draw.rounded_rectangle(
        (x, y, x + width, y + height),
        radius=height // 2,
        fill=fill,
        outline=outline,
        width=max(1, height // 12),
    )
    draw.text((x + padding_x, y + padding_y - text_box[1]), text, fill=text_fill, font=font)
    return width


def draw_search_glyph(
    draw: ImageDraw.ImageDraw,
    center: tuple[int, int],
    radius: int,
    stroke: tuple[int, int, int, int],
    handle_fill: tuple[int, int, int, int],
    width: int,
    interior: tuple[int, int, int, int] | None = None,
) -> None:
    box = (center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius)
    if interior is not None:
        draw.ellipse(box, fill=interior)
    draw.ellipse(box, outline=stroke, width=width)
    handle_start = (center[0] + int(radius * 0.48), center[1] + int(radius * 0.48))
    handle_end = (center[0] + int(radius * 1.38), center[1] + int(radius * 1.38))
    draw.line((handle_start, handle_end), fill=handle_fill, width=max(2, width), joint="curve")


def draw_icon_base(size: int = 1024) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    badge_box = (int(size * 0.065), int(size * 0.065), int(size * 0.935), int(size * 0.935))
    badge_radius = int(size * 0.245)
    canvas.alpha_composite(
        rounded_shadow(
            canvas.size,
            badge_box,
            badge_radius,
            blur=int(size * 0.045),
            offset=(0, int(size * 0.035)),
        )
    )
    fill_rounded_gradient(
        canvas,
        badge_box,
        badge_radius,
        [
            (0.0, rgba("#f7edd6")),
            (0.52, rgba("#e8f7f0")),
            (1.0, rgba("#cde7f2")),
        ],
    )
    draw.rounded_rectangle(
        badge_box,
        radius=badge_radius,
        outline=(255, 255, 255, 172),
        width=max(6, size // 72),
    )

    canvas.alpha_composite(
        ellipse_glow(
            canvas.size,
            (
                int(size * 0.17),
                int(size * 0.11),
                int(size * 0.63),
                int(size * 0.53),
            ),
            fill=(255, 255, 255, 120),
            blur=int(size * 0.09),
        )
    )
    canvas.alpha_composite(
        ellipse_glow(
            canvas.size,
            (
                int(size * 0.53),
                int(size * 0.58),
                int(size * 0.90),
                int(size * 0.90),
            ),
            fill=(109, 215, 191, 108),
            blur=int(size * 0.08),
        )
    )

    card_w = int(size * 0.50)
    card_h = int(size * 0.36)
    card_radius = int(size * 0.09)
    base_left = int(size * 0.19)
    base_top = int(size * 0.20)

    back_offsets = [(int(size * 0.10), int(size * 0.075)), (int(size * 0.055), int(size * 0.04))]
    for index, (x_offset, y_offset) in enumerate(back_offsets):
        box = (
            base_left + x_offset,
            base_top + y_offset,
            base_left + x_offset + card_w,
            base_top + y_offset + card_h,
        )
        fill = (255, 255, 255, 88 if index == 0 else 126)
        draw.rounded_rectangle(
            box,
            radius=card_radius,
            fill=fill,
            outline=(255, 255, 255, 84),
            width=max(4, size // 140),
        )
        bar_height = int(size * 0.05)
        bar_margin = int(size * 0.045)
        draw.rounded_rectangle(
            (
                box[0] + bar_margin,
                box[1] + bar_margin,
                box[2] - bar_margin,
                box[1] + bar_margin + bar_height,
            ),
            radius=bar_height // 2,
            fill=(23, 49, 58, 92 if index == 0 else 118),
        )

    front_box = (base_left, base_top, base_left + card_w, base_top + card_h)
    canvas.alpha_composite(
        rounded_shadow(
            canvas.size,
            front_box,
            card_radius,
            blur=int(size * 0.032),
            offset=(0, int(size * 0.018)),
            fill=PALETTE["shadow_soft"],
        )
    )
    draw.rounded_rectangle(
        front_box,
        radius=card_radius,
        fill=PALETTE["cream"],
        outline=(28, 56, 64, 38),
        width=max(4, size // 140),
    )

    top_bar_margin = int(size * 0.045)
    top_bar_height = int(size * 0.055)
    draw.rounded_rectangle(
        (
            front_box[0] + top_bar_margin,
            front_box[1] + top_bar_margin,
            front_box[2] - top_bar_margin,
            front_box[1] + top_bar_margin + top_bar_height,
        ),
        radius=top_bar_height // 2,
        fill=PALETTE["ink"],
    )

    line_left = front_box[0] + int(size * 0.082)
    line_top = front_box[1] + int(size * 0.165)
    row_height = int(size * 0.044)
    row_gap = int(size * 0.033)
    widths = [0.65, 0.57, 0.45]
    fills = [rgba("#0e7c70"), rgba("#69d7bf"), rgba("#8de3cf")]
    for index, (row_width, fill) in enumerate(zip(widths, fills)):
        y = line_top + index * (row_height + row_gap)
        draw.rounded_rectangle(
            (
                line_left,
                y,
                line_left + int(card_w * row_width),
                y + row_height,
            ),
            radius=row_height // 2,
            fill=fill,
        )

    lens_radius = int(size * 0.155)
    lens_center = (int(size * 0.68), int(size * 0.67))
    lens_box = (
        lens_center[0] - lens_radius,
        lens_center[1] - lens_radius,
        lens_center[0] + lens_radius,
        lens_center[1] + lens_radius,
    )
    canvas.alpha_composite(
        ellipse_glow(
            canvas.size,
            (
                lens_box[0] - int(size * 0.04),
                lens_box[1] - int(size * 0.03),
                lens_box[2] + int(size * 0.08),
                lens_box[3] + int(size * 0.12),
            ),
            fill=(10, 98, 89, 98),
            blur=int(size * 0.05),
        )
    )
    draw_search_glyph(
        draw,
        lens_center,
        lens_radius,
        stroke=PALETTE["ink"],
        handle_fill=PALETTE["accent"],
        width=max(4, size // 44),
        interior=PALETTE["white"],
    )
    inner_pad = min(max(6, size // 42), max(2, lens_radius - 4))
    draw.ellipse(
        (
            lens_box[0] + inner_pad,
            lens_box[1] + inner_pad,
            lens_box[2] - inner_pad,
            lens_box[3] - inner_pad,
        ),
        fill=PALETTE["mint_soft"],
    )
    target_radius = max(2, int(size * 0.028))
    target_center = (lens_center[0] - int(size * 0.052), lens_center[1] - int(size * 0.04))
    draw.ellipse(
        (
            target_center[0] - target_radius,
            target_center[1] - target_radius,
            target_center[0] + target_radius,
            target_center[1] + target_radius,
        ),
        fill=PALETTE["accent"],
    )
    draw.ellipse(
        (
            target_center[0] - int(target_radius * 0.42),
            target_center[1] - int(target_radius * 0.42),
            target_center[0] + int(target_radius * 0.42),
            target_center[1] + int(target_radius * 0.42),
        ),
        fill=PALETTE["white"],
    )

    return canvas


def make_background(size: tuple[int, int]) -> Image.Image:
    image = vertical_gradient(
        size,
        [
            (0.0, rgba("#f6e6d2")),
            (0.48, rgba("#edf7f2")),
            (1.0, rgba("#d5ebf4")),
        ],
    )
    image.alpha_composite(
        ellipse_glow(
            size,
            (
                int(size[0] * -0.08),
                int(size[1] * -0.16),
                int(size[0] * 0.52),
                int(size[1] * 0.42),
            ),
            fill=(255, 255, 255, 156),
            blur=max(10, size[1] // 10),
        )
    )
    image.alpha_composite(
        ellipse_glow(
            size,
            (
                int(size[0] * 0.62),
                int(size[1] * -0.04),
                int(size[0] * 1.08),
                int(size[1] * 0.48),
            ),
            fill=(185, 221, 234, 148),
            blur=max(10, size[1] // 9),
        )
    )
    image.alpha_composite(
        ellipse_glow(
            size,
            (
                int(size[0] * 0.34),
                int(size[1] * 0.52),
                int(size[0] * 0.94),
                int(size[1] * 1.14),
            ),
            fill=(105, 215, 191, 92),
            blur=max(10, size[1] // 8),
        )
    )
    return image


def draw_icon_badge(image: Image.Image, box: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = box
    resized = make_icon_variant(max(right - left, bottom - top)).resize((right - left, bottom - top), Image.Resampling.LANCZOS)
    image.alpha_composite(resized, dest=(left, top))


def draw_window_shell(
    image: Image.Image,
    box: tuple[int, int, int, int],
    compact: bool,
) -> None:
    draw = ImageDraw.Draw(image)
    radius = max(24, (box[3] - box[1]) // 14)
    image.alpha_composite(
        rounded_shadow(
            image.size,
            box,
            radius,
            blur=max(12, (box[3] - box[1]) // 16),
            offset=(0, max(8, (box[3] - box[1]) // 28)),
        )
    )
    draw.rounded_rectangle(
        box,
        radius=radius,
        fill=PALETTE["surface_strong"],
        outline=PALETTE["outline"],
        width=max(2, (box[3] - box[1]) // 120),
    )

    header_h = int((box[3] - box[1]) * 0.13)
    header_box = (box[0] + 2, box[1] + 2, box[2] - 2, box[1] + header_h)
    fill_rounded_gradient(
        image,
        header_box,
        radius,
        [
            (0.0, (255, 255, 255, 210)),
            (1.0, (245, 250, 248, 200)),
        ],
    )
    control_y = box[1] + header_h // 2
    dot_r = max(4, header_h // 10)
    colors = [rgba("#f39f7f"), rgba("#f1c462"), rgba("#76cfa8")]
    x = box[0] + int((box[2] - box[0]) * 0.06)
    gap = dot_r * 3
    for color in colors:
        draw.ellipse((x - dot_r, control_y - dot_r, x + dot_r, control_y + dot_r), fill=color)
        x += gap

    content_left = box[0] + int((box[2] - box[0]) * 0.055)
    content_right = box[2] - int((box[2] - box[0]) * 0.055)
    search_top = box[1] + header_h + int((box[3] - box[1]) * 0.05)
    search_height = int((box[3] - box[1]) * (0.16 if compact else 0.14))
    search_box = (content_left, search_top, content_right, search_top + search_height)
    draw.rounded_rectangle(
        search_box,
        radius=search_height // 2,
        fill=PALETTE["surface"],
        outline=(14, 124, 112, 52),
        width=max(2, (box[3] - box[1]) // 120),
    )
    search_center = (
        search_box[0] + int((search_box[2] - search_box[0]) * 0.07),
        search_box[1] + search_height // 2,
    )
    draw_search_glyph(
        draw,
        search_center,
        radius=max(7, search_height // 5),
        stroke=PALETTE["muted"],
        handle_fill=PALETTE["muted"],
        width=max(2, search_height // 13),
    )
    placeholder = "Search tabs, URLs, or domains"
    placeholder_font = fit_font(
        draw,
        placeholder,
        max_width=int((search_box[2] - search_box[0]) * 0.72),
        start_size=max(18, search_height // 3),
        min_size=10,
        weight="regular",
    )
    draw.text(
        (search_box[0] + int((search_box[2] - search_box[0]) * 0.16), search_box[1] + int(search_height * 0.25)),
        placeholder,
        fill=PALETTE["muted"],
        font=placeholder_font,
    )

    pill_font = load_font(max(10, (box[3] - box[1]) // 32), weight="bold")
    pill_y = search_box[3] + int((box[3] - box[1]) * 0.045)
    pill_x = content_left
    for label in ["github.com", "mail.google.com", "docs.github.com"]:
        pill_width = draw_pill(
            draw,
            pill_x,
            pill_y,
            label,
            pill_font,
            fill=(14, 124, 112, 34),
            outline=(14, 124, 112, 70),
            text_fill=PALETTE["accent_strong"],
            padding_x=max(8, (box[2] - box[0]) // 45),
            padding_y=max(4, (box[3] - box[1]) // 84),
        )
        pill_x += pill_width + max(8, (box[2] - box[0]) // 60)
        if pill_x > content_right - 100 and compact:
            break

    cards_top = pill_y + max(26, (box[3] - box[1]) // 12)
    cards_bottom = box[3] - int((box[3] - box[1]) * 0.06)
    usable_height = cards_bottom - cards_top

    if compact:
        left_box = (content_left, cards_top, content_right, cards_bottom)
        draw_domain_strip(draw, left_box, compact=True)
        return

    gap = max(18, (box[2] - box[0]) // 40)
    left_w = int((content_right - content_left - gap) * 0.62)
    left_box = (content_left, cards_top, content_left + left_w, cards_bottom)
    right_box = (left_box[2] + gap, cards_top, content_right, cards_bottom)
    draw_domain_strip(draw, left_box, compact=False)
    draw_trends_panel(draw, right_box)


def draw_domain_strip(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], compact: bool) -> None:
    radius = max(16, (box[3] - box[1]) // 10)
    entries = (
        [("github.com", "2 open tabs"), ("mail.google.com", "Current window")]
        if compact
        else [
            ("github.com", "2 open tabs"),
            ("mail.google.com", "Current window"),
            ("docs.github.com", "See it later"),
        ]
    )
    row_gap = max(8, (box[3] - box[1]) // (10 if compact else 18))
    row_h = (box[3] - box[1] - row_gap * (len(entries) - 1)) // len(entries)
    title_font = load_font(max(10, row_h // (4 if compact else 6)), weight="bold")
    sub_font = load_font(max(9, row_h // 8), weight="regular")
    top = box[1]
    for host, meta in entries:
        row_box = (box[0], top, box[2], top + row_h)
        draw.rounded_rectangle(
            row_box,
            radius=radius,
            fill=(255, 255, 255, 188),
            outline=(23, 49, 58, 28),
            width=max(1, row_h // 18),
        )
        badge_size = int(row_h * 0.48)
        badge_box = (
            row_box[0] + int(row_h * 0.25),
            row_box[1] + int(row_h * 0.26),
            row_box[0] + int(row_h * 0.25) + badge_size,
            row_box[1] + int(row_h * 0.26) + badge_size,
        )
        draw.rounded_rectangle(
            badge_box,
            radius=badge_size // 3,
            fill=(14, 124, 112, 30),
            outline=(14, 124, 112, 52),
            width=max(1, row_h // 20),
        )
        text_x = badge_box[2] + int(row_h * 0.2)
        host_y = row_box[1] + (int(row_h * 0.22) if compact else int(row_h * 0.18))
        draw.text((text_x, host_y), host, fill=PALETTE["ink"], font=title_font)
        if not compact:
            draw.text((text_x, row_box[1] + int(row_h * 0.52)), meta, fill=PALETTE["muted"], font=sub_font)

        meta_width = int((row_box[2] - row_box[0]) * 0.2)
        chip_box = (
            row_box[2] - meta_width - int(row_h * 0.18),
            row_box[1] + int(row_h * 0.28),
            row_box[2] - int(row_h * 0.18),
            row_box[1] + int(row_h * 0.58),
        )
        draw.rounded_rectangle(
            chip_box,
            radius=(chip_box[3] - chip_box[1]) // 2,
            fill=(14, 124, 112, 28),
        )
        if compact:
            bar_h = max(3, row_h // 10)
            draw.rounded_rectangle(
                (
                    text_x,
                    row_box[1] + int(row_h * 0.62),
                    row_box[2] - int(row_h * 0.3),
                    row_box[1] + int(row_h * 0.62) + bar_h,
                ),
                radius=bar_h // 2,
                fill=(23, 49, 58, 28),
            )
        top += row_h + row_gap


def draw_trends_panel(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int]) -> None:
    radius = max(16, (box[3] - box[1]) // 10)
    draw.rounded_rectangle(
        box,
        radius=radius,
        fill=(14, 124, 112, 22),
        outline=(14, 124, 112, 56),
        width=max(1, (box[3] - box[1]) // 24),
    )
    title_font = load_font(max(14, (box[3] - box[1]) // 10), weight="bold")
    body_font = load_font(max(11, (box[3] - box[1]) // 13), weight="regular")
    draw.text(
        (box[0] + int((box[2] - box[0]) * 0.09), box[1] + int((box[3] - box[1]) * 0.08)),
        "Trends",
        fill=PALETTE["accent_strong"],
        font=title_font,
    )

    leaders = [
        ("github.com", 1.0),
        ("mail.google.com", 0.72),
        ("docs.github.com", 0.56),
    ]
    y = box[1] + int((box[3] - box[1]) * 0.28)
    bar_left = box[0] + int((box[2] - box[0]) * 0.09)
    bar_max = int((box[2] - box[0]) * 0.74)
    bar_h = max(10, (box[3] - box[1]) // 18)
    gap = max(14, (box[3] - box[1]) // 16)
    for host, score in leaders:
        draw.text((bar_left, y - int(bar_h * 1.5)), host, fill=PALETTE["ink"], font=body_font)
        draw.rounded_rectangle(
            (bar_left, y, bar_left + bar_max, y + bar_h),
            radius=bar_h // 2,
            fill=(255, 255, 255, 120),
        )
        draw.rounded_rectangle(
            (bar_left, y, bar_left + int(bar_max * score), y + bar_h),
            radius=bar_h // 2,
            fill=PALETTE["accent"],
        )
        y += bar_h + gap


def draw_title_block(
    image: Image.Image,
    box: tuple[int, int, int, int],
    title: str,
    subtitle: str,
    feature_labels: list[str],
    compact: bool,
) -> None:
    draw = ImageDraw.Draw(image)
    eyebrow_font = load_font(max(14, (box[3] - box[1]) // (18 if compact else 16)), weight="bold")
    eyebrow = "NEW TAB TAB FINDER"
    draw.text((box[0], box[1]), eyebrow, fill=PALETTE["accent_strong"], font=eyebrow_font)

    title_max_width = box[2] - box[0]
    title_font = fit_font(
        draw,
        title,
        max_width=title_max_width,
        start_size=(56 if compact else 96),
        min_size=28,
        weight="bold",
    )
    title_y = box[1] + int((box[3] - box[1]) * (0.13 if compact else 0.14))
    draw.text((box[0], title_y), title, fill=PALETTE["ink"], font=title_font)

    subtitle_font = load_font(22 if compact else 34, weight="regular")
    subtitle_lines = wrap_text(draw, subtitle, subtitle_font, title_max_width, max_lines=2 if compact else 3)
    current_y = title_y + draw.textbbox((0, 0), title, font=title_font)[3] + int((box[3] - box[1]) * 0.06)
    line_gap = 8 if compact else 12
    for line in subtitle_lines:
        draw.text((box[0], current_y), line, fill=PALETTE["muted"], font=subtitle_font)
        current_y += draw.textbbox((0, 0), line, font=subtitle_font)[3] + line_gap

    if not feature_labels:
        return

    pill_font = load_font(16 if compact else 20, weight="bold")
    pill_y = current_y + int((box[3] - box[1]) * (0.04 if compact else 0.05))
    pill_x = box[0]
    pill_gap = 10 if compact else 14
    for label in feature_labels:
        width = draw_pill(
            draw,
            pill_x,
            pill_y,
            label,
            pill_font,
            fill=(255, 255, 255, 170),
            outline=(23, 49, 58, 28),
            text_fill=PALETTE["ink_soft"],
            padding_x=16 if compact else 20,
            padding_y=8 if compact else 10,
        )
        pill_x += width + pill_gap
        if compact and pill_x > box[2] - 120:
            break


def draw_promo_small() -> Image.Image:
    size = (440, 280)
    image = make_background(size)
    title = "Where Is My Tab"
    subtitle = "Find existing tabs fast."

    draw_title_block(
        image,
        box=(28, 24, 312, 128),
        title=title,
        subtitle=subtitle,
        feature_labels=[],
        compact=True,
    )
    draw_icon_badge(image, (332, 24, 408, 100))
    draw_window_shell(image, (24, 132, 416, 252), compact=True)
    return image


def draw_promo_wide() -> Image.Image:
    size = (1400, 560)
    image = make_background(size)
    draw_title_block(
        image,
        box=(84, 74, 610, 470),
        title="Where Is My Tab",
        subtitle="Search existing tabs across windows, keep domains grouped, and review browsing trends.",
        feature_labels=["Search current tabs", "Group by hostname", "See it later", "Review trends"],
        compact=False,
    )
    draw_icon_badge(image, (1186, 54, 1298, 166))
    draw_window_shell(image, (700, 68, 1332, 492), compact=False)
    return image


def export_icons() -> list[Path]:
    outputs: list[Path] = []
    for target in (128, 48, 16):
        resized = make_icon_variant(target)
        path = ICON_DIR / f"icon{target}.png"
        resized.save(path)
        outputs.append(path)
    return outputs


def export_promos() -> list[Path]:
    outputs = []
    for image, name in (
        (draw_promo_small(), "promo-440x280.png"),
        (draw_promo_wide(), "promo-1400x560.png"),
    ):
        path = STORE_DIR / name
        image.save(path)
        outputs.append(path)
    return outputs


def export_all() -> list[Path]:
    return [*export_icons(), *export_promos()]


if __name__ == "__main__":
    generated = export_all()
    print("generated store assets:")
    for path in generated:
        print(f"- {path.relative_to(ROOT)}")
