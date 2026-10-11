"""Extract the cell-body position of every neuron, for the 3D model of the whole nervous system.

Input : the same two raw files as tools/build_circuit.py
Output: data/cns_cloud.json
          xyz     base64 of uint16 triples: every neuron's cell-body position, scaled between lo and hi
                  (connectome voxels, 8 nm: x across the head, y downwards, z towards the back)
          tracts  base64 of uint32 pairs: for every descending and ascending neuron, its own index in
                  xyz and the index of its strongest partner on the other side of the neck
          neck    where those connections are gathered into a bundle: the gap between the brain and
                  the nerve cord, which holds no cell bodies

Usage: python3 tools/build_cloud.py <dir with the two raw files> data/cns_cloud.json
"""
import base64, json, sys
import numpy as np, pandas as pd, scipy.sparse as sp

NECK_Z = 52000          # no cell body lies between z = 44,500 and z = 60,000: that gap is the neck
raw, out = sys.argv[1], sys.argv[2]
m = pd.read_csv(f"{raw}/mcns_all_neuron_meta.csv", low_memory=False)

def parse(col):
    pts = np.full((len(m), 3), np.nan)
    for i, s in enumerate(m[col].values):
        if isinstance(s, str):
            v = s.strip("[]").replace(",", " ").split()
            if len(v) == 3: pts[i] = [float(x) for x in v]
    return pts

P = parse("somaLocation")
T = parse("tosomaLocation")          # neurons whose cell body was cut off: the point where they leave the volume
use_t = np.isnan(P[:, 0]) & ~np.isnan(T[:, 0])
P[use_t] = T[use_t]
keep = np.where(~np.isnan(P[:, 0]))[0]
P = P[keep]
lo, hi = P.min(0), P.max(0)
q = np.round((P - lo) / (hi - lo) * 65535).astype("<u2")

# ---- the neck: brain exit and nerve-cord entry of the connective, estimated from the cell bodies beside it
brain, cord = P[P[:, 2] < NECK_Z], P[P[:, 2] > NECK_Z]
mid_x = float(np.median(brain[:, 0]))
low_back = brain[(np.abs(brain[:, 0] - mid_x) < 9000) & (brain[:, 1] > 43000)]
a = [mid_x, float(np.median(low_back[:, 1])), float(np.percentile(low_back[:, 2], 90))]
front = cord[cord[:, 2] < np.percentile(cord[:, 2], 3)]
b = [float(np.median(cord[:, 0])), float(np.median(front[:, 1])), float(front[:, 2].mean())]

# ---- one line per descending / ascending neuron: to its strongest partner across the neck
z = np.load(f"{raw}/mcns_syncount_all_neuron.npz", allow_pickle=False)
A = sp.csc_matrix((z["data"], z["indices"], z["indptr"]), shape=tuple(z["shape"])).tocsr()
where = np.full(len(m), -1); where[keep] = np.arange(len(keep))
in_cord = np.zeros(len(m), bool); in_cord[keep] = P[:, 2] > NECK_Z
has = where >= 0
pairs = []
for i in m.index[m["superclass"].isin(["descending_neuron", "ascending_neuron"]) & has]:
    row = A.getrow(i)
    ok = has[row.indices] & (in_cord[row.indices] != in_cord[i])
    if ok.any():
        j = row.indices[ok][np.argmax(row.data[ok])]
        pairs.append((where[i], where[j]))
pairs = np.array(pairs, dtype="<u4")

cloud = {
    "dataset": "MaleCNS v1.0, CC BY 4.0", "count": int(len(P)), "lo": lo.tolist(), "hi": hi.tolist(),
    "xyz": base64.b64encode(q.tobytes()).decode(),
    "brainCentre": brain.mean(0).round().tolist(),
    "neck": {"a": a, "b": b, "radius": 2600},
    "tracts": base64.b64encode(pairs.tobytes()).decode(), "tractCount": int(len(pairs)),
}
json.dump(cloud, open(out, "w"), separators=(",", ":"))
print("neurons with a position:", len(P), "of", len(m), "| tracts:", len(pairs), "| neck", np.round(a), "->", np.round(b))
