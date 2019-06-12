from validator import Validator
from ..ether import exec_via_temp
import re

class XmlValidator(Validator):
    def __init__(self, rule):
        self.corpus = rule[0]
        self.doc = rule[1]
        self.schema = rule[3]

    def applies(self, doc_name, doc_corpus):
        if self.corpus is not None and re.search(self.corpus, doc_corpus) is None:
            return False
        if self.doc is not None and re.search(self.doc, doc_name) is None:
            return False
        return True

    def validate(self, doc):
        report = ""

        schema = self.schema
        command = "xmllint --schema schemas/" + schema + " tempfilename"
        _, err = exec_via_temp(doc.encode("utf-8"), command)
        err = err.strip()
        err = err.replace("<br>","").replace("\n","").replace('<h1 align="center">xmllint output</h1>',"")
        err = re.sub(r'/tmp/[A-Za-z0-9_]+:','XML schema: <br>',err)
        err = re.sub(r'/tmp/[A-Za-z0-9_]+','XML schema ',err)
        err = re.sub(r'\n','<br/>',err)
        if err.endswith("validates"):
            report = ""
        else:
            report = "Problems validating with " + self.schema + ":<br>" + err.decode("utf-8") + "<br>"

        return report
