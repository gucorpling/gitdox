import io
import re
import sys
import os
import json
import zipfile
import tempfile
import numpy as np
import pandas as pd
from glob import glob
from collections import defaultdict
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.compose import ColumnTransformer
from sklearn.metrics import classification_report
from xgboost import XGBClassifier

script_dir = os.path.dirname(os.path.realpath(__file__)) + os.sep
np.random.seed(42)

DEV_DOCS = ["GUM_academic_exposure", "GUM_academic_librarians", "GUM_bio_byron", "GUM_bio_emperor",
            "GUM_conversation_grounded", "GUM_conversation_risk", "GUM_court_loan", "GUM_court_negligence",
            "GUM_essay_evolved", "GUM_essay_tools", "GUM_fiction_beast", "GUM_fiction_lunre", "GUM_interview_cyclone",
            "GUM_interview_gaming", "GUM_letter_arendt", "GUM_letter_wiki", "GUM_news_homeopathic", "GUM_news_iodine",
            "GUM_podcast_bangladesh", "GUM_podcast_wrestling", "GUM_reddit_macroeconomics", "GUM_reddit_pandas",
            "GUM_speech_impeachment", "GUM_speech_inauguration", "GUM_textbook_governments", "GUM_textbook_labor",
            "GUM_vlog_portland", "GUM_vlog_radiology", "GUM_voyage_athens", "GUM_voyage_coron", "GUM_whow_joke",
            "GUM_whow_overalls"]
TEST_DOCS = ["GUM_academic_discrimination", "GUM_academic_eegimaa", "GUM_bio_dvorak", "GUM_bio_jespersen",
             "GUM_conversation_lambada", "GUM_conversation_retirement", "GUM_court_insanity", "GUM_court_mitigation",
             "GUM_essay_fear", "GUM_essay_system", "GUM_fiction_falling", "GUM_fiction_teeth", "GUM_interview_hill",
             "GUM_interview_libertarian", "GUM_letter_attorney", "GUM_letter_mandela", "GUM_news_nasa",
             "GUM_news_sensitive", "GUM_podcast_bezos", "GUM_podcast_multitasking", "GUM_reddit_escape",
             "GUM_reddit_monsters", "GUM_speech_austria", "GUM_speech_newzealand", "GUM_textbook_chemistry",
             "GUM_textbook_union", "GUM_vlog_london", "GUM_vlog_studying", "GUM_voyage_oakland", "GUM_voyage_vavau",
             "GUM_whow_cactus", "GUM_whow_mice"]

TOKNUM_RE = re.compile(r'^[0-9]+\t')
DEPREL_RE = re.compile(r':.+')
SENT_LEN_RE = re.compile(r'^([0-9]+)\t', flags=re.MULTILINE)
STYPE_RE = re.compile(r'type="([^"]+)"')


class STypeClassifier:

    def __init__(self):
        self.feat_names = [
            "root_pos", "words", "postags", "funcs", "parents", "wordfuncs",
            "hasverb", "hassubj", "len", "case", "root_modal", "do_support", "root_combo_pos"
        ]
        self.model_loaded = False
        self.model_zip_path = os.path.join(script_dir, "stype_model.zip")

        # Mappings for categorical features
        self.root_pos_map = {}
        self.root_combo_map = {}
        self.label_map = {}
        self.reverse_label_map = {}

        # Load from zip if it exists
        if os.path.exists(self.model_zip_path):
            try:
                with tempfile.TemporaryDirectory() as tmpdir:
                    with zipfile.ZipFile(self.model_zip_path, "r") as zf:
                        zf.extractall(tmpdir)

                    with open(os.path.join(tmpdir, "stype_features.json"), "r") as f:
                        config = json.load(f)

                    self.clf = XGBClassifier()
                    self.clf.load_model(os.path.join(tmpdir, "stype_xgb.json"))

                # Restore simple dictionaries
                self.root_pos_map = config["root_pos_map"]
                self.root_combo_map = config["root_combo_map"]
                # JSON converts int keys to strings, so we cast them back to int for the reverse map
                self.reverse_label_map = {int(k): v for k, v in config["reverse_label_map"].items()}

                # Reconstruct Transformer Pipeline
                self.transformer = self.make_transformer(config=config)

                # Simple dummy fit to set internal _is_fitted flags for CountVectorizers
                dummy_data = {
                    "words": [""], "postags": [""], "funcs": [""], "parents": [""], "wordfuncs": [""],
                    "root_pos": [0], "hasverb": [0], "hassubj": [0], "len": [0], "case": [0],
                    "root_modal": [0], "do_support": [0], "root_combo_pos": [0]
                }
                dummy_df = pd.DataFrame(dummy_data)
                self.transformer.fit(dummy_df)

                self.model_loaded = True
            except Exception as e:
                sys.stderr.write(f"Error loading models from zip: {e}\n")
        else:
            sys.stderr.write("Could not find stype_model.zip\nDo you need to train STypeClassifier?\n")

    @staticmethod
    def featurize_sentence(conll_sent):
        conll_lines = conll_sent.split("\n")
        word_list, xpos_list, deprel_list, rel_pair_list, head_list, word_func_list = [], [], [], [], [], []
        root_pos = ""

        for line in conll_lines:
            if TOKNUM_RE.match(line):
                toknum, word, lemma, upos, xpos, morph, head, deprel, _, _ = line.split("\t")
                deprel = DEPREL_RE.sub('', deprel)
                word_list.append(word)
                xpos_list.append(xpos)
                deprel_list.append(deprel)
                head_list.append(head)
                word_func_list.append(word + "_" + deprel)
                if head == "0":
                    root_pos = xpos

        # Propagate root to conj or parataxis child of root
        changes = {}
        root_combo_pos = "_"
        for i, deprel in enumerate(deprel_list):
            if deprel != "root":
                parent_rel = deprel_list[int(head_list[i]) - 1]
                if parent_rel == "root" and deprel in ["conj", "parataxis"]:
                    changes[i] = "root"
                    root_combo_pos = root_pos + "_" + xpos_list[i]
        for i, val in changes.items():
            deprel_list[i] = val

        # Look for root auxiliaries
        changes = {}
        do_support = 0
        for i, deprel in enumerate(deprel_list):
            if deprel != "root":
                parent_rel = deprel_list[int(head_list[i]) - 1]
                if parent_rel == "root" and deprel in ["aux", "aux:pass"]:
                    changes[i] = "rt" + deprel
                    if word_list[i].lower() in ["do", "did"]:
                        do_support = 1
        for i, val in changes.items():
            deprel_list[i] = val

        for i, deprel in enumerate(deprel_list):
            if deprel != "root":
                parent_rel = deprel_list[int(head_list[i]) - 1]
                rel_pair = deprel + "_" + parent_rel
            else:
                rel_pair = "root"
            rel_pair_list.append(rel_pair)

        verb = 1 if any(p.startswith("V") for p in xpos_list) else 0
        subj = 1 if any("subj" in f for f in deprel_list) else 0

        case = 0
        if all(w.isupper() for w in word_list):
            case = 3
        elif all(w.istitle() for w in word_list):
            case = 2
        elif word_list:
            title_prop = sum(1 for w in word_list if w.istitle()) / len(word_list)
            if title_prop > 0.5:
                case = 1

        root_modal = 0
        for i, rel in enumerate(deprel_list):
            if rel == "rtaux" and xpos_list[i] == "MD":
                root_modal = 1

        word_list_str = " ".join(["#"] + word_list + ["#"])
        xpos_list_str = " ".join(["#"] + xpos_list + ["#"])
        deprel_list_str = " ".join(["#"] + deprel_list + ["#"])
        rel_pair_list_str = " ".join(["#"] + rel_pair_list + ["#"])
        word_func_list_str = " ".join(["#"] + word_func_list + ["#"])
        length = word_list_str.count(" ") - 1

        return [root_pos, word_list_str, xpos_list_str, deprel_list_str, rel_pair_list_str,
                word_func_list_str, verb, subj, length, case, root_modal, do_support, root_combo_pos]

    def make_transformer(self, config=None):
        white_funcs = ["nsubj", "obj", "csubj", "nsubj:pass", "csubj:pass", "xcomp", "ccomp", "expl", "advcl", "acl",
                       "acl:relcl", "cop", "mark", "appos", "parataxis", "cc", "conj", "vocative"]
        white_words = ["! #", "!", "# !", "# 'll", "# (", "# )", "# .", "# :", "# ;", "# ?", "# and", "# are", "# as",
                       "# be", "# being", "# can", "# cf.", "# could", "# did", "# do", "# had", "# have", "# how",
                       "# i", "# if", "# is", "# it", "# ll", "# look", "# may", "# might", "# note", "# of", "# or",
                       "# say", "# see", "# shall", "# should", "# so", "# some", "# that", "# then", "# there",
                       "# this", "# to", "# was", "# what", "# where", "# who", "# whom", "# why", "# will", "# you",
                       "# your", "'ll", "( #", "(", ") #", ")", ", so", ". #", ".", ": #", ":", "; #", ";", "? #", "?",
                       "and", "are #", "are", "as", "be #", "be", "being #", "being", "can #", "can", "cf.", "could #",
                       "could", "did #", "did", "do #", "do", "had #", "had", "have #", "have", "how #", "how", "i #",
                       "i", "if", "is #", "is", "it #", "it", "ll", "look #", "look", "may #", "may", "might #",
                       "might", "note", "of #", "of", "or", "say #", "say", "see", "shall #", "shall", "should #",
                       "should", "so #", "so", "some #", "some", "that", "then #", "then", "there #", "there", "this",
                       "to #", "to", "was #", "was", "what #", "what", "where #", "where", "who #", "who", "whom #",
                       "whom", "why #", "why", "will #", "will", "you #", "you", "your #", "your", "been",
                       "n't", "should n't", "could n't", "wo n't", "wo", "must", "must n't", "have to", "not", "got to",
                       "gotta", "need to", "need n't", "had to", "needed to", "may be", "might be",
                       "which", "# which", "would", "# would"]

        if config:
            wordfuncs_kwargs = {"vocabulary": config["wordfuncs_vocab"]}
            parents_kwargs = {"vocabulary": config["parents_vocab"]}
            postags_kwargs = {"vocabulary": config["postags_vocab"], "ngram_range": (1, 3)}
        else:
            wordfuncs_kwargs = {"max_features": 300}
            parents_kwargs = {"max_features": 200}
            postags_kwargs = {"max_features": 200, "ngram_range": (1, 3)}

        func_vectorizer = CountVectorizer(vocabulary=white_funcs, token_pattern=r'[^\s]+')
        word_func_vectorizer = CountVectorizer(token_pattern=r'[^\s]+', **wordfuncs_kwargs)
        func_pair_vectorizer = CountVectorizer(token_pattern=r'[^\s]+', **parents_kwargs)
        pos_vectorizer = CountVectorizer(token_pattern=r'[^\s]+', **postags_kwargs)
        word_vectorizer = CountVectorizer(max_features=700, token_pattern=r'[^\s]+', ngram_range=(1, 3),
                                          vocabulary=white_words)

        # Categoricals are now mapped to integers beforehand, so everything non-text is just passed through
        column_trans = ColumnTransformer(
            transformers=[
                ('words', word_vectorizer, 'words'),
                ('postags', pos_vectorizer, 'postags'),
                ('funcs', func_vectorizer, 'funcs'),
                ('parents', func_pair_vectorizer, 'parents'),
                ('wordfuncs', word_func_vectorizer, 'wordfuncs'),
                ('passthrough_cols', 'passthrough',
                 ['root_pos', 'hasverb', 'hassubj', 'len', 'case', 'root_modal', 'do_support', 'root_combo_pos'])
            ]
        )

        return column_trans

    def predict(self, indata):
        if not self.model_loaded:
            raise RuntimeError("Model not loaded. Please train or provide stype_model.zip.")

        if len(indata) == 0:
            return []
        elif "<s>" in indata or "<s type" in indata:
            sents = []
            words = []
            for line in indata.split("\n"):
                if line == "</s>":
                    sents.append(words)
                    words = []
                elif line.startswith("<") and line.endswith(">"):
                    continue
                elif len(line.strip()) > 0:
                    words.append(line.split("\t")[0].strip())
            import stanza
            pipeline = stanza.Pipeline(lang='en', package="gum", processors='tokenize,mwt,pos,lemma,depparse',
                                       tokenize_pretokenized=True)
            doc = pipeline(sents)
            conllu_string = "{:C}".format(doc)
        else:
            conllu_string = indata

        sents = conllu_string.strip().split("\n\n")
        featlist = [self.featurize_sentence(sent) for sent in sents]
        df = pd.DataFrame(featlist, columns=self.feat_names)

        # Apply dictionary mapping with safe fallback (-1)
        df["root_pos"] = df["root_pos"].map(self.root_pos_map).fillna(-1).astype(int)
        df["root_combo_pos"] = df["root_combo_pos"].map(self.root_combo_map).fillna(-1).astype(int)

        X = self.transformer.transform(df)
        preds_int = self.clf.predict(X)

        # Map predictions back to strings
        preds = [self.reverse_label_map[p] for p in preds_int]

        if "<s>" in indata or "<s type" in indata:
            snum = 0
            output = []
            for line in indata.split("\n"):
                if line == "<s>" or line.startswith("<s "):
                    output.append(f'<s type="{preds[snum]}">')
                    snum += 1
                else:
                    output.append(line)
            return "\n".join(output).strip() + "\n"
        else:
            return preds

    def predict_from_dir(self, conllu_dir, extension="conllu"):
        if not conllu_dir.endswith(os.sep):
            conllu_dir += os.sep
        files = glob(conllu_dir + "*." + extension)
        preds = []
        for file_ in files:
            conll_string = io.open(file_, encoding="utf8").read()
            preds.append(self.predict(conll_string))
        return preds

    def train(self, root_dir, test_docs=None, dev_docs=None, write_table=False, train_with_dev=False, errors=False):
        if dev_docs is None: dev_docs = DEV_DOCS
        if test_docs is None: test_docs = TEST_DOCS

        if not root_dir.endswith(os.sep): root_dir += os.sep
        xml_dir = root_dir + "xml" + os.sep
        dep_dir = root_dir + "dep" + os.sep

        stypes = defaultdict(lambda: defaultdict(str))

        for file_ in glob(xml_dir + "*.xml"):
            lines = io.open(file_, encoding="utf8").readlines()
            docname = os.path.basename(file_).replace(".xml", "")
            counter = 0
            s_type = None
            for line in lines:
                line = line.strip()
                if not line: continue
                if "s type=" in line:
                    match = STYPE_RE.search(line)
                    if match: s_type = match.group(1)
                elif not (line.startswith("<") and line.endswith(">")):
                    stypes[docname][counter] = s_type
                    counter += 1

        headers = self.feat_names + ["partition", "doc", "label"]
        facts = []

        for file_ in glob(dep_dir + "*.conllu"):
            docname = os.path.basename(file_).replace(".conllu", "")
            partition = "train"
            if docname in test_docs:
                partition = "test"
            elif docname in dev_docs:
                partition = "dev"

            sents = io.open(file_, encoding="utf8").read().strip().split("\n\n")
            counter = 0
            for sent in sents:
                slen = len(SENT_LEN_RE.findall(sent))
                feats = self.featurize_sentence(sent)
                stype = stypes[docname][counter]
                facts.append(feats + [partition, docname, stype])
                counter += slen

        df = pd.DataFrame(facts, columns=headers)

        train = df[df["partition"] == "train"].copy()
        dev = df[df["partition"] == "dev"].copy()
        test = df[df["partition"] == "test"].copy()

        # Build Dictionary Encoders
        self.root_pos_map = {k: i for i, k in enumerate(sorted(train["root_pos"].unique()))}
        self.root_combo_map = {k: i for i, k in enumerate(sorted(train["root_combo_pos"].unique()))}
        self.label_map = {k: i for i, k in enumerate(sorted(train["label"].unique()))}
        self.reverse_label_map = {i: k for k, i in self.label_map.items()}

        # Apply Dictionary Encoders with fallback to mapping target variables
        for subset in [train, dev, test]:
            subset["root_pos"] = subset["root_pos"].map(self.root_pos_map).fillna(-1).astype(int)
            subset["root_combo_pos"] = subset["root_combo_pos"].map(self.root_combo_map).fillna(-1).astype(int)
            subset["label_encoded"] = subset["label"].map(self.label_map).fillna(-1).astype(int)

        drop_cols = ["doc", "partition", "label", "label_encoded"]

        self.transformer = self.make_transformer()
        X_train = self.transformer.fit_transform(train.drop(columns=drop_cols))
        X_dev = self.transformer.transform(dev.drop(columns=drop_cols))
        X_test = self.transformer.transform(test.drop(columns=drop_cols))

        xg = XGBClassifier(random_state=42, n_jobs=3, colsample_bytree=0.8, max_depth=11, n_estimators=100, gamma=0.1)

        sys.stderr.write("o Training...\n")
        # Ensure model is strictly trained on the newly mapped 'label_encoded' ints
        xg.fit(X_train, train["label_encoded"])
        preds = xg.predict(X_dev)

        sys.stderr.write("o Performance on dev:\n")
        # Target names sorted by encoding value for classification report
        target_names = [self.reverse_label_map[i] for i in range(len(self.reverse_label_map))]
        sys.stderr.write(classification_report(dev["label_encoded"], preds, target_names=target_names))

        if errors:
            # Map numeric predictions back to strings to compare against original string labels
            dev["pred_str"] = [self.reverse_label_map[p] for p in preds]
            dev["correct"] = dev["pred_str"] == dev["label"]
            error_rows = dev[~dev["correct"]].copy()
            err_out = []
            for _, row in error_rows.iterrows():
                err_out.append(
                    "\t".join([str(row["words"]).replace("#", "").strip(), row["pred_str"], str(row["label"])]))
            with io.open("stype_errors.tab", 'w', encoding="utf8", newline="\n") as f:
                f.write("\n".join(err_out) + "\n")

        if train_with_dev:
            sys.stderr.write("\no Retraining on train+dev\n")
            X_devtrain = self.transformer.transform(pd.concat([train, dev]).drop(columns=drop_cols))
            y_devtrain = pd.concat([train["label_encoded"], dev["label_encoded"]])
            xg.fit(X_devtrain, y_devtrain)
            preds = xg.predict(X_test)
            sys.stderr.write("o Performance on test:\n")
            sys.stderr.write(classification_report(test["label_encoded"], preds, target_names=target_names))

        sys.stderr.write(f"\no Archiving model and features to {self.model_zip_path}\n")

        named_tf = self.transformer.named_transformers_
        config = {
            "wordfuncs_vocab": named_tf['wordfuncs'].vocabulary_,
            "parents_vocab": named_tf['parents'].vocabulary_,
            "postags_vocab": named_tf['postags'].vocabulary_,
            "root_pos_map": self.root_pos_map,
            "root_combo_map": self.root_combo_map,
            "reverse_label_map": self.reverse_label_map
        }

        def _convert_np(obj):
            if isinstance(obj, np.integer): return int(obj)
            if isinstance(obj, np.floating): return float(obj)
            if isinstance(obj, np.ndarray): return obj.tolist()
            if isinstance(obj, dict): return {str(k): _convert_np(v) for k, v in obj.items()}
            if isinstance(obj, list): return [_convert_np(v) for v in obj]
            return obj

        with tempfile.TemporaryDirectory() as tmpdir:
            xgb_path = os.path.join(tmpdir, "stype_xgb.json")
            xg.save_model(xgb_path)

            config_path = os.path.join(tmpdir, "stype_features.json")
            with open(config_path, "w") as f:
                json.dump(_convert_np(config), f)

            with zipfile.ZipFile(self.model_zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                zf.write(xgb_path, arcname="stype_xgb.json")
                zf.write(config_path, arcname="stype_features.json")

        if write_table:
            rows = ["\t".join(map(str, row)) for row in facts]
            with io.open("stypes_data.tab", 'w', encoding="utf8", newline="\n") as f:
                f.write("\n".join(rows) + "\n")


if __name__ == "__main__":
    from argparse import ArgumentParser, RawTextHelpFormatter

    usage = "Training:\n  python stype_classifier.py -t target_dir/\n"
    usage += "Predicting:\n  python stype_classifier.py conll_files_dir/\n"

    p = ArgumentParser(epilog=usage, formatter_class=RawTextHelpFormatter)
    p.add_argument("-t", "--train", action="store_true")
    p.add_argument("-d", "--devtrain", action="store_true", help="train with dev")
    p.add_argument("-w", "--write", action="store_true", help="write training data table")
    p.add_argument("-e", "--errors", action="store_true", help="output error analysis file from dev")
    p.add_argument("target_path", default=None, help="directory of conll files or single conllu file for tagging")

    opts = p.parse_args()
    target_path = opts.target_path
    stp = STypeClassifier()

    if opts.train:
        stp.train(target_path, train_with_dev=opts.devtrain, write_table=opts.write, errors=opts.errors)
    else:
        if os.path.isfile(target_path):
            preds = stp.predict(io.open(target_path, encoding="utf8").read())
        else:
            preds = stp.predict_from_dir(target_path + os.sep + "dep" + os.sep)
        print(preds)