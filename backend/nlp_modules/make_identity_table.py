from glob import glob
from depedit import DepEdit
from collections import defaultdict
import re

counts = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))

# Coptic
pub_corpora = "Corpora/"  # Path to clone of CopticScriptorium/Corpora

sgml_files = glob(pub_corpora + "**/*.tt", recursive=True)

for f in sgml_files:
    sgml = open(f)
    for line in sgml.readlines():
        if "<entity " in line and "identity=" in line:
            identity = re.search(r' identity="([^"]+)"', line).group(1)
            etype = re.search(r' entity="([^"]+)"', line).group(1)
            text = re.search(r' text="([^"]+)"', line).group(1)
            counts[text][etype][identity]+=1

# English
gum_target = "GUM/_build/target/dep/not-to-release/"  # Path to GUM repo _build/target/dep/not-to-release/

conllu_files = glob(gum_target + "*.conllu")


d = DepEdit()


for f in conllu_files:
    conllu = open(f, "r").read()
    d.run_depedit(conllu,parse_entities=True)

    for m in d.mentions:
        a=4
        if "identity" in m.annos:
            identity = m.annos["identity"]
            minspan = m.annos["minspan"]
            head_toks = [int(x)-1 for x in minspan.split(",")]
            for t, tok in enumerate(m.tokens):
                if t in head_toks:
                    if tok.pos == "PROPN":
                        etype = m.annos["etype"]
                        text = m.text
                        counts[text][etype][identity]+=1
                        break


output = []
for text in counts:
    for etype in counts[text]:
        # Get max count identity
        max_identity = max(counts[text][etype], key=counts[text][etype].get)
        output.append("\t".join([text, etype, max_identity]))

output.sort()
with open("identities.tab",'w',encoding="utf8",newline="\n") as f:
    f.write("\n".join(output))