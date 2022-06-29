#!/usr/bin/python
# -*- coding: utf-8 -*-

#print("Content-type:text/html\r\n\r\n")

from six import iteritems
import cgi, cgitb
import os, shutil, io
import sys, traceback
from modules.logintools import login
import urllib
from modules.gitdox_sql import *
from modules.gitdox_git import *
from modules.reorder_sgml import reorder
from modules.configobj import ConfigObj
import requests
from requests.auth import HTTPBasicAuth
import platform, re
from paths import ether_url, get_menu, get_nlp_credentials
from modules.ether import make_spreadsheet, delete_spreadsheet, sheet_exists, get_socialcalc, ether_to_sgml, \
	build_meta_tag, get_ether_stylesheets, get_file_list, postprocess_sgml, merge_entities, get_pos_list
from modules.renderer import render
import modules.redis_cache as cache

# Support IIS site prefix on Windows
if platform.system() == "Windows":
	prefix = "transc\\"
else:
	prefix = ""

# Read configuration
scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
userdir = scriptpath + "users" + os.sep
templatedir = scriptpath + "templates" + os.sep
config = ConfigObj(userdir + 'config.ini')
project = config["project"]
editor_help_link = config["editor_help_link"]
# Captions and API URLs for NLP buttons
xml_nlp_button = config["xml_nlp_button"]
spreadsheet_nlp_button = config["spreadsheet_nlp_button"]
ner_nlp_button = config["ner_nlp_button"]
xml_nlp_api = config["xml_nlp_api"]
spreadsheet_nlp_api = config["spreadsheet_nlp_api"]

code_2fa = None


def harvest_meta(sgml):
	"""
	Get metadata key value pairs from <meta> element in imported SGML file

	:param sgml: TT SGML as string
	:return: dictionary of key value pairs
	"""

	sgml = sgml.replace("\r","").strip()
	meta = {}
	if not sgml.startswith("<meta "):
		return meta
	else:
		metatag = re.search(r'<meta ([^\n]*)>',sgml).group(1)
		matches = re.findall(r'([^ =>]+?)="([^"]+)"',metatag)
		for match in matches:
			meta[match[0].strip()] = match[1].strip().replace("<","&lt;").replace(">","&gt;")
	return meta


def serialize_file(text_content,file_name):
	f=open(prefix+file_name,'w')
	f.write(text_content)#.encode("utf8"))
	f.close()

def get_user_list():
	user_list=[]
	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	userdir = scriptpath + "users" + os.sep
	return get_file_list(userdir,"ini",forbidden=["admin","default","config"],hide_extension=True)

def load_page(user,admin,theform):
	global ether_url
	global code_2fa

	if theform.getvalue("2fa"):
		code_2fa = theform.getvalue("2fa")
	else:
		code_2fa = ""
	max_id = generic_query("SELECT MAX(id) AS max_id FROM docs","")[0][0]
	if not max_id:  # This is for the initial case after init db
		max_id = 0
	text_content = ""
	repo_name = ""
	corpus = ""
	status = ""
	assignee = ""
	mode = "xml"
	schema = ""
	doc_id = ""  # Should only remain so if someone navigated directly to editor.py
	docname = ""
	enable_entities = False if "enable_entities" not in config else config["enable_entities"]
	old_docname, old_corpus, old_repo, old_status, old_assignee, old_mode, old_schema = ["", "", "", "", "", "", ""]

	if int(admin) > 0:
		git_username, git_token, git_2fa = get_git_credentials(user, admin, code_2fa)
	else:
		git_username, git_token, git_2fa = (None, None, None)

	# dict of variables we'll need to render the html
	render_data = {}

	if theform.getvalue('id'):
		doc_id = theform.getvalue('id')
		if int(doc_id) > int(max_id):
			# Creating new doc case, assign some default values
			docname = "new_document"
			repo_name = "account/repo_name"
			status = "editing"
			assignee = "default_user"
			corpus = "default_corpus"
			schema = ""
			text_content = ""
			# If one of the four forms is edited or we're cloning a doc, then we create the doc, otherwise nothing happens (user cannot fill in nothing and create the doc)
			if theform.getvalue('edit_docname') and user != "demo":
				if docname != 'new_document':
					if doc_id > max_id:
						create_document(doc_id, docname, corpus, status, assignee, repo_name, text_content)
						max_id = doc_id
					else:
						update_docname(doc_id, docname)

			if theform.getvalue('edit_filename') and user != "demo":
				repo_name = theform.getvalue('edit_filename')
				if repo_name != 'account/repo_name':
					if doc_id > max_id:
						create_document(doc_id, docname, corpus, status, assignee, repo_name, text_content)
						max_id = doc_id
					else:
						update_filename(doc_id, repo_name)

			if theform.getvalue('edit_corpusname') and user != "demo":
				corpus = theform.getvalue('edit_corpusname')
				if corpus != 'default_corpus':
					if doc_id > max_id:
						create_document(doc_id, docname, corpus, status, assignee, repo_name, text_content)
						max_id = doc_id
					else:
						update_corpus(doc_id, corpus)

			if theform.getvalue('edit_status') and user != "demo":
				status = theform.getvalue('edit_status')
				if status != 'editing':
					if doc_id > max_id:
						create_document(doc_id, docname, corpus, status, assignee, repo_name, text_content)
						max_id = doc_id
					else:
						update_status(doc_id, status)

			if theform.getvalue('edit_assignee') and user != "demo":
				assignee = theform.getvalue('edit_assignee')
				if assignee != "default_user":
					if doc_id > max_id:
						create_document(doc_id, docname, corpus, status, assignee, repo_name, text_content)
						max_id = doc_id
					else:
						update_assignee(doc_id, assignee)

			# cloning metadata from an existing doc into a new doc
			if theform.getvalue('source_doc'):
				source_meta = get_doc_meta(theform.getvalue('source_doc'))
				if doc_id > max_id:
					create_document(doc_id, docname, corpus, status, assignee, repo_name, text_content)
					max_id = doc_id
				for meta in source_meta:
					m_key, m_val = meta[2:4]
					save_meta(int(doc_id), m_key, m_val)
					cache.invalidate_by_doc(doc_id, "meta")

		else:
			# Get previous values from DB
			old_docname, old_corpus, old_repo, old_status, old_assignee, old_mode, old_schema = get_doc_info(doc_id)
			# Assume new values are same, overwrite with different form values and update DB if new values found
			docname, corpus, repo_name, status, assignee, mode, schema = old_docname, old_corpus, old_repo, old_status, old_assignee, old_mode, old_schema
			docname = old_docname

			# Handle switch to spreadsheet mode if NLP spreadsheet service is called
			if theform.getvalue('nlp_spreadsheet') == "do_nlp_spreadsheet" and mode == "xml" and user != "demo":
				data_to_process = generic_query("SELECT content FROM docs WHERE id=?",(doc_id,))[0][0]
				api_call = spreadsheet_nlp_api
				if api_call != "":
					nlp_user, nlp_password = get_nlp_credentials()
					data = {"data":data_to_process, "lb":"line", "format":"sgml_no_parse"}
					resp = requests.post(api_call, data, auth=HTTPBasicAuth(nlp_user,nlp_password))
					sgml = resp.text.encode("utf8")
					postproc = config["nlp_postprocessing"] if "nlp_postprocessing" in config else None
					sgml = postprocess_sgml(sgml,postproc)
				else:
					sgml = data_to_process.encode("utf8")
				out, err = make_spreadsheet(sgml, ether_url + "_/gd_" + corpus + "_" + docname, "sgml")
				mode = "ether"

			# handle copying metadata
			if theform.getvalue('source_doc'):
				source_meta = get_doc_meta(theform.getvalue('source_doc'))
				existing_meta_keys = [x[2] for x in get_doc_meta(doc_id)]
				# don't overwrite existing keys
				meta_to_write = [x for x in source_meta if x[2] not in existing_meta_keys]
				for meta in meta_to_write:
					m_key, m_val = meta[2], meta[3]
					save_meta(int(doc_id), m_key, m_val)
					cache.invalidate_by_doc(doc_id, "meta")


	if theform.getvalue('edit_docname'):
		docname = theform.getvalue('edit_docname')
	elif old_docname != "":
		docname = old_docname
	if theform.getvalue('edit_corpusname'):
		corpus = theform.getvalue('edit_corpusname')
	elif old_corpus != "":
		corpus = old_corpus

	if theform.getvalue('id'):
		if int(doc_id) <= int(max_id):
		# After clicking edit in landing page, editing existing doc case, get the values from the db. pull the content from db to be displayed in the editor window.
			if theform.getvalue('edit_docname'):
				docname = theform.getvalue('edit_docname')
				if docname != old_docname and user != "demo":
					update_docname(doc_id,docname)
			if theform.getvalue('edit_filename'):
				repo_name=theform.getvalue('edit_filename')
				if repo_name != old_repo and user != "demo":
					update_filename(doc_id,repo_name)
			if theform.getvalue('edit_corpusname'):
				corpus = theform.getvalue('edit_corpusname')
				if corpus != old_corpus and user != "demo":
					update_corpus(doc_id,corpus)
			if theform.getvalue('edit_status'):
				status = theform.getvalue('edit_status')
				if status != old_status and user != "demo":
					update_status(doc_id,status)
			if theform.getvalue('edit_assignee'):
				assignee = theform.getvalue('edit_assignee')
				if assignee != old_assignee and user != "demo":
					update_assignee(doc_id,assignee)
			if theform.getvalue('edit_mode'):
				mode = theform.getvalue('edit_mode')
				if mode != old_mode and user != "demo":
					update_mode(doc_id,mode)
			if theform.getvalue('nlp_spreadsheet') == "do_nlp_spreadsheet":  # mode has been changed to spreadsheet via NLP
				update_mode(doc_id, "ether")
				mode = "ether"
			if old_docname != docname or old_corpus != corpus:
				old_sheet_name = "gd" + "_" + old_corpus + "_" + old_docname
				if sheet_exists(ether_url, old_sheet_name):  # Check if there is an ether sheet to copy
					old_socialcalc = get_socialcalc(ether_url, old_sheet_name)
					out, err = make_spreadsheet(old_socialcalc, ether_url + "_/gd_" + corpus + "_" + docname, "socialcalc")
					if out == "OK":
						delete_spreadsheet(ether_url,old_sheet_name)

			text_content = generic_query("SELECT content FROM docs WHERE id=?",(doc_id,))[0][0]

	# In the case of reloading after hitting 'save', either create new doc into db, or update db
	# CodeMirror sends the form with its code content in it before 'save' so we just display it again
	if theform.getvalue('code'):
		text_content = theform.getvalue('code')
		text_content = text_content.replace("\r","")
		text_content = re.sub(r'&(?!(#[xX][0-9a-fA-F]+|#\d+|[lg]t|amp|apos|quot);)',r'&amp;',text_content)  # Escape unescaped XML &
		text_content = unicode(text_content.decode("utf8"))
		if user != "demo":
			if int(doc_id)>int(max_id):
				create_document(doc_id, docname,corpus,status,assignee,repo_name,text_content)
			else:
				save_changes(doc_id,text_content)
				cache.invalidate_by_doc(doc_id, "xml")

	render_data["sent_mode"] = "text"
	if theform.getvalue("sent_mode"):
		render_data["sent_mode"] = theform.getvalue('sent_mode')

	if theform.getvalue('entity_sgml') and enable_entities:  # Save entity editor output
		entity_sgml = theform.getvalue('entity_sgml')
		ether_sgml  = ether_to_sgml(get_socialcalc(ether_url, "gd" + "_" + corpus + "_" + docname),doc_id)
		if len(entity_sgml.strip()) > 0:
			word_anno = config["DEFAULT_SGML_TOK_ATTR"] if config["DEFAULT_SGML_TOK_ATTR"].lower() != "none" else None
			other_annos = [a.split(":")[0] for a in config["entity_annos"].split(";")] if ":" in config["entity_annos"] else None
			merged_sgml = merge_entities(ether_sgml, entity_sgml, merge_anno="entity", word_anno=word_anno,
										 other_annos=other_annos)
			if not merged_sgml:  # merged_sgml = False means token counts don't match, can't merge
				render_data["entity_save_message"] = "Failed to save entities: token counts do not match with spreadsheet!"
				render_data["entity_save_color"] = "red"
				render_data["entity_save_icon"] = "ban"
			else:
				merged_sgml = merged_sgml.replace("&amp;", "&")
				out, err = make_spreadsheet(merged_sgml, ether_url + "_/gd_" + corpus + "_" + docname, "sgml")
				render_data["entity_save_message"] = "Saved merged entity annotations to spreadsheet"
				render_data["entity_save_color"] = "green"
				render_data["entity_save_icon"] = "floppy-o"


	if mode == "xml":
		render_data["xml_mode"] = True
	else:
		render_data["xml_mode"] = False
		
	# Get GitHub repo info
	git_status=False
	git_last_commit = False
	repo_name = generic_query("SELECT filename FROM docs WHERE id=?", (doc_id,))
	if len(repo_name) > 0:
		repo_name = repo_name[0][0]
	else:
		repo_name = ""
	file_name = generic_query("SELECT name FROM docs WHERE id=?", (doc_id,))
	if len(file_name) > 0:
		file_name = file_name[0][0]
	else:
		file_name = ""
	if "/" in repo_name:
		repo_info = repo_name.split('/')
		git_account, git_repo = repo_info[0], repo_info[1]
	else:
		repo_info = git_repo = git_account = repo_name

	# Get path for this document's serialized file in the repo
	if len(repo_info) > 2:
		subdir = '/'.join(repo_info[2:]) + "/"
	else:
		subdir = ""
	if mode == "xml":
		file_name = file_name.replace(" ","_") + ".xml"
	else:
		file_name = file_name.replace(" ","_") + "_ether.sgml"
	saved_file = subdir + file_name

	commit_message = ""
	if theform.getvalue('commit_msg'):
		commit_message = theform.getvalue('commit_msg')

	if theform.getvalue('push_git') == "push_git":

		# The user will indicate the subdir in the repo_name stored in the db.
		# Therefore, a file may be associated with the target repo subdir zangsir/coptic-xml-tool/uploaded_commits,
		# and that is fine, but we will need to make this uploaded_commits subdir first to create our file.
		if not os.path.isdir(prefix + subdir) and subdir != "":
			dirs = subdir.split(os.sep)[:-1]
			path_so_far = ""
			for dirname in dirs:
				if not os.path.isdir(prefix + path_so_far + dirname + os.sep):
					os.mkdir(prefix + path_so_far + dirname + os.sep, 0o755)
				path_so_far += dirname + os.sep

		if mode == "xml":
			text_content = generic_query("SELECT content FROM docs WHERE id=?", (doc_id,))[0][0]
			serializable_content = build_meta_tag(doc_id) + text_content.strip() + "\n</meta>\n"
			serializable_content = serializable_content.encode('utf8')
		else: # (mode == "ether")
			text_content = ether_to_sgml(get_socialcalc(ether_url, "gd" + "_" + corpus + "_" + docname),doc_id, config="tt_sgml")
			serializable_content = text_content
		serialize_file(serializable_content, saved_file)
		git_status = push_update_to_git(git_username, git_token, saved_file, git_account, git_repo, commit_message)

		# File system cleanup
		if subdir == "":
			# Delete a file
			os.remove(prefix+file_name)
		else:
			# Delete a subdirectory
			shutil.rmtree(prefix+subdir)

	if theform.getvalue('nlp_xml') == "do_nlp_xml" and mode == "xml":
		api_call = xml_nlp_api
		if api_call != "":
			nlp_user, nlp_password = get_nlp_credentials()
			data = {"data":text_content, "format":"pipes"}
			resp = requests.post(api_call, data, auth=HTTPBasicAuth(nlp_user,nlp_password))
			text_content=resp.text

	# Get last commit info
	if not (git_account=="account" and git_repo == "repo_name"):  # Check this is not the fake default repo name
		try:
			git_last_commit = get_last_commit(git_username, int(admin), git_account, git_repo, saved_file)
		except:
			git_last_commit = ""

	# Editing options
	# Docname
	# Filename
	status_list = open(prefix+"status.tab").read().replace("\r","").split("\n")
	render_data['status_options'] = [{'text': x, 'selected': x == status} for x in status_list]
	render_data['assignee_options'] = [{'text': x, 'selected': x == assignee} for x in get_user_list()]
	available_modes = ["xml", "ether"]
	if enable_entities:
		available_modes.append("entities")
	render_data['mode_options'] = [{'text': x, 'selected': x == mode} for x in available_modes]
	render_data['nlp_service'] = {'xml_button_html': xml_nlp_button.decode("utf8"),
                                  'spreadsheet_button_html': spreadsheet_nlp_button.decode("utf8"),
                                  'disabled': user == "demo" or mode == "ether",
								  "ner_button_html": ner_nlp_button.decode("utf8")}
	render_data['git_2fa'] = git_2fa == "true"
	if git_status:
		render_data['git_commit_response'] = git_status.replace('<','').replace('>','')
	if git_last_commit:
		render_data['git_last_commit'] = git_last_commit

	# prepare embedded editor html
	if str(enable_entities).lower() == "true":
		render_data['entity_mode'] = True
	if mode == "ether":
		render_data['ether_mode'] = True
		ether_url += "gd_" + corpus + "_" + docname
		render_data['ether_url'] = ether_url # .replace("http","https")  # fix AZ
		render_data['ether_stylesheets'] = get_ether_stylesheets()

		if "file" in theform and user != "demo":
			fileitem = theform["file"]
			if len(fileitem.filename) > 0:
				#  strip leading path from file name to avoid directory traversal attacks
				fn = os.path.basename(fileitem.filename)
				if fn.endswith(".xls") or fn.endswith(".xlsx"):
					make_spreadsheet(fileitem.file.read(),ether_url + "_/gd_" + corpus + "_" + docname,"excel")
				else:
					sgml = fileitem.file.read()
					meta_key_val = harvest_meta(sgml)
					make_spreadsheet(sgml,ether_url + "_/gd_" + corpus + "_" + docname)
					for (key, value) in iteritems(meta_key_val):
						key = key.replace("@","_")
						save_meta(int(doc_id),key.decode("utf8"),value.decode("utf8"))
						cache.invalidate_by_doc(doc_id, "meta")
	else:
		render_data['ether_mode'] = False
		if mode == "entities" and enable_entities:
			render_data['entity_mode'] = True
			ether_name = "_".join(["gd", corpus, docname])
			#ether_url = ether_url.replace("https","http")  # fix AZ
			soc = get_socialcalc(ether_url, ether_name)
			tt_string = ether_to_sgml(soc, doc_id, config="tt_sgml")
			tt_string = reorder(tt_string,priorities=[config["DEFAULT_SGML_SENT_TAG"],"entity",config["NER_POS_COL"],str(config["DEFAULT_SGML_TOK_ATTR"])])
			base_template = io.open("templates" + os.sep + "spannotator_template.html",encoding="utf8").read().replace('"','&quot;')
			if 'entity_annos' in config:
				base_template = base_template.replace("%%entity_annos%%", config["entity_annos"])  # optional key-value annotations
			base_template = base_template.replace("%%DEFAULT_SGML_SENT_TAG%%",config["DEFAULT_SGML_SENT_TAG"]).replace("%%DEFAULT_SGML_TOK_ATTR%%",config["DEFAULT_SGML_TOK_ATTR"])
			import_disabled = "" if int(admin) > 1 else ' disabled=&quot;disabled&quot; style=&quot;background-color: #6f6f6f&quot;'
			base_template = base_template.replace("%%DISABLE_IMPORT%%",import_disabled)
			if "NER_POS_COL" in config and "NER_POS_FILTER" in config:
				pos_list = get_pos_list(tt_string,config["NER_POS_COL"])
				render_data["NER_POS_FILTER"] = config["NER_POS_FILTER"]
				render_data["NER_POS_LIST"] = pos_list
				render_data["show_ner"] = True
			else:
				render_data["show_ner"] = False
			tt_escaped = tt_string.decode("utf8").replace('"',"%%quot%%").replace('\n','\\n').replace("<","%%lt%%").replace(">","%%gt%%")
			base_template = base_template.replace("%%DOC_TT_STRING%%",tt_escaped)
			entity_links = get_doc_entities(doc_id)
			entity_list = []
			if entity_links is not None:
				for row in entity_links:
					words, etype, eref = row
					entity_list.append(words + "+" + etype + "+" + eref)
			base_template = base_template.replace("%%DOC_ENTITY_LIST%%","|".join(entity_list).replace('"',"%%quot%%"))
			all_entity_links = get_entity_options()
			all_entity_list = []
			if all_entity_links is not None:
				for row in all_entity_links:
					etype, eref = row
					all_entity_list.append(etype + "+" + eref)
			base_template = base_template.replace("%%ALL_ENTITY_LIST%%","|".join(all_entity_list))

			render_data['spannotator_template'] = base_template

	# stop here if no doc selected
	if doc_id:
		render_data['doc_is_selected'] = len(doc_id) != 0
	else:
		return render("editor", render_data)

	render_data['id'] = doc_id
	render_data['mode'] = mode
	render_data['schema'] = schema
	render_data['docname'] = docname
	render_data['corpusname'] = corpus

	render_data['text_content'] = text_content
	render_data['repo'] = repo_name

	render_data["admin_gt_zero"] = int(admin) > 0
	render_data["admin_eq_three"] = admin == "3"

	# handle clone meta button, and allow github pushing
	if int(admin) > 0:
		doc_list = generic_query("SELECT id,corpus,name,status,assignee_username,mode FROM docs ORDER BY corpus, name COLLATE NOCASE",())
		render_data["docs"] = []
		for doc in doc_list:
			doc_vars = {}
			doc_vars["id"] = str(doc[0])
			doc_vars["corpus"] = doc[1]
			doc_vars["name"] = doc[2]
			render_data['docs'].append(doc_vars)

	render_data["can_save"] = not (int(admin) < 3)
	render_data["editor_help_link_html"] = editor_help_link
	render_data["first_load"] = len(theform.keys()) == 1

	return render("editor", render_data)


def open_main_server():
	thisscript = os.environ.get('SCRIPT_NAME', '')
	action = None
	theform = cgi.FieldStorage()
	#print(theform)
	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	userdir = scriptpath + "users" + os.sep
	action, userconfig = login(theform, userdir, thisscript, action)
	user = userconfig["username"]
	admin = userconfig["admin"]

	print("Content-type:text/html\n\n")
	try:
		print(load_page(user, admin, theform).encode("utf8"))
	except Exception as e:
		print("""<html><body><h1>Loading Error</h1>
		<p>For some reason, this page failed to load.</p>
		<p>Please send this to your system administrator:</p>
		<pre>""")
		traceback.print_exc(e, file=sys.stdout)
		print("""</pre></body></html>""")

if __name__ == "__main__":
	open_main_server()
