#!/usr/bin/python
# -*- coding: utf-8 -*-

import stanza, io
from argparse import ArgumentParser

vocab = set(io.open("eng_vocab.tab",encoding="utf8").read().strip().split("\n"))

def fix_lemma(word, pos, lemma):
    non_lemmas = {"them":"they", "me":"I", "him":"he", "n't":"not",'vlogg':"vlog"}
    non_lemma_combos = {("PRP", "her"): "she", ("MD", "wo"): "will", ("PRP", "us"):"we", ("DT", "an"):"a",
                        ("POS","be"):"'s", ("POS","have"):"'s"}
    non_cap_lemmas = ["There", "How", "Why", "Where", "When"]
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
    elif pos =="-RRB-":
        pos = ")"
    elif pos ==".":
        pos = "SENT"

    if pos=="RB" and lemma=="ago":
        pos="IN"

    return pos


def main():
    test = False
    if test:
        nlp = stanza.Pipeline(lang='en', package='gum', processors='tokenize,pos,lemma', tokenize_pretokenized=False)
        #stanza.download("en",package="gum")
        doc = nlp('Barack Obama was born in Hawaii.')
        print(*[f'word: {word.text}\tupos: {word.upos}\txpos: {word.xpos}\tfeats: {word.feats if word.feats else "_"}' for
        sent in doc.sentences for word in sent.words], sep='\n')
        quit()

    else:
        p = ArgumentParser()
        p.add_argument("file")

        opts = p.parse_args()
        infile = opts.file

        data = io.open(infile,encoding="utf8").read()
        tokens = data.strip().split("\n")
        tokens = " ".join(tokens)

        nlp = stanza.Pipeline(lang='en', package='gum', processors='tokenize,pos,lemma', tokenize_pretokenized=True)
        doc = nlp(tokens)

        words = [word for sent in doc.sentences for word in sent.words]

        output = []
        for word in words:
            lemma = fix_lemma(word.text, word.xpos, word.lemma)
            pos = extend_ptb(word.xpos, lemma)
            line = "\t".join([pos,pos,lemma])  # word.text,
            output.append(line)

        with io.open('stan_out.tt','w',encoding="utf8",newline="\n") as f:
            f.write("\n".join(output))


if __name__ == "__main__":
    #print(fix_lemma("continuing","VBG","continu"))
    #print(fix_lemma("witnesses", "NNS", "witnesse"))
    #print(fix_lemma("appealed", "VBD", "appeale"))
    #print(fix_lemma("pledged", "VBD", "pledg"))
    #quit()
    main()
