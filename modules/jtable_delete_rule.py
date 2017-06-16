#!/usr/bin/env python
# -*- coding: UTF-8 -*-

from gitdox_sql import *
import json
import cgi


def delete_rule():
	jtable_result = {}
	try:
		parameter = cgi.FieldStorage()
		id = parameter.getvalue("id")
		
		delete_validate_rule(id)
		
		jtable_result['Result'] = 'OK'
		return json.dumps(jtable_result)
	except:
		jtable_result['Result'] = 'Error'
		jtable_result['Message'] = 'Something went wrong in jtable_delete_rule.py'
		return json.dumps(jtable_result)


print "Content-type:application/json\r\n\r\n"
print delete_rule()