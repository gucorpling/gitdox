#!/usr/bin/python
# -*- coding: UTF-8 -*-

from gitdox_sql import *
from ether import ether_to_sgml, get_socialcalc, build_meta_tag
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

def export_all_docs():
	docs = get_all_docs()
	files = []
	for doc in docs:
		doc_id, docname, corpus, mode, content = doc
		filename = corpus + "_" + docname
		if mode == "xml":
			content = build_meta_tag(doc_id) + content.strip() + "\n</meta>\n"
			files.append((content,filename + ".xml"))
		elif mode == "ether":
			ether_name = "_".join(["gd",corpus,docname])
			sgml = ether_to_sgml(get_socialcalc(ether_url, ether_name),doc_id)
			files.append((sgml, filename + ".sgml"))

	zip_io = create_zip(files)

	temp = tempfile.NamedTemporaryFile(delete=False, mode='w+b')
	temp.write(zip_io.getvalue())
	temp.close()

	print "Content-type: application/download"
	print "Content-Disposition: attachment; filename=export.zip"
	print

	sys.stdout.flush()

	with open(temp.name,'rb') as z:
		copyfileobj(z, sys.stdout)

	os.remove(temp.name)


if __name__ == "__main__":
	if __package__ is None:
		from os import sys, path

		sys.path.append(path.dirname(path.dirname(path.abspath(__file__))))
		from paths import ether_url
	else:
		from ..paths import ether_url
	export_all_docs()
