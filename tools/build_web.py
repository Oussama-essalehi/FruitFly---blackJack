"""Assemble the web page: web/page.html + the scripts + the circuit data.

Writes  web/index.html          a complete page you can open in any browser
        web/flyjack.fragment.html   the same page without the <html> wrapper (for hosts that add their own)

Usage: python3 tools/build_web.py
       FLYJACK_SERVER=https://your-server python3 tools/build_web.py
           the page then watches the shared fly on that server (server/server.js) wherever it is
           hosted; without it, the page looks for the server on its own address
"""
import json, os, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
circuit = json.loads((root / "data/circuit.json").read_text(encoding="utf-8"))
for group in ("pn", "kc", "mbon", "pam", "ppl1"):          # keep the page small: drop what it never reads
    circuit[group].pop("aplSynapses", None)
circuit.pop("glomerulusSynapses", None)
data = json.dumps(circuit, separators=(",", ":")).replace("<", "\\u003c")
cloud = (root / "data/cns_cloud.json").read_text(encoding="utf-8").replace("<", "\\u003c")
page = (root / "web/page.html").read_text(encoding="utf-8")
server = os.environ.get("FLYJACK_SERVER", "").strip()
if server:
    page = page.replace("<script>/*APP*/", "<script>self.FLYJACK_SERVER = " + json.dumps(server) + ";</script>\n<script>/*APP*/", 1)
parts = {"/*CIRCUIT*/": data,
         "/*CLOUD*/": cloud,
         "/*BLACKJACK*/": (root / "src/blackjack.js").read_text(encoding="utf-8"),
         "/*FLYBRAIN*/": (root / "src/flybrain.js").read_text(encoding="utf-8"),
         "/*POKER*/": (root / "src/poker.js").read_text(encoding="utf-8"),
         "/*THREE*/": (root / "web/vendor/three.min.js").read_text(encoding="utf-8"),
         "/*SCENEKIT*/": (root / "web/scenekit.js").read_text(encoding="utf-8"),
         "/*SCENE3D*/": (root / "web/scene3d.js").read_text(encoding="utf-8"),
         "/*FLY3D*/": (root / "web/fly3d.js").read_text(encoding="utf-8"),
         "/*BRAIN3D*/": (root / "web/brain3d.js").read_text(encoding="utf-8"),
         "/*CASINO*/": (root / "web/casino.js").read_text(encoding="utf-8"),
         "/*APP*/": (root / "web/app.js").read_text(encoding="utf-8"),
         "/*POKERTABLE*/": (root / "web/pokertable.js").read_text(encoding="utf-8"),
         "/*POKERAPP*/": (root / "web/pokerapp.js").read_text(encoding="utf-8")}
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
