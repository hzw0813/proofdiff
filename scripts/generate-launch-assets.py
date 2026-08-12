#!/usr/bin/env python3
"""Render launch assets from asserted ProofDiff demo output.

This helper is invoked through `scripts/generate-demo.mjs --launch-assets` so the
marketing assets cannot drift away from the real fixture and generated reports.
Pillow is intentionally an opt-in documentation dependency, not a product runtime
dependency.
"""

from __future__ import annotations

import difflib
import json
from pathlib import Path
from textwrap import wrap

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
EXAMPLES = ROOT / "examples"
WIDTH, HEIGHT = 1200, 675

BG = (7, 10, 15)
PANEL = (15, 22, 31)
PANEL_2 = (19, 28, 39)
LINE = (43, 57, 72)
TEXT = (239, 244, 249)
MUTED = (151, 166, 184)
CYAN = (108, 224, 239)
GREEN = (92, 224, 161)
YELLOW = (246, 205, 112)
PURPLE = (189, 165, 255)
RED = (255, 118, 134)


def font(size: int, mono: bool = False, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = []
    if mono:
        candidates.extend([
            "/System/Library/Fonts/Menlo.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        ])
    elif bold:
        candidates.extend([
            "/System/Library/Fonts/SFNS.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ])
    else:
        candidates.extend([
            "/System/Library/Fonts/SFNS.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ])
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default(size=size)


F12 = font(12, bold=True)
F14 = font(14)
F16 = font(16)
F18 = font(18)
F20 = font(20, bold=True)
F24 = font(24, bold=True)
F30 = font(30, bold=True)
F42 = font(42, bold=True)
F54 = font(54, bold=True)
F70 = font(70, bold=True)
M14 = font(14, mono=True)
M16 = font(16, mono=True)
M18 = font(18, mono=True)


def background() -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    for y in range(HEIGHT):
        strength = int(18 * (1 - y / HEIGHT))
        draw.line((0, y, WIDTH, y), fill=(7, 14 + strength, 20 + strength))
    draw.ellipse((-260, -380, 620, 500), fill=(12, 48, 61))
    draw.ellipse((820, -360, 1450, 330), fill=(35, 25, 65))
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    ImageDraw.Draw(overlay).rectangle((0, 0, WIDTH, HEIGHT), fill=(3, 6, 10, 105))
    image = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
    return image


def brand(draw: ImageDraw.ImageDraw, step: str) -> None:
    draw.text((54, 34), "PROOFDIFF · REAL PRODUCT OUTPUT", font=F12, fill=CYAN)
    draw.text((1080, 34), step, font=F12, fill=MUTED, anchor="ra")


def panel(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill=PANEL, radius=18) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=LINE, width=2)


def wrapped(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, *, width: int, fill=MUTED, chosen_font=F18, spacing=8) -> int:
    chars = max(12, int(width / max(8, chosen_font.size * 0.56)))
    lines = []
    for paragraph in text.splitlines() or [""]:
        lines.extend(wrap(paragraph, width=chars) or [""])
    draw.multiline_text(xy, "\n".join(lines), font=chosen_font, fill=fill, spacing=spacing)
    bbox = draw.multiline_textbbox(xy, "\n".join(lines), font=chosen_font, spacing=spacing)
    return bbox[3]


def real_diff_lines() -> list[tuple[str, tuple[int, int, int]]]:
    pairs = [
        (ROOT / "fixtures/demo/base/src/discount.js", ROOT / "fixtures/demo/after/src/discount.js", "src/discount.js"),
        (ROOT / "fixtures/demo/base/services/email.py", ROOT / "fixtures/demo/after/services/email.py", "services/email.py"),
    ]
    output: list[tuple[str, tuple[int, int, int]]] = []
    for before_path, after_path, label in pairs:
        before = before_path.read_text().splitlines()
        after = after_path.read_text().splitlines()
        output.append((f"diff -- {label}", CYAN))
        for line in difflib.unified_diff(before, after, lineterm=""):
            if line.startswith(("---", "+++")):
                continue
            color = GREEN if line.startswith("+") else RED if line.startswith("-") else MUTED
            output.append((line, color))
    return output


def terminal_excerpt(terminal: str) -> list[str]:
    wanted = []
    for line in terminal.splitlines():
        stripped = line.strip()
        if (
            stripped.startswith("PARTIAL  ·")
            or stripped.startswith("1 verified")
            or stripped.startswith("UNVERIFIED services/email.py")
            or stripped.startswith("VERIFIED   src/discount.js")
            or stripped.startswith("Evidence: none observed")
            or stripped.startswith("Evidence: 1 related test file")
            or stripped.startswith("Executed tests:")
        ):
            wanted.append(line)
    if len(wanted) < 7:
        raise RuntimeError("Generated terminal report no longer contains the launch excerpt")
    return wanted


def frame_diff(diff_lines: list[tuple[str, tuple[int, int, int]]]) -> Image.Image:
    image = background()
    draw = ImageDraw.Draw(image)
    brand(draw, "01 / 04 · DIFF")
    draw.text((54, 83), "A code change lands.", font=F54, fill=TEXT)
    draw.text((57, 151), "Start with facts: the selected Git diff.", font=F20, fill=MUTED)
    panel(draw, (54, 198, 1146, 628))
    y = 222
    for line, color in diff_lines[:20]:
        draw.text((79, y), line[:116], font=M14, fill=color)
        y += 19
    return image


def frame_pipeline() -> Image.Image:
    image = background()
    draw = ImageDraw.Draw(image)
    brand(draw, "02 / 04 · ANALYZE")
    draw.text((54, 92), "Turn a diff into evidence.", font=F54, fill=TEXT)
    wrapped(draw, (58, 162), "ProofDiff inspects relationships, discovers checks, and records only what actually happened.", width=900, chosen_font=F20)
    boxes = [
        ((54, 260, 320, 470), "GIT DIFF", "Changed files\nChanged symbols", CYAN),
        ((467, 230, 733, 500), "PROOFDIFF", "Static relationships\nChecks explicitly enabled", TEXT),
        ((880, 260, 1146, 470), "EVIDENCE", "Observed results\nVisible gaps", GREEN),
    ]
    for box, title, body, color in boxes:
        panel(draw, box, fill=PANEL_2)
        draw.text(((box[0] + box[2]) // 2, box[1] + 42), title, font=F20, fill=color, anchor="ma")
        draw.multiline_text(((box[0] + box[2]) // 2, box[1] + 102), body, font=F18, fill=MUTED, anchor="ma", align="center", spacing=10)
    draw.text((392, 357), "→", font=F42, fill=CYAN, anchor="mm")
    draw.text((808, 357), "→", font=F42, fill=CYAN, anchor="mm")
    draw.rounded_rectangle((375, 550, 825, 598), radius=24, fill=(9, 15, 22), outline=LINE)
    draw.text((600, 574), "trusted demo fixture · checks explicitly enabled", font=M14, fill=YELLOW, anchor="mm")
    return image


def frame_evidence(summary: dict, excerpt: list[str]) -> Image.Image:
    image = background()
    draw = ImageDraw.Draw(image)
    brand(draw, "03 / 04 · EVIDENCE")
    draw.text((54, 82), "Certainty stays narrow.", font=F54, fill=TEXT)
    draw.text((57, 150), "Actual terminal output from the generated demo", font=F18, fill=MUTED)
    panel(draw, (54, 194, 1146, 623), fill=(5, 8, 12))
    y = 224
    for line in excerpt:
        stripped = line.strip()
        if stripped.startswith("PARTIAL"):
            color = YELLOW
        elif stripped.startswith("VERIFIED") or "1 related test file" in stripped or stripped.startswith("Executed tests"):
            color = GREEN
        elif stripped.startswith("UNVERIFIED") or "none observed" in stripped:
            color = PURPLE
        else:
            color = MUTED
        segments = wrap(line, width=104, subsequent_indent="  ") or [line]
        for segment in segments:
            draw.text((78, y), segment, font=M16, fill=color)
            y += 24
        y += 16 if stripped.startswith(("PARTIAL", "1 verified")) else 10
    expected = summary["counts"]
    if expected["verified"] != 1 or expected["unverified"] != 1:
        raise RuntimeError("Launch asset expects the asserted mixed-evidence scenario")
    return image


def frame_report(gallery: Image.Image) -> Image.Image:
    image = background()
    draw = ImageDraw.Draw(image)
    brand(draw, "04 / 04 · REPORT")
    draw.multiline_text((54, 76), "Open the\nreport.", font=F54, fill=TEXT, spacing=-4)
    wrapped(draw, (57, 224), "A self-contained interactive HTML report keeps every evidence state inspectable.", width=300, chosen_font=F18)
    tags = [("VERIFIED", GREEN), ("UNVERIFIED", PURPLE), ("FAILED", RED)]
    y = 365
    for label, color in tags:
        draw.rounded_rectangle((54, y, 225, y + 42), radius=20, outline=LINE, fill=PANEL)
        draw.ellipse((72, y + 16, 82, y + 26), fill=color)
        draw.text((94, y + 10), label, font=F14, fill=color)
        y += 58
    draw.text((57, 558), "LOCAL · NO UPLOAD", font=F12, fill=CYAN)
    crop = gallery.crop((70, 500, 1210, 1360))
    crop.thumbnail((730, 520), Image.Resampling.LANCZOS)
    x, y0 = 430, 116
    panel(draw, (410, 96, 1146, 628), fill=PANEL_2)
    image.paste(crop, (x + (696 - crop.width) // 2, y0 + (490 - crop.height) // 2))
    draw.rounded_rectangle((410, 96, 1146, 628), radius=18, outline=LINE, width=2)
    return image


def frame_end() -> Image.Image:
    image = background()
    draw = ImageDraw.Draw(image)
    brand(draw, "15 SECOND WALKTHROUGH")
    draw.text((600, 165), "Evidence, not opinions.", font=F70, fill=TEXT, anchor="ma")
    draw.text((600, 272), "Know what changed. See what ran. Keep every gap visible.", font=F24, fill=MUTED, anchor="ma")
    draw.rounded_rectangle((280, 344, 920, 424), radius=40, fill=(13, 42, 50), outline=CYAN, width=2)
    draw.text((600, 384), "EXPLORE THE INTERACTIVE REPORT  →", font=F20, fill=CYAN, anchor="mm")
    draw.text((600, 507), "NO LLM  /  NO UPLOAD  /  NO ACCOUNT", font=F16, fill=TEXT, anchor="ma")
    return image


def save_gif(frames: list[Image.Image], target: Path) -> None:
    holds = [2200, 2600, 3000, 3500, 2600]
    rendered: list[Image.Image] = []
    durations: list[int] = []
    for index, current in enumerate(frames):
        rendered.append(current)
        durations.append(holds[index])
        if index < len(frames) - 1:
            for alpha in (0.25, 0.5, 0.75):
                rendered.append(Image.blend(current, frames[index + 1], alpha))
                durations.append(120)
    paletted = [frame.quantize(colors=128, method=Image.Quantize.MEDIANCUT) for frame in rendered]
    paletted[0].save(
        target,
        save_all=True,
        append_images=paletted[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )


def social_preview() -> Image.Image:
    image = Image.new("RGB", (1280, 640), BG)
    draw = ImageDraw.Draw(image)
    for y in range(640):
        draw.line((0, y, 1280, y), fill=(8, 12 + int(14 * (1 - y / 640)), 18 + int(20 * (1 - y / 640))))
    draw.ellipse((-240, -300, 560, 430), fill=(12, 47, 59))
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    ImageDraw.Draw(overlay).rectangle((0, 0, 1280, 640), fill=(3, 6, 10, 80))
    image = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(image)
    draw.text((72, 61), "PROOFDIFF", font=F20, fill=CYAN)
    draw.text((72, 133), "Evidence, not opinions.", font=F70, fill=TEXT)
    draw.text((76, 237), "Know what changed. See what ran. Keep gaps visible.", font=F24, fill=MUTED)
    flow = [
        ((72, 334, 300, 436), "GIT DIFF", CYAN),
        ((430, 320, 816, 450), "PROOFDIFF", TEXT),
        ((946, 334, 1208, 436), "EVIDENCE", GREEN),
    ]
    for box, label, color in flow:
        panel(draw, box, fill=PANEL_2)
        draw.text(((box[0] + box[2]) // 2, (box[1] + box[3]) // 2), label, font=F24, fill=color, anchor="mm")
    draw.text((365, 385), "→", font=F42, fill=CYAN, anchor="mm")
    draw.text((880, 385), "→", font=F42, fill=CYAN, anchor="mm")
    draw.text((72, 547), "NO LLM  /  NO UPLOAD  /  NO ACCOUNT", font=F16, fill=TEXT)
    draw.text((1208, 547), "DETERMINISTIC CHANGE EVIDENCE", font=F14, fill=MUTED, anchor="ra")
    return image


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    report = json.loads((EXAMPLES / "demo-report.json").read_text())
    terminal = (EXAMPLES / "demo-terminal.txt").read_text()
    gallery = Image.open(EXAMPLES / "demo-gallery.png").convert("RGB")
    if report["summary"]["overallStatus"] != "partially-verified":
        raise RuntimeError("Launch asset requires the asserted mixed-evidence report")
    frames = [
        frame_diff(real_diff_lines()),
        frame_pipeline(),
        frame_evidence(report["summary"], terminal_excerpt(terminal)),
        frame_report(gallery),
        frame_end(),
    ]
    save_gif(frames, ASSETS / "proofdiff-launch-demo.gif")
    social_preview().save(ASSETS / "proofdiff-social-preview.png", optimize=True)
    print("Generated truthful launch demo (15.34s) and social preview from real demo output.")


if __name__ == "__main__":
    main()
