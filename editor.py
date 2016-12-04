#!/usr/bin/python
# -*- coding: utf-8 -*-

# Import modules for CGI handling 
import cgi, cgitb 
import os, shutil
from os import listdir
from modules.logintools import login
from modules.configobj import ConfigObj
from modules.pathutils import *
import urllib
from modules.gitdox_sql import *
from os.path import isfile, join
from modules.dataenc import pass_dec, pass_enc
import github3
from requests.auth import HTTPBasicAuth
import requests
import platform

# Support IIS site prefix on Windows
if platform.system() == "Windows":
	prefix = "transc\\"
else:
	prefix = ""


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
			options += '<option value=%s>\n' %name
	return options


def cell(text):
	return "\n	<td>" + str(text) + "</td>"


def print_meta(doc_id):
	meta = generic_query("SELECT * FROM metadata WHERE docid=?",(doc_id,))
	# docid,metaid,key,value - four cols
	table="""<input type="hidden" id="metaid" name="metaid" value="">
	<table id="meta_table">
	<colgroup>
    	<col>
    	<col>
    	<col style="width: 40px">
  	</colgroup>
  		<tbody>
	"""
	for item in meta:
		# Each item appears in one row of the table
		row = "\n <tr>"
		metaid = str(item[1])
		('metaid:'+str(metaid))
		id=str(doc_id)
		for i in item[2:]:
			row += cell(i)

	#delete meta
		metaid_code="""<div class="button slim" onclick="document.getElementById('metaid').value='"""+metaid+"""'; document.getElementById('codemir').submit();"><i class="fa fa-trash"></i> </div>"""
		#id_code="""<input type="hidden" name="id"  value="""+id+">"

		button_delete=""
		button_delete+=metaid_code
		#button_delete+=id_code
		#button_delete+="""<input type='submit' name='deletemeta'  value='DELETE'>"""
		row+=cell(button_delete)
		row+="\n </tr>"
		table+=row
	table+="\n</tbody>\n</table>\n"
	return table


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
	max_id = generic_query("SELECT MAX(id) AS max_id FROM docs","")[0][0]
	if not max_id:  # This is for the initial case after init db
		max_id = 0
	text_content = ""
	doc_name = ""
	repo_name = ""
	status = ""
	assignee = ""
	doc_id = ""

	if theform.getvalue('id'):
		# This should come from either creating new doc or 'editing doc' in index page
		doc_id=theform.getvalue('id')

		# Creating new doc case, assign some default values
		if int(doc_id) > int(max_id):
			doc_name="new_document"
			repo_name="account/repo_name"
			status="editing"
			assignee="default_user"
			text_content=""
			doc_saved=False
			# If one of the four forms is edited, then we create the doc, otherwise nothing happens (user cannot fill in nothing and create the doc)
			if theform.getvalue('edit_docname'):
				docname=theform.getvalue('edit_docname')
				if docname!='new document':
					if int(doc_id) > int(max_id):
						create_document(doc_name,status,assignee,repo_name,text_content)
						max_id = doc_id
					update_docname(doc_id,docname)
					doc_saved=True

			if theform.getvalue('edit_filename'):
				filename=theform.getvalue('edit_filename')
				if filename!='account/repo_name':
					if int(doc_id) > int(max_id):
						create_document(doc_name,status,assignee,repo_name,text_content)
						max_id = doc_id
					update_filename(doc_id,filename)
					doc_saved=True


			if theform.getvalue('edit_status'):
				newstatus=theform.getvalue('edit_status')
				if newstatus!='editing':
					if int(doc_id) > int(max_id):
						create_document(doc_name,status,assignee,repo_name,text_content)
						max_id = doc_id
					update_status(doc_id,newstatus)
					doc_saved=True
				
			if theform.getvalue('edit_assignee'):
				newassignee_username=theform.getvalue('edit_assignee')
				if newassignee_username!="default_user":
					if int(doc_id) > int(max_id):
						create_document(doc_name,status,assignee,repo_name,text_content)
						max_id = doc_id
					update_assignee(doc_id,newassignee_username)
					doc_saved=True
			if doc_saved==True:		
				text_content = generic_query("SELECT content FROM docs WHERE id=?",(doc_id,))[0][0]
				doc_name=generic_query("SELECT name FROM docs WHERE id=?",(doc_id,))[0][0]
				repo_name=generic_query("SELECT filename FROM docs WHERE id=?",(doc_id,))[0][0]
				assignee=generic_query("SELECT assignee_username FROM docs WHERE id=?",(doc_id,))[0][0]
				status=generic_query("SELECT status FROM docs WHERE id=?",(doc_id,))[0][0]
				
		#after clicking edit in landing page, editing existing doc case, get the values from the db. pull the content from db to be displayed in the editor window.
		else:
			if theform.getvalue('edit_docname'):
				docname=theform.getvalue('edit_docname')
				update_docname(doc_id,docname)
			if theform.getvalue('edit_filename'):
				filename=theform.getvalue('edit_filename')
				update_filename(doc_id,filename)
			if theform.getvalue('edit_status'):
				newstatus=theform.getvalue('edit_status')
				update_status(doc_id,newstatus)
			if theform.getvalue('edit_assignee'):
				newassignee_username=theform.getvalue('edit_assignee')
				update_assignee(doc_id,newassignee_username)
			text_content = generic_query("SELECT content FROM docs WHERE id=?",(doc_id,))[0][0]
			doc_name=generic_query("SELECT name FROM docs WHERE id=?",(doc_id,))[0][0]
			repo_name=generic_query("SELECT filename FROM docs WHERE id=?",(doc_id,))[0][0]
			assignee=generic_query("SELECT assignee_username FROM docs WHERE id=?",(doc_id,))[0][0]
			status=generic_query("SELECT status FROM docs WHERE id=?",(doc_id,))[0][0]

	# In the case of reloading after hitting 'save', either create new doc into db, or update db
	# CodeMirror sends the form with its code content in it before 'save' so we just display it again
	if theform.getvalue('code'):
		text_content = theform.getvalue('code')
		text_content = text_content.replace("\r","")
		text_content = unicode(text_content.decode("utf8"))
		if int(doc_id)>int(max_id):
			create_document(doc_name,status,assignee,repo_name,text_content)
		else:
			save_changes(doc_id,text_content)

	git_status=False

	if theform.getvalue('commit_msg'):
		commit_message = theform.getvalue('commit_msg')


	if theform.getvalue('push_git') == "push_git":
		text_content = generic_query("SELECT content FROM docs WHERE id=?", (doc_id,))[0][0]
		repo_name = generic_query("SELECT filename FROM docs WHERE id=?", (doc_id,))[0][0]
		file_name = generic_query("SELECT name FROM docs WHERE id=?", (doc_id,))[0][0]
		file_name = file_name.replace(" ","_") + ".xml"
		repo_info = repo_name.split('/')
		git_account, git_repo = repo_info[0], repo_info[1]
		if len(repo_info)>2:
			subdir = '/'.join(repo_info[2:]) + "/"
		else:
			subdir = ""
		if not os.path.isdir(prefix+subdir) and subdir != "":
			os.mkdir(prefix+subdir, 0755)

		# The user will indicate the subdir in the repo_name stored in the db.
		# Therefore, a file may be associated with the target repo subdir zangsir/coptic-xml-tool/uploaded_commits,
		# and that is fine, but we will need to make this uploaded_commits subdir first to create our file.
		saved_file = subdir + file_name
		serialize_file (text_content,saved_file)
		git_username,git_password=get_git_credentials(user,admin)
		git_status = push_update_to_git(git_username, git_password, saved_file, git_account, git_repo, commit_message)
		if subdir == "":
			# Delete a file
			os.remove(prefix+file_name)
		else:
			shutil.rmtree(prefix+subdir)
	
	if theform.getvalue('nlp_service') == "do_nlp":
		api_call="https://corpling.uis.georgetown.edu/coptic-nlp/api?data=%s&lb=line&format=pipes" %text_content
		resp = requests.get(api_call, auth=HTTPBasicAuth('coptic_client', 'kz7hh2'))
		text_content=resp.text


	# Editing options
	# Docname
	edit_docname = """<input type='text' id='edit_docname' name='edit_docname' value='%s' onblur='validate_docname();'>
	<div onclick="document.getElementById('codemir').submit();" class="button slim"><i class="fa fa-floppy-o"> </i>
	""" %doc_name
	# Filename
	edit_filename = """<input type='text' name='edit_filename' value='%s'>
		<div onclick="document.getElementById('codemir').submit();" class="button slim"><i class="fa fa-floppy-o"> </i>
	""" %repo_name
	#push_git = """<input type='hidden' name='push_git' value='yes'> <input type='submit' value='Push'>"""
	push_git = """<input type="hidden" name="push_git" id="push_git" value="">
	<input type="text" name="commit_msg" placeholder = "commit message here" style="width:140px">
	<div name="push_git" class="button" onclick="document.getElementById('push_git').value='push_git'; document.getElementById('codemir').submit();"> <i class="fa fa-github"></i> Commit </div>
	"""

	if git_status:
		#remove some html keyword symbols in the commit message returned by github3
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

	#get user_list from the logintools
	user_list=[]
	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	userdir = scriptpath + "users" + os.sep

	userfiles = [ f for f in listdir(userdir) if isfile(join(userdir,f)) ]
	for userfile in sorted(userfiles):
		if userfile != "config.ini" and userfile != "default.ini" and userfile != "admin.ini" and userfile.endswith(".ini"):
			userfile = userfile.replace(".ini","")
			user_list.append(userfile)

	edit_assignee="""<select name="edit_assignee" onchange='this.form.submit()'>"""
	for user in user_list:
		assignee_select=""
		user_name=user
		if user_name==assignee:
			assignee_select="selected"
		edit_assignee+="""<option value='""" + user_name + "' %s>" + user_name + """</option>""" 
		edit_assignee=edit_assignee%assignee_select
	edit_assignee+="</select>"

	#meta data
	if theform.getvalue('metakey'):
		metakey=theform.getvalue('metakey')
		metavalue=theform.getvalue('metavalue')
		save_meta(doc_id,metakey,metavalue)
	if theform.getvalue('metaid'):
		metaid=theform.getvalue('metaid')
		delete_meta(metaid)
	metadata=print_meta(doc_id)

	nlp_service = """

	<div class="button" name="nlp_button" onclick="document.getElementById('nlp_service').value='do_nlp'; document.getElementById('codemir').submit();"> <i class="fa fa-cogs"></i> NLP </div>


	"""


	page= "Content-type:text/html\r\n\r\n"
	page += urllib.urlopen(prefix + "editor_codemir.html").read()
	if len(doc_id) == 0:
		exp = re.compile(r"<article>.*</article>",re.DOTALL)
		page = exp.sub("""<h2>No document selected | <a href="index.py">back to document list</a> </h2>""",page)
	else:
		page=page.replace("**content**",text_content)
		page=page.replace("**edit_docname**",edit_docname)
		page=page.replace("**edit_status**",edit_status)
		page=page.replace("**edit_repo**",edit_filename)
		page=page.replace("**edit_assignee**",edit_assignee)
		page=page.replace("**metadata**",metadata)
		page=page.replace("**NLP**",nlp_service)
		page=page.replace("**id**",doc_id)
		if int(admin)>0:
			page=page.replace("**github**",push_git)
		else:
			page = page.replace("**github**", '')

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