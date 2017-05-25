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

# Support IIS site prefix on Windows
if platform.system() == "Windows":
	prefix = "transc\\"
else:
	prefix = ""

project = "Scriptorium"


def perform_action(text_content, logging=True):
	#this is used to write information into a text file to serve as a debugging tool and log
	#change logging=True to start logging
	if logging:
		f=open(prefix+"hwak.txt","a")
		f.write('\n')
		f.write(text_content)
		f.close()

def write_user_file(username,password,admin,email,realname,git_username,git_password):
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


def update_git_info(user,new_git_username,new_git_password):
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
		perform_action(user_del)
		#delete_user(user_del)
		#need to also delete the user.ini file
		os.remove(userdir+user_del_file)

	if theform.getvalue('create_user'):
		perform_action('create user')
		
		username=theform.getvalue('username')
		password=theform.getvalue('password')
		realname=theform.getvalue('realname') if theform.getvalue('realname') is not None else ""
		email=theform.getvalue('email') if theform.getvalue('email') is not None else ""
		admin=theform.getvalue('admin')
		git_username=theform.getvalue('git_username') if theform.getvalue('git_username') is not None else "none"
		git_password=theform.getvalue('git_password') if theform.getvalue('git_password') is not None else "none"

		if username!=None and password!=None:

			#create user in database
			#create_user(username)
			#need to write a user file for login tools
			write_user_file(username,password,admin,email,realname,git_username,git_password)
		else:
			warn="</br><b style='color:red;'>ERROR: username or password missing; user cannot be created.</b></br>"

	if theform.getvalue('init_db'):
		perform_action('init db')
		setup_db()

	page= "Content-type:text/html\r\n\r\n"
	page+="""

	<!DOCTYPE html>
	<html>
	<head>
		<link rel="stylesheet" href="css/scriptorium.css" type="text/css" charset="utf-8"/>
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
			<div id="copticlogo">
				<a href="http://copticscriptorium.org/">
					<img id="img1" src="https://corpling.uis.georgetown.edu/coptic-nlp/img/copticlogo.png" width="210" height="101" alt="Coptic SCRIPTORIUM"/>
				</a>
			</div>
			<div id="unicorn">
				<a href="http://copticscriptorium.org/">
					<img id="img2" src="https://corpling.uis.georgetown.edu/coptic-nlp/img/unicorn.png" width="80" height="101" alt="Unicorn"/>
				</a>
			</div>
			<div id="englishlogo">
				<a href="http://copticscriptorium.org/">
					<img id="img3" src="https://corpling.uis.georgetown.edu/coptic-nlp/img/englishlogo.png" width="199" height="101" alt="Coptic SCRIPTORIUM"/>
				</a>
			</div>
			<img id="img4" src="img/ruleline.png" width="95%" height="14" alt=""/>
			</br>
			</br>
		</div>
		<div id="content">
	<h1 >Coptic XML transcription editor</h1> 
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
	</tbody>
	</table>




	</br></br><input type='hidden' name='create_user' value='true'>
	<div onclick="document.getElementById('form_new_user').submit();" class="button"> <i class="fa fa-floppy-o"></i> save</div>
	</form>"""
	if warn!="":
		page+=warn



	

	page+="<br><br><h2>Database management</h2>"
	#init database, setup_db, wipe all documents

	page+="""<form id="form_initdb" action='admin.py' method='post'>
	<b style='color:red'>warning: this will wipe the database!</b>
	<br><input type='hidden' name='init_db' value='true'>
		<div onclick="document.getElementById('form_initdb').submit();" class="button"> <i class="fa fa-database"></i> init DB</div>
	</form>"""



	page+="</div></div></body></html>"
	page = page.replace("**navbar**",get_menu())

	return page


def load_user_config(user,admin,theform):
	if theform.getvalue('new_pass'):
		new_pass=theform.getvalue('new_pass')
		perform_action(new_pass)
		update_password(user,new_pass)
	if theform.getvalue('new_git_password'):

		new_git_password=theform.getvalue('new_git_password')
		new_git_username=theform.getvalue('new_git_username')
		perform_action(new_git_password)
		perform_action(new_git_username)

		update_git_info(user,new_git_username,new_git_password)


	page= "Content-type:text/html\r\n\r\n"
	page+="""

	<!DOCTYPE html>
	<html>
	<head>
		<link rel="stylesheet" href="css/scriptorium.css" type="text/css" charset="utf-8"/>
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
			<div id="copticlogo">
				<a href="http://copticscriptorium.org/">
					<img id="img1" src="https://corpling.uis.georgetown.edu/coptic-nlp/img/copticlogo.png" width="210" height="101" alt="Coptic SCRIPTORIUM"/>
				</a>
			</div>
			<div id="unicorn">
				<a href="http://copticscriptorium.org/">
					<img id="img2" src="https://corpling.uis.georgetown.edu/coptic-nlp/img/unicorn.png" width="80" height="101" alt="Unicorn"/>
				</a>
			</div>
			<div id="englishlogo">
				<a href="http://copticscriptorium.org/">
					<img id="img3" src="https://corpling.uis.georgetown.edu/coptic-nlp/img/englishlogo.png" width="199" height="101" alt="Coptic SCRIPTORIUM"/>
				</a>
			</div>
			<img id="img4" src="img/ruleline.png" width="800px" height="14" alt=""/>
			</br>
			</br>
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
	page+="<input type='submit' value='change'> </form>"
	page+="</br><p>note: after you changed your password you'll be logged out and you need to log in using your new password again</p>"

	#edit git info
	if admin=="1":
		page+="<form action='admin.py' method='post'><table><tr><td>new git username</td><td><input type='text' name='new_git_username'></td></tr><tr><td>new git password</td><td><input type='password' name='new_git_password'></td></tr></table>"


		page+="<input type='submit' value='change'> </form>"
	
	page+="</div></div></body></html>"

	page = page.replace("**navbar**",get_menu())

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
		print load_admin(user,admin,theform)
	elif admin == "0" or admin=="1":
		print load_user_config(user,admin,theform)


open_main_server()



