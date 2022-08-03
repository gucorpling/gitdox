#!/usr/bin/python
# -*- coding: utf-8 -*-

import cgi
import cgitb
from modules.gitdox_sql import *
from modules.logintools import login

if __name__ == "__main__":
	thisscript = os.environ.get('SCRIPT_NAME', '')
	action = None
	theform = cgi.FieldStorage()
	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	userdir = scriptpath + "users" + os.sep
	action, userconfig = login(theform, userdir, thisscript, action)
	user = userconfig["username"]
	admin = userconfig["admin"]

	print("Content-type:text/html; charset=utf-8\r\n\r\n")
	cgitb.enable()

	if "action" in theform:
		action = theform.getvalue("action")
	else:
		action = "list"

	if action == "list":
		all_entity_links = get_entity_options()
		all_entity_list = []
		if all_entity_links is not None:
			for row in all_entity_links:
				etype, eref = row
				all_entity_list.append(etype + "+" + eref)
		print("|".join(all_entity_list).encode("utf8"))
	elif action == "guess":
		entries = ""
		if "entries" in theform:
			entries = theform.getvalue("entries")
		entries = entries.split("|")
		corpus_mappings = {}
		all_mappings = {}
		if "docid" in theform:
			docid = theform.getvalue("docid")
			corpus_entities = get_common_entity_map(int(docid))
			for row in corpus_entities:
				string, etype, eref = row
				corpus_mappings[string +"+" + etype] = eref
		all_entities = get_common_entity_map()
		for row in all_entities:
			string, etype, eref, freq = row
			all_mappings[string + "+" + etype] = eref

		guess = {}
		for entry in entries:
			words, head, etype = entry.decode("utf8").split("+")
			word_key = words + "+" + etype
			head_key = head + "+" + etype
			if word_key in corpus_mappings:
				guess[words+"+"+etype] = corpus_mappings[word_key]
			elif word_key in all_mappings:
				guess[words+"+"+etype] = all_mappings[word_key]
			elif head_key in corpus_mappings:
				guess[words+"+"+etype] = corpus_mappings[head_key]
			elif head_key in all_mappings:
				guess[words + "+" + etype] = all_mappings[head_key]
			else:
				guess[words + "+" + etype] = ""
		output = []
		for key in guess:
			output.append(unicode((key + "+" + guess[key])))
		print("\n".join(output).encode("utf8"))

	elif action == "save":
		entries = []
		if "entries" in theform:
			entries = theform.getvalue("entries").decode("utf8")
		entries = entries.split("|")
		if "docid" in theform:
			doc_id = theform.getvalue("docid")
		else:
			quit()

		if "entcount" in theform:
			entcount = int(theform.getvalue("entcount"))
		else:
			entcount = None

		doc, corpus, _, _, _, _, _ = get_doc_info(doc_id)
		rows = []
		for entry in entries:
			rows.append(tuple([doc,corpus]+entry.split("+")))
		if len(rows)<1:
			quit()
		assert all([len(row) == 6 for row in rows])
		generic_query('DELETE FROM entities where corpus=? and doc=?',(corpus,doc))
		insert_entity_links(rows, entcount, doc_id)
	elif action=="empty":
		if "docid" in theform:
			doc_id = theform.getvalue("docid")
			insert_entity_links([], 0, doc_id)
		else:
			quit()




