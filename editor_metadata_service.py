#!/usr/bin/env python
# -*- coding: utf-8 -*-

import json
import cgi
import os
import platform
from modules.gitdox_sql import *
from modules.logintools import login
import modules.redis_cache as cache

parameter = cgi.FieldStorage()
action = parameter.getvalue("action")
id = parameter.getvalue("id")
docid = parameter.getvalue("docid")
key = parameter.getvalue("key")
value = parameter.getvalue("value")
corpus = parameter.getvalue("corpus")

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
        resp['Records'] = [row_to_dict(r) for r in get_doc_meta(docid, corpus=corpus)]
        print json.dumps(resp)
    except:
        resp['Result'] = 'Error'
        resp['Message'] = 'Could not fetch metadata'
        print json.dumps(resp)

def get_default_key_options():
    resp = {}
    try:
        resp['Result'] = 'OK'
        if not corpus:
            resp['Options'] = read_options(file='..' + os.sep + 'metadata_fields.tab')
        else:
            resp['Options'] = read_options(file='..' + os.sep + 'corpus_metadata_fields.tab')
        print json.dumps(resp)
    except:
        resp['Result'] = 'Error'
        resp['Message'] = 'Could not fetch metadata key options'
        print json.dumps(resp)

def create_metadata():
    resp = {}
    try:
        id = save_meta(int(docid), key.decode("utf8"), value.decode("utf8"), corpus=corpus)
        resp['Result'] = 'OK'
        resp['Record'] = {'id': id,
                          'docid': docid,
                          'key': key,
                          'value': value}
        cache.invalidate_by_doc(docid, "meta")
        print json.dumps(resp)
    except:
        resp['Result'] = 'Error'
        resp['Message'] = 'Could not create metadata'
        print json.dumps(resp)

def update_metadata():
    resp = {}
    try:
        update_meta(int(id), int(docid), key.decode("utf8"), value.decode("utf8"), corpus=corpus)
        resp['Result'] = 'OK'
        resp['Record'] = {'id': id,
                          'docid': docid,
                          'key': key,
                          'value': value}
        cache.invalidate_by_doc(docid, "meta")
        print json.dumps(resp)
    except:
        resp['Result'] = 'Error'
        resp['Message'] = 'Could not update metadata'
        print json.dumps(resp)

def delete_metadata():
    resp = {}
    try:
        delete_meta(int(id), int(docid), corpus=corpus)
        resp['Result'] = 'OK'
        cache.invalidate_by_doc(docid, "meta")
        print json.dumps(resp)
    except:
        resp['Result'] = 'Error'
        resp['Message'] = 'Could not delete metadata'
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
        get_metadata()
    elif action == "keys":
        get_default_key_options()
    elif user == "demo":
        print json.dumps({'Result': 'Error', 'Message': 'Demo user may not make changes.'})
    elif action == "create":
        create_metadata()
    elif action == "update":
        update_metadata()
    elif action == "delete":
        delete_metadata()
    else:
        print json.dumps({'Result': 'Error',
                          'Message': 'Unknown action: "' + str(action) + '"'})

if __name__ == '__main__':
    open_main_server()
