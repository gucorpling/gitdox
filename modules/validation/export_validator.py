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

    def applies(self, doc_name, doc_corpus):
        if self.corpus is not None:
            if re.search(self.corpus, doc_corpus) is None:
                return False
        if self.doc is not None:
            if re.search(self.doc, doc_name) is None:
                return False
        return True

    def validate(self, socialcalc, doc_id):
        report = ""
        export_data = ether_to_sgml(socialcalc, doc_id, config=self.config)

        schema = self.schema
        command = "xmllint --schema schemas/" + schema + " tempfilename"

        _, err = exec_via_temp(export_data, command)
        err = err.strip()
        err = re.sub(r'/tmp/[A-Za-z0-9_]+:', '', err)
        if err.strip().endswith("validates"):
            report = ""
        else:
            err = err.replace("<","&lt;").replace(">","&gt;")
            err = re.sub(r'\n','<br>', err)
            err = re.sub(r' ','&nbsp;', err)
            report = "Problems with exporting with " + self.config \
                     + " and validating with " + self.schema + ":<br>" + err.decode("utf8") + "<br>"

        return report
