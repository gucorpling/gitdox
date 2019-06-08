from validator import Validator
from ..ether import ExportConfig, ether_to_sgml, get_socialcalc
from ..gitdox_sql import get_doc_info
from paths import ether_url
import re
import tempfile
import os
import subprocess

# TODO: would have been ideal to write this without any filesystem operations
class BulkExportValidator(Validator):
    def __init__(self, rule):
        self.corpus = rule[0]
        self.doc = rule[1]
        self.config = rule[3]
        self.schema = rule[5]

    def validate(self, doc_ids):
        report = {}

        export_files = []
        for doc_id in doc_ids:
            doc_info = get_doc_info(doc_id)
            doc_name = doc_info[0]
            doc_corpus = doc_info[1]

            if self.corpus is not None and re.search(self.corpus, doc_corpus) is None:
                continue
            if self.doc is not None and re.search(self.doc, doc_name) is None:
                continue

            ether_doc_name = "gd_" + doc_corpus + "_" + doc_name
            socialcalc = get_socialcalc(ether_url, ether_doc_name, doc_id=doc_id, dirty=True)

            export_files.append(ether_to_sgml(socialcalc, doc_id, config=self.config))

        command = "xmllint --schema schemas/" + self.schema + " tempfilename"

        tempnames = prepare_temp_files(export_files)
        _, err = exec_via_temp_list(tempnames, command)

        err = err.strip()
        err = err.replace("<","&lt;").replace(">","&gt;")

        doc_index = 0
        accum = ""
        for line in err.split("\n"):
            if line == (tempnames[doc_index] + " validates"):
                report[doc_ids[doc_index]] = "Export is valid"
                accum = ""
                doc_index += 1
            elif line == (tempnames[doc_index] + " fails to validate"):
                report[doc_ids[doc_index]] = ("Problems with exporting with "
                                              + self.config + " and validating with "
                                              + self.schema + ":<br>"
                                              + accum.decode('utf8'))
                doc_index += 1
                accum = ""
            else:
                line = line.replace(tempnames[doc_index] + ":", "")
                accum += line + "<br>"

        return report, True

def prepare_temp_files(input_texts):
    tempnames = []
    for input_text in input_texts:
        temp = tempfile.NamedTemporaryFile(delete=False,mode='wb')
        tempnames.append(temp.name)
        try:
            temp.write(input_text)
            temp.close()
        except Exception as e:
            return str(e)
    return tempnames

def exec_via_temp_list(tempnames, command_params):
    command_params = command_params.replace("tempfilename", " ".join(tempnames))
    try:
        proc = subprocess.Popen(command_params,
                                stdout=subprocess.PIPE,
                                stdin=subprocess.PIPE,
                                stderr=subprocess.PIPE,
                                shell=True)
        stdout, stderr = proc.communicate()
    finally:
        for tempname in tempnames:
            os.remove(tempname)
    return stdout, stderr
