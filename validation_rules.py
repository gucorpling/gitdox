#!/usr/bin/env python
# -*- coding: UTF-8 -*-

import cgi, cgitb 
import os, platform
from modules.logintools import login
from modules.gitdox_sql import *
from modules.configobj import ConfigObj
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

	page= "Content-type:text/html\r\n\r\n"
	page+="""

	<!DOCTYPE html>
	<html>
	<head>
		<link rel="stylesheet" href="**skin**" type="text/css" charset="utf-8"/>
		<link rel="stylesheet" href="css/gitdox.css" type="text/css" charset="utf-8"/>
		<link rel="stylesheet" href="css/font-awesome-4.7.0/css/font-awesome.min.css"/>
		<link rel="stylesheet" href="js/jquery-ui-1.12.1/jquery-ui.min.css"/>
		<link rel="stylesheet" href="js/jtable.2.4.0/themes/lightcolor/gray/jtable.min.css" type="text/css" />
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
	<script src="js/jquery-ui-1.12.1/external/jquery/jquery.js" type="text/javascript"></script>
	<script src="js/jquery-ui-1.12.1/jquery-ui.min.js" type="text/javascript"></script>
	<script src="js/jtable.2.4.0/jquery.jtable.min.js" type="text/javascript"></script>
	</head>
	<body>
	**navbar**
	<div id="wrapper">
		  **header**
		<div id="content">
	<h1>GitDox - Validation</h1>
		<p style="border-bottom:groove;"><i>validation rule management</i> | <a href="index.py">back to document list</a> </p>
	
	
	

	"""
	
	page+="""<script type="text/javascript">
    $(document).ready(function () {
        $('#ValidationTableContainer').jtable({
            title: 'Validation Rules',
            sorting: true,
            actions: {
                listAction: 'modules/jtable_rule_list.py',
                createAction: 'modules/jtable_create_rule.py',
                updateAction: 'modules/jtable_update_rule.py',
                deleteAction: 'modules/jtable_delete_rule.py'
            },
            fields: {
            	id: {
            		title: 'ID',
            		key: true
            	},
                doc: {
                    title: 'Document'
                },
                corpus: {
                    title: 'Corpus'
                },
                domain: {
                    title: 'Domain',
                    options: ['ether', 'meta']
                },
                name: {
                    title: 'Name'
                },
                operator: {
                    title: 'Operator',
                    options: ['~', '|', '=', '>', 'exists']
                },
                argument: {
                    title: 'Argument'
                }
            }
        });
        $('#ValidationTableContainer').jtable('load');
    });
</script>"""

	page+="""<div id="ValidationTableContainer"></div>"""


	page+="</div></div></body></html>"
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
	admin = userconfig["admin"]
	if admin == "3":
		print load_validation_rules()


open_main_server()



