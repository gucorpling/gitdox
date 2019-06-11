#!/usr/bin/env python
# -*- coding: utf-8 -*-

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
				 (id INTEGER PRIMARY KEY AUTOINCREMENT, name text, corpus text, status text,assignee_username text ,filename text, content text, mode text, schema text, validation text, timestamp text, cache text)''')
	#metadata table
	cur.execute('''CREATE TABLE IF NOT EXISTS metadata
				 (docid INTEGER, metaid INTEGER PRIMARY KEY AUTOINCREMENT, key text, value text, corpus_meta text, UNIQUE (docid, metaid) ON CONFLICT REPLACE, UNIQUE (docid, key) ON CONFLICT REPLACE)''')
	#validation table
	cur.execute('''CREATE TABLE IF NOT EXISTS validate
				 (doc text, corpus text, domain text, name text, operator text, argument text, id INTEGER PRIMARY KEY AUTOINCREMENT)''')


	conn.commit()
	conn.close()


def create_document(doc_id, name, corpus, status, assigned_username, filename, content,mode="xml", schema='--none--'):
	generic_query("INSERT INTO docs(id, name,corpus,status,assignee_username,filename,content,mode,schema) VALUES(?,?,?,?,?,?,?,'xml',?)",
		(int(doc_id), name, corpus, status, assigned_username, filename, content, schema))


def generic_query(sql, params, return_new_id=False):
	# generic_query("DELETE FROM rst_nodes WHERE doc=? and project=?",(doc,project))

	dbpath = os.path.dirname(os.path.realpath(__file__)) + os.sep + ".." + os.sep + "gitdox.db"
	conn = sqlite3.connect(dbpath)

	with conn:
		cur = conn.cursor()
		if params is not None:
			cur.execute(sql,params)
		else:
			cur.execute(sql)

		if return_new_id:
			return cur.lastrowid
		else:
			rows = cur.fetchall()
			return rows


def invalidate_doc_by_name(doc,corpus):
	generic_query("UPDATE docs SET validation=NULL WHERE name like ? and corpus like ?", (doc, corpus))

def invalidate_ether_docs(doc,corpus):
	generic_query("UPDATE docs SET validation=NULL WHERE name like ? and corpus like ? and mode = 'ether'", (doc, corpus))

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

def update_meta(meta_id,doc_id,key,value,corpus=False):
	if corpus:
		_, corpus_name, _, _, _, _, _ = get_doc_info(doc_id)
		generic_query("REPLACE INTO metadata(metaid,docid,key,value,corpus_meta) VALUES(?,?,?,?,?)", (meta_id, None, key, value,corpus_name))
	else:
		generic_query("REPLACE INTO metadata(metaid,docid,key,value,corpus_meta) VALUES(?,?,?,?,?)",(meta_id,doc_id,key,value,None))
		invalidate_doc_by_id(doc_id)


def save_meta(doc_id,key,value,corpus=False):
	if corpus:
		_, corpus_name, _, _, _, _, _ = get_doc_info(doc_id)
		new_id = generic_query("REPLACE INTO metadata(docid,key,value,corpus_meta) VALUES(?,?,?,?)", (None, key, value,corpus_name), return_new_id = True)
	else:
		new_id = generic_query("INSERT OR REPLACE INTO metadata(docid,key,value,corpus_meta) VALUES(?,?,?,?)",(doc_id,key,value,None), return_new_id = True)
		invalidate_doc_by_id(doc_id)

	return new_id

def delete_meta(metaid, doc_id, corpus=False):
	generic_query("DELETE FROM metadata WHERE metaid=?", (metaid,))
	if not corpus:
		invalidate_doc_by_id(doc_id)

def get_doc_info(doc_id):
	res = generic_query("SELECT name,corpus,filename,status,assignee_username,mode,schema FROM docs WHERE id=?", (int(doc_id),))
	if len(res) > 0:
		return res[0]
	else:
		return res

def get_doc_content(doc_id):
	res = generic_query("SELECT content FROM docs WHERE id=?", (int(doc_id),))
	return res[0][0]

def get_all_doc_ids_for_corpus(corpus):
	return map(lambda x: x[0],
               generic_query("SELECT id FROM docs WHERE corpus=?", (corpus,)))

def get_all_docs(corpus=None, status=None):
	if corpus is None:
		if status is None:
			return generic_query("SELECT id, name, corpus, mode, content FROM docs", None)
		else:
			return generic_query("SELECT id, name, corpus, mode, content FROM docs where status=?", (status,))
	else:
		if status is None:
			return generic_query("SELECT id, name, corpus, mode, content FROM docs where corpus=?", (corpus,))
		else:
			return generic_query("SELECT id, name, corpus, mode, content FROM docs where corpus=? and status=?", (corpus, status))

def get_doc_meta(doc_id, corpus=False):
	if corpus:
		fields = get_doc_info(doc_id)
		if len(fields) > 0:
			_, corpus_name, _, _, _, _, _ = fields
			return generic_query("SELECT * FROM metadata WHERE corpus_meta=? ORDER BY key COLLATE NOCASE",(corpus_name,))
		else:
			return []
	else:
		return generic_query("SELECT * FROM metadata WHERE docid=? ORDER BY key COLLATE NOCASE", (int(doc_id),))

def get_corpora():
	return generic_query("SELECT DISTINCT corpus FROM docs ORDER BY corpus COLLATE NOCASE", None)

def get_validate_rules(sort=None, domain=None):
	query = "SELECT corpus, doc, domain, name, operator, argument, id FROM validate"
	args = []
	if domain:
		query += " WHERE domain=? "
		args.append(domain)
	if sort:
		query += " ORDER BY " + sort
	return generic_query(query, args)

def get_rule_domain(id):
	return generic_query("SELECT domain FROM validate WHERE id=?", (id,))[0][0]

def get_xml_rules():
	return get_validate_rules(domain='xml')

def get_meta_rules():
	return get_validate_rules(domain='meta')

def get_ether_rules():
	return get_validate_rules(domain='ether')

def get_export_rules():
	return get_validate_rules(domain='export')

def create_validate_rule(doc, corpus, domain, name, operator, argument):
	new_id = generic_query("INSERT INTO validate(doc,corpus,domain,name,operator,argument) VALUES(?,?,?,?,?,?)", (doc, corpus, domain, name, operator, argument), return_new_id = True)
	if domain == "meta":
		invalidate_doc_by_name("%","%")
	else:
		invalidate_ether_docs("%","%")
	return new_id

def delete_validate_rule(id):
	generic_query("DELETE FROM validate WHERE id=?", (int(id),))
	invalidate_doc_by_name("%", "%")

def update_validate_rule(doc, corpus, domain, name, operator, argument, id):
	generic_query("UPDATE validate SET doc = ?, corpus = ?, domain = ?, name = ?, operator = ?, argument = ? WHERE id = ?",(doc, corpus, domain, name, operator, argument, id))
	if domain == "meta":
		invalidate_doc_by_name("%", "%")
	else:
		invalidate_ether_docs("%", "%")


def update_validation(doc_id,validation):
	generic_query("UPDATE docs SET validation=? where id=?",(validation,doc_id))

def update_timestamp(doc_id, timestamp):
	generic_query("UPDATE docs SET timestamp=? where id=?", (timestamp, doc_id))
