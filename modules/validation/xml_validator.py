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
                return report
        if self.doc is not None:
            if re.search(self.doc, doc_name) is None:
                return report

        schema = self.schema
        command = "xmllint --htmlout --schema schemas/" + schema + " tempfilename"
        out, err = exec_via_temp(doc, command)
        err = err.strip()
        err = err.replace("<br>","").replace("\n","").replace('<h1 align="center">xmllint output</h1>',"")
        err = re.sub(r'/tmp/[A-Za-z0-9]+:','XML schema: <br>',err)
        err = re.sub(r'/tmp/[A-Za-z0-9]+','XML schema ',err)
        err = re.sub(r'\n','<br/>',err)
        report += err + "<br/>"

        return report
