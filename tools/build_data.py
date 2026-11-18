#!/usr/bin/env python3
"""
Build the static data files for the "Just Ends" prototype from the
Open Khipu Repository SQLite database (khipu.db, MIT licence).

    python3 tools/build_data.py

Reads : data-src/open-khipu-repository/data/khipu.db
        data-src/open-khipu-repository/data/okr-kh-numbers.csv
Writes: app/data/index.js      (catalogue of every khipu + archive statistics)
        app/data/k/KHxxxx.js   (one file per khipu, loaded on demand)
        docs/archive_stats.json (the same statistics, for the proposal)

The output is plain .js (not .json) so the app can be opened straight from
the filesystem (file://) with no server and no build step.

Nothing is invented here. Where the archive has no value, the output has
null / "" and the app is expected to treat that absence as material.
"""
import csv
import json
import os
import sqlite3
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data-src", "open-khipu-repository", "data")
DB = os.path.join(SRC, "khipu.db")
CSV = os.path.join(SRC, "okr-kh-numbers.csv")
OUT = os.path.join(ROOT, "app", "data")
OUT_K = os.path.join(OUT, "k")
DOCS = os.path.join(ROOT, "docs")


def clean(s):
    if s is None:
        return ""
    s = str(s).replace("\r", " ").replace("\n", " ").strip().strip('"').strip()
    return " ".join(s.split())


def num(v):
    """Round a measurement; return None when the archive has nothing."""
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f == int(f) else round(f, 2)


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
                    "other": clean(row.get("Other Names")),
                }

    # ---- colour dictionary ---------------------------------------------
    colors = {}
    for r in con.execute("SELECT * FROM ascher_color_dc"):
        code = clean(r["AS_COLOR_CD"])
        colors[code] = [
            round((r["R_DEC"] or 0) * 255),
            round((r["G_DEC"] or 0) * 255),
            round((r["B_DEC"] or 0) * 255),
            clean(r["COLOR_DESCR"]),
        ]

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
        prov_known = bool(prov) and prov.lower() != "unknown"
        if not prov_known:
            S["khipus_no_provenance"] += 1
        if not clean(km["DISCOVERED_BY"]):
            S["khipus_no_discoverer"] += 1
        if clean(km["DATE_DISCOVERED"]) in ("", "0000-00-00"):
            S["khipus_no_date"] += 1

        hold = holding.get(kh, {})
        country = hold.get("country", "") or ""
        country_counts[country or "(unrecorded)"] += 1
        museum = hold.get("collection") or clean(km["MUSEUM_NAME"])
        museum_counts[museum or "(unrecorded)"] += 1

        # parents first, so a child can always refer to an earlier index
        rows = sorted(rows, key=lambda r: (abs(r["CORD_LEVEL"] or 1), r["CORD_ORDINAL"] or 0, r["CORD_ID"]))
        idx_of = {r["CORD_ID"]: i for i, r in enumerate(rows)}

        out_cords = []
        last_x = 0.0
        x_recorded = 0
        n_knots = n_broken = n_level1 = 0
        total_value = 0
        max_len = 0.0
        unknown_fields = known_fields = 0

        for r in rows:
            cid = r["CORD_ID"]
            level = r["CORD_LEVEL"] or 1
            parent = idx_of.get(r["PENDANT_FROM"], -1)
            length = num(r["CORD_LENGTH"])
            if length is not None and length <= 0:
                length = None

            # position: along the primary cord (from the cord cluster) for
            # pendants, along the parent cord for subsidiaries
            x = None
            if parent == -1:
                n_level1 += 1
                cc = cord_clusters.get(r["CLUSTER_ID"])
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

            term = clean(r["TERMINATION"])
            twist = clean(r["TWIST"])
            att = clean(r["ATTACHMENT_TYPE"])
            fiber = clean(r["FIBER"])

            col = cord_color.get(cid)
            c1 = clean(col["COLOR_CD_1"]) if col else ""
            op = clean(col["OPERATOR_1"]) if col else ""
            c2 = clean(col["COLOR_CD_2"]) if col else ""

            kcl = []
            cord_value = 0
            for kc in knot_clusters.get(cid, []):
                ks = knots.get(kc["CLUSTER_ID"], [])
                if not ks:
                    continue
                ktype = clean(ks[0]["TYPE_CODE"]).strip("'")
                kdir = clean(ks[0]["DIRECTION"])
                if kdir not in ("S", "Z"):
                    kdir = "U"
                val = 0
                for k in ks:
                    v = k["knot_value_type"] or 0
                    val += int(v)
                    knot_type_counts[clean(k["TYPE_CODE"]).strip("'") or "(none)"] += 1
                    d = clean(k["DIRECTION"])
                    knot_dir_counts[d if d in ("S", "Z") else "U"] += 1
                pos = num(kc["START_POS"])
                if pos is not None and pos <= 0:
                    pos = None
                kcl.append([pos, ktype or "?", len(ks), val, kdir])
                n_knots += len(ks)
                cord_value += val
            total_value += cord_value

            # --- bookkeeping of what the archive knows / does not know ---
            term_counts[term or "(blank)"] += 1
            S["cords"] += 1
            if term == "B":
                n_broken += 1
            if length is None:
                S["cords_no_length"] += 1
            else:
                total_cm += length
                max_len = max(max_len, length)
            if not kcl:
                S["cords_no_knots"] += 1
            for name, val_, unknown in (
                ("termination", term, term == ""),
                ("twist", twist, twist in ("", "U")),
                ("attachment", att, att in ("", "U")),
                ("fiber", fiber, fiber in ("", "X")),
                ("length", length, length is None),
                ("colour", c1, c1 == ""),
            ):
                if unknown:
                    S["unknown_" + name] += 1
                    unknown_fields += 1
                else:
                    known_fields += 1

            out_cords.append([parent, level, x, length, c1, op, c2, term, twist, att, fiber, kcl, clean(r["CORD_NOTES"])[:240]])

        # Pendants whose position along the main cord was never recorded.
        # The guess is flagged (last element = 1), never passed off as data:
        #  - if most positions are missing, every pendant is spread evenly, in
        #    recorded order, along the main cord's recorded length;
        #  - otherwise the few missing ones follow the last recorded pendant
        #    at a nominal half-centimetre pitch.
        pc = pcords.get(kid, [])
        plen = num(pc[0]["PCORD_LENGTH"]) if pc else None
        if plen is not None and plen <= 0:
            plen = None
        mostly_missing = n_level1 > 0 and x_recorded / n_level1 < 0.5
        if mostly_missing:
            span = plen if plen else 0.5 * (n_level1 + 1)
            j = 0
            for c in out_cords:
                if c[0] == -1:
                    j += 1
                    c[2] = round(span * j / (n_level1 + 1), 2)
                    c.append(1)
                else:
                    c.append(0)
            x_recorded = 0
        else:
            for c in out_cords:
                if c[0] == -1 and c[2] is None:
                    last_x += 0.5
                    c.append(1)
                    c[2] = round(last_x, 2)
                else:
                    c.append(0)

        pnotes = clean(pc[0]["plainnotes"])[:400] if pc else ""
        pcol_row = pcord_color.get(pc[0]["PCORD_ID"]) if pc else None
        pcol = clean(pcol_row["COLOR_CD_1"]) if pcol_row else ""

        n = len(out_cords)
        tot_fields = unknown_fields + known_fields
        entry = {
            "id": kh,
            "inv": clean(km["INVESTIGATOR_NUM"]),
            "prov": prov if prov_known else "",
            "museum": museum,
            "country": country,
            "n": n,
            "knots": n_knots,
            "broken": round(n_broken / n, 3) if n else 0,
            "unknown": round(unknown_fields / tot_fields, 3) if tot_fields else 1,
            "value": total_value,
            "maxlen": max_len,
        }
        index.append(entry)
        if n == 0:
            S["khipus_no_cords"] += 1

        detail = {
            "id": kh,
            "inv": entry["inv"],
            "prov": entry["prov"],
            "museum": museum,
            "city": hold.get("city", ""),
            "country": country,
            "plen": plen,
            "pcol": pcol,
            "pbeg": clean(pc[0]["BEGINNING"]) if pc else "",
            "pterm": clean(pc[0]["TERMINATION"]) if pc else "",
            "pnotes": pnotes,
            "by": clean(km["DISCOVERED_BY"]),
            "date": "" if clean(km["DATE_DISCOVERED"]) in ("", "0000-00-00") else clean(km["DATE_DISCOVERED"]),
            "notes": clean(km["NOTES"])[:900],
            "xrec": round(x_recorded / n_level1, 3) if n_level1 else 0,
            "cords": out_cords,
        }
        with open(os.path.join(OUT_K, kh + ".js"), "w", encoding="utf-8") as f:
            f.write("window.KHIPU_LOAD(")
            json.dump(detail, f, ensure_ascii=False, separators=(",", ":"))
            f.write(");\n")

    S["knots"] = sum(knot_type_counts.values())
    stats = {
        "source": "Open Khipu Repository, khipu.db (MIT). https://github.com/khipulab/open-khipu-repository  doi:10.5281/zenodo.18025748",
        "counts": dict(S),
        "total_cord_metres": round(total_cm / 100.0, 1),
        "terminations": dict(term_counts.most_common()),
        "knot_types": dict(knot_type_counts.most_common()),
        "knot_directions": dict(knot_dir_counts.most_common()),
        "countries": dict(country_counts.most_common()),
        "collections_top": dict(museum_counts.most_common(15)),
    }

    with open(os.path.join(OUT, "index.js"), "w", encoding="utf-8") as f:
        f.write("window.KHIPU_INDEX=")
        json.dump({"stats": stats, "colors": colors, "khipus": index}, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    with open(os.path.join(DOCS, "archive_stats.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)

    print(json.dumps(stats, ensure_ascii=False, indent=2))
    size = sum(os.path.getsize(os.path.join(OUT_K, p)) for p in os.listdir(OUT_K))
    print("khipu files: %d, %.1f MB; index %.0f KB" % (len(os.listdir(OUT_K)), size / 1e6, os.path.getsize(os.path.join(OUT, "index.js")) / 1e3))


if __name__ == "__main__":
    main()
