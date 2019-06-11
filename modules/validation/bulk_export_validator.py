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
            socialcalc = get_socialcalc(ether_url, ether_doc_name)

            export_files.append((doc_id, ether_to_sgml(socialcalc, doc_id, config=self.config)))

        command = "xmllint --schema schemas/" + self.schema + " tempfilename"

        tempname_to_id = prepare_temp_files(export_files)
        _, err = exec_via_temp_list(tempname_to_id.keys(), command)

        err = err.strip()
        err = err.replace("<","&lt;").replace(">","&gt;")

        accum = ""
        for line in err.split("\n"):
            if line.endswith(" validates"):
                filename = line[:line.index(" validates")]
                doc_id = tempname_to_id[filename]
                report[doc_id] = "Export is valid"
                accum = ""
            elif line.endswith(" fails to validate"):
                filename = line[:line.index(" fails to validate")]
                doc_id = tempname_to_id[filename]
                accum = accum.replace(filename + ":","")
                accum = accum.replace("  ", "&nbsp;&nbsp;")
                accum = accum.replace("\n", "<br>")

                report[doc_id] = ("Problems with exporting with "
                                  + self.config + " and validating with "
                                  + self.schema + ":<br>"
                                  + accum.decode('utf8'))
                accum = ""
            else:
                accum += line + "<br>"

        return report, True

def prepare_temp_files(input_texts):
    tempname_to_id = {}
    for doc_id, input_text in input_texts:
        temp = tempfile.NamedTemporaryFile(delete=False, mode='wb')
        tempname_to_id[temp.name] = doc_id
        temp.write(input_text)
        temp.close()
    return tempname_to_id

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
