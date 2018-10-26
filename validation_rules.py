#!/usr/bin/env python
# -*- coding: utf-8 -*-

import cgi, cgitb
import os, platform
from modules.logintools import login
from modules.gitdox_sql import *
from modules.configobj import ConfigObj
from modules.renderer import render
from paths import get_menu

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

def load_validation_rules():
	render_data = {}
	render_data['navbar_html'] = get_menu()
	render_data['skin_stylesheet'] = skin
	return render("validation_rules", render_data)

def open_main_server():
	thisscript = os.environ.get('SCRIPT_NAME', '')
	action = None
	theform = cgi.FieldStorage()
	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	userdir = scriptpath + "users" + os.sep
	action, userconfig = login(theform, userdir, thisscript, action)
	admin = userconfig["admin"]
	if admin == "3":
		print "Content-type:text/html\r\n\r\n"
		print load_validation_rules()


open_main_server()



