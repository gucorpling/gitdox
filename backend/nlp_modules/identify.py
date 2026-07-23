"""
Simple lookup script for named entity linking based on entity string and type
"""
from collections import defaultdict
import pathlib

script_dir = str(pathlib.Path(__file__).resolve().parent)
identities_by_text = defaultdict(dict)
identities_by_type = defaultdict(set)


identity_file = script_dir + "/identities.tab"
for line in open(identity_file, "r").read().strip().split("\n"):
    if line.count("\t") == 2:
        text, etype, identity = line.split("\t")
        identities_by_text[text][etype] = identity
        identities_by_type[etype].add(identity)


def suggest_identities(text_etypes, return_all_of_type=False):
    """
    Takes a list of text + etype pairs and returns suggested identities or
    empty strings if no match is found. For example, if the input is:

    :param text_etypes: [("Paris", "place"), ("Jim Smith", "person"), ...]
    :return: ["Paris (France)", "", ...]
    """
    if return_all_of_type:
        if len(text_etypes) == 0:
            return []
        else:
            # Full typed list for auto-complete textboxes
            return sorted(list(identities_by_type[text_etypes[0][1]]))
    
    suggestions = []
    for text, etype in text_etypes:
        # Specific match lookups
        if text in identities_by_text and etype in identities_by_text[text]:
            suggestions.append(identities_by_text[text][etype])
        else:
            suggestions.append("")
    return suggestions

if __name__ == "__main__":
    identities_by_text = suggest_identities([("Paris", "place"), ("UK","place"),("Jim Smith", "person")])
    print(identities_by_text)