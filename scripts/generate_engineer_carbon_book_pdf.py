from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "templates" / "ewg-engineer-carbon-book-template.pdf"
LOGO = ROOT / "apps" / "web" / "public" / "ewg-logo.png"

EWG_BLUE = colors.HexColor("#41A6CF")
EWG_NAVY = colors.HexColor("#12384A")
LINE = colors.HexColor("#1F3947")
SOFT = colors.HexColor("#EAF7FC")
MUTED = colors.HexColor("#5B7280")


def set_font(pdf: canvas.Canvas, name="Helvetica", size=8, colour=LINE):
    pdf.setFillColor(colour)
    pdf.setFont(name, size)


def draw_label(pdf: canvas.Canvas, text: str, x: float, y: float, size=5.7):
    set_font(pdf, "Helvetica-Bold", size, EWG_NAVY)
    pdf.drawString(x, y, text.upper())


def draw_box(pdf: canvas.Canvas, x: float, y: float, size=7):
    pdf.rect(x, y, size, size, stroke=1, fill=0)


def field(pdf: canvas.Canvas, x: float, y: float, w: float, h: float, label: str):
    pdf.rect(x, y, w, h, stroke=1, fill=0)
    draw_label(pdf, label, x + 3, y + h - 7)


def section(pdf: canvas.Canvas, title: str, hint: str, x: float, y: float, w: float, h: float):
    pdf.setStrokeColor(LINE)
    pdf.rect(x, y, w, h, stroke=1, fill=0)
    pdf.setFillColor(EWG_NAVY)
    pdf.rect(x, y + h - 14, w, 14, stroke=0, fill=1)
    set_font(pdf, "Helvetica-Bold", 7.2, colors.white)
    pdf.drawString(x + 5, y + h - 10, title.upper())
    set_font(pdf, "Helvetica", 5.3, colors.HexColor("#D9F4FF"))
    pdf.drawRightString(x + w - 5, y + h - 10, hint)
    return y + h - 14


def check_item(pdf: canvas.Canvas, text: str, x: float, y: float, w: float, h=14):
    pdf.rect(x, y, w, h, stroke=1, fill=0)
    draw_box(pdf, x + 3, y + 3.5, 6)
    set_font(pdf, "Helvetica-Bold", 6.3)
    pdf.drawString(x + 12, y + 5, text)


def table(pdf: canvas.Canvas, x: float, y: float, w: float, h: float, headers: list[str], rows: int, widths: list[float] | None = None):
    if widths is None:
        widths = [1 / len(headers)] * len(headers)
    total = sum(widths)
    widths = [w * part / total for part in widths]
    header_h = 13
    row_h = (h - header_h) / rows
    cursor = x
    pdf.setFillColor(SOFT)
    pdf.rect(x, y + h - header_h, w, header_h, stroke=0, fill=1)
    for header, col_w in zip(headers, widths):
        pdf.rect(cursor, y, col_w, h, stroke=1, fill=0)
        draw_label(pdf, header, cursor + 3, y + h - 9, 5)
        cursor += col_w
    for row in range(rows):
        line_y = y + row * row_h
        pdf.line(x, line_y, x + w, line_y)


def note_lines(pdf: canvas.Canvas, x: float, y: float, w: float, h: float, label: str):
    pdf.rect(x, y, w, h, stroke=1, fill=0)
    draw_label(pdf, label, x + 3, y + h - 8)
    line_y = y + h - 18
    while line_y > y + 7:
        pdf.setStrokeColor(colors.HexColor("#9AAAB2"))
        pdf.line(x + 4, line_y, x + w - 4, line_y)
        line_y -= 12
    pdf.setStrokeColor(LINE)


def build_pdf():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(OUTPUT), pagesize=A4)
    width, height = A4
    margin = 8 * mm
    x = margin
    y = height - margin
    usable = width - margin * 2

    pdf.setTitle("Errol Watson Group Engineer Carbon Book Template")
    pdf.setAuthor("NeXa / HubFlo")
    pdf.setStrokeColor(LINE)
    pdf.setLineWidth(0.75)

    header_h = 31 * mm
    logo_w = 38 * mm
    right_w = 54 * mm
    pdf.rect(x, y - header_h, usable, header_h, stroke=1, fill=0)
    pdf.rect(x, y - header_h, logo_w, header_h, stroke=1, fill=0)
    if LOGO.exists():
      logo = ImageReader(str(LOGO))
      pdf.drawImage(logo, x + 5, y - header_h + 6, width=logo_w - 10, height=header_h - 12, preserveAspectRatio=True, mask="auto")

    title_x = x + logo_w + 7
    set_font(pdf, "Helvetica-Bold", 20, EWG_NAVY)
    pdf.drawString(title_x, y - 18, "ENGINEER JOB SHEET")
    set_font(pdf, "Helvetica-Bold", 6.6, MUTED)
    pdf.drawString(title_x, y - 30, "CARBON BOOK TEMPLATE - SCAN INTO NEXA ENGINEER AFTER COMPLETION")
    for i, copy in enumerate(["Office copy", "Engineer copy", "Customer copy where required"]):
        item_y = y - 46 - i * 12
        draw_box(pdf, title_x, item_y, 7)
        set_font(pdf, "Helvetica-Bold", 7)
        pdf.drawString(title_x + 11, item_y + 1, copy)

    right_x = x + usable - right_w
    cell_w = right_w / 2
    for row, labels in enumerate([["Job ref", "Cost centre"], ["Date", "Engineer"], ["Quote / PO", "Sheet no."]]):
        for col, label in enumerate(labels):
            field(pdf, right_x + col * cell_w, y - 18 - row * 17, cell_w, 17, label)
    pdf.setFillColor(SOFT)
    pdf.rect(right_x, y - header_h + 3, right_w, 14, stroke=1, fill=1)
    set_font(pdf, "Helvetica-Bold", 5.8, EWG_NAVY)
    pdf.drawCentredString(right_x + right_w / 2, y - header_h + 8, "SCAN FULL PAGE INTO NEXA ENGINEER")

    y -= header_h + 6

    sec_h = 82
    content_top = section(pdf, "1. Customer / Site", "AI fields: client, address, contact, job description", x, y - sec_h, usable, sec_h)
    gap = 4
    col = (usable - gap * 3) / 4
    for i, label in enumerate(["Client / customer", "Contact name", "Telephone", "Access / keys"]):
        field(pdf, x + i * (col + gap), content_top - 21, col, 17, label)
    half = (usable - gap) / 2
    field(pdf, x, content_top - 42, half, 17, "Site address")
    field(pdf, x + half + gap, content_top - 42, half, 17, "Parking / permits / hazards")
    field(pdf, x, y - sec_h + 6, usable, 28, "Works instructed / job description")
    y -= sec_h + 5

    sec_h = 50
    content_top = section(pdf, "2. Time Sheet", "AI fields: scheduled time, actual time, break, travel, variance", x, y - sec_h, usable, sec_h)
    table(pdf, x + 5, content_top - 28, usable - 10, 24, ["Scheduled start", "Scheduled finish", "Actual arrival", "Actual start", "Actual finish", "Break mins", "Travel mins", "Actual hrs"], 1)
    check_w = (usable - 10) / 3
    for i, label in enumerate(["Time same as schedule", "Time under schedule", "Time over schedule"]):
        check_item(pdf, label, x + 5 + i * check_w, y - sec_h + 5, check_w, 13)
    y -= sec_h + 5

    sec_h = 124
    content_top = section(pdf, "3. Stop / Go Checklist", "Tick all that apply. Missing required items block completion.", x, y - sec_h, usable, sec_h)
    check_w = (usable - 10) / 3
    checks = [
        "Before photos taken", "Risk assessment complete", "Isolation confirmed",
        "Appliance photo", "Existing boiler serial no.", "New boiler serial no.",
        "Flue / analyser evidence", "Benchmark / commissioning", "Controls photo",
        "Defects recorded / none", "Completion photos taken", "Customer handover done",
    ]
    for idx, label in enumerate(checks):
        row = idx // 3
        col_idx = idx % 3
        check_item(pdf, label, x + 5 + col_idx * check_w, content_top - 18 - row * 15, check_w, 14)
    thirds = (usable - 10) / 3
    for i, label in enumerate(["Existing boiler make / model", "Existing serial no.", "Existing location"]):
        field(pdf, x + 5 + i * thirds, y - sec_h + 25, thirds, 18, label)
    for i, label in enumerate(["New boiler make / model", "New serial no.", "New location"]):
        field(pdf, x + 5 + i * thirds, y - sec_h + 5, thirds, 18, label)
    y -= sec_h + 5

    sec_h = 55
    content_top = section(pdf, "4. Equipment Book Out / Book In", "AI fields: equipmentOut, equipmentIn, condition", x, y - sec_h, usable, sec_h)
    table(pdf, x + 5, y - sec_h + 5, usable - 10, content_top - (y - sec_h + 9), ["Equipment / plant", "Out qty", "Out condition", "In qty", "In condition", "Initials"], 3, [3, 1, 2, 1, 2, 1])
    y -= sec_h + 5

    sec_h = 62
    content_top = section(pdf, "5. Materials / Parts Used", "AI fields: materials, qty, supplier, PO required", x, y - sec_h, usable, sec_h)
    table(pdf, x + 5, y - sec_h + 5, usable - 10, content_top - (y - sec_h + 9), ["Item / description", "Qty", "Van stock / supplier", "PO required?", "Cost centre"], 4, [4, 0.8, 2.3, 1.4, 1.7])
    y -= sec_h + 5

    sec_h = 88
    content_top = section(pdf, "6. Variations / Extra Works", "Use before doing unquoted works where client approval is required.", x, y - sec_h, usable, sec_h)
    checks = ["No variation", "Variation required", "Office contacted", "Customer approval required", "Customer approved on site", "Quote required before works"]
    check_w = (usable - 10) / 3
    for idx, label in enumerate(checks):
        row = idx // 3
        col_idx = idx % 3
        check_item(pdf, label, x + 5 + col_idx * check_w, content_top - 18 - row * 15, check_w, 14)
    thirds = (usable - 10) / 3
    for i, label in enumerate(["Extra labour hrs", "Extra materials", "Approved by / time"]):
        field(pdf, x + 5 + i * thirds, y - sec_h + 20, thirds, 18, label)
    field(pdf, x + 5, y - sec_h + 5, usable - 10, 14, "Variation description")
    y -= sec_h + 5

    sec_h = 120
    content_top = section(pdf, "7. Outcome / Office Review", "AI fields: outcome, notes, defects, rebook reason", x, y - sec_h, usable, sec_h)
    checks = ["Complete", "Needs parts", "Needs rebooked", "Could not access", "Office review required", "Ready to invoice"]
    check_w = (usable - 10) / 3
    for idx, label in enumerate(checks):
        row = idx // 3
        col_idx = idx % 3
        check_item(pdf, label, x + 5 + col_idx * check_w, content_top - 18 - row * 15, check_w, 14)
    note_lines(pdf, x + 5, y - sec_h + 36, usable - 10, 35, "Engineer notes / service report / defects / rebook reason")
    sig_w = (usable - 10) / 3
    for i, label in enumerate(["Engineer signature", "Customer / site contact signature", "Date / time"]):
        field(pdf, x + 5 + i * sig_w, y - sec_h + 7, sig_w, 24, label)

    set_font(pdf, "Helvetica-Bold", 6, EWG_NAVY)
    pdf.setDash(2, 2)
    pdf.rect(x, 22, usable, 18, stroke=1, fill=0)
    pdf.setDash()
    pdf.drawString(x + 5, 33, "Printer note: A4 duplicate/triplicate carbonless book. Suggested paper: white office, yellow engineer, pink customer.")
    pdf.drawString(x + 5, 25, "Keep labels and boxes dark for OCR. Scan this page into NeXa Engineer so actuals update the job.")
    set_font(pdf, "Helvetica", 5.5, MUTED)
    pdf.drawString(x, 12, "Errol Watson Group - Engineer carbon book template - NeXa scan-ready v1")
    pdf.drawRightString(x + usable, 12, "Office review: approve time, equipment, materials and variations")

    pdf.save()


if __name__ == "__main__":
    build_pdf()
    print(OUTPUT)
