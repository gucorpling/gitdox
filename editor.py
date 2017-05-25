#!/usr/bin/python
# -*- coding: utf-8 -*-

import cgi, cgitb
import os, shutil
from os import listdir
from modules.logintools import login
import urllib
from modules.gitdox_sql import *
from os.path import isfile, join
from modules.dataenc import pass_dec, pass_enc
import github3
from requests.auth import HTTPBasicAuth
import requests
import platform, re
from paths import ether_url, get_menu
from modules.ether import make_spreadsheet, delete_spreadsheet, sheet_exists, get_socialcalc, ether_to_sgml

# Support IIS site prefix on Windows
if platform.system() == "Windows":
	prefix = "transc\\"
else:
	prefix = ""

  
  
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
		metatag = re.search(r'<meta ([^>]*)>',sgml).group(1)
		matches = re.findall(r'([^=>]+?)="([^">]+)"',metatag)
		for match in matches:
			meta[match[0]] = match[1]
	return meta


def push_update_to_git(username,password,path,account,repo,message):
	files_to_upload = [path]
	gh = github3.login(username=username, password=password)
	repository = gh.repository(account, repo)
	for file_info in files_to_upload:
		with open(prefix+file_info, 'rb') as fd:
			contents = fd.read()
		contents_object = repository.contents(file_info)
		if contents_object: #this file already exists on remote repo
			#update
			push_status = contents_object.update(message,contents)
			return str(push_status)
		else:#file doesn't exist on remote repo
			#push
			push_status = repository.create_file(path=file_info, message=message.format(file_info),content=contents,)
			return str(push_status['commit'])


def serialize_file(text_content,file_name):
	f=open(prefix+file_name,'w')
	f.write(text_content.encode("utf8"))
	f.close()


def get_git_credentials(user,admin):
	if admin==0:
		return
	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	userdir = scriptpath + "users" + os.sep
	userfile = userdir + user + '.ini'
	f=open(userfile,'r').read().split('\n')
	user_dict={}
	for line in f:
		if line!='':
			l=line.split(' = ')
			user_dict[l[0]]=l[1]
	git_username=user_dict['git_username']
	git_password=pass_dec(user_dict['git_password'])
	return git_username,git_password[0]


def load_page(user,admin,theform):
	global ether_url
	max_id = generic_query("SELECT MAX(id) AS max_id FROM docs","")[0][0]
	if not max_id:  # This is for the initial case after init db
		max_id = 0
	text_content = ""
	repo_name = ""
	corpus = ""
	status = ""
	assignee = ""
	mode = "xml"
	doc_id = ""  # Should only remain so if someone navigated directly to editor.py
	docname = ""
	mymsg = ""
	old_docname, old_corpus, old_repo, old_status, old_assignee, old_mode = ["","","","","",""]

	if theform.getvalue('id'):
		doc_id = theform.getvalue('id')
		if int(doc_id) > int(max_id):
			# Creating new doc case, assign some default values
			docname = "new_document"
			repo_name = "account/repo_name"
			status = "editing"
			assignee = "default_user"
			corpus = "default_corpus"
			text_content = ""
			# If one of the four forms is edited, then we create the doc, otherwise nothing happens (user cannot fill in nothing and create the doc)
			if theform.getvalue('edit_docname'):
				if docname != 'new_document':
					if doc_id > max_id:
						create_document(doc_id, docname, corpus, status, assignee, repo_name, text_content)
						max_id = doc_id
					else:
						update_docname(doc_id, docname)

			if theform.getvalue('edit_filename'):
				repo_name = theform.getvalue('edit_filename')
				if repo_name != 'account/repo_name':
					if doc_id > max_id:
						create_document(doc_id, docname, corpus, status, assignee, repo_name, text_content)
						max_id = doc_id
					else:
						update_filename(doc_id, repo_name)

			if theform.getvalue('edit_corpusname'):
				corpus = theform.getvalue('edit_corpusname')
				if corpus != 'default_corpus':
					if doc_id > max_id:
						create_document(doc_id, docname, corpus, status, assignee, repo_name, text_content)
						max_id = doc_id
					else:
						update_corpus(doc_id, corpus)

			if theform.getvalue('edit_status'):
				status = theform.getvalue('edit_status')
				if status != 'editing':
					if doc_id > max_id:
						create_document(doc_id, docname, corpus, status, assignee, repo_name, text_content)
						max_id = doc_id
					else:
						update_status(doc_id, status)

			if theform.getvalue('edit_assignee'):
				assignee = theform.getvalue('edit_assignee')
				if assignee != "default_user":
					if doc_id > max_id:
						create_document(doc_id, docname, corpus, status, assignee, repo_name, text_content)
						max_id = doc_id
					else:
						update_assignee(doc_id, assignee)
		else:
			# Get previous values from DB
			old_docname, old_corpus, old_repo, old_status, old_assignee, old_mode = get_doc_info(doc_id)
			# Assume new value are same, overwrite with different form values and update DB if new values found
			docname, corpus, repo_name, status, assignee, mode = old_docname, old_corpus, old_repo, old_status, old_assignee, old_mode
			docname = old_docname

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
				if docname != old_docname:
					update_docname(doc_id,docname)
			if theform.getvalue('edit_filename'):
				repo_name=theform.getvalue('edit_filename')
				if repo_name != old_repo:
					update_filename(doc_id,repo_name)
			if theform.getvalue('edit_corpusname'):
				corpus = theform.getvalue('edit_corpusname')
				if corpus != old_corpus:
					update_corpus(doc_id,corpus)
			if theform.getvalue('edit_status'):
				status = theform.getvalue('edit_status')
				if status != old_status:
					update_status(doc_id,status)
			if theform.getvalue('edit_assignee'):
				assignee = theform.getvalue('edit_assignee')
				if assignee != old_assignee:
					update_assignee(doc_id,assignee)
			if theform.getvalue('edit_mode'):
				mode = theform.getvalue('edit_mode')
				if mode != old_mode:
					update_mode(doc_id,mode)
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
		if int(doc_id)>int(max_id):
			create_document(doc_id, docname,corpus,status,assignee,repo_name,text_content)
		else:
			save_changes(doc_id,text_content)

	git_status=False

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

		git_username, git_password = get_git_credentials(user, admin)

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
	
	if theform.getvalue('nlp_service') == "do_nlp" and mode == "xml":
		api_call="https://corpling.uis.georgetown.edu/coptic-nlp/api?data=%s&lb=line&format=pipes" %text_content
		resp = requests.get(api_call, auth=HTTPBasicAuth('coptic_client', 'kz7hh2'))
		text_content=resp.text


	# Editing options
	# Docname
	# Filename
	push_git = """<input type="hidden" name="push_git" id="push_git" value="">
	<input type="text" name="commit_msg" placeholder = "commit message here" style="width:140px">
	<div name="push_git" class="button" onclick="document.getElementById('push_git').value='push_git'; document.getElementById('editor_form').submit();"> <i class="fa fa-github"></i> Commit </div>
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

	edit_status="""<select name="edit_status" onchange='this.form.submit()'>"""

	edit_status += options+"</select>"

	# Get user_list from the logintools
	user_list=[]
	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	userdir = scriptpath + "users" + os.sep

	userfiles = [ f for f in listdir(userdir) if isfile(join(userdir,f)) ]
	for userfile in sorted(userfiles):
		if userfile != "config.ini" and userfile != "default.ini" and userfile != "admin.ini" and userfile.endswith(".ini"):
			userfile = userfile.replace(".ini","")
			user_list.append(userfile)

	edit_assignee="""<select name="edit_assignee" onchange="this.form.submit()">"""
	for user in user_list:
		assignee_select=""
		user_name=user
		if user_name==assignee:
			assignee_select="selected"
		edit_assignee+="""<option value='""" + user_name + "' %s>" + user_name + """</option>""" 
		edit_assignee=edit_assignee%assignee_select
	edit_assignee+="</select>"

	edit_mode = '''<select name="edit_mode" onchange="this.form.submit()">\n<option value="xml">xml</option>\n<option value="ether">spreadsheet</option>\n</select>'''
	edit_mode = edit_mode.replace(mode+'"', mode+'" selected="selected"')

	# Metadata
	if theform.getvalue('metakey'):
		metakey = theform.getvalue('metakey')
		metavalue = theform.getvalue('metavalue')
		save_meta(int(doc_id),metakey.encode("utf8"),metavalue.encode("utf8"))
	if theform.getvalue('metaid'):
		metaid = theform.getvalue('metaid')
		delete_meta(metaid)
	metadata = print_meta(doc_id)

	nlp_service = """
	<div class="button" name="nlp_button" onclick="document.getElementById('nlp_service').value='do_nlp'; document.getElementById('editor_form').submit();"> <i class="fa fa-cogs"></i> NLP </div>
	"""

	disabled_nlp_service = """
	<div class="button disabled" name="nlp_button"> <i class="fa fa-cogs"></i> NLP </div>

	"""


	page= "Content-type:text/html\r\n\r\n"
	#page += str(theform)
	if mode == "ether":
		embedded_editor = urllib.urlopen(prefix + "templates" + os.sep + "ether.html").read()
		ether_url += "gd_" + corpus + "_" + docname

		if "file" in theform:
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
					for key, value in meta_key_val.iteritems():
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
		page=page.replace("**content**",text_content)
		page=page.replace("**docname**",docname)
		page=page.replace("**corpusname**",corpus)
		page=page.replace("**edit_status**",edit_status)
		page=page.replace("**repo**",repo_name)
		page=page.replace("**edit_assignee**",edit_assignee)
		page=page.replace("**edit_mode**",edit_mode)
		page=page.replace("**metadata**",metadata)
		page=page.replace("**disabled_NLP**",disabled_nlp_service)
		page=page.replace("**NLP**",nlp_service)
		page=page.replace("**id**",doc_id)
		if int(admin)>0:
			page=page.replace("**github**",push_git)
		else:
			page = page.replace("**github**", '')

	page = page.replace("**navbar**", get_menu())
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
	print load_page(user,admin,theform).encode("utf8")

open_main_server()
