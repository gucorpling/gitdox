#!/usr/bin/python3.11
# -*- coding: utf-8 -*-

import io, os
import stanza
from argparse import ArgumentParser

script_dir = os.path.dirname(os.path.realpath(__file__)) + os.sep
vocab = set(io.open(script_dir + "eng_vocab.tab",encoding="utf8").read().strip().split("\n"))

def fix_lemma(word, pos, lemma):
    non_lemmas = {"them":"they", "me":"I", "him":"he", "n't":"not",'vlogg':"vlog","whom":"who","worshippe":"worship"}
    non_lemma_combos = {("PRP", "her"): "she", ("MD", "wo"): "will", ("PRP", "us"):"we", ("DT", "an"):"a",
                        ("POS","be"):"'s", ("POS","have"):"'s",("NN","datum"):"data", ("NNS","datum"):"data"}
    non_cap_lemmas = ["There", "How", "Why", "Where", "When"]
    num_lemmas = {"two":"2","three":"3","four":"4","five":"5","six":"6","seven":"7","eight":"8","nine":"9",
                  "ten":"10","eleven":"11","dozen":"12", "thirteen":"13", "fourteen":"14", "fifteen":"15",
                  "sixteen":"16", "seventeen":"17", "eighteen":"18", "nineteen":"19", "twenty":"20",
                  "thirty":"30", "forty":"40", "fourty":"40", "fifty":"50", "sixty":"60", "seventy":"70",
                  "eighty":"80", "ninety":"90", "hundred":"100", "thousand":"1000", "million":"1000000",
                  "billion":"1000000000","trillion":"1000000000000"}
    false_non_e = {"pleas","tun"}  # e.g. pleas is a word, but not the lemma of pleased, tun != tune(d)

    if lemma in non_cap_lemmas:
        lemma = lemma.lower()

    if (pos,lemma) in non_lemma_combos:
        lemma = non_lemma_combos[(pos,lemma)]

    if lemma in non_lemmas:
        lemma = non_lemmas[lemma]

    if pos == "NN" and word.endswith("ing"):
        if not lemma.endswith("ing"):
            lemma = word

    if pos == "VBG" and word.endswith("ing") and not word.endswith("inging"):
        if lemma.endswith("ing"):
            lemma = word.replace("ing","")
            if lemma not in vocab:
                if lemma + "e" in vocab:
                    lemma = lemma + "e"
        elif lemma not in vocab and lemma + "e" in vocab:
            lemma += "e"
        elif lemma not in vocab and lemma.endswith("e"):
            if lemma[:-1] in vocab:
                lemma = lemma[:-1]

    if pos in ["VBN","VBD"] and word.endswith("ed") and not word.endswith("eded"):
        if lemma.endswith("ed"):
            lemma = word.replace("ed","")
            if lemma not in vocab or lemma in false_non_e:
                if lemma + "e" in vocab:
                    lemma = lemma + "e"
        elif lemma.endswith("e"):
            if lemma not in vocab and lemma[:-1] in vocab:
                lemma = lemma[:-1]
        elif lemma not in vocab:
            if lemma + "e" in vocab:
                lemma += "e"

    if pos == "JJ" and word.endswith("ed"):
        if not lemma.endswith("ed"):
            lemma = word

    if pos =="CD" and word.lower() in num_lemmas:
        pass
        #lemma = num_lemmas[word.lower()]

    if word.endswith("d") and lemma == "will" and pos =="MD":
        lemma="would"

    if pos == "NNS" and word.endswith("sses"):  # witnesses:witnesse -> witness
        if lemma.endswith("sse"):
            if lemma not in vocab and lemma[:-1] in vocab:
                lemma = lemma[:-1]

    lemma = lemma.replace('"',"''")  # for ethercalc pastability

    return lemma


def extend_ptb(pos, lemma):
    lemma = lemma.lower()
    if lemma=="be" and pos.startswith("VB"):
        pass
    elif lemma=="have" and pos.startswith("VB"):
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

def stanza_tag(tokens):
    import stanza
    from stanza.pipeline.core import DownloadMethod

    nlp = stanza.Pipeline(lang='en', package='gum', processors='tokenize,pos,lemma', tokenize_pretokenized=True)
                          #model_dir=script_dir + "stanza_resources", download_method=DownloadMethod.NONE)
    doc = nlp(tokens)

    words = [word for sent in doc.sentences for word in sent.words]

    output = []
    for word in words:
        lemma = fix_lemma(word.text, word.xpos, word.lemma)
        pos = extend_ptb(word.xpos, lemma)
        line = "\t".join([pos, pos, lemma])  # word.text,
        output.append(line)
    return "\n".join(output)


def main(sgml="", s_tag="s_type"):
    if sgml:
        to_tag = []
        if s_tag:
            if s_tag in sgml:
                sents = sgml.split("</" + s_tag + ">")[0:-1]
                for s in sents:
                    lines = s.split("\n")
                    lines = [line.strip() for line in lines if len(line.strip()) > 0 and not (line.startswith("<") and line.endswith(">"))]
                    to_tag.append(lines)
            else:
                # One giant text
                to_tag.append([l for l in sgml.split("\n") if len(l.strip()) > 0 and not (l.startswith("<") and l.endswith(">"))])
        else:
            # One giant text
            to_tag.append([l for l in sgml.split("\n") if len(l.strip()) > 0 and not (l.startswith("<") and l.endswith(">"))])

        # Stanza pos tag and lemmatize with pretokenized input
        nlp = stanza.Pipeline(lang='en', package="gum", processors='tokenize,pos,lemma', tokenize_pretokenized=True)

        # Collect pos and lemma for each token
        doc = nlp(to_tag)
        words = [word for sent in doc.sentences for word in sent.words]
        pos_lemmas = []
        for word in words:
            lemma = fix_lemma(word.text, word.xpos, word.lemma)
            pos = extend_ptb(word.xpos, lemma)
            pos_lemmas.append((word.text, pos, lemma))

        # Wrap TT SGML tokens with pos and lemma
        output = []
        word_index = 0
        for line in sgml.split("\n"):
            line = line.strip()
            if not (line.startswith("<") and line.endswith(">")):
                if word_index < len(pos_lemmas):
                    word, pos, lemma = pos_lemmas[word_index]
                    tagged = f"""<_ pos="{pos}" lemma="{lemma}">\n{word}\n</_>"""
                    output.append(tagged)
                    word_index += 1
                    continue
            output.append(line)

        return "\n".join(output)


    else:
        p = ArgumentParser()
        p.add_argument("file")

        opts = p.parse_args()
        infile = opts.file

        data = io.open(infile,encoding="utf8").read()
        tokens = data.strip().split("\n")
        tokens = " ".join(tokens)

        tagged = stanza_tag(tokens)

        with io.open('stanza_out.tt','w',encoding="utf8",newline="\n") as f:
            f.write(tagged)


if __name__ == "__main__":

    main()
