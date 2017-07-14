#!/usr/bin/python
# -*- coding: UTF-8 -*-

import cgi, cgitb 
import os, platform
from os.path import isfile, join
from os import listdir
from modules.logintools import login
from modules.configobj import ConfigObj
from modules.pathutils import *
import urllib
from modules.gitdox_sql import *
from modules.dataenc import pass_dec, pass_enc
from paths import get_menu
from editor import harvest_meta
from modules.ether import make_spreadsheet

# Support IIS site prefix on Windows
if platform.system() == "Windows":
	prefix = "transc\\"
else:
	prefix = ""

scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
userdir = scriptpath + "users" + os.sep
templatedir = scriptpath + "templates" + os.sep
config = ConfigObj(userdir + 'config.ini')
skin = config["skin"]
project = config["project"]

def write_user_file(username,password,admin,email,realname,git_username,git_password,git_2fa=False):
	#this is used to write information into a text file to serve as a debugging tool and log
	#change logging=True to start logging
	userdir=prefix+"users"+os.sep
	f=open(userdir+username+'.ini',"w")
	f.write('username='+username+'\n')
	f.write('password='+pass_enc(password)+'\n')
	f.write('realname='+realname+'\n')
	f.write('admin='+str(admin)+'\n')
	f.write('email='+email+'\n')
	f.write('max-age=0'+'\n')
	f.write('numlogins = 85\nnumused = 2869\n')
	f.write('git_username='+git_username+'\n')
	f.write('git_password='+pass_enc(git_password)+'\n')
	f.write('git_2fa='+str(git_2fa).lower()+'\n')
	f.close()


def update_password(user,new_pass):
	f=open(prefix+'users'+os.sep+user+'.ini','r')
	ff=f.read().split('\n')
	f.close()

	new_file=[]
	for line in ff:
		if line!='':
			line_split=line.split('=')
			if line_split[0].strip().startswith('password'):
				newline='password = ' + pass_enc(new_pass)
				new_file.append(newline)
			else:
				new_file.append(line)
	open(prefix + 'users'+os.sep+user+'.ini', 'w').close()
	g=open('users/'+user+'.ini','a')
	for l in new_file:
		g.write(l+'\n')
	g.close()


def update_git_info(user,new_git_username,new_git_password,new_git_2fa=False):
	f=open(prefix+'users'+os.sep+user+'.ini','r')
	ff=f.read().split('\n')
	f.close()

	new_file=[]
	for line in ff:
		if line!='':
			line_split=line.split('=')
			if line_split[0].strip().startswith('git_password'):
				newline='git_password = ' + pass_enc(new_git_password)
				new_file.append(newline)
			elif line_split[0].strip().startswith('git_username'):
				newline='git_username = ' + new_git_username
				new_file.append(newline)
			elif line_split[0].strip().startswith('git_2fa'):
				newline = 'git_2fa = ' + str(new_git_2fa).lower()
				new_file.append(newline)
			else:
				new_file.append(line)
	open(prefix + 'users'+os.sep+user+'.ini', 'w').close()
	g=open(prefix+ 'users'+os.sep+user+'.ini','a')
	for l in new_file:
		g.write(l+'\n')
	g.close()


def load_admin(user,admin,theform):
	warn=""
	if theform.getvalue('user_delete'):
		userdir=prefix+'users' + os.sep
		user_del_file=theform.getvalue('user_delete')
		user_del=user_del_file.split('.ini')[0]
		#delete_user(user_del)
		#need to also delete the user.ini file
		os.remove(userdir+user_del_file)

	if theform.getvalue('create_user'):
		username=theform.getvalue('username')
		password=theform.getvalue('password')
		realname=theform.getvalue('realname') if theform.getvalue('realname') is not None else ""
		email=theform.getvalue('email') if theform.getvalue('email') is not None else ""
		admin=theform.getvalue('admin')
		git_username=theform.getvalue('git_username') if theform.getvalue('git_username') is not None else "none"
		git_password=theform.getvalue('git_password') if theform.getvalue('git_password') is not None else "none"
		git_2fa=theform.getvalue('git_2fa') if theform.getvalue('git_2fa') is not None else "false"

		if username!=None and password!=None:

			#create user in database
			#create_user(username)
			#need to write a user file for login tools
			write_user_file(username,password,admin,email,realname,git_username,git_password,git_2fa)
		else:
			warn="</br><b style='color:red;'>ERROR: username or password missing; user cannot be created.</b></br>"

	if theform.getvalue('init_db'):
		setup_db()

	page= "Content-type:text/html\r\n\r\n"
	page+="""

	<!DOCTYPE html>
	<html>
	<head>
		<link rel="stylesheet" href="**skin**" type="text/css" charset="utf-8"/>
		<link rel="stylesheet" href="css/gitdox.css" type="text/css" charset="utf-8"/>
		<link rel="stylesheet" href="css/font-awesome-4.7.0/css/font-awesome.min.css"/>
		<script src="js/validate.js"/>
	<style>
	table {
		font-family: arial, sans-serif;
		border-collapse: collapse;
		width:400pt;
	}

	td, th {
		
		text-align: left;
		padding: 8px;
	}

	</style>
	<script src="js/jquery-1.11.3.min.js"></script>
	</head>
	<body>
	**navbar**
	<div id="wrapper">
		**header**
		<div id="content">
		<h1 >GitDox - Administration</h1>
			<p style="border-bottom:groove;"><i>administration and user management</i> | <a href="index.py">back to document list</a> </p>

	"""
	page+="""<form id="form_del_user" action="admin.py" method='post'>"""

	#page+="""<h2> User Management </h2>"""

	#a list of all users
	page += '''<h2>User Management</h2>
	
	
	<p><h3>Select users to delete:</h3></p>
	<select id="userlist_select" name='user_delete' class="doclist">
	'''
	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	userdir = scriptpath + "users" + os.sep

	userfiles = [ f for f in listdir(userdir) if isfile(join(userdir,f)) ]
	for userfile in sorted(userfiles):
		if userfile != "config.ini" and userfile != "default.ini" and userfile != "admin.ini" and userfile.endswith(".ini"):
			userfile = userfile.replace(".ini","")
			page += '<option value="' + userfile + '.ini">'+userfile+'</option>'
	
	page+="</select>"

	
	page+="""</br></br>
    <input type="hidden" name='deleteuser' value='delete user'/><div onclick="document.getElementById('form_del_user').submit();" class="button"> <i class="fa fa-trash-o"></i> delete</div>
	</form>"""

	#add user

	page+="""</br><h3>Enter user info to create new user:</h3></br><form id="form_new_user" class="admin_form" action='admin.py' method='post'>
	<table id="user_data">
	<colgroup>
    	<col style="width:150px">
  	</colgroup>
  	<tbody>
	<tr><td>username</td><td><input type='text' name='username'> </td></tr>
	<tr><td>password </td><td><input type='password' name='password'> </td></tr>
	<tr><td>realname</td><td> <input type='text' name='realname'> </td></tr>
	<tr><td>email </td><td><input type='text' name='email'> </td></tr>
	<tr><td>admin</td><td> <select name="admin">
	<option value="0">User</option>
	<option value="1">Committer</option>
	<option value="3">Administrator</option> </select></td></tr>
	<tr><td>git username </td><td><input type='text' name='git_username'></td></tr>
	<tr><td>git password</td><td> <input type='password' name='git_password'></td></tr>
	<tr><td>use two-factor auth</td><td> <input type='checkbox' name='git_2fa' value='true'></td></tr>
	</tbody>
	</table>




	</br></br><input type='hidden' name='create_user' value='true'>
	<div onclick="document.getElementById('form_new_user').submit();" class="button"> <i class="fa fa-floppy-o"></i> save</div>
	</form>"""
	if warn!="":
		page+=warn

	msg = ""
	imported = 0
	if "file" in theform and "mode" in theform:
		fileitem = theform["file"]
		mode = theform.getvalue("mode")
		if len(fileitem.filename) > 0:
			#  strip leading path from file name to avoid directory traversal attacks
			fn = os.path.basename(fileitem.filename)
			msg = '<br><span style="color:green">The file "' + fn + '" was uploaded successfully</span><br>'
			from zipfile import ZipFile
			zip = ZipFile(fileitem.file)
			file_list = [f for f in zip.namelist() if not os.path.isdir(f)]
			for filename in file_list:
				imported += 1
				sgml = zip.open(filename).read()
				meta_key_val = harvest_meta(sgml)
				if "corpus" in meta_key_val:
					corpus = meta_key_val["corpus"]
				else:
					corpus = "default_corpus"
				docname = filename.replace(" ","_")  # No spaces in document names
				docname = re.sub(r'(.+)\.[^\.]+$',r'\1',docname)  # Strip extension
				if not doc_exists(docname, corpus):
					max_id = generic_query("SELECT MAX(id) AS max_id FROM docs", "")[0][0]
					if not max_id:  # This is for the initial case after init db
						max_id = 0
					doc_id = int(max_id) + 1
					create_document(doc_id, docname, corpus, "published", "default_user", "cligu/lirc/gitdox", "", mode)
				else:
					# Document already exists, just overwrite spreadsheet/xml and metadata and set mode
					doc_id = generic_query("SELECT id FROM docs where corpus=? and name=?", (corpus,docname))[0][0]
					update_mode(doc_id, mode)

				if mode == "ether":
					make_spreadsheet(sgml, "https://etheruser:etherpass@corpling.uis.georgetown.edu/ethercalc/_/gd_" + corpus + "_" + docname, format="sgml", ignore_elements=True)
				else:
					content = re.sub("</?meta ?[^>]*>[\r\n]*","",sgml)
					content = unicode(content.decode("utf8"))
					save_changes(doc_id, content)
				for key, value in meta_key_val.iteritems():
					key = key.replace("@", "_")
					save_meta(doc_id, key.decode("utf8"), value.decode("utf8"))
	if imported > 0:
		msg += '<span style="color:green">Imported '+str(imported)+' files from archive</span><br>'

	page+="""
	<h2>Batch upload</h2>
<p>Import multiple spreadsheets data by uploading a zip archive with SGML files</p>
<ul>
	<li>Document names are generated from file names inside the zip, without their extension (e.g. .sgml, .tt)</li>
	<li>Metadata is taken from the &lt;meta&gt; element surrounding the document</li>
	<li>Corpus name is taken from a metadatum corpus inside meta, else 'default_corpus'</li>
	<li>Select XML mode to import into XML editor, or Spreadsheet to convert SGML spans into a new spreadsheet</li>
</ul>
<form id="batch_upload" name="batch_upload" method="post" action="admin.py" enctype="multipart/form-data">
<table>
  <tbody><tr>
    <td>Mode:
  <select id="mode" name="mode" style="width: 120px;">
	<option value="xml">XML</option>
	<option value="ether">Spreadsheet</option>
</select>
    </td>
  </tr>
  <tr>
    <td>
      <input id="file" type="file" name="file" style="width: 200px"></td></tr><tr>
<td><button onclick="upload()">Upload</button>
    </td>
  </tr>
  </tbody></table></form>
"""
	
	page+=msg

	msg = ""
	sql_statements = 0
	if "sqltab" in theform:
		fileitem = theform["sqltab"]
		if len(fileitem.filename) > 0:
			#  strip leading path from file name to avoid directory traversal attacks
			fn = os.path.basename(fileitem.filename)
			msg = '<br><span style="color:green">The file "' + fn + '" was uploaded successfully</span><br>'
			rows = fileitem.file.read().replace("\r","").split("\n")
			c1, c2 = ["",""]
			for i, row in enumerate(rows):
				if row.count("\t") == 1:
					f1, f2 = row.split("\t")
				if i == 0:
					c1, c2 = f1, f2
				else:
					if c1 in ["corpus", "name"]:
						sql = "update docs set " + c2 + " = ? where " + c1 + " = ? ;"
						generic_query(sql, (f2, f1))
						sql_statements += 1

	if sql_statements > 0:
		msg += '<span style="color:green">Executed ' + str(sql_statements) + ' DB updates</span><br>'

	page += """
		<h2>Batch update DB</h2>
	<p>Execute multiple SQL updates, e.g. to assign documents to users from a list</p>
	<ul>
		<li>The uploaded file should be a tab delimited, two column text file</li>
		<li>The first rwo contains the headers:
			<ul><li>in column 1, the criterion, one of 'corpus' or 'name' (=document name)</li>
			<li>in column 2, the docs table column to update, e.g. 'assignee_username'</li></ul></li>
		<li>Subsequent rows give pairs of criterion-value, e.g. 'doc001   user1'</li>
	</ul>
	<form id="batch_sql" name="batch_sql" method="post" action="admin.py" enctype="multipart/form-data">
	      <input id="sqltab" type="file" name="sqltab" style="width: 200px">
	      <button onclick="upload()">Upload</button>
	</form>
	"""

	page += msg


	page+="<br><br><h2>Database management</h2>"
	#init database, setup_db, wipe all documents

	page+="""<form id="form_initdb" action='admin.py' method='post'>
	<b style='color:red'>warning: this will wipe the database!</b>
	<br><input type='hidden' name='init_db' value='true'>
		<div onclick="document.getElementById('form_initdb').submit();" class="button"> <i class="fa fa-database"></i> init DB</div>
	</form>"""



	page+="</div></div></div></body></html>"
	header = open(templatedir + "header.html").read()
	page = page.replace("**navbar**",get_menu())
	page = page.replace("**header**",header)
	page = page.replace("**project**",project)
	page = page.replace("**skin**",skin)

	return page


def load_user_config(user,admin,theform):
	if theform.getvalue('new_pass') and user != "demo":
		new_pass=theform.getvalue('new_pass')
		update_password(user,new_pass)
	if theform.getvalue('new_git_password') and user != "demo":

		new_git_password=theform.getvalue('new_git_password')
		new_git_username=theform.getvalue('new_git_username')
		new_git_2fa=theform.getvalue('new_git_2fa')

		update_git_info(user,new_git_username,new_git_password,new_git_2fa)


	page= "Content-type:text/html\r\n\r\n"
	page+="""

	<!DOCTYPE html>
	<html>
	<head>
		<link rel="stylesheet" href="**skin**" type="text/css" charset="utf-8"/>
		<link rel="stylesheet" href="css/gitdox.css" type="text/css" charset="utf-8"/>
		<link rel="stylesheet" href="css/font-awesome-4.7.0/css/font-awesome.min.css"/>
	<style>
	table {
		font-family: arial, sans-serif;
		border-collapse: collapse;
		width:400pt;
	}

	td, th {
		
		text-align: left;
		padding: 8px;
	}

	</style>
	</head>
	<body>
	**navbar**
	<div id="wrapper">
		<div id="header">
			**header**
		</div>
		<div id="content">
	<h1 >Coptic XML transcription editor</h1> 
		<p style="border-bottom:groove;"><i>edit user info</i> | <a href="index.py">back to document list</a> </p>
	
	<h2>Edit your account information</h2>
	"""
	#edit user password
	username_info="""<table><tr><td>username</td><td>%s</td></tr>"""%user
	username_info+="""
	<form action='admin.py' method='post'>
	<tr><td>new password</td><td><input type='password' name='new_pass'></td></tr></table>
	"""
	

	page+=username_info
	page+="<input type='submit' value='change'> </form>\n"
	page+="</br><p>note: after you changed your password you'll be logged out and you need to log in using your new password again</p>\n"

	#edit git info
	if admin=="1":
		page+="""<form action='admin.py' method='post'><table><tr><td>new git username</td><td><input type='text' name='new_git_username'></td></tr>
		<tr><td>new git password</td><td><input type='password' name='new_git_password'></td></tr>
		<tr><td>use two-factor auth</td><td><input type='checkbox' name='new_git_2fa' value='true'></td></tr>
		</table>\n"""


		page+="<input type='submit' value='change'> </form>\n"
	
	page += "\t\t\t</div>\t\t\n</div>\t\n</div>\n</body>\n</html>"

	header = open(templatedir + "header.html").read()
	page = page.replace("**navbar**",get_menu())
	page = page.replace("**header**",header)
	page = page.replace("**project**",project)
	page = page.replace("**skin**",skin)

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
	if admin == "3":
		print(load_admin(user,admin,theform))
	elif admin == "0" or admin=="1":
		print(load_user_config(user,admin,theform))


open_main_server()



