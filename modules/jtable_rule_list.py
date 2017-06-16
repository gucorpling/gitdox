#!/usr/bin/env python
# -*- coding: UTF-8 -*-

from gitdox_sql import *
import json
import cgi


def list_rules():
	jtable_result = {}
	try:
		parameter = cgi.FieldStorage()
		sort = parameter.getvalue("jtSorting")
		if sort is not None:
			rules = get_sorted_rules(sort)
		else:
			rules = get_validate_rules()
		json_rules = []
		for rule in rules:
			new_json_rule = {}
			new_json_rule['doc'] = rule[0]
			new_json_rule['corpus'] = rule[1]
			new_json_rule['domain'] = rule[2]
			new_json_rule['name'] = rule[3]
			new_json_rule['operator'] = rule[4]
			new_json_rule['argument'] = rule[5]
			new_json_rule['id'] = rule[6]
			json_rules.append(new_json_rule)
		jtable_result['Result'] = 'OK'
		jtable_result['Records'] = json_rules
		return json.dumps(jtable_result)
	except:
		jtable_result['Result'] = 'Error'
		jtable_result['Message'] = 'Something went wrong in jtable_rule_list.py'
		return json.dumps(jtable_result)


print "Content-type:application/json\r\n\r\n"
print list_rules()