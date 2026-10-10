"""Extract the mushroom body learning circuit from the MaleCNS v1.0 connectome.

Input : the two files mirrored at github.com/YijieYin/connectome_data_prep
          data/maleCNS/mcns_syncount_all_neuron.npz   (synapse-count matrix, rows = pre, cols = post)
          data/maleCNS/mcns_all_neuron_meta.csv       (one row per neuron)
Output: data/circuit.json  -- every number in it is a measured synapse count or annotation.

Selection rules (no behavioural measure is used anywhere):
  PN   : cholinergic uniglomerular antennal-lobe projection neurons, from glomeruli that make
         at least MIN_GLOM_SYN synapses onto Kenyon cells
  KC   : Kenyon cells receiving at least MIN_KC_SYN synapses from those PNs (the olfactory ones)
  MBON : all 97 mushroom body output neurons
  DAN  : all PAM (reward) and PPL1 (punishment) dopamine neurons

Usage: python3 tools/build_circuit.py <dir with the two raw files> data/circuit.json
"""
import json, sys
import numpy as np, pandas as pd, scipy.sparse as sp

MIN_GLOM_SYN, MIN_KC_SYN = 500, 20
raw, out = sys.argv[1], sys.argv[2]

z = np.load(f"{raw}/mcns_syncount_all_neuron.npz", allow_pickle=False)
assert z["format"].item() == b"csc"
A = sp.csc_matrix((z["data"], z["indices"], z["indptr"]), shape=tuple(z["shape"])).tocsr()
m = pd.read_csv(f"{raw}/mcns_all_neuron_meta.csv", low_memory=False)
assert (m["idx"].values == np.arange(len(m))).all() and A.shape[0] == len(m)
typ = m["type"].fillna("")
rows = lambda mask: m.index[mask].values

# sanity: the matrix really is pre -> post (PN->KC must dwarf KC->PN)
kc_all, pn_all = rows(m["class"] == "Kenyon_Cell"), rows(m["class"] == "ALPN")
assert A[pn_all][:, kc_all].sum() > 20 * A[kc_all][:, pn_all].sum()

# ---- projection neurons, grouped by glomerulus
uni = (m["class"] == "ALPN") & (m["top_nt"] == "acetylcholine") & ~typ.str.startswith(("M_", "CB"))
pn = rows(uni)
glom_of = typ[pn].str.replace(r"_.*$", "", regex=True).values
pn_out = np.asarray(A[pn][:, kc_all].sum(1)).ravel()
gsum = pd.Series(pn_out).groupby(glom_of).sum().sort_values(ascending=False)
gloms = [g for g, s in gsum.items() if s >= MIN_GLOM_SYN]
keep = np.array([g in gloms for g in glom_of]) & (pn_out > 0)
pn, glom_of = pn[keep], glom_of[keep]

# ---- Kenyon cells with olfactory input
kc_in = np.asarray(A[pn][:, kc_all].sum(0)).ravel()
kc = kc_all[kc_in >= MIN_KC_SYN]

mbon = rows(m["class"] == "MBON")
pam, ppl1 = rows(typ.str.startswith("PAM")), rows(typ.str.startswith("PPL1"))
apl = rows(typ == "APL")

def edges(pre, post):
    B = A[pre][:, post].tocoo()
    o = np.lexsort((B.row, B.col))
    return np.stack([B.row[o], B.col[o], B.data[o]], 1).astype(int).ravel().tolist()

def soma(ids):
    pts = []
    for s in m.loc[ids, "somaLocation"]:
        pts.append([int(v) for v in s.strip("[]").split()] if isinstance(s, str) else None)
    good = np.array([p for p in pts if p is not None])
    med = np.median(good, 0).astype(int).tolist()
    return [p if p is not None else med for p in pts]

def cells(ids, extra=None):
    d = {"bodyId": m.loc[ids, "bodyid"].astype(int).tolist(),
         "type": m.loc[ids, "type"].tolist(),
         "side": m.loc[ids, "somaSide"].fillna("?").tolist(),
         "soma": soma(ids)}
    d.update(extra or {})
    return d

nt = m.loc[mbon, "top_nt"].values
circuit = {
    "dataset": "MaleCNS v1.0 (Berg et al., FlyEM / HHMI Janelia, Cambridge, MRC LMB, Google Research), CC BY 4.0",
    "source": "preprocessed matrices from github.com/YijieYin/connectome_data_prep (data/maleCNS)",
    "selection": {"minGlomerulusSynapses": MIN_GLOM_SYN, "minKcSynapses": MIN_KC_SYN},
    "glomeruli": gloms,
    "glomerulusSynapses": [int(gsum[g]) for g in gloms],
    "pn": cells(pn, {"glom": [gloms.index(g) for g in glom_of]}),
    "kc": cells(kc, {"aplSynapses": np.asarray(A[apl][:, kc].sum(0)).ravel().astype(int).tolist()}),
    "mbon": cells(mbon, {
        "transmitter": nt.tolist(),
        # Aso et al. 2014: glutamatergic MBONs drive avoidance, cholinergic and GABAergic ones approach
        "valence": [-1 if t == "glutamate" else 1 for t in nt],
        "pamSynapses": np.asarray(A[pam][:, mbon].sum(0)).ravel().astype(int).tolist(),
        "ppl1Synapses": np.asarray(A[ppl1][:, mbon].sum(0)).ravel().astype(int).tolist()}),
    "pam": cells(pam), "ppl1": cells(ppl1),
    "pnKc": edges(pn, kc),        # flat [pn, kc, synapses, ...]
    "kcMbon": edges(kc, mbon),    # flat [kc, mbon, synapses, ...]
}
circuit["counts"] = {
    "glomeruli": len(gloms), "pn": len(pn), "kc": len(kc), "mbon": len(mbon), "pam": len(pam), "ppl1": len(ppl1),
    "pnKcConnections": len(circuit["pnKc"]) // 3, "pnKcSynapses": int(sum(circuit["pnKc"][2::3])),
    "kcMbonConnections": len(circuit["kcMbon"]) // 3, "kcMbonSynapses": int(sum(circuit["kcMbon"][2::3])),
    "wholeConnectomeNeurons": int(len(m)), "wholeConnectomeConnections": int(A.nnz), "wholeConnectomeSynapses": int(A.sum()),
}
json.dump(circuit, open(out, "w"), separators=(",", ":"))
print(json.dumps(circuit["counts"], indent=1))
v = np.array(circuit["mbon"]["valence"]); P = np.array(circuit["mbon"]["pamSynapses"]); Q = np.array(circuit["mbon"]["ppl1Synapses"])
print("PAM synapses onto avoid MBONs: %.1f%%   PPL1 synapses onto approach MBONs: %.1f%%" % (100 * P[v < 0].sum() / P.sum(), 100 * Q[v > 0].sum() / Q.sum()))
for k in ("pn", "kc", "mbon", "pam", "ppl1"):
    s = np.array(circuit[k]["soma"]); print(k, "soma min", s.min(0), "max", s.max(0))
