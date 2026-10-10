"""Assemble the web page: web/page.html + the four scripts + the circuit data.

Writes  web/index.html          a complete page you can open in any browser
        web/flyjack.fragment.html   the same page without the <html> wrapper (for hosts that add their own)

Usage: python3 tools/build_web.py
"""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
circuit = json.loads((root / "data/circuit.json").read_text(encoding="utf-8"))
for group in ("pn", "kc", "mbon", "pam", "ppl1"):          # keep the page small: drop what it never reads
    circuit[group].pop("aplSynapses", None)
circuit.pop("glomerulusSynapses", None)
data = json.dumps(circuit, separators=(",", ":")).replace("<", "\\u003c")
page = (root / "web/page.html").read_text(encoding="utf-8")
parts = {"/*CIRCUIT*/": data,
         "/*BLACKJACK*/": (root / "src/blackjack.js").read_text(encoding="utf-8"),
         "/*FLYBRAIN*/": (root / "src/flybrain.js").read_text(encoding="utf-8"),
         "/*CASINO*/": (root / "web/casino.js").read_text(encoding="utf-8"),
         "/*APP*/": (root / "web/app.js").read_text(encoding="utf-8")}
for key, value in parts.items():
    assert page.count(key) == 1 and "</script" not in value, key
    page = page.replace(key, value)
(root / "web/flyjack.fragment.html").write_text(page, encoding="utf-8")
head, body = page.split("</style>", 1)
(root / "web/index.html").write_text(
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    "<style>body{margin:0}[hidden]{display:none!important}</style>\n"
    + head + "</style>\n</head>\n<body>\n" + body + "\n</body>\n</html>\n", encoding="utf-8")
print("built", round(len(page) / 1e6, 2), "MB")
