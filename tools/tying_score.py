#!/usr/bin/env python3
"""
Tying score: turn one khipu's rows into a cord-by-cord making sheet.

    python3 tools/tying_score.py KH0279 --scale 4

Writes docs/tying_scores/KH0279_x4.csv with one line per cord, in the order
the cords hang, with every length and knot position multiplied by the scale.
This is the bridge from the database to the workshop: it is what a spinner,
dyer and knotter would work from, and it keeps every "not recorded" visible
so that each gap is a decision made by a person rather than by a default.

Run tools/build_data.py first (this reads app/data).
"""
import argparse
import csv
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ENDING = {
    "K": "knotted: finish with a knot near the bottom",
    "B": "broken: tear, do not cut; leave the fibres ragged",
    "C": "cut: one clean cut with a blade",
    "R": "ravelled: untwist the plies by hand for the last few cm",
    "D": "doubled: fold the end back on itself",
    "U": "unfinished: not knotted, not broken, not cut. Stop.",
    "TT": "canutito: wrap the end with coloured thread",
    "": "NOT RECORDED: decide, and write down what you decided",
}
KNOT = {"S": "single", "L": "long", "E": "figure-eight", "EE": "double figure-eight",
        "LL": "double long", "BL": "belted long", "SP": "spiral", "TF": "tufted"}
FIBER = {"A": "alpaca", "L": "llama", "CN": "cotton", "W": "sheep's wool", "V": "vegetal",
         "CL": "camelid", "CC": "cotton & camelid", "CW": "cotton & wool", "H": "human hair", "AH": "animal hair"}
ATTACH = {"R": "recto", "V": "verso", "H": "overhand knot"}
OP = {"-": "barber pole with", ":": "mottled with", "%": "with element of"}


def load_js(path, prefix):
    s = open(path, encoding="utf-8").read().strip()
    return json.loads(s[len(prefix):].rstrip(";").rstrip(")"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("khipu", help="KH number, e.g. KH0279")
    ap.add_argument("--scale", type=float, default=1.0, help="multiply every length by this (default 1)")
    a = ap.parse_args()

    idx = load_js(os.path.join(ROOT, "app", "data", "index.js"), "window.KHIPU_INDEX=")
    colors = idx["colors"]
    d = load_js(os.path.join(ROOT, "app", "data", "k", a.khipu + ".js"), "window.KHIPU_LOAD(")
    cords = d["cords"]
    sc = a.scale

    def cm(v):
        return "" if v is None else ("%.1f" % (v * sc))

    # names like 12, 12s1, 12s1s2, in hanging order
    kids = {}
    for i, c in enumerate(cords):
        kids.setdefault(c[0], []).append(i)
    names, order = {}, []

    def walk(i, name):
        names[i] = name
        order.append(i)
        for j, k in enumerate(sorted(kids.get(i, []), key=lambda k: (cords[k][2] is None, cords[k][2] or 0)), 1):
            walk(k, "%ss%d" % (name, j))

    for n, i in enumerate(sorted(kids.get(-1, []), key=lambda k: cords[k][2]), 1):
        walk(i, str(n))

    out_dir = os.path.join(ROOT, "docs", "tying_scores")
    os.makedirs(out_dir, exist_ok=True)
    tag = ("%g" % sc).replace(".", "_")
    path = os.path.join(out_dir, "%s_x%s.csv" % (a.khipu, tag))
    total = 0.0
    unknown = 0
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["# %s (%s), from %s, held: %s. Scale x%g. Main cord %s cm." % (
            d["id"], d["inv"], d["prov"] or "NOT RECORDED", ", ".join(x for x in (d["museum"], d["country"]) if x),
            sc, cm(d["plen"]) or "NOT RECORDED")])
        w.writerow(["cord", "hangs", "hangs from", "at (cm)", "position is a guess", "length (cm)", "colour", "fibre",
                    "twist", "attachment", "ending", "knots (type x count = value @ cm from top, direction)", "archive note"])
        for i in order:
            parent, level, pos, length, c1, op, c2, term, twist, att, fiber, knots, note, guess = cords[i]
            colour = "NOT RECORDED"
            if c1:
                colour = "%s %s" % (c1, colors.get(c1, [0, 0, 0, ""])[3])
                if c2:
                    colour += " / %s %s %s" % (OP.get(op, "with"), c2, colors.get(c2, [0, 0, 0, ""])[3])
            ks = "; ".join("%s x%d = %d @ %s%s" % (
                KNOT.get(k[1], "unknown type"), k[2], k[3], cm(k[0]) or "NOT RECORDED",
                "" if k[4] == "U" else " " + k[4]) for k in knots)
            fields = [length is None, not c1, fiber not in FIBER, twist not in ("S", "Z"), att not in ATTACH, term == ""]
            unknown += sum(fields)
            if length:
                total += length * sc
            w.writerow([
                names[i], "up" if level < 0 else "down",
                "main cord" if parent == -1 else "cord " + names[parent],
                cm(pos), "yes" if guess else "",
                cm(length) or "NOT RECORDED", colour, FIBER.get(fiber, "NOT RECORDED"),
                twist if twist in ("S", "Z") else "NOT RECORDED", ATTACH.get(att, "NOT RECORDED"),
                ENDING.get(term, term), ks or "none", note,
            ])
    n_knots = sum(k[2] for c in cords for k in c[11])
    print("%s: %d cords, %d knots, %.1f m of cord to spin at x%g (plus main cord), %d fields not recorded" % (
        a.khipu, len(cords), n_knots, total / 100.0, sc, unknown))
    print("wrote", os.path.relpath(path, ROOT))


if __name__ == "__main__":
    main()
