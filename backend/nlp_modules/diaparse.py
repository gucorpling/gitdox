from argparse import ArgumentParser
from diaparser.parsers import Parser
import sys, re, os

parser = None
script_dir = os.path.dirname(os.path.realpath(__file__))
# You will need a diaparser model file in the same directory as this script for it to work:
model_name = 'en_gum11.electra-base.pt'

if not os.path.exists(script_dir + os.sep + model_name):
    sys.stderr.write(f"ERROR: The diaparser model file '{model_name}' is missing in the script directory '{script_dir}'.\n")
    

def conllize(in_text,tag=None, element=None, pos_name="pos", lemma_name="lemma", no_zero=False,
             ten_cols=False,with_text=False):

    xml = False
    if element is not None:
        xml = True
    pos_elements = lemma_elements = False
    if xml and "\t" not in in_text:
        if ' ' + pos_name + '=' in in_text:
            pos_elements = True
        if ' ' + lemma_name + '=' in in_text:
            lemma_elements = True

    outlines = []
    counter = 1
    for line in in_text.replace("\r","").split("\n"):
        if len(line.strip()) > 0:
            tabs = line.count("\t")
            if not pos_elements:
                pos = "_"
            if not lemma_elements:
                lemma = "_"
            morph = "_"
            if tabs == 0:
                tok = line
            else:
                fields = line.split("\t")
                tok = fields[0]
                pos = fields[1]
                if tabs > 1:
                    lemma = fields[2]
                if tabs > 2:
                    morph = fields[3]
            if not (line.startswith("<") and line.endswith(">")):  # Do not make tokens out of XML elements
                if no_zero:
                    fields = [str(counter), tok, lemma, pos, pos, morph, "_", "_"]
                else:
                    fields = [str(counter),tok,lemma,pos,pos,morph,"0","_"]
                if ten_cols:
                    fields += ["_","_"]
                outlines.append("\t".join(fields))
                if outlines[-1].count("\t")>9:
                    sys.stderr.write("WARN: found " + str(outlines[-1].count("\t")) + " tabs in conll data!\n")
                    sys.stderr.write("WARN: do your tokens contain tabs?\n")
                counter += 1
            if xml:
                if "</" + element + ">" in line:
                    counter = 1
                    outlines.append("")
                if " " + pos_name + "=" in line:
                    pos = re.search(r' ' + pos_name + r'="([^"]*)"',line).group(1)
                if " " + lemma_name + "=" in line:
                    lemma = re.search(r' ' + lemma_name + r'="([^"]*)"',line).group(1)
            else:
                if pos == tag:
                    counter = 1
                    outlines.append("")
    if with_text:
        out_sents = []
        sents = "\n".join(outlines).strip().split("\n\n")
        for sent in sents:
            words = []
            for line in sent.split("\n"):
                if "\t" in line:
                    words.append(line.split("\t")[1])
            sent = "# text = " + " ".join(words) + "\n" + sent
            out_sents.append(sent)
        outlines = "\n\n".join(out_sents).split("\n")
    return "\n".join(outlines)


def merge(conllu, deprels):
    """
    A function that merges dependency relations from a separate deprel file into a CoNLL-U formatted string. 
    It takes two strings as input: `conllu`, which is the CoNLL-U formatted string, and `deprels`, which contains the dependency relations. The function processes each sentence in both inputs, updating the head and dependency relation fields in the CoNLL-U data with the corresponding values from the deprel data. The merged result is returned as a new CoNLL-U formatted string.
    """
    output = []
    sents = conllu.strip().split("\n\n")
    deprels = deprels.strip().split("\n\n")
    for i, sent in enumerate(sents):
        parse = deprels[i].split("\n")
        for l, line in enumerate(sent.split("\n")):
            head, func = parse[l].split("\t")[6:8]
            fields = line.split("\t")
            fields[6] = head
            fields[7] = func.replace(":outer","")
            if len(fields) == 8:
                fields.append("_")
                fields.append("_")

            line = "\t".join(fields)
            output.append(line)
        output.append("")
    return "\n".join(output).strip() + "\n\n"


def conllu2sgml(tt_sgml, conllu):
    """
    A function that converts CoNLL-U formatted data back into SGML format. 
    It takes two strings as input: `tt_sgml`, which is the original SGML string, and `conllu`, which contains the 
    CoNLL-U formatted data. 
    
    We find all of the token lines in the TT SGML (lines without tags) and append three fields, tab delimited, tokenwise:
    - ID (converted to an absolute running ID, unique across the entire document)
    - Head (same absolute ID mapping)
    - Deprel label
    """
    sents = conllu.strip().split("\n\n")
    deps = []
    mapping = {}
    toknum = 0
    for snum, sent in enumerate(sents):
        lines = sent.split("\n")
        for line in lines:
            if "\t" in line:
                fields = line.split("\t")
                if "." in fields[0] or "-" in fields[0]:
                    continue
                toknum += 1
                mapping[(snum, fields[0])] = str(toknum)
                deps.append([snum, fields[0], fields[6], fields[7]])

    output = []
    toknum = 0
    for line in tt_sgml.replace("\r","").split("\n"):
        if len(line.strip()) > 0:
            if not (line.startswith("<") and line.endswith(">")):  # Do not make tokens out of XML elements
                snum, tid, head, deprel = deps[toknum]
                mapped_tid = mapping.get((int(snum), tid))
                mapped_head = mapping.get((int(snum), head)) if head != "0" else "0"
                line = f'<_ deprel="{deprel}" parent="{mapped_head}" uid="{mapped_tid}">\n{line}\n</_>'
                toknum += 1
            output.append(line)

    return "\n".join(output).strip() + "\n"


def diaparse(tt_sgml, parser=None, tag=None, element="s_type"):

    if parser is None:
        parser = Parser.load(script_dir + os.sep + model_name)

    conllu = conllize(tt_sgml, tag=tag, element=element, no_zero=True, ten_cols=True, with_text=False)
    sents = conllu.strip().split("\n\n")
    parser_input = []

    for sent in sents:
        words = [(l.split("\t")[0],l.split("\t")[1]) for l in sent.split("\n") if "\t" in l]
        words = [w[1] for w in words if "." not in w[0] and "-" not in w[0]]
        parser_input.append(words)

    dataset = parser.predict(parser_input, prob=True)

    out_parses = []
    for sent in dataset.sentences:
        out_parses.append(str(sent).strip())

    conllu = "\n\n".join(out_parses) + "\n\n"
    sgml = conllu2sgml(tt_sgml, conllu)

    return sgml


if __name__ == "__main__":

    p = ArgumentParser()
    p.add_argument("sgml", help="Path to the input SGML file containing the text to be parsed.")
    args = p.parse_args()

    parser = Parser.load(script_dir + os.sep + model_name)
    sgml = open(args.sgml, "r", encoding="utf-8").read()
    sgml = diaparse(sgml,parser=parser,element="s_type")
    print(sgml)
