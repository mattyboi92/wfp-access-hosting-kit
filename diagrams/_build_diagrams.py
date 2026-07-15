#!/usr/bin/env python3
"""Diagram generator for the static-hosting kit (Cloudflare brand palette).

Run:  python3 _build_diagrams.py   ->  writes publish-flow.svg

Style: 1400x900 canvas, white bg, Inter, blue #1A6FD4 zones/icons, orange #F6821F
connectors with arrowheads. Matches Cloudflare's technical-diagram house style.
"""
import os

BLUE = "#1A6FD4"; ORANGE = "#F6821F"; WHITE = "#FFFFFF"
SVC_FILL = "#F5F7FA"; SVC_BORDER = "#D1D9E0"; TEXT = "#1A1A1A"; MUTED = "#6B7280"
FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
W, H = 1400, 900


def header(title, subtitle=""):
    sub = (f'<text x="40" y="86" font-family="{FONT}" font-size="16" fill="{MUTED}">{subtitle}</text>'
           if subtitle else "")
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="{FONT}">
  <defs>
    <style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap');</style>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="{ORANGE}"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="{W}" height="{H}" fill="{WHITE}"/>
  <text x="40" y="56" font-family="{FONT}" font-size="28" font-weight="700" fill="{TEXT}">{title}</text>
  {sub}
'''


def footer():
    return "</svg>\n"


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _wrap(cx, cy, body, color):
    return (f'<g stroke="{color}" stroke-width="2.2" fill="none" stroke-linejoin="round" '
            f'stroke-linecap="round" transform="translate({cx},{cy})">{body}</g>')


def ic_user(cx, cy, color=BLUE):
    return _wrap(cx, cy, '<circle cx="0" cy="-12" r="11"/><path d="M-20 26 C-20 6 20 6 20 26"/>', color)


def ic_doc(cx, cy, color=BLUE):
    b = ('<path d="M-18 -26 H10 L22 -14 V26 H-18 Z"/><path d="M10 -26 V-14 H22"/>'
         '<line x1="-10" y1="-2" x2="14" y2="-2"/><line x1="-10" y1="8" x2="14" y2="8"/>'
         '<line x1="-10" y1="18" x2="6" y2="18"/>')
    return _wrap(cx, cy, b, color)


def ic_shield(cx, cy, color=BLUE):
    b = ('<path d="M0 -28 L24 -18 V2 C24 18 12 26 0 30 C-12 26 -24 18 -24 2 V-18 Z"/>'
         '<path d="M-10 0 L-2 9 L12 -10"/>')
    return _wrap(cx, cy, b, color)


def ic_hex(cx, cy, color=BLUE):
    return _wrap(cx, cy, '<path d="M0 -28 L24 -14 L24 14 L0 28 L-24 14 L-24 -14 Z"/>', color)


def ic_globe(cx, cy, color=BLUE):
    b = ('<circle cx="0" cy="0" r="27"/><ellipse cx="0" cy="0" rx="11" ry="27"/>'
         '<line x1="-27" y1="0" x2="27" y2="0"/><line x1="-23" y1="-14" x2="23" y2="-14"/>'
         '<line x1="-23" y1="14" x2="23" y2="14"/>')
    return _wrap(cx, cy, b, color)


def label(cx, y, text, weight="600", size=16, color=TEXT):
    return (f'<text x="{cx}" y="{y}" text-anchor="middle" font-family="{FONT}" '
            f'font-size="{size}" font-weight="{weight}" fill="{color}">{esc(text)}</text>')


def node(cx, cy, icon_fn, title, sub="", accent=BLUE):
    parts = [f'<rect x="{cx-64}" y="{cy-52}" width="128" height="104" rx="10" '
             f'fill="{SVC_FILL}" stroke="{SVC_BORDER}" stroke-width="1.5"/>']
    parts.append(icon_fn(cx, cy - 8, accent))
    parts.append(label(cx, cy + 40, title, size=15))
    if sub:
        parts.append(label(cx, cy + 78, sub, weight="400", size=12.5, color=MUTED))
    return "".join(parts)


def zone(x, y, w, h, text, solid=False):
    dash = "" if solid else ' stroke-dasharray="8 4"'
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="none" '
            f'stroke="{BLUE}" stroke-width="1.5"{dash}/>'
            f'<text x="{x+16}" y="{y+26}" font-family="{FONT}" font-size="14" '
            f'font-weight="600" letter-spacing="0.5" fill="{BLUE}">{esc(text.upper())}</text>')


def conn(pts, text="", label_dy=-12):
    d = " ".join(f"{x},{y}" for x, y in pts)
    out = (f'<polyline points="{d}" fill="none" stroke="{ORANGE}" stroke-width="2" '
           f'marker-end="url(#arrow)"/>')
    if text:
        mx = (pts[0][0] + pts[-1][0]) / 2
        my = (pts[0][1] + pts[-1][1]) / 2
        w = 7.2 * len(text) + 16
        out += (f'<rect x="{mx-w/2}" y="{my+label_dy-14}" width="{w}" height="20" rx="4" '
                f'fill="{WHITE}" opacity="0.92"/>')
        out += (f'<text x="{mx}" y="{my+label_dy}" text-anchor="middle" font-family="{FONT}" '
                f'font-size="12.5" font-weight="500" fill="{MUTED}">{esc(text)}</text>')
    return out


OUT = os.path.dirname(os.path.abspath(__file__))


def write(name, body):
    with open(os.path.join(OUT, name), "w") as f:
        f.write(body)
    print("wrote", name)


def publish_flow():
    s = header("Self-service publish flow — describe it, ship it",
               "A non-engineer describes a site; the agent builds it and publishes it through Access + Workers for Platforms. No Cloudflare credential ever on the device.")
    y = 430
    xs = [150, 410, 670, 930, 1210]

    # Cloudflare-owned zone behind Access -> control-plane -> tenant
    s += zone(590, 300, 700, 300, "Cloudflare — your account (user never holds a CF credential)")

    s += node(xs[0], y, ic_user, "Non-engineer", "+ AI agent (opencode)")
    s += node(xs[1], y, ic_doc, "publish-site.sh", "auto cloudflared login")
    s += node(xs[2], y, ic_shield, "Cloudflare Access", "SSO -> signed JWT")
    s += node(xs[3], y, ic_hex, "Control-plane", "validate JWT -> deploy")
    s += node(xs[4], y, ic_hex, "Tenant Worker", "isolated -> owner-<email>")

    s += conn([(xs[0] + 64, y), (xs[1] - 64, y)], "1. describe -> HTML")
    s += conn([(xs[1] + 64, y), (xs[2] - 64, y)], "2. cf-access-token")
    s += conn([(xs[2] + 64, y), (xs[3] - 64, y)], "3. injects JWT")
    s += conn([(xs[3] + 64, y), (xs[4] - 64, y)], "4. WFP API")

    # Output: live URL behind Access
    s += node(xs[4], y + 210, ic_globe, "<slug>.sites.example.com", "behind Access")
    s += conn([(xs[4], y + 52), (xs[4], y + 210 - 52)], "Live at", label_dy=-2)

    # scoped token note
    s += (f'<rect x="590" y="620" width="700" height="34" rx="6" fill="{ORANGE}" opacity="0.08"/>'
          f'<text x="606" y="642" font-family="{FONT}" font-size="12.5" fill="{MUTED}">'
          f'Scoped CF API token lives only in the control-plane as a Worker Secret — it never leaves the platform.</text>')
    s += footer()
    write("publish-flow.svg", s)


if __name__ == "__main__":
    publish_flow()
    print("done ->", OUT)
