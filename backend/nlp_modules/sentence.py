import stanza
import os, sys, re, io
try:
    from reorder_sgml import reorder
except:
    from .reorder_sgml import reorder
from collections import OrderedDict, defaultdict

script_dir = os.path.dirname(os.path.realpath(__file__)) + os.sep
lib_dir = script_dir + ".." + os.sep + "lib" + os.sep

TAGS = [
    "sp",
    "table",
    "row",
    "cell",
    "head",
    "p",
    "figure",
    "caption",
    "list",
    "item",
    "quote",
    "s",
    "q",
    "hi",
    "sic",
    "ref",
    "date",
    "incident",
    "w",
]
BLOCK_TAGS = ["sp", "head", "p", "figure", "caption", "list", "item"]
OPEN_SGML_ELT = re.compile(r"^<([^/ ]+)( .*)?>$")
CLOSE_SGML_ELT = re.compile(r"^</([^/]+)>$")


def maximal_nontoken_span_end(sgml_list, i):
    """Return j such that sgml_list[i:j] does not contain tokens
    and no element that is begun in the MNS is closed in it."""
    opened = []
    j = i
    while j < len(sgml_list):
        line = sgml_list[j]
        open_match = re.match(OPEN_SGML_ELT, line)
        close_match = re.match(CLOSE_SGML_ELT, line)
        if not (open_match or close_match):
            break
        if open_match:
            opened.append(open_match.groups()[0])
        if close_match and close_match.groups()[0] in opened:
            break
        j += 1
    return j


def fix_malformed_sentences(sgml_list):
    """
    Fixing malformed SGML seems to boil down to two cases:

    (1) The sentence is interrupted by the close of a tag that opened before it. In this case,
        update the s boundaries so that we close and begin sentences at the close tag:

                             <a>
                <a>          ...
                ...          <s>
                <s>          ...
                ...    ==>   </s>
                </a>         </a>
                ...          <s>
                </s>         ...
                             </s>

    (2) Some tag opened inside of the sentence and has remained unclosed at the time of sentence closure.
        In this case, we choose not to believe the sentence split, and merge the two sentences:

                <s>
                ...          <s>
                <a>          ...
                ...          <a>
                </s>   ==>   ...
                <s>          ...
                ...          </a>
                </a>         ...
                ...          </s>
                </s>
    """
    tag_opened = defaultdict(list)
    i = 0
    while i < len(sgml_list):
        line = sgml_list[i].strip()
        open_match = re.search(OPEN_SGML_ELT, line)
        close_match = re.search(CLOSE_SGML_ELT, line)
        if open_match:
            tag_opened[open_match.groups()[0]].append(i)
        elif close_match:
            tagname = close_match.groups()[0]
            j = maximal_nontoken_span_end(sgml_list, i + 1)
            mns = sgml_list[i:j]

            # case 1: we've encountered a non-s closing tag. If...
            if (
                tagname != "s"  # the closing tag is not an s
                and len(tag_opened["s"]) > 0  # and we're in a sentence
                and len(tag_opened[tagname]) > 0
                and len(tag_opened["s"]) > 0  # and the sentence opened after the tag
                and tag_opened[tagname][-1] < tag_opened["s"][-1]
                and "</s>" not in mns  # the sentence is not closed in the mns
            ):
                # end sentence here and move i back to the line we were looking at
                sgml_list.insert(i, "</s>")
                i += 1
                # open a new sentence at the end of the mns and note that we are no longer in the sentence
                sgml_list.insert(j + 1, "<s>")
                tag_opened["s"].pop(-1)
                # we have successfully closed this tag
                tag_opened[tagname].pop(-1)
            # case 2: s closing tag and there's some tag that opened inside of it that isn't closed in time
            elif tagname == "s" and any(
                e != "s" and f"</{e}>" not in mns
                for e in [
                    e
                    for e in tag_opened.keys()
                    if len(tag_opened[e]) > 0 and len(tag_opened["s"]) > 0 and tag_opened[e][-1] > tag_opened["s"][-1]
                ]
            ):
                # some non-s element opened within this sentence and has not been closed even in the mns
                assert "<s>" in mns
                sgml_list.pop(i)
                i -= 1
                sgml_list.pop(i + mns.index("<s>"))
            else:
                tag_opened[tagname].pop(-1)
        i += 1
    return sgml_list


def is_sgml_tag(line):
    return line.startswith("<") and line.endswith(">")


def unescape(token):
    token = token.replace("&quot;", '"')
    token = token.replace("&lt;", "<")
    token = token.replace("&gt;", ">")
    token = token.replace("&amp;", "&")
    token = token.replace("&apos;", "'")
    return token



class StanzaSentSplitter():

    def __init__(self):
        # Stanza english depparse pipeline using gum package
        self.pipeline = None

    def load_model(self):
        self.pipeline = stanza.Pipeline(lang="en", package="gum",processors="tokenize,mwt,lemma,pos,depparse")

    def predict(self, tt_sgml, outmode="binary"):
        def is_tok(sgml_line):
            return len(sgml_line) > 0 and not (sgml_line.startswith("<") and sgml_line.endswith(">"))

        def is_sent(line):
            return line in ["<s>", "</s>"] or line.startswith("<s ")

        if self.pipeline is None:
            self.load_model()

        tt_sgml = unescape(tt_sgml)  # Splitter is trained on UTF-8 forms, since LM embeddings know characters like '&'
        lines = tt_sgml.strip().split("\n")
        toks = [l for l in lines if is_tok(l)]
        toks = [re.sub(r"\t.*", "", t) for t in toks]
        text = ' '.join(toks)

        # Predict sentence split points based on stanza tokenization
        doc = self.pipeline(text)

        # Map sentence split predictions from Stanza back to our tokens
        labels = [0] * len(toks)
        labels[0] = 1  # The first token is inherently a sentence start
        chr2tok = {}
        index = 0
        for t, tok in enumerate(toks):
            for c in tok:
                chr2tok[index] = t
                index += 1

        index = 0
        for sent in doc.sentences:
            tid = chr2tok[index]  # This is the token index of the first character in the sentence
            labels[tid] = 1
            for word in sent.words:
                word = word.text
                index += len(word)

        if outmode == "binary":
            return labels

        # Generate edited XML if desired
        output = []
        counter = 0
        first = True
        for line in tt_sgml.strip().split("\n"):
            if is_sent(line):  # Remove existing sentence tags
                continue
            if is_tok(line):
                if labels[counter] == 1:
                    if not first:
                        output.append("</s>")
                    output.append("<s>")
                    first = False
                counter += 1
            output.append(line)
        output.append("</s>")  # Final closing </s>

        output = reorder("\n".join(output))

        return output.strip() + "\n"

    def split(self, xml_data):
        # Sometimes the tokenizer doesn't newline every elt
        xml_data = xml_data.replace("><", ">\n<")
        # Ad hoc fix for a tokenization error
        xml_data = xml_data.replace("°<", "°\n<")

        # don't feed the sentencer our pos and lemma predictions, if we have them
        no_pos_lemma = re.sub(r"([^\n\t]*?)\t[^\n\t]*?\t[^\n\t]*?\n", r"\1\n", xml_data)
        split_indices = self.predict(no_pos_lemma)

        # for xml
        counter = 0
        splitted = []
        opened_sent = False
        para = True

        for l, line in enumerate(xml_data.strip().split("\n")):
            if not is_sgml_tag(line):
                # Token
                if split_indices[counter] == 1 or para:
                    if opened_sent:
                        rev_counter = len(splitted) - 1
                        while is_sgml_tag(splitted[rev_counter]):
                            rev_counter -= 1
                        splitted.insert(rev_counter + 1, "</s>")
                    splitted.append("<s>")
                    opened_sent = True
                    para = False
                counter += 1
            elif any(f"<{elt}>" in line for elt in BLOCK_TAGS) or any(
                f"</{elt}>" in line for elt in BLOCK_TAGS
            ):  # New block, force sentence split
                para = True
            splitted.append(line)

        if opened_sent:
            rev_counter = len(splitted) - 1
            while is_sgml_tag(splitted[rev_counter]):
                rev_counter -= 1
            splitted.insert(rev_counter + 1, "</s>")

        lines = "\n".join(splitted)
        lines = reorder(lines)
        lines = fix_malformed_sentences(lines.split("\n"))
        lines = "\n".join(lines)
        lines = reorder(lines)

        return lines.strip() + "\n"

def ssplit(xml):
    splitter = StanzaSentSplitter()
    return splitter.split(xml)


if __name__ == "__main__":
    from argparse import ArgumentParser

    p = ArgumentParser()
    p.add_argument("file", help="TT SGML file to test sentence splitting on, or training dir")
    p.add_argument(
        "-o",
        "--out_format",
        choices=["binary", "sgml"],
        help="output list of binary split indices or TT SGML",
        default="sgml",
    )

    opts = p.parse_args()
    sentencer = StanzaSentSplitter()

    sgml = io.open(opts.file, encoding="utf8").read()
    sgml = [l.split("\t")[0] for l in sgml.split("\n")]
    sgml = "\n".join(sgml)
    result = sentencer.split(sgml)
    print(result)
