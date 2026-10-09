#!/usr/bin/env python3
"""Build the word packs (js/data/packs/*.js) from the Codex scores.

Usage: python3 scripts/build-packs.py

Inputs : data-src/full_scores.csv, data-src/full_review_required.csv,
         data-src/review-fixes/part*.txt (hand-checked fixes + examples for the
         rows Codex flagged review_required)
Outputs: js/data/packs/{elem,hs,toeic,ielts}.js and js/data/packs/index.js
         data-src/packs-report.txt, data-src/packs-dropped.csv

The 1,300 TOEFL words already live in js/data/batch-*.js (the base set), so the
TOEFL pack only lists their keys. Words that appear in several lists are merged
into one entry when their Chinese meanings overlap; a different meaning of the
same spelling becomes a separate entry with a letter suffix (bank, bank_b).
Run scripts/make-kk.mjs afterwards to add KK phonetics.
"""
import csv, glob, json, os, re, statistics, subprocess, sys, collections

sys.path.insert(0, os.path.dirname(__file__))
from scorelib import load_rows, cutoffs, level_of

ROOT = os.path.join(os.path.dirname(__file__), "..")
os.chdir(ROOT)

PACKS = {  # category in the CSV -> pack id
    "elementary_middle": "elem", "high_school": "hs", "TOEIC": "toeic", "IELTS": "ielts", "TOEFL": "toefl",
}
PACK_INFO = [  # id, English name, Chinese name
    ("elem", "Elementary & Junior High", "國小國中"), ("hs", "High School", "高中"),
    ("toeic", "TOEIC", "多益"), ("ielts", "IELTS", "雅思"), ("toefl", "TOEFL", "托福"),
]
POS = {"noun": "n.", "verb": "v.", "adjective": "adj.", "adverb": "adv.", "preposition": "prep.",
       "conjunction": "conj.", "pronoun": "pron.", "determiner": "det.", "interjection": "interj.",
       "propernoun": "n.", "pluralnoun": "n.", "nounplural": "n.", "modalverb": "modal v.",
       "numeral": "num.", "number": "num.", "cardinalnumber": "num.", "ordinalnumber": "num.", "ordinalnumeral": "num.",
       "quantifier": "quantifier", "名詞": "n.", "動詞": "v.", "形容詞": "adj.", "副詞": "adv.",
       "nounphrase": "n. phr.", "verbphrase": "v. phr.", "phrasalverb": "phr. v.", "adjectivephrase": "adj. phr.",
       "adverbialphrase": "adv. phr.", "prepositionalphrase": "prep. phr.", "idiomaticphrase": "idiom",
       "idiomaticverbphrase": "idiom", "idiom": "idiom", "phrase": "phrase", "verbalphrase": "v. phr.",
       "adjectivephr": "adj. phr.", "adjectivalphrase": "adj. phr."}


def pos_of(raw):
    raw = (raw or "").strip().lower().replace("／", "/").replace(" ", "")
    if not raw or raw == "unclear":
        return ""
    raw = re.sub(r"(adjective|noun|verb|adverb)(or|and)(adjective|noun|verb|adverb)", r"\1/\3", raw)
    parts = []
    for p in raw.split("/"):
        m = POS.get(p) or POS.get(p.replace("-", ""))
        if m and m not in parts:
            parts.append(m)
    return "/".join(parts)


def clean_word(word):
    """-> (display form, key). Display drops notes like (to) and (adj./v.); key is a-z and _ only."""
    w = word.strip()
    while True:
        n = re.sub(r"\([^()]*\)", "", w)
        if n == w:
            break
        w = n
    w = re.sub(r"\s*[=／]\s*.*$", "", w)
    w = re.split(r"\s+/\s+", w)[0]
    w = re.sub(r"(\w+)/(\w+)", r"\1", w)
    w = re.sub(r"(…|\.\.\.)\s*self", "oneself", w)
    w = re.sub(r"[…~]|\.\.\.", " ", w)
    w = re.sub(r"\s+", " ", w).strip(" ,;")
    all_toks = re.split(r"\s+", w.lower().replace("'s", ""))
    toks = [t for t in all_toks if t not in ("sb", "sb.", "sth", "sth.", "someone", "something", "etc.")] or all_toks
    key = "_".join(t for t in (re.sub(r"[^a-z]+", " ", " ".join(toks)).split()))
    return w, key


STOP = set("的地得之者性或及與和在把將被使")


def sense_sig(zh):
    z = re.sub(r"[（(][^）)]*[）)]", "", zh)
    chars = [c for c in z if "一" <= c <= "鿿" and c not in STOP]
    return set(chars), {a + b for a, b in zip(chars, chars[1:])}


def same_sense(a, b):
    ca, ba = sense_sig(a)
    cb, bb = sense_sig(b)
    if ba & bb:
        return True
    if not ca or not cb:
        return True
    return len(ca & cb) / len(ca | cb) >= 0.34


def short_zh(zh):
    out = _short_zh(zh)
    return out or re.sub(r"[（()）]", "", zh.strip())[:22]


def _short_zh(zh):
    z = re.sub(r"^[（(][^）)]*[）)]\s*", "", zh.strip())
    z = re.split(r"\s+/\s+", z)[0]
    z = re.sub(r"[（(]\+[^）)]*[）)]", "", z)
    z = re.split(r"、", z)[0]
    segs = [s for s in re.split(r"[；;]", z) if s.strip()]
    z = "；".join(segs[:3]) if segs else z
    if len(z) > 22:
        z = "；".join(segs[:2]) if len(segs) > 1 else z[:22]
    return z.strip(" ，,")


def parse_fixes(rv):
    fixes = {}
    for f in sorted(glob.glob("data-src/review-fixes/part*.txt")):
        for line in open(f, encoding="utf-8"):
            line = line.rstrip("\n")
            if not line.strip():
                continue
            parts = line.split("|", 3)
            idx = int(parts[0])
            if parts[1] == "DROP":
                fixes[rv[idx]["word_id"]] = None
                continue
            opts = dict(o.split("=", 1) for o in (parts[3] if len(parts) > 3 else "").split(";") if "=" in o)
            fixes[rv[idx]["word_id"]] = {"ex": parts[1], "exZh": parts[2], **opts}
    return fixes


def keep_split_keys():
    path = "data-src/review-fixes/senses.txt"
    return set(l.split("#")[0].strip() for l in open(path, encoding="utf-8")) - {""} if os.path.exists(path) else set()


def main():
    rows = load_rows()
    keep_split = keep_split_keys()
    rv = list(csv.DictReader(open("data-src/review_required.csv" if os.path.exists("data-src/review_required.csv") else "data-src/full_review_required.csv", encoding="utf-8-sig")))
    fixes = parse_fixes(rv)
    t1, t2, _ = cutoffs(rows)

    base_keys = set(json.loads(subprocess.check_output(["node", "-e",
        'global.window={};const fs=require("fs");require("./js/data/characters.js");'
        'fs.readdirSync("js/data").filter(f=>/^batch-\\d+\\.js$/.test(f)).forEach(f=>require("./js/data/"+f));'
        "console.log(JSON.stringify(Object.keys(window.VOCAB)))"])))

    items, dropped = [], []
    for r in rows:
        fx = None
        if r["review_status"] == "review_required":
            if r["word_id"] in fixes:
                fx = fixes[r["word_id"]]
                if fx is None:
                    dropped.append((r, "dropped after review: sense unclear or word too obscure"))
                    continue
            elif r["source_category"] != "TOEFL":
                dropped.append((r, "no review decision"))
                continue
        word = (fx or {}).get("word") or r["word"]
        zh = (fx or {}).get("zh") or r["meaning_zh"]
        score = (fx or {}).get("score") or r["initial_difficulty"]
        ex, exzh = ((fx or {}).get("ex"), (fx or {}).get("exZh")) if fx else (r["example_en"], r["example_zh"])
        disp, key = clean_word(word)
        if not key:
            dropped.append((r, "word has no usable letters"))
            continue
        if r["source_category"] != "TOEFL" and (not score or not ex or not exzh):
            dropped.append((r, "missing score or example"))
            continue
        items.append(dict(row=r, disp=disp, key=key, zh=zh, score=int(score) if score else None, ex=ex, exzh=exzh,
                          pos=(fx or {}).get("pos") or r["part_of_speech"], cat=r["source_category"],
                          conf=r["confidence"], fixed=bool(fx)))

    # cluster rows that share a key and a meaning
    by_key = collections.defaultdict(list)
    for it in items:
        by_key[it["key"]].append(it)
    entries = {}  # final key -> dict
    n_split = 0
    split_candidates = []
    for key in sorted(by_key):
        clusters = []
        for it in sorted(by_key[key], key=lambda i: (i["cat"] != "TOEFL", i["cat"], i["row"]["source_line"])):
            for c in clusters:
                if same_sense(c[0]["zh"], it["zh"]):
                    c.append(it)
                    break
            else:
                clusters.append([it])
        entries[key] = clusters[0]
        for n, c in enumerate(clusters[1:], 1):
            fk = f"{key}_{chr(ord('a') + n)}"
            split_candidates.append((fk, clusters[0], c))
            if fk in keep_split:
                n_split += 1
                entries[fk] = c
            else:
                entries[key] = entries[key] + c  # same sense, just glossed differently

    packs = {p[0]: {"own": {}, "base": []} for p in PACK_INFO}
    problems = collections.Counter()
    for fk, c in entries.items():
        cats = {i["cat"] for i in c}
        is_base = fk in base_keys
        if is_base and "TOEFL" not in cats:
            # a spelling that shares a key with a TOEFL word but a different meaning was split off above
            pass
        pool = [i for i in c if i["score"] is not None and i["ex"]] or c
        pick = min(pool, key=lambda i: (len(short_zh(i["zh"])) < 2, len(short_zh(i["zh"]))))
        if is_base:
            for cat in cats:
                packs[PACKS[cat]]["base"].append(fk)
            continue
        scores = [i["score"] for i in c if i["score"] is not None]
        if not scores or not pick["ex"]:
            problems["no score/example"] += 1
            continue
        sc = int(round(statistics.mean(scores) / 5.0) * 5)
        sc = max(5, min(100, sc))
        stem = fk.replace("_", "")[: max(3, len(fk.replace("_", "")) - 3)]
        ex_ok = stem in re.sub(r"[^a-z]", "", pick["ex"].lower())
        if not ex_ok:
            problems["example may not contain the word"] += 1
        entry = {"pos": pos_of(pick["pos"]) or "", "zh": short_zh(pick["zh"]), "level": level_of(sc, t1, t2), "diff": sc,
                 "ex": pick["ex"], "exZh": pick["exzh"]}
        if not entry["pos"]:
            problems["no part of speech"] += 1
        disp = pick["disp"]
        if disp.lower() != fk.replace("_", " "):
            entry["w"] = disp
        for cat in cats:
            if cat != "TOEFL":
                packs[PACKS[cat]]["own"][fk] = entry

    with open("data-src/packs-split-candidates.txt", "w", encoding="utf-8") as f:
        for fk, a, b in split_candidates:
            f.write("{}\t{} [{}]\t{} [{}]\n".format(fk, short_zh(a[0]["zh"]), a[0]["cat"][:4], short_zh(b[0]["zh"]), b[0]["cat"][:4]))
    os.makedirs("js/data/packs", exist_ok=True)
    js = lambda v: json.dumps(v, ensure_ascii=False)
    total_own = {}
    for pid, en, zh in PACK_INFO:
        if pid == "toefl":
            continue
        own = packs[pid]["own"]
        lines = [f"// Generated by scripts/build-packs.py ({en}). Do not edit by hand.", "(function () {", "  var W = {"]
        lines.append(",\n".join(
            "    {}: {{ {} }}".format(k, ", ".join(f"{f}: {js(e[f])}" for f in ("w", "pos", "zh", "level", "diff", "ex", "exZh") if f in e))
            for k, e in sorted(own.items())))
        lines += ["  };", "  Object.keys(W).forEach(function (k) { if (!window.VOCAB[k]) window.VOCAB[k] = W[k]; });",
                  "  window.PACKS = window.PACKS || {};",
                  f"  window.PACKS[{js(pid)}] = {{ own: Object.keys(W), base: {js(sorted(set(packs[pid]['base'])))} }};",
                  "})();", "// KK", ""]
        open(f"js/data/packs/{pid}.js", "w", encoding="utf-8").write("\n".join(lines))
        total_own.update(own)

    meta = [{"id": pid, "name": en, "zh": zh,
             "count": len(base_keys) if pid == "toefl" else len(packs[pid]["own"]) + len(set(packs[pid]["base"]))}
            for pid, en, zh in PACK_INFO]
    open("js/data/packs/index.js", "w", encoding="utf-8").write(
        "// Generated by scripts/build-packs.py. Do not edit by hand.\n"
        "// The TOEFL list is the base set in batch-*.js; the others load on demand from js/data/packs/<id>.js.\n"
        f"window.PACK_META = {json.dumps(meta, ensure_ascii=False, indent=2)};\n"
        "window.PACKS = window.PACKS || {};\n"
        "window.PACKS.toefl = { own: Object.keys(window.VOCAB), base: [] };\n")

    with open("data-src/packs-dropped.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["word_id", "word", "meaning_zh", "source_category", "reason"])
        for r, why in dropped:
            w.writerow([r["word_id"], r["word"], r["meaning_zh"], r["source_category"], why])

    toefl_rows = [i for i in items if i["cat"] == "TOEFL"]
    missing_base = sorted(base_keys - {i["key"] for i in toefl_rows})
    report = [f"cut-offs: level1 <= {t1}, level3 > {t2}",
              f"input rows {len(rows)}, kept {len(items)}, dropped {len(dropped)}",
              f"entries {len(entries)} (split-off extra senses {n_split})",
              f"base TOEFL keys not found among TOEFL rows: {missing_base}",
              "problems: " + json.dumps(problems, ensure_ascii=False)]
    for m in meta:
        report.append(f"pack {m['id']}: {m['count']} words")
    for pid in ("elem", "hs", "toeic", "ielts"):
        lv = collections.Counter(e["level"] for e in packs[pid]["own"].values())
        report.append(f"  {pid} levels {dict(sorted(lv.items()))}")
    open("data-src/packs-report.txt", "w", encoding="utf-8").write("\n".join(report) + "\n")
    print("\n".join(report))


main()
