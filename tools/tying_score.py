#!/usr/bin/env python3
"""
Tying score: turn one khipu's rows into a cord-by-cord making sheet.

    python3 tools/tying_score.py KH0279 --scale 4

Writes docs/tying_scores/KH0279_x4.csv with one line per cord, in the order
the cords hang, with every length and knot position multiplied by the scale.
This is the bridge from the database to the workshop: it is what a spinner,
dyer and knotter would work from, and it keeps every "not recorded" visible
so that each gap is a decision made by a person rather than by a default.

Run tools/build_data.py first (this reads app/public/data, schema version 2).
"""
import argparse
import csv
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "app", "public", "data")

ENDING = {
    "K": "knotted: finish with a knot near the bottom",
    "B": "broken: tear, do not cut; leave the fibres ragged",
    "C": "cut: one clean cut with a blade",
    "R": "ravelled: untwist the plies by hand for the last few cm",
    "D": "doubled: fold the end back on itself",
    "U": "unfinished: not knotted, not broken, not cut. Stop.",
    "TT": "canutito: wrap the end with coloured thread",
    None: "NOT RECORDED: decide, and write down what you decided",
}
KNOT = {"S": "single", "L": "long", "E": "figure-eight", "EE": "double figure-eight",
        "LL": "double long", "BL": "belted long", "SP": "spiral", "TF": "tufted"}
FIBER = {"A": "alpaca", "L": "llama", "CN": "cotton", "W": "sheep's wool", "V": "vegetal",
         "CL": "camelid", "CC": "cotton & camelid", "CW": "cotton & wool", "H": "human hair", "AH": "animal hair"}
ATTACH = {"R": "recto", "V": "verso", "H": "overhand knot"}
OP = {"-": "barber pole with", ":": "mottled with", "%": "with element of"}


def load(*path):
    with open(os.path.join(DATA, *path), encoding="utf-8") as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("khipu", help="KH number, e.g. KH0279")
    ap.add_argument("--scale", type=float, default=1.0, help="multiply every length by this (default 1)")
    a = ap.parse_args()

    colors = load("index.json")["colors"]
    d = load("khipus", a.khipu + ".json")
    cords = d["cords"]
    sc = a.scale

    def cm(v):
        return "" if v is None else ("%.1f" % (v * sc))

    def colour_name(c):
        return "%s %s" % (c, colors[c]["name"] if c in colors else "")

    # names like 12, 12s1, 12s1s2, in hanging order
    kids = {}
    for i, c in enumerate(cords):
        kids.setdefault(c["parent"], []).append(i)
    names, order = {}, []

    def walk(i, name):
        names[i] = name
        order.append(i)
        subs = sorted(kids.get(i, []), key=lambda k: (cords[k]["position"] is None, cords[k]["position"] or 0))
        for j, k in enumerate(subs, 1):
            walk(k, "%ss%d" % (name, j))

    for n, i in enumerate(sorted(kids.get(None, []), key=lambda k: cords[k]["position"]), 1):
        walk(i, str(n))

    out_dir = os.path.join(ROOT, "docs", "tying_scores")
    os.makedirs(out_dir, exist_ok=True)
    tag = ("%g" % sc).replace(".", "_")
    path = os.path.join(out_dir, "%s_x%s.csv" % (a.khipu, tag))
    total = 0.0
    unknown = 0
    held = ", ".join(x for x in (d["collection"]["name"], d["collection"]["country"]) if x)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["# %s (%s), from %s, held: %s. Scale x%g. Main cord %s cm." % (
            d["id"], d["investigatorId"], d["provenance"] or "NOT RECORDED", held,
            sc, cm(d["primaryCord"]["length"]) or "NOT RECORDED")])
        w.writerow(["cord", "hangs", "hangs from", "at (cm)", "position is a guess", "length (cm)", "colour", "fibre",
                    "twist", "attachment", "ending", "knots (type x count = value @ cm from top, direction)", "archive note"])
        for i in order:
            c = cords[i]
            colour = "NOT RECORDED"
            if c["color"]:
                colour = colour_name(c["color"])
                if c["color2"]:
                    colour += " / %s %s" % (OP.get(c["colorOperator"], "with"), colour_name(c["color2"]))
            ks = "; ".join("%s x%d = %d @ %s%s" % (
                KNOT.get(k["type"], "unknown type"), k["count"], k["value"], cm(k["position"]) or "NOT RECORDED",
                "" if k["direction"] is None else " " + k["direction"]) for k in c["knots"])
            fields = [c["length"] is None, c["color"] is None, c["fiber"] is None,
                      c["twist"] is None, c["attachment"] is None, c["termination"] is None]
            unknown += sum(fields)
            if c["length"]:
                total += c["length"] * sc
            is_pendant = c["parent"] is None
            w.writerow([
                names[i], "up" if c["up"] else "down",
                "main cord" if is_pendant else "cord " + names[c["parent"]],
                cm(c["position"]), "yes" if (is_pendant and not c["positionRecorded"]) else "",
                cm(c["length"]) or "NOT RECORDED", colour, FIBER.get(c["fiber"], "NOT RECORDED"),
                c["twist"] or "NOT RECORDED", ATTACH.get(c["attachment"], "NOT RECORDED"),
                ENDING[c["termination"]], ks or "none", c["note"],
            ])
    n_knots = sum(k["count"] for c in cords for k in c["knots"])
    print("%s: %d cords, %d knots, %.1f m of cord to spin at x%g (plus main cord), %d fields not recorded" % (
        a.khipu, len(cords), n_knots, total / 100.0, sc, unknown))
    print("wrote", os.path.relpath(path, ROOT))


if __name__ == "__main__":
    main()
