from validator import Validator
from ..ether import exec_via_temp
import re

class XmlValidator(Validator):
    def __init__(self, rule):
        self.corpus = rule[0]
        self.doc = rule[1]
        self.schema = rule[3]

    def validate(self, doc, doc_name, doc_corpus):
        report = ""

        if self.corpus is not None:
            if re.search(self.corpus, doc_corpus) is None:
                return report, False
        if self.doc is not None:
            if re.search(self.doc, doc_name) is None:
                return report, False

        schema = self.schema
        command = "xmllint --schema schemas/" + schema + " tempfilename"
        out, err = exec_via_temp(doc, command)
        err = err.strip()
        err = err.replace("<br>","").replace("\n","").replace('<h1 align="center">xmllint output</h1>',"")
        err = re.sub(r'/tmp/[A-Za-z0-9_]+:','XML schema: <br>',err)
        err = re.sub(r'/tmp/[A-Za-z0-9_]+','XML schema ',err)
        err = re.sub(r'\n','<br/>',err)
        if err == "XML schema  validates":
            report = ""
        else:
            report = "Problems validating with " + self.schema + ":<br>" + err + "<br>"

        return report, True
