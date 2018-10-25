#!/usr/bin/env python
# -*- coding: utf-8 -*-

from gitdox_sql import *
import json
import cgi
import os

schema_dir = (os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
              + os.sep
              + 'schemas')

def list_files():
	jtable_result = {}
	ext = cgi.FieldStorage().getvalue("extension")

	try:
		options = [{"DisplayText": x,
                    "Value": x}
                   for x in os.listdir(schema_dir)
                   if x.endswith(ext)]
		jtable_result['Result'] = 'OK'
		jtable_result['Options'] = options
		return json.dumps(jtable_result)
	except:
		jtable_result['Result'] = 'Error'
		jtable_result['Message'] = 'Something went wrong in jtable_xsd_list.py'
		return json.dumps(jtable_result)


print "Content-type:application/json\r\n\r\n"
print list_files()
