#!/usr/bin/env python
# -*- coding: utf-8 -*-

import json
import cgi
import os
import platform
from modules.gitdox_sql import *
from modules.logintools import login
import modules.redis_cache as cache
import traceback

parameter = cgi.FieldStorage()
action = parameter.getvalue("action")

# for rules
doc = parameter.getvalue("doc")
corpus = parameter.getvalue("corpus")
domain = parameter.getvalue("domain")
name = parameter.getvalue("name")
operator = parameter.getvalue("operator")
argument = parameter.getvalue("argument")
id = parameter.getvalue("id")

# for schemas
schema_dir = os.path.dirname(os.path.realpath(__file__)) + os.sep + 'schemas'
extension = parameter.getvalue("extension")

# for sorting
sort = parameter.getvalue("jtSorting")

def row_to_dict(row):
    return {'corpus': row[0],
            'doc': row[1],
            'domain': row[2],
            'name': row[3],
            'operator': row[4],
            'argument': row[5],
            'id': row[6]}

def list_rules():
    resp = {}
    try:
        parameter = cgi.FieldStorage()
        rules = get_validate_rules(sort=sort, domain=domain)

        json_rules = [row_to_dict(row) for row in rules]
        resp['Result'] = 'OK'
        resp['Records'] = json_rules
        print json.dumps(resp)
    except:
        resp['Result'] = 'Error'
        resp['Message'] = 'Something went wrong while attempting to retrieve the list of rules.'
        print json.dumps(resp)

def create_rule():
    resp = {}
    try:
        id = create_validate_rule(doc, corpus, domain, name, operator, argument)
        resp['Result'] = 'OK'
        resp['Record'] = {'doc': doc,
                          'corpus': corpus,
                          'domain': domain,
                          'name': name,
                          'operator': operator,
                          'argument': argument,
                          'id': id}
        cache.invalidate_by_type(domain)
        print json.dumps(resp)
    except:
        resp['Result'] = 'Error'
        resp['Message'] = 'Something went wrong while attempting to create a new rule.'
        print json.dumps(resp)

def update_rule():
    resp = {}
    try:
        update_validate_rule(doc, corpus, domain, name, operator, argument, id)
        resp['Result'] = 'OK'
        cache.invalidate_by_type(domain)
        print json.dumps(resp)
    except:
        resp['Result'] = 'Error'
        resp['Message'] = 'Something went wrong while attempting to update a rule.'
        resp['Message'] += '\n' + traceback.format_exc()
        print json.dumps(resp)

def delete_rule():
    resp = {}
    try:
        domain = get_rule_domain(id)
        delete_validate_rule(id)
        resp['Result'] = 'OK'
        cache.invalidate_by_type(domain)
        print json.dumps(resp)
    except:
        resp['Result'] = 'Error'
        resp['Message'] = 'Something went wrong while trying to delete a rule.'
        print json.dumps(resp)


def list_schemas():
    resp = {}
    try:
        resp['Result'] = 'OK'
        resp['Options'] = [{"DisplayText": x, "Value": x}
                           for x in os.listdir(schema_dir)
                           if x.endswith(extension)]
        print json.dumps(resp)
    except:
        resp['Result'] = 'Error'
        resp['Message'] = 'Something went wrong while trying to list schemas.'
        print json.dumps(resp)

def open_main_server():
    thisscript = os.environ.get('SCRIPT_NAME', '')
    loginaction = None
    theform = cgi.FieldStorage()
    scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
    userdir = scriptpath + "users" + os.sep
    loginaction, userconfig = login(theform, userdir, thisscript, loginaction)
    user = userconfig["username"]
    admin = userconfig["admin"]

    print "Content-type:application/json\r\n\r\n"
    if action == "list":
        list_rules()
    elif action == "listschemas":
        list_schemas()
    elif user == "demo":
        print json.dumps({'Result': 'Error', 'Message': 'Demo user may not make changes.'})
    elif action == "create":
        create_rule()
    elif action == "update":
        update_rule()
    elif action == "delete":
        delete_rule()
    else:
        print json.dumps({'Result': 'Error',
                          'Message': 'Unknown action: "' + str(action) + '"'})

if __name__ == '__main__':
    open_main_server()
