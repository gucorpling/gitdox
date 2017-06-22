#!/usr/bin/env python
# -*- coding: UTF-8 -*-

from gitdox_sql import *
import json
import cgi


def create_rule():
	jtable_result = {}
	try:
		parameter = cgi.FieldStorage()
		doc = parameter.getvalue("doc")
		corpus = parameter.getvalue("corpus")
		domain = parameter.getvalue("domain")
		name = parameter.getvalue("name")
		operator = parameter.getvalue("operator")
		argument = parameter.getvalue("argument")
		
		create_validate_rule(doc,corpus,domain,name,operator,argument)
		
		new_json_rule = {}
		new_json_rule['doc'] = doc
		new_json_rule['corpus'] = corpus
		new_json_rule['domain'] = domain
		new_json_rule['name'] = name
		new_json_rule['operator'] = operator
		new_json_rule['argument'] = argument

		jtable_result['Result'] = 'OK'
		jtable_result['Record'] = new_json_rule
		return json.dumps(jtable_result)
	except:
		jtable_result['Result'] = 'Error'
		jtable_result['Message'] = 'Something went wrong in jtable_create_rule.py'
		return json.dumps(jtable_result)


print "Content-type:application/json\r\n\r\n"
print create_rule()