#!/usr/bin/python
# -*- coding: UTF-8 -*-

import cgi
from modules.gitdox_sql import *
from modules.ether import ether_to_sgml, get_socialcalc, build_meta_tag
from modules.logintools import login
import zipfile
from StringIO import StringIO
from shutil import copyfileobj
import sys, tempfile


def create_zip(content_name_pairs):
	io_file = StringIO()
	zf = zipfile.ZipFile(io_file, mode='w', compression=zipfile.ZIP_DEFLATED)

	for content, name in content_name_pairs:
		zf.writestr(name, content.encode("utf8"))

	return io_file

def export_all_docs(config=None, corpus_filter=None, extension="sgml"):
	docs = get_all_docs(corpus_filter)
	files = []
	for doc in docs:
		doc_id, docname, corpus, mode, content = doc
		if corpus_filter is None:  # All documents exported, use corpus prefix to avoid name clashes
			filename = corpus + "_" + docname
		else:  # Only exporting one user specified corpus, name documents without prefix
			filename = docname
		if mode == "xml":
			content = build_meta_tag(doc_id) + content.strip() + "\n</meta>\n"
			files.append((content,filename + ".xml"))
		elif mode == "ether":
			ether_name = "_".join(["gd",corpus,docname])
			sgml = ether_to_sgml(get_socialcalc(ether_url, ether_name),doc_id,config=config)
			files.append((sgml, filename + "." + extension))

	zip_io = create_zip(files)

	temp = tempfile.NamedTemporaryFile(delete=False, mode='w+b')
	temp.write(zip_io.getvalue())
	temp.close()

	if corpus_filter is not None:
		zipname = corpus_filter + ".zip"
	else:
		zipname = "export.zip"

	print("Content-type: application/download")
	print("Content-Disposition: attachment; filename=" + zipname)
	print("")

	sys.stdout.flush()

	with open(temp.name,'rb') as z:
		copyfileobj(z, sys.stdout)

	os.remove(temp.name)


def export_doc(doc_id, stylesheet=None):
	docname, corpus, filename, status, assignee_username, mode, schema = get_doc_info(doc_id)
	ether_name = "_".join(["gd", corpus, docname])

	sgml = ether_to_sgml(get_socialcalc(ether_url, ether_name), doc_id, config=stylesheet)

	cpout = ""
	cpout += "Content-Type: application/download\n"
	cpout += "Content-Disposition: attachment; filename=" + corpus + "_" + docname + ".sgml\n\n"

	if isinstance(cpout,unicode):
		cpout = str(cpout.encode("utf8"))

	cpout += sgml
	print(cpout)


if __name__ == "__main__":
	import cgitb
	cgitb.enable()
	from paths import ether_url

	thisscript = os.environ.get('SCRIPT_NAME', '')
	action = None
	theform = cgi.FieldStorage()
	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	userdir = scriptpath + "users" + os.sep
	action, userconfig = login(theform, userdir, thisscript, action)
	user = userconfig["username"]
	admin = userconfig["admin"]

	export_stylesheet = "--default--"

	if "extension" in theform:
		extension = theform.getvalue("extension")
	else:
		extension = "sgml"
	if "stylesheet" in theform:
		export_stylesheet = theform.getvalue("stylesheet")
	else:
		export_stylesheet = None
	if "corpus" in theform:
		corpus = theform.getvalue("corpus")
	else:
		corpus = None

	if corpus == "--ALL--":
		corpus = None

	if "docs" in theform:
		docs = theform.getvalue("docs")
		if docs == "%all%":
			export_all_docs(export_stylesheet,corpus_filter=corpus,extension=extension)
		else:
			export_doc(docs, export_stylesheet)