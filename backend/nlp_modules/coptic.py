#!/usr/bin/python
# -*- coding: utf-8 -*-

"""
Obtain Coptic tokenization from API
Sends XML data and receives replacement XML data
"""

import requests, pathlib, re
from requests.auth import HTTPBasicAuth


script_dir = pathlib.Path(__file__).parent.absolute()

def get_nlp_credentials():
    fpath = script_dir / "nlp_api.txt"
    return open(fpath, "r").read().strip().split("\n")

def coptic_tokenize(xml):
    data = {"data":xml, "format":"pipes"}

    resp = requests.post(api_url, data, auth=HTTPBasicAuth(nlp_user,nlp_password))
    text_content=resp.text

    return text_content

def coptic_nlp_tabulate(xml):
    data = {"data":xml, "lb":"line", "format":"sgml_no_parse"}

    resp = requests.post(api_url, data, auth=HTTPBasicAuth(nlp_user,nlp_password))
    tt_sgml_content = resp.text

    return tt_sgml_content


def coptic_ner(tt_sgml):
    def remove_extras(sgml):
        """
        Remove redundant XML attributes from all elemente

        :param sgml: TT SGML
        :return: SGML without redundant XML attributes
        """
        to_remove = ["func","xml:id","text","head","new_sent","head_tok"]
        for attr in to_remove:
            sgml = re.sub(r' {}="[^"]*"'.format(attr), "", sgml)
        return sgml

    data = {"data":tt_sgml, "lb":"line", "format":"sgml_entities"}

    resp = requests.post(api_url, data, auth=HTTPBasicAuth(nlp_user,nlp_password))
    tt_sgml_content = resp.text
    tt_sgml_content = remove_extras(tt_sgml_content)

    return tt_sgml_content


api_url = "https://tools.copticscriptorium.org/coptic-nlp/api"
nlp_user, nlp_password = get_nlp_credentials()

if __name__ == "__main__":
    mode = "entities"  # "nlp"

    if mode == "nlp":
        test = """<lb n="1"><xml>ⲁ<hi rend="gold">|ϥ</hi>|ⲥⲱⲧⲙ</xml></lb>
    <lb n="2"></lb>
    """

        print(coptic_nlp_tabulate(test))
    elif mode == "entities":
        test = """<meta author="Shenoute of Atripe" people="none" places="none">
<lb_n lb_n="1">
<xml xml="xml">
<orig_group orig_group="ⲁϥⲥⲱⲧⲙ">
<norm_group norm_group="ⲁϥⲥⲱⲧⲙ">
<orig orig="ⲁ">
<norm norm="ⲁ">
<lemma lemma="ⲁ">
<pos pos="APST">
ⲁ
</pos>
</lemma>
</norm>
</orig>
<orig orig="ϥ">
<norm norm="ϥ">
<lemma lemma="ⲛⲧⲟϥ">
<pos pos="PPERS">
<hi_rend hi_rend="gold">
ϥ
</hi_rend>
</pos>
</lemma>
</norm>
</orig>
<orig orig="ⲥⲱⲧⲙ">
<norm norm="ⲥⲱⲧⲙ">
<lemma lemma="ⲥⲱⲧⲙ">
<pos pos="V">
ⲥⲱⲧⲙ
</pos>
</lemma>
</norm>
</orig>
</norm_group>
</orig_group>
<orig_group orig_group="ⲉⲡⲉⲡⲛⲁ">
<norm_group norm_group="ⲉⲡⲉⲡⲛⲁ">
<orig orig="ⲉ">
<norm norm="ⲉ">
<lemma lemma="ⲉ">
<pos pos="PREP">
ⲉ
</pos>
</lemma>
</norm>
</orig>
<orig orig="ⲡⲉ">
<norm norm="ⲡⲉ">
<lemma lemma="ⲡ">
<pos pos="ART">
ⲡⲉ
</pos>
</lemma>
</norm>
</orig>
<orig orig="ⲡⲛⲁ">
<norm norm="ⲡⲛⲁ">
<lemma lemma="ⲡⲛⲉⲩⲙⲁ">
<pos pos="N">
ⲡⲛⲁ
</pos>
</lemma>
</norm>
</orig>
</norm_group>
</orig_group>
</xml>
</lb_n>
</meta>
"""

        print(coptic_ner(test))
    print("done")