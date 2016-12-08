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

    conn.commit()
    
    # Create tables
    #user table not used
    #cur.execute('''CREATE TABLE IF NOT EXISTS users
    #             (id INTEGER PRIMARY KEY AUTOINCREMENT, username text)''')


    #docs table
    cur.execute('''CREATE TABLE IF NOT EXISTS docs
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, name text, status text,assignee_username text ,filename text, content text)''')
    #metadata table
    cur.execute('''CREATE TABLE IF NOT EXISTS metadata 
                 (docid INTEGER, metaid INTEGER PRIMARY KEY AUTOINCREMENT, key text UNIQUE, value text, FOREIGN KEY (docid) REFERENCES users(id), UNIQUE (docid, metaid) ON CONFLICT REPLACE)''')

    
    conn.commit()
    conn.close()
    

def create_document(name,status,assigned_username,filename,content):
    generic_query("INSERT INTO docs(name,status,assignee_username,filename,content) VALUES(?,?,?,?,?)", (name,status,assigned_username,filename,content))


def generic_query(sql,params):
    #generic_query("DELETE FROM rst_nodes WHERE doc=? and project=?",(doc,project))
    
    dbpath = os.path.dirname(os.path.realpath(__file__)) + os.sep +".."+os.sep+"gitdox.db"
    conn = sqlite3.connect(dbpath)
    
    with conn:
        cur = conn.cursor()
        cur.execute(sql,params)
        
        rows = cur.fetchall()
        return rows


def save_changes(id,content):
    """save change from the editor"""
    generic_query("UPDATE docs SET content=? WHERE id=?",(content,id))


def update_assignee(doc_id,user_name):
    generic_query("UPDATE docs SET assignee_username=? WHERE id=?",(user_name,doc_id))

def update_status(id,status):
    generic_query("UPDATE docs SET status=? WHERE id=?",(status,id))

def update_docname(id,docname):
    generic_query("UPDATE docs SET name=? WHERE id=?",(docname,id))


def update_filename(id,filename):
    generic_query("UPDATE docs SET filename=? WHERE id=?",(filename,id))


#def create_user(username):
 #   generic_query("INSERT INTO users(username) VALUES(?)",(username,))

#def delete_user(username):
 #   generic_query("DELETE FROM users WHERE username=?",(username,))

def delete_doc(id):
    generic_query("DELETE FROM docs WHERE id=?",(id,))

def save_meta(doc_id,key,value):
    generic_query("INSERT OR REPLACE INTO metadata(docid,key,value) VALUES(?,?,?)",(doc_id,key,value))

def delete_meta(metaid):
    generic_query("DELETE FROM metadata WHERE metaid=?",(metaid,))







