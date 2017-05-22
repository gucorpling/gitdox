#!/usr/bin/python
# -*- coding: UTF-8 -*-

# Import modules for CGI handling
import cgi, cgitb 
import os
from os import listdir
from modules.logintools import login
from modules.configobj import ConfigObj
from modules.pathutils import *
import urllib
from modules.gitdox_sql import *
from modules.ether import delete_spreadsheet
from paths import ether_url, get_menu
from os.path import isfile, join
import platform

# Support IIS site prefix on Windows
if platform.system() == "Windows":
	prefix = "transc\\"
else:
	prefix = ""

project = "Scriptorium"


def make_options(**kwargs):
	if "file" in kwargs:
		kwargs["file"] = prefix + kwargs["file"]
		names = open(kwargs["file"],'r').read().replace("\r","").split("\n")
		#print len(names)
		names = list(name[:name.find("\t")] for name in names)
	elif "names" in kwargs:
		names = kwargs[names]
	selected = kwargs["selected"] if "selected" in kwargs else None
	options=""
	for name in names:
		if name!='':
			options+='<option value=%s>\n' %name
	return options

def cell(text):
	if 'class="fa' in str(text):
		return '<td style="text-align:center">' + str(text) + "</td>"
	else:
		return "<td>" + str(text) + "</td>"

def get_max_id():
	#get current max of existing records in the db
	current_max=generic_query("SELECT MAX(id) AS max_id FROM docs",())[0][0]
	#set the max key for auto_increment of id to that value
	generic_query("UPDATE sqlite_sequence SET seq=? WHERE name=?",(current_max,"docs"))
	return current_max


def gen_meta_popup():
	popup_meta_html="""
	<HTML>
	<HEAD>
	<SCRIPT LANGUAGE="JavaScript"><!--
	function copyForm() {
		opener.document.hiddenForm.metakey.value = document.popupForm.metakey.value;
		opener.document.hiddenForm.metavalue.value = document.popupForm.metavalue.value;

		opener.document.hiddenForm.submit();
		window.close();
		return false;
	}
	//--></SCRIPT>
	</HEAD>
	<BODY>
	<FORM NAME="popupForm" onSubmit="return copyForm()">
	meta key (e.g.,year):<br>
	<input list="metakeys" name="metakey">
	<datalist id="metakeys">
		***options***
	</datalist>
	<br>
	meta value(e.g.,200BC):<br>
	<input type="text" name='metavalue'><br>
	<INPUT TYPE="BUTTON" VALUE="Submit" onClick="copyForm()">
	</FORM>
	</BODY>
	</HTML>


	"""
	options=make_options(file='metadata_fields.tab')
	popup_meta_html=popup_meta_html.replace("***options***",options)
	f=open(prefix+'popupPage.html','w')
	f.write(popup_meta_html)


def load_landing(user,admin,theform):
	gen_meta_popup()

	if theform.getvalue('deletedoc'):
		doc_id = theform.getvalue('id')
		doc_name, corpus = get_doc_info(doc_id)[0:2]
		delete_doc(doc_id)
		sheet_name = "gd_" + corpus + "_" + doc_name
		delete_spreadsheet(ether_url,sheet_name)

	selected_corpus = ""
	corpora = get_corpora()
	corpus_list = '<option value="all">(show all)</option>\n'
	for corpus in corpora:
		corpus_list += '<option value="'+corpus[0]+'">'+corpus[0]+'</option>\n'
	if "sel_corpus" in theform:
		selected_corpus = theform.getvalue("sel_corpus")
		corpus_list = corpus_list.replace('="'+selected_corpus+'"','="'+selected_corpus+'" selected="selected"')

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

	table = """<table id="doctable" class="sortable"><tr><th>id</th><th>corpus</th><th>document</th><th>status</th><th>assigned</th><th>mode</th><th colspan="2" class="sorttable_nosort">actions</th></tr>"""

	for doc in doc_list:
		row="<tr>"
		for item in doc:
			if item == "xml":
				item = '<i class="fa fa-code" title="xml">&nbsp;</i>'
			elif item == "ether":
				item = '<i class="fa fa-table" title="spreadsheet">&nbsp;</i>'
			elif "-" in str(item):
				item = item.replace("-","&#8209;")  # Use non-breaking hyphens
			row += cell(item)
		id=str(doc[0])
		#edit document
		button_edit="""<form action="editor.py" method="post" id="form_edit_"""+id+"""">"""
		id_code="""<input type="hidden" name="id"  value="""+id+">"
		button_edit+=id_code
		button_edit+="""<div onclick="document.getElementById('form_edit_"""+id+"""').submit();" class="button"> <i class="fa fa-pencil-square-o"></i> edit</div></form>"""

		#delete document
		button_delete="""<form action="index.py" method="post" id="form_del_"""+id+"""">"""
		button_delete+=id_code
		button_delete+="""<input type="hidden" name='deletedoc' value='DELETE DOCUMENT'/><div onclick="document.getElementById('form_del_"""+id+"""').submit();" class="button"> <i class="fa fa-trash-o"></i> delete</div>
		<input type="hidden" name="sel_corpus" value="**sel_corpus**"></form>"""

		row += cell(button_edit)
		row += cell(button_delete)
		row += "</tr>"
		table += row
		
	table+="</table>"

	page = ""

	menu = get_menu()
	menu = menu.encode("utf8")

	landing = open(prefix+"templates"+os.sep+"landing.html").read()
	landing = landing.replace("**max_id_plus1**",str(max_id+1))
	landing = landing.replace("**user**",user)
	landing = landing.replace("**project**",project)
	landing = landing.replace("**corpora**",corpus_list)
	landing = landing.replace("**sel_corpus**",selected_corpus)
	landing = landing.replace("**table**",table)
	landing = landing.replace("**navbar**", menu)
	page += landing
	print "Content-type:text/html\n\n"

	return page


def open_main_server():
	thisscript = os.environ.get('SCRIPT_NAME', '')
	action = None
	theform = cgi.FieldStorage()
	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	userdir = scriptpath + "users" + os.sep
	action, userconfig = login(theform, userdir, thisscript, action)
	user = userconfig["username"]
	admin = userconfig["admin"]
	print load_landing(user,admin,theform)


open_main_server()
