#!/usr/bin/python
# -*- coding: utf-8 -*-

from six import iteritems
import cgi, cgitb
import os, shutil
from os import listdir
from modules.logintools import login
import urllib
from modules.gitdox_sql import *
from modules.gitdox_git import *
from modules.configobj import ConfigObj
from os.path import isfile, join
import requests
from requests.auth import HTTPBasicAuth
import platform, re
from paths import ether_url, get_menu, get_nlp_credentials
from modules.ether import make_spreadsheet, delete_spreadsheet, sheet_exists, get_socialcalc, ether_to_sgml

# Support IIS site prefix on Windows
if platform.system() == "Windows":
	prefix = "transc\\"
else:
	prefix = ""

# Read configuration
scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
userdir = scriptpath + "users" + os.sep
templatedir = scriptpath + "templates" + os.sep
config = ConfigObj(userdir + 'config.ini')
skin = config["skin"]
project = config["project"]
editor_help_link = config["editor_help_link"]
# Captions and API URLs for NLP buttons
xml_nlp_button = config["xml_nlp_button"]
spreadsheet_nlp_button = config["spreadsheet_nlp_button"]
xml_nlp_api = config["xml_nlp_api"]
spreadsheet_nlp_api = config["spreadsheet_nlp_api"]

code_2fa = None


def harvest_meta(sgml):
	"""
	Get metadata key value pairs from <meta> element in imported SGML file

	:param sgml: TT SGML as string
	:return: dictionary of key value pairs
	"""

	sgml = sgml.replace("\r","").strip()
	meta = {}
	if not sgml.startswith("<meta "):
		return meta
	else:
		metatag = re.search(r'<meta ([^\n]*)>',sgml).group(1)
		matches = re.findall(r'([^ =>]+?)="([^"]+)"',metatag)
		for match in matches:
			meta[match[0].strip()] = match[1].strip().replace("<","&lt;").replace(">","&gt;")
	return meta


def serialize_file(text_content,file_name):
	f=open(prefix+file_name,'w')
	f.write(text_content.encode("utf8"))
	f.close()


def load_page(user,admin,theform):
	global ether_url
	global code_2fa
	if theform.getvalue("2fa"):
		code_2fa = theform.getvalue("2fa")
	else:
		code_2fa = ""
	max_id = generic_query("SELECT MAX(id) AS max_id FROM docs","")[0][0]
	if not max_id:  # This is for the initial case after init db
		max_id = 0
	text_content = ""
	repo_name = ""
	corpus = ""
	status = ""
	assignee = ""
	mode = "xml"
	schema = ""
	doc_id = ""  # Should only remain so if someone navigated directly to editor.py
	docname = ""
	mymsg = ""
	old_docname, old_corpus, old_repo, old_status, old_assignee, old_mode, old_schema = ["", "", "", "", "", "", ""]

	if int(admin) > 0:
		git_username, git_password, git_2fa = get_git_credentials(user, admin, code_2fa)
	else:
		git_username, git_password, git_2fa = (None,None,None)

	if theform.getvalue('id'):
		doc_id = theform.getvalue('id')
		if int(doc_id) > int(max_id):
			# Creating new doc case, assign some default values
			docname = "new_document"
			repo_name = "account/repo_name"
			status = "editing"
			assignee = "default_user"
			corpus = "default_corpus"
			schema = ""
			text_content = ""
			# If one of the four forms is edited, then we create the doc, otherwise nothing happens (user cannot fill in nothing and create the doc)
			if theform.getvalue('edit_docname') and user != "demo":
				if docname != 'new_document':
					if doc_id > max_id:
						create_document(doc_id, docname, corpus, status, assignee, repo_name, text_content)
						max_id = doc_id
					else:
						update_docname(doc_id, docname)

			if theform.getvalue('edit_filename') and user != "demo":
				repo_name = theform.getvalue('edit_filename')
				if repo_name != 'account/repo_name':
					if doc_id > max_id:
						create_document(doc_id, docname, corpus, status, assignee, repo_name, text_content)
						max_id = doc_id
					else:
						update_filename(doc_id, repo_name)

			if theform.getvalue('edit_corpusname') and user != "demo":
				corpus = theform.getvalue('edit_corpusname')
				if corpus != 'default_corpus':
					if doc_id > max_id:
						create_document(doc_id, docname, corpus, status, assignee, repo_name, text_content)
						max_id = doc_id
					else:
						update_corpus(doc_id, corpus)

			if theform.getvalue('edit_status') and user != "demo":
				status = theform.getvalue('edit_status')
				if status != 'editing':
					if doc_id > max_id:
						create_document(doc_id, docname, corpus, status, assignee, repo_name, text_content)
						max_id = doc_id
					else:
						update_status(doc_id, status)

			if theform.getvalue('edit_assignee') and user != "demo":
				assignee = theform.getvalue('edit_assignee')
				if assignee != "default_user":
					if doc_id > max_id:
						create_document(doc_id, docname, corpus, status, assignee, repo_name, text_content)
						max_id = doc_id
					else:
						update_assignee(doc_id, assignee)

			if theform.getvalue('edit_schema') and user != "demo":
				schema = theform.getvalue('edit_schema')
				if schema != "--none--":
					if doc_id > max_id:
						create_document(doc_id, docname, corpus, status, assignee, repo_name, text_content)
						max_id = doc_id
					else:
						update_schema(doc_id, schema)

		else:
			# Get previous values from DB
			old_docname, old_corpus, old_repo, old_status, old_assignee, old_mode, old_schema = get_doc_info(doc_id)
			# Assume new values are same, overwrite with different form values and update DB if new values found
			docname, corpus, repo_name, status, assignee, mode, schema = old_docname, old_corpus, old_repo, old_status, old_assignee, old_mode, old_schema
			docname = old_docname

			# Handle switch to spreadsheet mode if NLP spreadsheet service is called
			if theform.getvalue('nlp_spreadsheet') == "do_nlp_spreadsheet" and mode == "xml" and user != "demo":
				api_call = spreadsheet_nlp_api
				nlp_user, nlp_password = get_nlp_credentials()
				data_to_process = generic_query("SELECT content FROM docs WHERE id=?",(doc_id,))[0][0]
				data = {"data":data_to_process, "lb":"line", "format":"sgml_no_parse"}
				resp = requests.post(api_call, data, auth=HTTPBasicAuth(nlp_user,nlp_password))
				sgml=resp.text.encode("utf8")
				out, err = make_spreadsheet(sgml, ether_url + "_/gd_" + corpus + "_" + docname, "sgml")
				mode = "ether"


	if theform.getvalue('edit_docname'):
		docname = theform.getvalue('edit_docname')
	elif old_docname != "":
		docname = old_docname
	if theform.getvalue('edit_corpusname'):
		corpus = theform.getvalue('edit_corpusname')
	elif old_corpus != "":
		corpus = old_corpus

	if theform.getvalue('id'):
		if int(doc_id) <= int(max_id):
		# After clicking edit in landing page, editing existing doc case, get the values from the db. pull the content from db to be displayed in the editor window.
			if theform.getvalue('edit_docname'):
				docname = theform.getvalue('edit_docname')
				if docname != old_docname and user != "demo":
					update_docname(doc_id,docname)
			if theform.getvalue('edit_filename'):
				repo_name=theform.getvalue('edit_filename')
				if repo_name != old_repo and user != "demo":
					update_filename(doc_id,repo_name)
			if theform.getvalue('edit_corpusname'):
				corpus = theform.getvalue('edit_corpusname')
				if corpus != old_corpus and user != "demo":
					update_corpus(doc_id,corpus)
			if theform.getvalue('edit_status'):
				status = theform.getvalue('edit_status')
				if status != old_status and user != "demo":
					update_status(doc_id,status)
			if theform.getvalue('edit_assignee'):
				assignee = theform.getvalue('edit_assignee')
				if assignee != old_assignee and user != "demo":
					update_assignee(doc_id,assignee)
			if theform.getvalue('edit_mode'):
				mode = theform.getvalue('edit_mode')
				if mode != old_mode and user != "demo":
					update_mode(doc_id,mode)
			if theform.getvalue('edit_schema'):
				schema = theform.getvalue('edit_schema')
				if schema != old_schema and user != "demo":
					update_schema(doc_id, schema)
			if theform.getvalue('nlp_spreadsheet') == "do_nlp_spreadsheet":  # mode has been changed to spreadsheet via NLP
				update_mode(doc_id, "ether")
				mode = "ether"
			if old_docname != docname or old_corpus != corpus:
				old_sheet_name = "gd" + "_" + old_corpus + "_" + old_docname
				if sheet_exists(ether_url, old_sheet_name):  # Check if there is an ether sheet to copy
					old_socialcalc = get_socialcalc(ether_url, old_sheet_name)
					out, err = make_spreadsheet(old_socialcalc, ether_url + "_/gd_" + corpus + "_" + docname, "socialcalc")
					if out == "OK":
						out, err = delete_spreadsheet(ether_url,old_sheet_name)
					else:
						mymsg += "out was: " + out + " err was" + err

			text_content = generic_query("SELECT content FROM docs WHERE id=?",(doc_id,))[0][0]

	# In the case of reloading after hitting 'save', either create new doc into db, or update db
	# CodeMirror sends the form with its code content in it before 'save' so we just display it again
	if theform.getvalue('code'):
		text_content = theform.getvalue('code')
		text_content = text_content.replace("\r","")
		text_content = unicode(text_content.decode("utf8"))
		if user != "demo":
			if int(doc_id)>int(max_id):
				create_document(doc_id, docname,corpus,status,assignee,repo_name,text_content)
			else:
				save_changes(doc_id,text_content)

	git_status=False

	commit_message = ""
	if theform.getvalue('commit_msg'):
		commit_message = theform.getvalue('commit_msg')

	if theform.getvalue('push_git') == "push_git":
		repo_name = generic_query("SELECT filename FROM docs WHERE id=?", (doc_id,))[0][0]
		file_name = generic_query("SELECT name FROM docs WHERE id=?", (doc_id,))[0][0]
		repo_info = repo_name.split('/')
		git_account, git_repo = repo_info[0], repo_info[1]
		if len(repo_info) > 2:
			subdir = '/'.join(repo_info[2:]) + "/"
		else:
			subdir = ""

		# The user will indicate the subdir in the repo_name stored in the db.
		# Therefore, a file may be associated with the target repo subdir zangsir/coptic-xml-tool/uploaded_commits,
		# and that is fine, but we will need to make this uploaded_commits subdir first to create our file.
		if not os.path.isdir(prefix + subdir) and subdir != "":
			os.mkdir(prefix + subdir, 0755)

		if mode == "xml":
			text_content = generic_query("SELECT content FROM docs WHERE id=?", (doc_id,))[0][0]
			file_name = file_name.replace(" ","_") + ".xml"
		else: # (mode == "ether")
			text_content = ether_to_sgml(get_socialcalc(ether_url, "gd" + "_" + corpus + "_" + docname),doc_id)
			file_name = file_name.replace(" ","_") + "_ether.sgml"
		saved_file = subdir + file_name
		serialize_file(text_content, saved_file)
		git_status = push_update_to_git(git_username, git_password, saved_file, git_account, git_repo, commit_message)

		# File system cleanup
		if subdir == "":
			# Delete a file
			os.remove(prefix+file_name)
		else:
			# Delete a subdirectory
			shutil.rmtree(prefix+subdir)

	if theform.getvalue('nlp_xml') == "do_nlp_xml" and mode == "xml":
		api_call=xml_nlp_api
		nlp_user, nlp_password = get_nlp_credentials()
		data = {"data":text_content, "lb":"line", "format":"pipes"}
		resp = requests.post(api_call, data, auth=HTTPBasicAuth(nlp_user,nlp_password))
		text_content=resp.text

	# Editing options
	# Docname
	# Filename
	push_git = """<input type="hidden" name="push_git" id="push_git" value="">
	<input type="text" name="commit_msg" id="commit_msg" placeholder="commit message here" style="width:140px">"""
	if git_2fa == "true":
		push_git += """<input type="text" id="code_2fa" name="2fa" placeholder = "2-factor code" style="width:80px" autocomplete="off">"""
	push_git += """<div name="push_git" class="button h128" onclick="do_push();"> <i class="fa fa-github"></i> Commit </div>
	"""

	if git_status:
		# Remove some html keyword symbols in the commit message returned by github3
		push_msg=git_status.replace('<','')
		push_msg=push_msg.replace('>','')
		push_git+="""<p style='color:red;'>""" + push_msg + ' successful' + """</p>"""

	status_list = open(prefix+"status.tab").read().replace("\r","").split("\n")

	options = ""
	for stat in status_list:
		options +='<option value="'+stat+'">'+stat+'</option>\n'
	options = options.replace('">'+status, '" selected="selected">'+status)

	edit_status="""<select name="edit_status" onchange='do_save();'>"""

	edit_status += options+"</select>"

	# Get XML schema list
	schema_list = ['--none--']
	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	schemadir = scriptpath + "schemas" + os.sep

	schemafiles = [f for f in listdir(schemadir) if isfile(join(schemadir, f))]
	for schemafile in sorted(schemafiles):
		if schemafile.endswith(".xsd"):
			schemafile = schemafile.replace(".xsd", "")
			schema_list.append(schemafile)

	edit_schema = """<select name="edit_schema" onchange="do_save();">"""
	for schema_file in schema_list:
		schema_select = ""
		schema_name = schema_file
		if schema_name == schema:
			schema_select = "selected"
		edit_schema += """<option value='""" + schema_name + "' %s>" + schema_name + """</option>"""
		edit_schema = edit_schema % schema_select
	edit_schema += "</select>"
	# edit_schema = edit_schema.replace(schema+'"', schema+'" selected="selected"')

	# Get user_list from the logintools
	user_list=[]
	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	userdir = scriptpath + "users" + os.sep

	userfiles = [ f for f in listdir(userdir) if isfile(join(userdir,f)) ]
	for userfile in sorted(userfiles):
		if userfile != "config.ini" and userfile != "default.ini" and userfile != "admin.ini" and userfile.endswith(".ini"):
			userfile = userfile.replace(".ini","")
			user_list.append(userfile)

	edit_assignee="""<select name="edit_assignee" onchange="do_save();">"""
	for list_user in user_list:
		assignee_select=""
		user_name=list_user
		if user_name==assignee:
			assignee_select="selected"
		edit_assignee+="""<option value='""" + user_name + "' %s>" + user_name + """</option>"""
		edit_assignee=edit_assignee%assignee_select
	edit_assignee+="</select>"

	edit_mode = '''<select name="edit_mode" id="edit_mode" onchange="do_save();">\n<option value="xml">xml</option>\n<option value="ether">spreadsheet</option>\n</select>'''
	edit_mode = edit_mode.replace(mode+'"', mode+'" selected="selected"')

	# Metadata
	if theform.getvalue('metakey'):
		metakey = theform.getvalue('metakey')
		metavalue = theform.getvalue('metavalue')
		if user != "demo":
			save_meta(int(doc_id),metakey.decode("utf8"),metavalue.decode("utf8"))
	if theform.getvalue('metaid'):
		metaid = theform.getvalue('metaid')
		if user != "demo":
			delete_meta(metaid, doc_id)

	nlp_service = """<div class="button h128" name="nlp_xml_button" onclick="document.getElementById('nlp_xml').value='do_nlp_xml'; do_save();"> """ + xml_nlp_button + """</div>""" + \
				  """<div class="button h128" name="nlp_ether_button" onclick="document.getElementById('nlp_spreadsheet').value='do_nlp_spreadsheet'; do_save();">"""+ spreadsheet_nlp_button + """</div>"""
	nlp_service = nlp_service.decode("utf8")

	disabled_nlp_service = """<div class="button disabled h128" name="nlp_xml_button">"""+xml_nlp_button+"""</div>""" + \
						   """<div class="button disabled h128" name="nlp_ether_button">""" +spreadsheet_nlp_button + """</div>"""
	disabled_nlp_service = disabled_nlp_service.decode("utf8")

	# Disable NLP services in demo
	if user == "demo":
		nlp_service = disabled_nlp_service

	page= "Content-type:text/html\r\n\r\n"
	if mode == "ether":
		embedded_editor = urllib.urlopen(prefix + "templates" + os.sep + "ether.html").read()
		ether_url += "gd_" + corpus + "_" + docname

		if "file" in theform and user != "demo":
			fileitem = theform["file"]
			if len(fileitem.filename) > 0:
				#  strip leading path from file name to avoid directory traversal attacks
				fn = os.path.basename(fileitem.filename)
				msg = 'The file "' + fn + '" was uploaded successfully'
				if fn.endswith(".xls") or fn.endswith(".xlsx"):
					make_spreadsheet(fileitem.file.read(),"https://etheruser:etherpass@corpling.uis.georgetown.edu/ethercalc/_/gd_" + corpus + "_" + docname,"excel")
				else:
					sgml = fileitem.file.read()
					meta_key_val = harvest_meta(sgml)
					make_spreadsheet(sgml,"https://etheruser:etherpass@corpling.uis.georgetown.edu/ethercalc/_/gd_" + corpus + "_" + docname)
					for (key, value) in iteritems(meta_key_val):
						key = key.replace("@","_")
						save_meta(int(doc_id),key.decode("utf8"),value.decode("utf8"))
		else:
			msg = "no file was uploaded"

		embedded_editor = embedded_editor.replace("**source**",ether_url)
	else:
		embedded_editor = urllib.urlopen(prefix + "templates" + os.sep + "codemirror.html").read()

	page += urllib.urlopen(prefix + "templates" + os.sep + "editor.html").read()
	page += mymsg
	page = page.replace("**embedded_editor**",embedded_editor)

	if len(doc_id) == 0:
		exp = re.compile(r"<article>.*</article>",re.DOTALL)
		page = exp.sub("""<h2>No document selected | <a href="index.py">back to document list</a> </h2>""",page)
	else:
		metadata = print_meta(doc_id)
		page=page.replace("**content**",text_content)
		page=page.replace("**docname**",docname)
		page=page.replace("**corpusname**",corpus)
		page=page.replace("**edit_status**",edit_status)
		page=page.replace("**repo**",repo_name)
		page=page.replace("**edit_schema**",edit_schema)
		page=page.replace("**edit_assignee**",edit_assignee)
		page=page.replace("**edit_mode**",edit_mode)
		page=page.replace("**metadata**",metadata)
		page=page.replace("**disabled_NLP**",disabled_nlp_service)
		page=page.replace("**NLP**",nlp_service)
		page=page.replace("**id**",doc_id)
		page=page.replace("**mode**",mode)
		page=page.replace("**schema**",schema)
		if int(admin)>0:
			page=page.replace("**github**",push_git)
		else:
			page = page.replace("**github**", '')

		if int(admin) < 3:
			page = page.replace('onblur="validate_docname();"','onblur="validate_docname();" disabled="disabled" class="disabled"')
			page = page.replace('onblur="validate_corpusname();"','onblur="validate_corpusname();" disabled="disabled" class="disabled"')
			page = page.replace('onblur="validate_repo();"','onblur="validate_repo();" disabled="disabled" class="disabled"')
			page = page.replace('''<div onclick="do_save();" class="button slim"><i class="fa fa-floppy-o"> </i>''','''<div class="button slim disabled"><i class="fa fa-floppy-o"> </i>''')

	header = open(templatedir + "header.html").read()
	page = page.replace("**navbar**", get_menu())
	page = page.replace("**header**", header)
	page = page.replace("**project**", project)
	page = page.replace("**skin**", skin)
	page = page.replace("**editor_help_link**",editor_help_link)

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
	print(load_page(user,admin,theform).encode("utf8"))


if __name__ == "__main__":
	open_main_server()
