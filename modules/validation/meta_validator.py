from validator import Validator
import re

class MetaValidator(Validator):
    def __init__(self, rule):
        self.corpus = rule[0]
        self.doc = rule[1]
        self.name = rule[3]
        self.operator = rule[4]
        self.argument = rule[5]

    def _apply_match(self, metadata):
        report, tooltip = "", ""
        for d in metadata:
            if d[2] == self.name:
                value = d[3]
                match = re.search(self.argument, value)
                if match is None:
                    report += "Metadata for " + self.name + " does not match pattern" + "<br/>"
                    tooltip += "Metadata: " + value + "<br/>" + "Pattern: " + self.argument + "<br/>"

        return report, tooltip

    def _apply_exists(self, metadata):
        report, tooltip = "", ""
        exists = False
        for d in metadata:
            if d[2] == self.name:
                exists = True
                break
        if exists is False:
            report += "No metadata for " + self.name + '<br/>'

        return report, tooltip

    def _apply_rule(self, metadata):
        if self.operator == "~":
            return self._apply_match(metadata)
        elif self.operator == "exists":
            return self._apply_exists(metadata)
        else:
            raise Exception("Unknown metadata validation operator: '" + str(self.operator) + "'")

    def applies(self, doc_name, doc_corpus):
        if self.corpus is not None and re.search(self.corpus, doc_corpus) is None:
            return False
        if self.doc is not None and re.search(self.doc, doc_name) is None:
            return False
        return True

    def validate(self, metadata):
        report, tooltip = self._apply_rule(metadata)
        return {"report": report, "tooltip": tooltip}
