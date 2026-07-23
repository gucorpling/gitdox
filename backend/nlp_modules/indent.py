import re
from argparse import ArgumentParser

glue_left = [".",",",";","!","?",")","]","'s","n't","'m","'ll","'re","'d","'ve",":","”"]
glue_right = ["(","[","“"]

def extend_ptb(pos, lemma):

    # replace fancy single quotes with apostrophes
    lemma = lemma.replace("’","'").replace("‘","'").replace("“","''").replace("”","''").strip().lower()
    if lemma == "be" and pos.startswith("VB"):
        pass
    elif lemma == "have" and pos.startswith("VB"):
        pos = pos.replace("VB","VH")
    elif pos.startswith("VB"):
        pos = pos.replace("VB","VV")

    if pos=="IN" and lemma=="that":
        pos="IN/that"

    if pos.startswith("NNP"):
        pos = pos.replace("NNP","NP")
    elif pos.startswith("PRP"):
        pos = pos.replace("PRP","PP")
    elif pos == "-LRB-":
        pos = "("
    elif pos == "-RRB-":
        pos = ")"
    elif pos == "-LSB-":
        pos = "("
    elif pos == "-RSB-":
        pos = ")"
    elif pos ==".":
        pos = "SENT"

    if pos=="IN" and lemma=="ago":
        pos="RB"

    if lemma in ["$","€","£","¢"]:
        pos = "$"

    return pos

def detok(data):
    for x in glue_left:
        data = data.replace(" " + x,x)
        data = data.replace(" " + x.replace("'","’"), x)
    for x in glue_right:
        data = data.replace(x+" ",x)
    return data

def reindent(data, remove_tags=True, remove_xml=False, extend_tags=True, detokenize=True, no_stype=False):

    break_elems = ["</sp>","</p>","</head>","</figure>","<text.*?>"]
    remove_attrs = ['<s type=".*?"']

    if remove_tags:
        data = re.sub(r'\t[^\n\t]+\t[^\n\t]+\n',r'\n',data)
    if detokenize:
        data = re.sub(r'\n',' ',data)

        for elem in break_elems:
            data = re.sub("(" + elem + ")",r'\1\n\n',data)

    if extend_tags:
        output = []
        lines = data.split("\n")
        for line in lines:
            if "\t" in line:
                token, pos, lemma = line.split("\t")
                pos = extend_ptb(pos,lemma)
                line = token + "\t" + pos + "\t" + lemma
            output.append(line)
        data = "\n".join(output)

    if no_stype:
        for attr in remove_attrs:
            data = re.sub(attr,'<s',data)

    data = data.replace(' <s> ','<s>').replace(' </s> ','</s>')

    if detokenize:
        data = detok(data)
    if remove_xml:
        data = re.sub(r'<[^>]+>\n?',r'',data)
    return data


if __name__ == "__main__":

    p = ArgumentParser()
    p.add_argument("file", help="File to reindent")
    p.add_argument("-x","--remove_xml",action="store_true",help="remove_xml")
    p.add_argument("-t","--remove_tags",action="store_true",help="remove_tags")
    p.add_argument("-e","--extend",action="store_true",help="extend_tags")
    p.add_argument("-d","--detokenize",action="store_true",help="detokenize")
    p.add_argument("-s","--stype",action="store_true",help="remove stype attribute from <s> tags")

    args = p.parse_args()

    data = open(args.file).read()

    data = reindent(data, args.remove_tags, args.remove_xml, args.extend, args.detokenize, args.stype)
    data = reindent(data)
    print(data)