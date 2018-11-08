#!/usr/bin/env python
# -*- coding: utf-8 -*-

import cgi, cgitb
import os, platform
from modules.logintools import login
from modules.gitdox_sql import *
from modules.configobj import ConfigObj
from modules.renderer import render
from paths import get_menu

def load_validation_rules():
	render_data = {}
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



