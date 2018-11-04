#!/usr/bin/python
# -*- coding: utf-8 -*-

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
from modules.ether import make_spreadsheet, get_ether_stylesheets
from modules.renderer import render
from passlib.apps import custom_app_context as pwd_context
import github3
import time

# Support IIS site prefix on Windows
if platform.system() == "Windows":
	prefix = "transc\\"
else:
	prefix = ""


scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
userdir = scriptpath + "users" + os.sep
templatedir = scriptpath + "templates" + os.sep
config = ConfigObj(userdir + 'config.ini')
project = config["project"]


def get_statuses():
	return open(prefix+"status.tab").read().replace("\r","").split("\n")


def write_user_file(username,password,admin,email,realname,git_username,git_password,git_2fa=False):
	#this is used to write information into a text file to serve as a debugging tool and log
	#change logging=True to start logging
	userdir=prefix+"users"+os.sep
	f=open(userdir+username+'.ini',"w")
	f.write('username='+username+'\n')
	f.write('password='+pass_enc(pwd_context.hash(password,salt=""))+'\n')
	f.write('realname='+realname+'\n')
	f.write('admin='+str(admin)+'\n')
	f.write('email='+email+'\n')
	f.write('max-age=0'+'\n')
	f.write('editable=Yes'+'\n')
	f.write('numlogins = 85\nnumused = 2869\n')

	# get oauth token for github. Add current date to note since they need to be unique or an error will occur
	note = project + ", " + time.ctime()
	try:
		auth = github3.authorize(git_username, git_password, ['repo'], note, "")
		f.write('git_username='+git_username+'\n')
		f.write('git_token='+auth.token+'\n')
		f.write('git_id='+str(auth.id)+'\n') # in case we ever need to update authorizations
		f.write('git_2fa='+str(git_2fa).lower()+'\n')
	except:
		# would be ideal to show an error, but just fail silently
		pass 
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
	o = ConfigObj(prefix + 'users' + os.sep + user + '.ini')
	o['git_username'] = new_git_username
	o['git_2fa'] = str(new_git_2fa).lower()

	try:
		note = project + ", " + time.ctime()
		auth = github3.authorize(new_git_username, new_git_password, ['repo'], note, "")
		o['git_token'] = auth.token
		o['git_id'] = auth.id
		if 'git_password' in o:
			del o['git_password']
		o.write()
	except:
		# fail silently--would want to display an error ideally, but
		# users will know to try again if the credentials are wrong
		pass

def load_admin(user, admin, theform):
	render_data = {}

	# handle user deletion
	if theform.getvalue('user_delete'):
		userdir = prefix + 'users' + os.sep
		user_del_file = theform.getvalue('user_delete')
		user_del = user_del_file.split('.ini')[0]
		#delete_user(user_del)
		#need to also delete the user.ini file
		os.remove(userdir + user_del_file)

	# handle user creation
	if theform.getvalue('create_user'):
		username = theform.getvalue('username')
		password = theform.getvalue('password')
		realname = theform.getvalue('realname') if theform.getvalue('realname') is not None else "anonymous"
		email = theform.getvalue('email') if theform.getvalue('email') is not None else "a@b.com"
		admin = theform.getvalue('admin')
		git_username = theform.getvalue('git_username') if theform.getvalue('git_username') is not None else "none"
		git_password = theform.getvalue('git_password') if theform.getvalue('git_password') is not None else "none"
		git_2fa = theform.getvalue('git_2fa') if theform.getvalue('git_2fa') is not None else "false"

		if username != None and password != None:
			write_user_file(username, password, admin, email, realname, git_username, git_password, git_2fa)
		else:
			render_data["user_creation_warning"] = "ERROR: username or password missing; user cannot be created."

	# handle db wipe
	if theform.getvalue('init_db'):
		setup_db()

	# find all existing user files for deletion dropdown
	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	userdir = scriptpath + "users" + os.sep
	userfiles = [f for f in listdir(userdir) if isfile(join(userdir,f))]
	render_data['userfiles'] = []
	for userfile in sorted(userfiles):
		if userfile.endswith(".ini") and userfile not in ["config.ini", "admin.ini", "default.ini"]:
			userfile = userfile.replace(".ini","")
			render_data['userfiles'].append(userfile)

	# get html for dropdown selections
	render_data['corpora'] = [x[0] for x in get_corpora()]
	render_data['statuses'] = get_statuses()
	render_data['ether_stylesheets'] = get_ether_stylesheets()

	# handle upload
	imported = 0
	if "file" in theform and "mode" in theform:
		fileitem = theform["file"]
		mode = theform.getvalue("mode")
		if len(fileitem.filename) > 0:
			#  strip leading path from file name to avoid directory traversal attacks
			fn = os.path.basename(fileitem.filename)
			render_data['file_uploaded'] = fn
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
						create_document(doc_id, docname, corpus, "init", "default_user", "gucorpling/gitdox", "", mode)
				else:
					# Document already exists, just overwrite spreadsheet/xml and metadata and set mode
					doc_id = generic_query("SELECT id FROM docs where corpus=? and name=?", (corpus,docname))[0][0]
					update_mode(doc_id, mode)

				if "repo" in meta_key_val:
					update_filename(doc_id,meta_key_val["repo"])
					del meta_key_val["repo"]
				if "schema" in meta_key_val:
					update_schema(doc_id,meta_key_val["schema"])
					del meta_key_val["schema"]

				if mode == "ether":
					make_spreadsheet(sgml, "https://etheruser:etherpass@corpling.uis.georgetown.edu/ethercalc/_/gd_" + corpus + "_" + docname, format="sgml", ignore_elements=True)
				else:
					content = re.sub("</?meta ?[^>]*>[\r\n]*","",sgml)
					content = unicode(content.decode("utf8"))
					save_changes(doc_id, content)
				for key, value in meta_key_val.iteritems():
					key = key.replace("@", "_")
					if key == "status":
						update_status(doc_id,value)
						continue
					elif key == "assigned":
						update_assignee(doc_id,value)
						continue
					save_meta(doc_id, key.decode("utf8"), value.decode("utf8"))
	if imported > 0:
		render_data['files_imported'] = str(imported)

	# handle sql execution
	sql_statements = 0
	if "sqltab" in theform:
		fileitem = theform["sqltab"]
		if len(fileitem.filename) > 0:
			#  strip leading path from file name to avoid directory traversal attacks
			fn = os.path.basename(fileitem.filename)
			render_data['sql_file_imported'] = fn
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
		render_data["sql_statements"] = sql_statements

	return render("admin", render_data)


def load_user_config(user, admin, theform):
	render_data = {}

	if theform.getvalue('new_pass') and user != "demo":
		new_pass=theform.getvalue('new_pass')
		update_password(user,new_pass)

	if theform.getvalue('new_git_password') and user != "demo":
		new_git_password=theform.getvalue('new_git_password')
		new_git_username=theform.getvalue('new_git_username')
		new_git_2fa=theform.getvalue('new_git_2fa')
		update_git_info(user,new_git_username,new_git_password,new_git_2fa)

	render_data['user'] = user
	render_data['admin_eq_one'] = admin == "1"

	return render("user_admin", render_data)


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
	if admin == "3":
		print(load_admin(user, admin, theform))
	elif admin == "0" or admin=="1":
		print(load_user_config(user, admin, theform))


open_main_server()



