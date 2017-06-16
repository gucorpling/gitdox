#!/usr/bin/env python
# -*- coding: UTF-8 -*-

from gitdox_sql import *
import json
import cgi


def update_rules():
	jtable_result = {}
	try:
		parameter = cgi.FieldStorage()
		doc = parameter.getvalue("doc")
		corpus = parameter.getvalue("corpus")
		domain = parameter.getvalue("domain")
		name = parameter.getvalue("name")
		operator = parameter.getvalue("operator")
		argument = parameter.getvalue("argument")
		id = parameter.getvalue("id")
		
		update_validate_rule(doc,corpus,domain,name,operator,argument,id)
		
		jtable_result['Result'] = 'OK'
		return json.dumps(jtable_result)
	except:
		jtable_result['Result'] = 'Error'
		jtable_result['Message'] = 'Something went wrong in jtable_update_rule.py'
		return json.dumps(jtable_result)


print "Content-type:application/json\r\n\r\n"
print update_rules()