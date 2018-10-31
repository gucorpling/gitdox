#!/usr/bin/env python
# -*- coding: utf-8 -*-

from gitdox_sql import *
import json
import cgi
import os
import platform

parameter = cgi.FieldStorage()
action = parameter.getvalue("action")
id = parameter.getvalue("id")
docid = parameter.getvalue("docid")
key = parameter.getvalue("key")
value = parameter.getvalue("value")

if platform.system() == "Windows":
    prefix = "transc\\"
else:
    prefix = ""

def read_options(**kwargs):
	if "file" in kwargs:
		kwargs["file"] = prefix + kwargs["file"]
		names = open(kwargs["file"],'r').read().replace("\r","").split("\n")
		names = list(name[:name.find("\t")] for name in names)
	elif "names" in kwargs:
		names = kwargs[names]
	selected = kwargs["selected"] if "selected" in kwargs else None
	return names

def row_to_dict(row):
    return {'id': row[1],
            'docid': row[0],
            'key': row[2],
            'value': row[3]}

def get_metadata():
    resp = {}
    try:
        resp['Result'] = 'OK'
        resp['Records'] = [row_to_dict(r) for r in get_doc_meta(docid)]
        print json.dumps(resp)
    except:
        resp['Result'] = 'Error'
        resp['Message'] = 'Could not fetch metadata'
        print json.dumps(resp)

def get_default_key_options():
    resp = {}
    try:
        resp['Result'] = 'OK'
        resp['Options'] = read_options(file='..' + os.sep + 'metadata_fields.tab')
        print json.dumps(resp)
    except:
        resp['Result'] = 'Error'
        resp['Message'] = 'Could not fetch metadata key options'
        print json.dumps(resp)

def create_metadata():
    resp = {}
    try:
        save_meta(int(docid), key.decode("utf8"), value.decode("utf8"))
        resp['Result'] = 'OK'
        resp['Record'] = {'docid': docid,
                          'key': key,
                          'value': value}
        print json.dumps(resp)
    except:
        resp['Result'] = 'Error'
        resp['Message'] = 'Could not create metadata'
        print json.dumps(resp)

def delete_metadata():
    resp = {}
    try:
        delete_meta(int(id), int(docid))
        resp['Result'] = 'OK'
        print json.dumps(resp)
    except:
        resp['Result'] = 'Error'
        resp['Message'] = 'Could not delete metadata'
        print json.dumps(resp)

print "Content-type:application/json\r\n\r\n"
if action == "list":
    get_metadata()
elif action == "create":
    create_metadata()
elif action == "delete":
    delete_metadata()
elif action == "keys":
    get_default_key_options()
else:
    print json.dumps({'Result': 'Error',
                      'Message': 'Unknown action: "' + str(action) + '"'})
