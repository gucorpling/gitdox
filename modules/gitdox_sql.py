#!/usr/bin/env python
# -*- coding: UTF-8 -*-

"""
Data access functions to read from and write to the SQLite backend.
"""

import sqlite3
import codecs
import os
import re


def setup_db():
	dbpath = os.path.dirname(os.path.realpath(__file__)) + os.sep +".."+os.sep+"gitdox.db"
	conn = sqlite3.connect(dbpath)
	cur = conn.cursor()
	# Drop tables if they exist
	cur.execute("DROP TABLE IF EXISTS docs")
	cur.execute("DROP TABLE IF EXISTS users")
	cur.execute("DROP TABLE IF EXISTS metadata")
	cur.execute("DROP TABLE IF EXISTS validate")

	conn.commit()

	# Create tables
	#user table not used
	#cur.execute('''CREATE TABLE IF NOT EXISTS users
	#			 (id INTEGER PRIMARY KEY AUTOINCREMENT, username text)''')


	#docs table
	cur.execute('''CREATE TABLE IF NOT EXISTS docs
				 (id INTEGER PRIMARY KEY AUTOINCREMENT, name text, corpus text, status text,assignee_username text ,filename text, content text, mode text, schema text, validation text, timestamp text)''')
	#metadata table
	cur.execute('''CREATE TABLE IF NOT EXISTS metadata
				 (docid INTEGER, metaid INTEGER PRIMARY KEY AUTOINCREMENT, key text, value text, FOREIGN KEY (docid) REFERENCES users(id), UNIQUE (docid, metaid) ON CONFLICT REPLACE, UNIQUE (docid, key, value) ON CONFLICT REPLACE)''')
	#validation table
	cur.execute('''CREATE TABLE IF NOT EXISTS validate
				 (doc text, corpus text, domain text, name text, operator text, argument text, id INTEGER PRIMARY KEY AUTOINCREMENT)''')


	conn.commit()
	conn.close()


def create_document(doc_id, name, corpus, status, assigned_username, filename, content,mode="xml", schema='--none--'):
	generic_query("INSERT INTO docs(id, name,corpus,status,assignee_username,filename,content,mode,schema) VALUES(?,?,?,?,?,?,?,'xml',?)",
		(int(doc_id), name, corpus, status, assigned_username, filename, content, schema))


def generic_query(sql, params):
	# generic_query("DELETE FROM rst_nodes WHERE doc=? and project=?",(doc,project))

	dbpath = os.path.dirname(os.path.realpath(__file__)) + os.sep + ".." + os.sep + "gitdox.db"
	conn = sqlite3.connect(dbpath)

	with conn:
		cur = conn.cursor()
		if params is not None:
			cur.execute(sql,params)
		else:
			cur.execute(sql)

		rows = cur.fetchall()
		return rows


def invalidate_doc_by_name(doc,corpus):
	generic_query("UPDATE docs SET validation=NULL WHERE name=? and corpus=?", (doc, corpus))

def invalidate_doc_by_id(id):
	generic_query("UPDATE docs SET validation=NULL WHERE id=?", (id,))

def doc_exists(doc,corpus):
	res = generic_query("SELECT name from docs where name=? and corpus=?",(doc,corpus))
	return len(res) > 0

def save_changes(id,content):
	"""save change from the editor"""
	generic_query("UPDATE docs SET content=? WHERE id=?",(content,id))
	invalidate_doc_by_id(id)

def update_assignee(doc_id,user_name):
	generic_query("UPDATE docs SET assignee_username=? WHERE id=?",(user_name,doc_id))

def update_status(id,status):
	generic_query("UPDATE docs SET status=? WHERE id=?",(status,id))

def update_docname(id,docname):
	generic_query("UPDATE docs SET name=? WHERE id=?",(docname,id))
	invalidate_doc_by_id(id)

def update_filename(id,filename):
	generic_query("UPDATE docs SET filename=? WHERE id=?",(filename,id))

def update_corpus(id,corpusname):
	generic_query("UPDATE docs SET corpus=? WHERE id=?",(corpusname,id))
	invalidate_doc_by_id(id)

def update_mode(id,mode):
	generic_query("UPDATE docs SET mode=? WHERE id=?",(mode,id))

def update_schema(id, schema):
	generic_query("UPDATE docs SET schema=? WHERE id=?", (schema, id))

def delete_doc(id):
	generic_query("DELETE FROM docs WHERE id=?",(id,))
	generic_query("DELETE FROM metadata WHERE docid=?", (id,))

def cell(text):
	if isinstance(text, int):
		text = str(text)
	return "\n	<td>" + text + "</td>"

def print_meta(doc_id):
	meta = get_doc_meta(doc_id)
	# docid,metaid,key,value - four cols
	table="""<input type="hidden" id="metaid" name="metaid" value="">
	<table id="meta_table">
	<colgroup>
    	<col>
    	<col>
    	<col style="width: 40px">
  	</colgroup>
  		<tbody>
	"""
	for item in meta:
		# Each item appears in one row of the table
		row = "\n <tr>"
		metaid = str(item[1])
		('metaid:'+str(metaid))
		id = str(doc_id)
		for i in item[2:]:
			cell_contents = cell(i)
			cell_contents = re.sub(r'(<td>)(https?://[^ <>]+)',r'\1<a href="\2">\2</a>',cell_contents)
			row += cell_contents

		# delete meta
		metaid_code="""<div class="button slim" onclick="document.getElementById('metaid').value='"""+metaid+"""'; document.getElementById('editor_form').submit();"><i class="fa fa-trash"></i> </div>"""

		button_delete=""
		button_delete+=metaid_code
		row += cell(button_delete)
		row += "\n </tr>"
		table += row
	table += "\n</tbody>\n</table>\n"
	return table


def save_meta(doc_id,key,value):
	generic_query("INSERT OR REPLACE INTO metadata(docid,key,value) VALUES(?,?,?)",(doc_id,key,value))
	invalidate_doc_by_id(doc_id)

def delete_meta(metaid, doc_id):
	generic_query("DELETE FROM metadata WHERE metaid=?",(metaid,))
	invalidate_doc_by_id(doc_id)

def get_doc_info(doc_id):
	return generic_query("SELECT name,corpus,filename,status,assignee_username,mode,schema FROM docs WHERE id=?",
						 (int(doc_id),))[0]


def get_doc_meta(doc_id):
	return generic_query("SELECT * FROM metadata WHERE docid=? ORDER BY key COLLATE NOCASE", (int(doc_id),))

def get_corpora():
	return generic_query("SELECT DISTINCT corpus FROM docs ORDER BY corpus COLLATE NOCASE", None)

def get_validate_rules():
	return generic_query("SELECT * FROM validate", None)

def get_sorted_rules(sort):
	return generic_query("SELECT * FROM validate ORDER BY " + sort, None)  # parameterization doesn't work for order by

def create_validate_rule(doc, corpus, domain, name, operator, argument):
	generic_query("INSERT INTO validate(doc,corpus,domain,name,operator,argument) VALUES(?,?,?,?,?,?)", (doc, corpus, domain, name, operator, argument))
	if domain == "meta":
		invalidate_doc_by_name("%","%")

def delete_validate_rule(id):
	generic_query("DELETE FROM validate WHERE id=?", (int(id),))
	invalidate_doc_by_name("%", "%")

def update_validate_rule(doc, corpus, domain, name, operator, argument, id):
	generic_query("UPDATE validate SET doc = ?, corpus = ?, domain = ?, name = ?, operator = ?, argument = ? WHERE id = ?",(doc, corpus, domain, name, operator, argument, id))
	if domain == "meta":
		invalidate_doc_by_name("%", "%")

def update_validation(doc_id,validation):
	generic_query("UPDATE docs SET validation=? where id=?",(validation,doc_id))

def update_timestamp(doc_id, timestamp):
	generic_query("UPDATE docs SET timestamp=? where id=?", (timestamp, doc_id))
