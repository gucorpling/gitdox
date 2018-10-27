from validator import Validator
from ..ether import exec_via_temp, ExportConfig, ether_to_sgml
import re

# TODO: would have been ideal to write this without any filesystem operations
class ExportValidator(Validator):
    def __init__(self, rule):
        self.corpus = rule[0]
        self.doc = rule[1]
        self.config = rule[3]
        self.schema = rule[5]

    def validate(self, socialcalc, doc_id, doc_name, doc_corpus):
        report = ""

        if self.corpus is not None:
            if re.search(self.corpus, doc_corpus) is None:
                return report, False
        if self.doc is not None:
            if re.search(self.doc, doc_name) is None:
                return report, False

        export_data = ether_to_sgml(socialcalc, doc_id, config=self.config)

        schema = self.schema
        command = "xmllint --schema schemas/" + schema + " tempfilename"
        out, err = exec_via_temp(export_data, command)
        err = err.strip()
        err = err.replace("<br>","").replace("\n","").replace('<h1 align="center">xmllint output</h1>',"")
        err = re.sub(r'/tmp/[A-Za-z0-9_]+:','XML schema: <br>',err)
        err = re.sub(r'/tmp/[A-Za-z0-9_]+','XML schema ',err)
        err = re.sub(r'\n','<br/>',err)
        if err == "XML schema validates":
            report = ""
        else:
            report = "Problems with exporting with " + self.config \
                     + " and validating with " + self.schema + ":<br>" + err.decode("utf8") + "<br>"

        return report, True
