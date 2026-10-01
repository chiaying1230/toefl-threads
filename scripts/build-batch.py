#!/usr/bin/env python3
"""Turn a compact source file into js/data/batch-N.js.

Usage: scripts/build-batch.py <source.txt> <groups.json> <group-number> <batch-number>

Source format:
    @words
    key | level | English example sentence | 例句中文翻譯
    @posts
    p201 | author | Topic
    English text with [[key]] or [[key|shown form]] …
    ---
    中文翻譯 …
    ===
Part of speech and Chinese meaning come from the word list (groups.json).
"""
import json, re, sys

src, groups_path, group_no, batch_no = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
group = {w["key"]: w for w in json.load(open(groups_path, encoding="utf-8"))[group_no - 1]}
text = open(src, encoding="utf-8").read()
words_part, posts_part = text.split("@posts")
words_part = words_part.replace("@words", "")

vocab = {}
for line in words_part.strip().splitlines():
    if not line.strip():
        continue
    key, level, ex, exzh = [x.strip() for x in line.split("|")]
    if key not in group:
        sys.exit(f"'{key}' is not in word group {group_no}")
    vocab[key] = {"pos": group[key]["pos"], "zh": group[key]["zh"], "level": int(level), "ex": ex, "exZh": exzh}

missing = [k for k in group if k not in vocab]
if missing:
    sys.exit("No example sentence for: " + ", ".join(missing))

posts = []
for block in [b for b in posts_part.split("===") if b.strip()]:
    head, rest = block.strip().split("\n", 1)
    pid, author, topic = [x.strip() for x in head.split("|")]
    en, zh = [x.strip() for x in rest.split("---")]
    posts.append({"id": pid, "author": author, "topic": topic, "text": en, "zh": zh})

used = set()
for p in posts:
    used.update(m.group(1) for m in re.finditer(r"\[\[([a-z_]+)(?:\|[^\]]+)?\]\]", p["text"]))
unused = [k for k in vocab if k not in used]
if unused:
    sys.exit("Words not used in any thread: " + ", ".join(unused))

def js(s):
    return json.dumps(s, ensure_ascii=False)

out = [f"// Batch {batch_no}: threads {posts[0]['id']}–{posts[-1]['id']} and their words",
       "",
       "Object.assign(window.VOCAB, {"]
out.append(",\n".join(f"  {k}: {{ pos: {js(v['pos'])}, zh: {js(v['zh'])}, level: {v['level']}, ex: {js(v['ex'])}, exZh: {js(v['exZh'])} }}" for k, v in vocab.items()))
out += ["});", "", "window.POSTS.push("]
out.append(",\n".join(f"  {{ id: {js(p['id'])}, author: {js(p['author'])}, topic: {js(p['topic'])},\n    text: {js(p['text'])},\n    zh: {js(p['zh'])} }}" for p in posts))
out += [");", ""]
open(f"js/data/batch-{batch_no}.js", "w", encoding="utf-8").write("\n".join(out))
print(f"batch-{batch_no}.js: {len(vocab)} words, {len(posts)} threads")
