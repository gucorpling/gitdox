from validator import Validator
from ..ether import exec_via_temp
import re

# TODO: would have been ideal to write this without any filesystem operations
class LegacyXmlValidator(Validator):
    def __init__(self, schema):
        self.schema = schema

    def validate(self, doc):
        report = ""

        if self.schema == '--none--':
            return report
        else:
            schema = self.schema
            command = "xmllint --htmlout --schema schemas/" + schema + ".xsd tempfilename"
            out, err = exec_via_temp(doc, command)
            err = err.strip()
            err = err.replace("<br>","").replace("\n","").replace('<h1 align="center">xmllint output</h1>',"")
            err = re.sub(r'/tmp/[A-Za-z0-9]+:','XML schema: <br>',err)
            err = re.sub(r'/tmp/[A-Za-z0-9]+','XML schema ',err)
            err = re.sub(r'\n','<br/>',err)
            report += err + "<br/>"

        return report
