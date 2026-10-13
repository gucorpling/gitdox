#!/usr/bin/python3.11
# -*- coding: utf-8 -*-

import io, os, platform
from argparse import ArgumentParser
from flair.data import Sentence
from flair.models import SequenceTagger
from random import randint
import os, sys, io
import pathlib

plt = platform.system()
if plt == 'Linux': pathlib.WindowsPath = pathlib.PosixPath

script_dir = os.path.dirname(os.path.realpath(__file__)) + os.sep
vocab = set(io.open(script_dir + "eng_vocab.tab",encoding="utf8").read().strip().split("\n"))


def extend_ptb(pos, word):

    # replace fancy single quotes with apostrophes
    word = word.replace("’","'").replace("‘","'").replace("“","''").replace("”","''").strip().lower()
    if word in ["be","is","am","are","was","were","'re","'s","'m","being","been"] and pos.startswith("V"):
        pos = pos.replace("VV", "VB").replace("VH", "VB")
        pass
    elif word in ["have","had","has","'ve","'d","having"] and pos.startswith("V"):
        pos = pos.replace("VB","VH").replace("VV","VH")
    elif pos.startswith("V"):
        pos = pos.replace("VB","VV").replace("VH","VV")

    if pos=="IN" and word=="that":
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

    if pos=="IN" and word=="ago":
        pos="RB"

    if word in ["$","€","£","¢"]:
        pos = "$"

    return pos

def ablate_pos_lemmas(tuples):
    # Divide the token indices into 5 quintiles:
    # Quintile 1: keep all tags
    # Quintile 2: replace tags and lemmas with "_" at a 0.30 probability
    # Quintile 3: replace tags and lemmas with "_" at a 0.40 probability
    # Quintile 4: replace tags and lemmas with "_" at a 0.80 probability
    # Quintile 5: replace all tags and lemmas with "_"
    output = []
    quintile_size = len(tuples) // 5
    for i, (word, pos) in enumerate(tuples):
        if i < quintile_size:
            pass  # Keep all tags in the first quartile
        elif i < 2 * quintile_size:
            if randint(1,100) <= 40:  # 30% chance to replace
                pos = "_"
        elif i < 3 * quintile_size:
            if randint(1,100) <= 55:  # 40% chance to replace
                pos = "_"
        elif i < 4 * quintile_size:
            if randint(1,100) <= 85:  # 80% chance to replace
                pos = "_"
        else:
            pos = "_"

        output.append((word, pos))

    return output


def predict(tokens):
    model_name = script_dir + "gum-pos-flair.pt"
    model = SequenceTagger.load(model_name)

    tagcol2 = 4 # xpos

    sents = []
    words = []
    prev_token = ""
    for token in tokens:
        if prev_token in ["!",".","?"]:
            if len(words) > 0:
                sents.append(Sentence(" ".join(words), use_tokenizer=False))
                #sents.append(Sentence(" ".join(words), use_tokenizer=lambda x: x.split(" ")))
                words = []
                words.append(token)
        else:
            words.append(token)
        prev_token = token

    if len(words) > 0:
        sents.append(Sentence(" ".join(words), use_tokenizer=False))
        #sents.append(Sentence(" ".join(words), use_tokenizer=lambda x: x.split(" ")))

    # predict tags and print
    model.predict(sents)

    preds = []
    for i, sent in enumerate(sents):
        for tok in sent.tokens:
            #pred = tok.labels[0].value
            pred = tok.labels[-1].value
            preds.append(pred)

    do_postprocess = True
    if do_postprocess:
        preds = post_process(tokens, preds)

    output = []
    toknum = 0

    for i, pred in enumerate(preds):
        final = extend_ptb(pred, tokens[toknum])
        output.append(final)
        toknum += 1

    sys.stderr.write(f"Predicted {len(output)} POS tags for {len(tokens)} tokens.\n")

    return output

def post_process(word_list, pred_list):
    """
    Implement a subset of closed-class words that can only take one of their attested closed class POS tags
    """
    output = []

    closed = {"except": ["IN"],
              "or": ["CC"],
              "another": ["DT"],
              "be": ["VB"]
              }
    # case marking VVG can never be IN:
    vbg_preps = {("including", "IN"): "VBG", ("according", "IN"): "VBG", ("depending", "IN"): "VBG",
                 ("following", "IN"): "VBG", ("involving", "IN"): "VBG",
                 ("regarding", "IN"): "VBG", ("concerning", "IN"): "VBG"}

    top100 = {",": ",", ".": ".", "of": "IN", "is": "VBZ", "you": "PRP", "for": "IN", "was": "VBD", "with": "IN",
              "The": "DT", "are": "VBP", ")": "-RRB-", "(": "-LRB-", "at": "IN", "this": "DT", "from": "IN",
              "or": "CC", "not": "RB", "his": "PRP$", "they": "PRP", "an": "DT", "we": "PRP", "n't": "RB",
              "he": "PRP", "[": "-LRB-", "]": "-RRB-", "has": "VBZ", "my": "PRP$", "their": "PRP$", "It": "PRP",
              "were": "VBD", "In": "IN", "if": "IN", "would": "MD", "”": "''", ";": ":", "into": "IN",
              "when": "WRB", "You": "PRP", "also": "RB", "she": "PRP", "our": "PRP$", "been": "VBN", "who": "WP",
              "We": "PRP", "time": "NN", "He": "PRP", "This": "DT", "its": "PRP$", "did": "VBD", "two": "CD",
              "these": "DT", "many": "JJ", "And": "CC", "!": ".", "should": "MD", "because": "IN", "how": "WRB",
              "If": "IN", "n’t": "RB", "'re": "VBP", "him": "PRP", "'m": "VBP", "city": "NN", "could": "MD",
              "may": "MD", "years": "NNS", "She": "PRP", "really": "RB", "now": "RB", "new": "JJ",
              "something": "NN", "here": "RB", "world": "NN", "They": "PRP", "life": "NN", "But": "CC",
              "year": "NN", "us": "PRP", "between": "IN", "different": "JJ", "those": "DT", "language": "NN",
              "does": "VBZ", "same": "JJ", "going": "VBG", "United": "NNP", "day": "NN", "few": "JJ", "For": "IN",
              "every": "DT", "important": "JJ", "When": "WRB", "things": "NNS", "during": "IN", "might": "MD",
              "kind": "NN", "How": "WRB", "system": "NN", "thing": "NN", "example": "NN", "another": "DT",
              "small": "JJ", "until": "IN", "information": "NN", "away": "RB"}

    scores = []

    # VBG must end in ing/in; VBN may not
    for i, word in enumerate(word_list):
        try:
            pred = pred_list[i]
        except:
            print(len(word_list))
            print(len(pred_list))
            quit()
        if word in top100:
            output.append(top100[word])
        elif (word.lower(), pred) in vbg_preps:
            output.append(vbg_preps[(word.lower(), pred)])
        else:
            output.append(pred)

    # Also VB+RP/RB disambig from large list? PTB+ON?

    return output


def main(sgml="",ablate=True):
    if sgml:
        to_tag = []
        # One giant text
        to_tag = [l for l in sgml.split("\n") if len(l.strip()) > 0 and not (l.startswith("<") and l.endswith(">"))]

        tags = predict(to_tag)

        tuples = [(word, tags[i]) for i, word in enumerate(to_tag)]
        if ablate:
            tuples = ablate_pos_lemmas(tuples)

        # Wrap TT SGML tokens with pos and lemma
        output = []
        word_index = 0
        for line in sgml.split("\n"):
            line = line.strip()
            if not (line.startswith("<") and line.endswith(">")):
                if word_index < len(tuples):
                    word, pos = tuples[word_index]
                    tagged = f"""<_ pos="{pos}">\n{word}\n</_>"""
                    output.append(tagged)
                    word_index += 1
                    continue
            output.append(line)

        return "\n".join(output)

if __name__ == "__main__":
    data = """<meta corpus="eng.erst.gentle" people="none" people="none" places="none" places="none">
<sp_who sp_who="#JasonKropF">
<jj jj="jj">
a
</jj>
Mr.
Speaker
<d d="three">
<c c="three">
,
<t t="rise">
I
</t>
</c>
rise
</d>
<t t="support">
in
</t>
support
of
House
Bill
3984
.
I
'm
going
to
talk
briefly
about
sections
one
through
four
.
</meta>"""
    tagged = main(sgml=data)
    print(tagged)
