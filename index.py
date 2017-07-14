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
	popup_meta_html="""<HTML>
<HEAD>
<SCRIPT LANGUAGE="JavaScript">
function copyForm() {
	opener.document.hiddenForm.metakey.value = document.popupForm.metakey.value;
	opener.document.hiddenForm.metavalue.value = document.popupForm.metavalue.value;

	opener.document.hiddenForm.submit();
	window.close();
	return false;
}
</SCRIPT>
</HEAD>
<BODY>
<FORM NAME="popupForm" onSubmit="return copyForm()">
field name (e.g., short_name):<br>
<input list="metakeys" name="metakey">
<datalist id="metakeys">
***options**
</datalist>
<br>
field value (e.g., superman):<br>
<input type="text" name='metavalue'><br>
<INPUT TYPE="BUTTON" VALUE="Submit" onClick="copyForm()">
</FORM>
</BODY>
</HTML>"""
	options = make_options(file='metadata_fields.tab')
	popup_meta_html = popup_meta_html.replace("***options**",options)
	f = open(prefix + 'popupPage.html', 'w')
	f.write(popup_meta_html)


def load_landing(user, admin, theform):
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

	table = """<script src="js/index.js"></script><table id="doctable" class="sortable">"""
	table += """<thead><tr><th>id</th><th>corpus</th><th>document</th><th>status</th><th>assigned</th><th>mode</th><th>validate</th><th colspan="2" class="sorttable_nosort">actions</th></tr></thead>"""
	table += """<tfoot><tr><td><input type="text" id="filter_id" onkeyup="filter()"></td>
					<td><input type="text" id="filter_corpus" onkeyup="filter()"></td>
					<td><input type="text" id="filter_document" onkeyup="filter()"></td>
					<td><input type="text" id="filter_status" onkeyup="filter()"></td>
					<td><input type="text" id="filter_assigned" onkeyup="filter()"></td>
					<td><input type="text" id="filter_mode" onkeyup="filter()" placeholder="xml/spreadsheet"></td>
					<td></td>
					<td colspan="2"></td></tr></tfoot>"""
	table += """<tbody>"""

	for doc in doc_list:
		row="<tr>"
		for item in doc:
			if item == "xml":
				item = '<i class="fa fa-code" title="xml">&nbsp;</i>'
				mode = "xml"
			elif item == "ether":
				item = '<i class="fa fa-table" title="spreadsheet">&nbsp;</i>'
				mode = "ether"
			elif "-" in str(item):
				item = item.replace("-","&#8209;")  # Use non-breaking hyphens
			row += cell(item)
		id = str(doc[0])

		# validation icons
		icons = """<div id="validate_""" + id + """">"""
		if mode == "xml":
			icons += """<i class="fa fa-code" title="xml">&nbsp;</i>"""
		elif mode == "ether":
			icons += """<i class="fa fa-table" title="spreadsheet">&nbsp;</i>"""
		icons += """<i class="fa fa-tags" title="metadata" style="display:inline-block">&nbsp;</i>"""
		icons += """</div>"""

		# edit document
		button_edit = """<form action="editor.py" method="post" id="form_edit_""" + id + """">"""
		id_code = """<input type="hidden" name="id"  value=""" + id + ">"
		button_edit += id_code
		button_edit += """<div onclick="document.getElementById('form_edit_""" + id + """').submit();" class="button"> <i class="fa fa-pencil-square-o"></i> edit</div></form>"""

		#delete document
		button_delete="""<form action="index.py" method="post" id="form_del_"""+id+"""">"""
		button_delete+=id_code
		if int(admin) > 0:
			button_delete+="""<input type="hidden" name='deletedoc' value='DELETE DOCUMENT'/><div onclick="document.getElementById('form_del_"""+id+"""').submit();" class="button"> <i class="fa fa-trash-o"></i> delete</div>
			<input type="hidden" name="sel_corpus" value="**sel_corpus**"></form>"""
		else:
			button_delete += """<input type="hidden" name='deletedoc' value='DELETE DOCUMENT'/><div class="button disabled"> <i class="fa fa-trash-o"></i> delete</div>
		    <input type="hidden" name="sel_corpus" value="**sel_corpus**"></form>"""

		row += cell(icons)
		row += cell(button_edit)
		row += cell(button_delete)
		row += "</tr>"
		table += row

	table+="</tbody></table>"

	if admin == "3":
		validation_rules = """<form action='validation_rules.py' id="form_validation_rules" method="post" style="display:inline-block">
		<div onclick="document.getElementById('form_validation_rules').submit();" class="button">
  		<i class="fa fa-table"></i>
		validation rules</div></form>"""
	else:
		validation_rules = ""

	page = ""

	menu = get_menu()
	menu = menu.encode("utf8")

	landing = open(prefix + "templates" + os.sep + "landing.html").read()
	header = open(prefix + "templates" + os.sep + "header.html").read()

	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	userdir = scriptpath + "users" + os.sep
	config = ConfigObj(userdir + 'config.ini')
	skin = config["skin"]
	project = config["project"]

	landing = landing.replace("**max_id_plus1**", str(max_id + 1))
	landing = landing.replace("**user**", user)
	landing = landing.replace("**project**", project)
	landing = landing.replace("**header**", header)
	landing = landing.replace("**skin**", skin)
	landing = landing.replace("**validation_rules**", validation_rules)
	landing = landing.replace("**corpora**", corpus_list)
	landing = landing.replace("**sel_corpus**", selected_corpus)
	landing = landing.replace("**table**", table)
	landing = landing.replace("**navbar**", menu)
	if int(admin) > 0:
		landing = landing.replace("**create_doc**",'''onclick="document.getElementById('form_new').submit();" class="button"''')
	else:
		landing = landing.replace("**create_doc**",'''class="button disabled"''')
	page += landing
	print("Content-type:text/html\n\n")

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
	print(load_landing(user,admin,theform))


open_main_server()
