#!/usr/bin/python
# -*- coding: utf-8 -*-

# Import modules for CGI handling
import cgi, cgitb
import os
import sys, traceback
from os import listdir
from modules.logintools import login
from modules.configobj import ConfigObj
from modules.pathutils import *
import urllib
from modules.gitdox_sql import *
from modules.ether import delete_spreadsheet
from modules.renderer import render
from paths import ether_url, get_menu
from os.path import isfile, join
import platform

# Support IIS site prefix on Windows
if platform.system() == "Windows":
	prefix = "transc\\"
else:
	prefix = ""

project = "Scriptorium"

def get_max_id():
	#get current max of existing records in the db
	current_max=generic_query("SELECT MAX(id) AS max_id FROM docs",())[0][0]
	#set the max key for auto_increment of id to that value
	generic_query("UPDATE sqlite_sequence SET seq=? WHERE name=?",(current_max,"docs"))
	return current_max

def load_landing(user, admin, theform):
	render_data = {}

	# delete doc if requested
	if theform.getvalue('deletedoc'):
		doc_id = theform.getvalue('id')
		doc_name, corpus = get_doc_info(doc_id)[0:2]
		delete_doc(doc_id)
		sheet_name = "gd_" + corpus + "_" + doc_name
		delete_spreadsheet(ether_url,sheet_name)

	# find selected corpus, if any
	selected_corpus = ""
	if "sel_corpus" in theform:
		selected_corpus = theform.getvalue("sel_corpus")
	render_data["sel_corpus"] = selected_corpus

	# provide list of corpora for corpus selection dropdown
	corpora = get_corpora()
	render_data['corpora'] = []
	for corpus in corpora:
		render_data['corpora'].append({"name": corpus[0],
									   "selected": selected_corpus == corpus[0]})

	# find the documents we need to display
	if selected_corpus != "" and selected_corpus != "all":
		doc_list = generic_query("SELECT id,corpus,name,status,assignee_username,mode FROM docs where corpus=? ORDER BY corpus, name COLLATE NOCASE", (selected_corpus,))
		if len(doc_list) == 0: # Restricted query produced no documents, switch back to all document display
			doc_list = generic_query("SELECT id,corpus,name,status,assignee_username,mode FROM docs ORDER BY corpus, name COLLATE NOCASE", ())
			selected_corpus = ""
	else:
		doc_list = generic_query("SELECT id,corpus,name,status,assignee_username,mode FROM docs ORDER BY corpus, name COLLATE NOCASE",())

	max_id = get_max_id()
	if not max_id:  # This is for the initial case after init db
		max_id = 0

	render_data['docs'] = []
	for doc in doc_list:
		doc_vars = {}
		doc_vars["xml"] = "xml" in doc
		doc_vars["ether"] = "ether" in doc
		doc_vars["other_mode"] = not (doc_vars["xml"] or doc_vars["ether"])

		id = str(doc[0])
		doc_vars["id"] = id
		doc_vars["corpus"] = doc[1]
		doc_vars["name"] = doc[2]
		doc_vars["status"] = doc[3]
		doc_vars["assignee"] = doc[4]
		render_data['docs'].append(doc_vars)

	render_data["admin_gt_zero"] = int(admin) > 0
	render_data["admin_eq_three"] = admin == "3"
	render_data["max_id_plus1"] = str(max_id + 1)
	render_data["user"] = user

	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	userdir = scriptpath + "users" + os.sep
	config = ConfigObj(userdir + 'config.ini')
	render_data["project"] = config["project"]

	return render("index", render_data)


def open_main_server():
	thisscript = os.environ.get('SCRIPT_NAME', '')
	action = None
	theform = cgi.FieldStorage()
	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	userdir = scriptpath + "users" + os.sep

	action, userconfig = login(theform, userdir, thisscript, action)
	user = userconfig["username"]
	admin = userconfig["admin"]

	print("Content-type:text/html\n\n")
	try:
		print(load_landing(user, admin, theform))
	except Exception as e:
		print("""<html><body><h1>Loading Error</h1>
		<p>For some reason, this page failed to load.</p>
		<p>Please send this to your system administrator:</p>
		<pre>""")
		traceback.print_exc(e, file=sys.stdout)
		print("""</pre></body></html>""")


if __name__ == '__main__':
	open_main_server()
