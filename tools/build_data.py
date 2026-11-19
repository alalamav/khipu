#!/usr/bin/env python3
"""
Build the data files for "Just Ends" from the Open Khipu Repository SQLite
database (khipu.db, MIT licence).

    python3 tools/build_data.py

Reads : data-src/open-khipu-repository/data/khipu.db
        data-src/open-khipu-repository/data/okr-kh-numbers.csv
Writes: app/public/data/index.json          catalogue, colour table, statistics
        app/public/data/khipus/KHxxxx.json  one file per khipu, loaded on demand
        docs/archive_stats.json             the same statistics, for the proposal

The files follow schema version 2. The TypeScript description of that schema
is app/src/khipu/schema.ts; the two must be changed together.

Conventions:
  - Every "not recorded" is null. The database's own markers for unknown
    ('' , 'U' for twist / attachment / knot direction, 'X' for fibre) are all
    turned into null here, so nothing downstream has to know them.
  - Codes are checked against the code sets below, which were copied from the
    database's dictionary tables. A code that is in neither its set nor the
    list of unknown markers is reported and written as null.
  - Positions along the main cord are the one thing worked out rather than
    copied. The database records where each group of cords begins and ends,
    not where each cord is: the cords of a group are spaced evenly between
    those two points, and count as recorded. A pendant that cannot be placed
    that way is given a position so that it can be drawn, and
    "positionRecorded" is false for it. Where fewer than half of a khipu's
    pendants can be placed, all of them are spread evenly instead (the few
    positions there were are not used) and none counts as recorded.
"""
import csv
import json
import os
import sqlite3
from collections import Counter, defaultdict

SCHEMA = 2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data-src", "open-khipu-repository", "data")
DB = os.path.join(SRC, "khipu.db")
CSV = os.path.join(SRC, "okr-kh-numbers.csv")
OUT = os.path.join(ROOT, "app", "public", "data")
OUT_K = os.path.join(OUT, "khipus")
DOCS = os.path.join(ROOT, "docs")

SOURCE = ("Open Khipu Repository, khipu.db (MIT). "
          "https://github.com/khipulab/open-khipu-repository  doi:10.5281/zenodo.18025748")

# Code sets, from the database's dictionary tables (termination_dc, fiber_dc,
# attachment_dc, knot_type_dc, color_operator_dc, beginning_dc).
TERMINATIONS = {"K", "B", "C", "R", "D", "U", "TT"}
TWISTS = {"S", "Z"}
ATTACHMENTS = {"R", "V", "H"}
FIBERS = {"A", "L", "CN", "W", "V", "CL", "CC", "CW", "H", "AH"}
KNOT_TYPES = {"S", "L", "E", "EE", "LL", "BL", "SP", "TF"}
DIRECTIONS = {"S", "Z"}
COLOR_OPERATORS = {"-", ":", "*", "**", "*_", "%"}
BEGINNINGS = {"B", "D", "K", "NB", "WB", "X", "T", "TL", "R"}

# What the database writes when it means "unknown", per field.
UNKNOWN = {
    "termination": {""},
    "twist": {"", "U"},
    "attachment": {"", "U"},
    "fiber": {"", "X"},
    "knot type": {""},
    "knot direction": {"", "U", "null"},
    "colour operator": {""},
    "beginning": {""},
    "main cord termination": {""},
}

unexpected = Counter()


def clean(s):
    if s is None:
        return ""
    s = str(s).replace("\r", " ").replace("\n", " ").strip().strip('"').strip()
    return " ".join(s.split())


def text(s):
    """A string, or None when there is nothing."""
    s = clean(s)
    return s or None


def num(v):
    """Round a measurement; return None when the archive has nothing."""
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f == int(f) else round(f, 2)


def code(value, allowed, field):
    """A code from `allowed`, or None. Anything else is counted and dropped."""
    v = clean(value).strip("'")
    if v in allowed:
        return v
    if v not in UNKNOWN[field]:
        unexpected[(field, v)] += 1
    return None


def main():
    os.makedirs(OUT_K, exist_ok=True)
    os.makedirs(DOCS, exist_ok=True)
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row

    # ---- collection / country from the master KH list ------------------
    holding = {}
    with open(CSV, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            kh = clean(row.get("OKR Number"))
            if kh:
                holding[kh] = {
                    "collection": clean(row.get("Collection / Location")),
                    "city": clean(row.get("City / State")),
                    "country": clean(row.get("Country")),
                }

    # ---- colour dictionary ---------------------------------------------
    colors = {}
    for r in con.execute("SELECT * FROM ascher_color_dc"):
        colors[clean(r["AS_COLOR_CD"])] = {
            "rgb": [
                round((r["R_DEC"] or 0) * 255),
                round((r["G_DEC"] or 0) * 255),
                round((r["B_DEC"] or 0) * 255),
            ],
            "name": clean(r["COLOR_DESCR"]),
        }

    def color(value):
        v = clean(value)
        if v in colors:
            return v
        if v:
            unexpected[("colour", v)] += 1
        return None

    # ---- bulk-load the big tables into memory --------------------------
    cords_by_khipu = defaultdict(list)
    for r in con.execute("SELECT * FROM cord ORDER BY KHIPU_ID, CORD_ORDINAL, CORD_ID"):
        cords_by_khipu[r["KHIPU_ID"]].append(r)

    cord_clusters = {r["CLUSTER_ID"]: r for r in con.execute("SELECT * FROM cord_cluster")}

    knot_clusters = defaultdict(list)  # cord_id -> [cluster rows]
    for r in con.execute("SELECT * FROM knot_cluster ORDER BY CORD_ID, ORDINAL"):
        knot_clusters[r["CORD_ID"]].append(r)

    knots = defaultdict(list)  # cluster_id -> [knot rows]
    for r in con.execute("SELECT * FROM knot ORDER BY CLUSTER_ID, KNOT_ORDINAL"):
        knots[r["CLUSTER_ID"]].append(r)

    cord_color = {}  # cord_id -> first colour row (lowest RANGE_BEG)
    pcord_color = {}
    for r in con.execute("SELECT * FROM ascher_cord_color ORDER BY CORD_ID, RANGE_BEG"):
        target = pcord_color if r["PCORD_FLAG"] == 1 else cord_color
        target.setdefault(r["CORD_ID"], r)

    pcords = defaultdict(list)
    for r in con.execute("SELECT * FROM primary_cord ORDER BY KHIPU_ID, PCORD_ID"):
        pcords[r["KHIPU_ID"]].append(r)

    # ---- archive-wide counters ------------------------------------------
    S = Counter()
    not_recorded = Counter()
    term_counts = Counter()
    country_counts = Counter()
    museum_counts = Counter()
    knot_type_counts = Counter()
    knot_dir_counts = Counter()
    total_cm = 0.0

    index = []
    for km in con.execute("SELECT * FROM khipu_main ORDER BY OKR_NUM"):
        kid = km["KHIPU_ID"]
        kh = clean(km["OKR_NUM"])
        rows = cords_by_khipu.get(kid, [])
        S["khipus"] += 1

        prov = clean(km["PROVENANCE"])
        if not prov or prov.lower() == "unknown":
            prov = None
            S["khipusWithoutProvenance"] += 1
        found_by = text(km["DISCOVERED_BY"])
        if found_by is None:
            S["khipusWithoutDiscoverer"] += 1
        found_on = text(km["DATE_DISCOVERED"])
        if found_on in (None, "0000-00-00"):
            found_on = None
            S["khipusWithoutDate"] += 1

        hold = holding.get(kh, {})
        country = hold.get("country") or None
        country_counts[country or "notRecorded"] += 1
        museum = hold.get("collection") or text(km["MUSEUM_NAME"])
        museum_counts[museum or "notRecorded"] += 1

        # parents first, so a child can always refer to an earlier index
        rows = sorted(rows, key=lambda r: (abs(r["CORD_LEVEL"] or 1), r["CORD_ORDINAL"] or 0, r["CORD_ID"]))
        idx_of = {r["CORD_ID"]: i for i, r in enumerate(rows)}

        out_cords = []
        last_x = 0.0
        x_recorded = 0
        n_knots = n_broken = n_pendants = 0
        total_value = 0
        max_len = 0.0
        unknown_fields = known_fields = 0

        for r in rows:
            cid = r["CORD_ID"]
            level = r["CORD_LEVEL"] or 1
            # A few cords name a parent that is not in the archive. They are
            # hung from the main cord, like the pendants.
            parent = idx_of.get(r["PENDANT_FROM"])
            length = num(r["CORD_LENGTH"])
            if length is not None and length <= 0:
                length = None

            cc = cord_clusters.get(r["CLUSTER_ID"])
            group = None
            if cc is not None and cc["KHIPU_ID"] == kid and (cc["ORDINAL"] or 0) > 0:
                group = int(cc["ORDINAL"])

            # position: along the main cord (from the cord group) for
            # pendants, along the parent cord for subsidiaries
            x = None
            if parent is None:
                n_pendants += 1
                if cc is not None and (cc["START_POSITION"] or 0) > 0:
                    a = float(cc["START_POSITION"])
                    b = float(cc["END_POSITION"] or 0)
                    if b < a:
                        b = a
                    n = max(1, cc["NUM_CORDS"] or 1)
                    o = max(1, r["CLUSTER_ORDINAL"] or 1)
                    t = 0.0 if n == 1 else min(1.0, (o - 1) / (n - 1))
                    x = round(a + (b - a) * t, 2)
                    x_recorded += 1
                    last_x = max(last_x, x)
            else:
                ap = num(r["ATTACH_POS"])
                x = ap if (ap is not None and ap > 0) else None

            term = code(r["TERMINATION"], TERMINATIONS, "termination")
            twist = code(r["TWIST"], TWISTS, "twist")
            att = code(r["ATTACHMENT_TYPE"], ATTACHMENTS, "attachment")
            fiber = code(r["FIBER"], FIBERS, "fiber")

            col = cord_color.get(cid)
            c1 = color(col["COLOR_CD_1"]) if col else None
            op = code(col["OPERATOR_1"], COLOR_OPERATORS, "colour operator") if col else None
            c2 = color(col["COLOR_CD_2"]) if col else None

            kcl = []
            cord_value = 0
            for kc in knot_clusters.get(cid, []):
                ks = knots.get(kc["CLUSTER_ID"], [])
                if not ks:
                    continue
                val = 0
                for k in ks:
                    val += int(k["knot_value_type"] or 0)
                    knot_type_counts[code(k["TYPE_CODE"], KNOT_TYPES, "knot type") or "notRecorded"] += 1
                    knot_dir_counts[code(k["DIRECTION"], DIRECTIONS, "knot direction") or "notRecorded"] += 1
                pos = num(kc["START_POS"])
                if pos is not None and pos <= 0:
                    pos = None
                kcl.append({
                    "position": pos,
                    "type": code(ks[0]["TYPE_CODE"], KNOT_TYPES, "knot type"),
                    "count": len(ks),
                    "value": val,
                    "direction": code(ks[0]["DIRECTION"], DIRECTIONS, "knot direction"),
                })
                n_knots += len(ks)
                cord_value += val
            total_value += cord_value

            # --- bookkeeping of what the archive knows / does not know ---
            term_counts[term or "notRecorded"] += 1
            S["cords"] += 1
            if term == "B":
                n_broken += 1
            if length is not None:
                total_cm += length
                max_len = max(max_len, length)
            if not kcl:
                S["cordsWithoutKnots"] += 1
            for name, value in (("termination", term), ("twist", twist), ("attachment", att),
                                ("fiber", fiber), ("length", length), ("colour", c1)):
                if value is None:
                    not_recorded[name] += 1
                    unknown_fields += 1
                else:
                    known_fields += 1

            out_cords.append({
                "parent": parent,
                "level": abs(level),
                "up": level < 0,
                "position": x,
                "positionRecorded": x is not None,
                "length": length,
                "color": c1,
                "colorOperator": op,
                "color2": c2,
                "termination": term,
                "twist": twist,
                "attachment": att,
                "fiber": fiber,
                "group": group,
                "knots": kcl,
                "note": clean(r["CORD_NOTES"])[:240],
            })

        # Pendants whose position along the main cord was never recorded get
        # one, flagged by positionRecorded = false:
        #  - if most positions are missing, every pendant is spread evenly, in
        #    recorded order, along the main cord's recorded length (and none
        #    of them counts as recorded);
        #  - otherwise the few missing ones follow the last recorded pendant
        #    at a nominal half-centimetre pitch.
        pc = pcords.get(kid, [])
        plen = num(pc[0]["PCORD_LENGTH"]) if pc else None
        if plen is not None and plen <= 0:
            plen = None
        if n_pendants > 0 and x_recorded / n_pendants < 0.5:
            span = plen if plen else 0.5 * (n_pendants + 1)
            j = 0
            for c in out_cords:
                if c["parent"] is None:
                    j += 1
                    c["position"] = round(span * j / (n_pendants + 1), 2)
                    c["positionRecorded"] = False
        else:
            for c in out_cords:
                if c["parent"] is None and c["position"] is None:
                    last_x += 0.5
                    c["position"] = round(last_x, 2)

        pcol_row = pcord_color.get(pc[0]["PCORD_ID"]) if pc else None

        n = len(out_cords)
        tot_fields = unknown_fields + known_fields
        index.append({
            "id": kh,
            "investigatorId": clean(km["INVESTIGATOR_NUM"]),
            "provenance": prov,
            "collection": museum,
            "country": country,
            "cords": n,
            "knots": n_knots,
            "value": total_value,
            "brokenShare": round(n_broken / n, 3) if n else 0,
            "unrecordedShare": round(unknown_fields / tot_fields, 3) if tot_fields else 1,
            "longestCord": max_len,
        })
        if n == 0:
            S["khipusWithoutCords"] += 1

        detail = {
            "schema": SCHEMA,
            "id": kh,
            "investigatorId": clean(km["INVESTIGATOR_NUM"]),
            "provenance": prov,
            "discoveredBy": found_by,
            "discoveredOn": found_on,
            "collection": {"name": museum, "city": hold.get("city") or None, "country": country},
            "notes": clean(km["NOTES"])[:900],
            "primaryCord": {
                "length": plen,
                "color": color(pcol_row["COLOR_CD_1"]) if pcol_row else None,
                "beginning": code(pc[0]["BEGINNING"], BEGINNINGS, "beginning") if pc else None,
                "termination": code(pc[0]["TERMINATION"], TERMINATIONS, "main cord termination") if pc else None,
                "notes": clean(pc[0]["plainnotes"])[:400] if pc else "",
            },
            "cords": out_cords,
        }
        with open(os.path.join(OUT_K, kh + ".json"), "w", encoding="utf-8") as f:
            json.dump(detail, f, ensure_ascii=False, separators=(",", ":"))

    stats = {
        "khipus": S["khipus"],
        "cords": S["cords"],
        "knots": sum(knot_type_counts.values()),
        "cordMetres": round(total_cm / 100.0, 1),
        "khipusWithoutProvenance": S["khipusWithoutProvenance"],
        "khipusWithoutDiscoverer": S["khipusWithoutDiscoverer"],
        "khipusWithoutDate": S["khipusWithoutDate"],
        "khipusWithoutCords": S["khipusWithoutCords"],
        "cordsWithoutKnots": S["cordsWithoutKnots"],
        "notRecorded": {k: not_recorded[k] for k in ("termination", "twist", "attachment", "fiber", "length", "colour")},
        "terminations": dict(term_counts.most_common()),
        "knotTypes": dict(knot_type_counts.most_common()),
        "knotDirections": dict(knot_dir_counts.most_common()),
        "countries": dict(country_counts.most_common()),
        "collections": dict(museum_counts.most_common(15)),
    }

    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"schema": SCHEMA, "source": SOURCE, "stats": stats, "colors": colors, "khipus": index},
                  f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DOCS, "archive_stats.json"), "w", encoding="utf-8") as f:
        json.dump({"source": SOURCE, **stats}, f, ensure_ascii=False, indent=2)

    print(json.dumps(stats, ensure_ascii=False, indent=2))
    files = [p for p in os.listdir(OUT_K) if p.endswith(".json")]
    size = sum(os.path.getsize(os.path.join(OUT_K, p)) for p in files)
    print("khipu files: %d, %.1f MB; index %.0f KB" % (len(files), size / 1e6, os.path.getsize(os.path.join(OUT, "index.json")) / 1e3))
    if unexpected:
        print("codes not in the dictionary tables, written as null:")
        for (field, value), n in sorted(unexpected.items(), key=lambda kv: -kv[1]):
            print("  %-22s %-8r x %d" % (field, value, n))
    else:
        print("every code was in the dictionary tables or a known marker for 'unknown'")


if __name__ == "__main__":
    main()
