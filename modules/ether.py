#!/usr/bin/python
# -*- coding: utf-8 -*-

"""
This script takes CWB-SGML format input
and outputs EtherCalc/SocialCalc spreadsheet data

Author: Amir Zeldes
"""

import re, tempfile, subprocess, os
from collections import defaultdict
from collections import OrderedDict
from operator import itemgetter
from gitdox_sql import *
from os import listdir
from os.path import isfile, join
from configobj import ConfigObj
from ast import literal_eval
import json
import cgi
from xml.sax.saxutils import escape

__version__ = "2.0.0"


class ExportConfig:

	def __init__(self, **kwargs):
		"""
		:param kwargs:
			config=None, aliases=None, priorities=None, milestones=None, no_content=None, tok_annos=None

		"""
		self.config = kwargs.get("config",None)
		self.export_all = True

		if self.config is None:
			self.aliases = kwargs.get("aliases",{})
			self.priorities = kwargs.get("priorities",[])
			self.milestones = kwargs.get("milestones",[])
			self.no_content = kwargs.get("no_content",[])
			self.tok_annos = kwargs.get("tok_annos",[])
			self.template = "<meta %%all%%>\n%%body%%\n</meta>\n"
		else:
			if not self.config.endswith(".ini"):
				self.config += ".ini"
			self.read_config(self.config)

		# Anything that is 'no_content' must have some sort of priority
		for anno in sorted(self.no_content):
			if anno not in self.priorities:
				self.priorities.append(anno)
		# Anything that is in 'milestones' must have some sort of priority
		for anno in sorted(self.milestones):
			if anno not in self.priorities:
				self.priorities.append(anno)
		# Anything that is in 'tok_annos' must have some sort of priority
		for anno in sorted(self.tok_annos):
			if anno not in self.priorities:
				self.priorities.append(anno)

	def read_config(self,config_file):

		config = ConfigObj(os.path.dirname(os.path.realpath(__file__)) + os.sep + ".." + os.sep + "schemas" + os.sep + config_file)
		if config.has_key("aliases"):
			self.aliases = literal_eval(config["aliases"])
		else:
			self.aliases = {}
		if config.has_key("priorities"):
			self.priorities = literal_eval(config["priorities"])
		else:
			self.priorities = []
		if config.has_key("milestones"):
			self.milestones = literal_eval(config["milestones"])
		else:
			self.milestones = []
		if config.has_key("no_content"):
			self.no_content = literal_eval(config["no_content"])
		else:
			self.no_content = []
		if config.has_key("tok_annos"):
			self.tok_annos = literal_eval(config["tok_annos"])
		else:
			self.tok_annos = []
		if config.has_key("export_all"):
			self.export_all = config["export_all"].lower() == "true"
		if config.has_key("template"):
			self.template = config["template"]
		else:
			self.template = "<meta %%all%%>\n%%body%%\n</meta>\n"

def build_meta_tag(doc_id):
	meta = "<meta"
	meta_items = []
	meta_rows = get_doc_meta(doc_id)
	# docid,metaid,key,value - four cols
	for item in meta_rows:
		key, value = item[2], item[3]
		if not key.startswith("ignore:"):
			key = key.replace("=", "&equals;")
			value = value.replace('"', "&quot;")
			meta_items.append(key + '="' + value + '"')

	meta_props = " ".join(meta_items)
	if meta_props != "":
		meta_props = " " + meta_props
	output = meta + meta_props + ">\n"
	return output


def fill_meta_template(doc_id,template):
	meta_items = []
	meta_dict = {}
	meta_rows = get_doc_meta(doc_id)
	doc_info = get_doc_info(doc_id)
	name, corpus = [str(x) for x in doc_info[0:2]]
	# docid,metaid,key,value - four cols
	for item in meta_rows:
		key, value = str(item[2].encode("utf8")), str(item[3].encode("utf8"))
		if not key.startswith("ignore:"):
			key = key.replace("=", "&equals;")
			value = value.replace('"', "&quot;")
			meta_items.append(escape(key) + '="' + escape(value) + '"')
			meta_dict[escape(key)] = escape(value)

	meta_props = " ".join(meta_items)

	"""
	if "%%all:" in template: # Check for instruction to embed all metadata in an existing tag
		m = re.search(r"%%all:([^%]+)%",template)
		if m is not None:
			meta_tag = m.group(1)
			template = re.sub("(<" + meta_tag + "[^>]*)>", "\1 " + meta_props + ">", template)
		template = re.sub(r"%%all:([^%]+)%","",template)
	else:
	"""
	template = template.replace("%%all%%", meta_props)
	template = template.replace("%%name%%", name)
	template = template.replace("%%corpus%%", corpus)

	for key in meta_dict:
		if key != "body": # Never overwrite body template position
			template = template.replace("%%" + key + "%%",meta_dict[key])

	return template


def get_file_list(path,extension,hide_extension=False,forbidden=None):
	if forbidden is None:
		forbidden = []

	if not extension.startswith("."):
		extension = "." + extension

	outfiles = []
	files = [f for f in listdir(path) if isfile(join(path, f))]
	for filename in sorted(files):
		if filename.endswith(extension) and filename not in forbidden:
			if hide_extension:
				filename = filename.replace(extension, "")
			if filename not in forbidden:
				outfiles.append(filename)

	return outfiles


def get_ether_stylesheet_select():

	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	stylesheet_dir = scriptpath + os.sep + ".." + os.sep + "schemas" + os.sep

	stylesheet_list = get_file_list(stylesheet_dir,"ini",hide_extension=True)
	select = """<select name="ether_stylesheet" id="ether_stylesheet">\n"""
	if len(stylesheet_list) == 0:
		select += "\t<option>--default--</option>\n"

	for f in stylesheet_list:
		select += '\t<option value="' + f + '">' + f + '</option>\n'
	select += "</select>\n"
	return select


def get_corpus_select():

	corpora = get_corpora()
	select = """<select name="corpus_select" id="corpus_select">\n"""
	select += '\t<option value="--ALL--">[all corpora]</option>\n'

	for corpus in corpora:
		select += '\t<option value="' + corpus[0] + '">' + corpus[0] + '</option>\n'
	select += "</select>\n"
	return select


def flush_open(annos, row_num, colmap):
	flushed = ""
	for anno in annos:
		element, name, value = anno
		flushed += "cell:"+colmap[name] + str(row_num) + ":t:" + value + "\n"
	return flushed


def flush_close(closing_element, last_value, last_start, row_num, colmap, aliases):
	flushed = ""
	for alias in aliases[closing_element]:
		if last_start[alias] < row_num - 1:
			span_string = ":rowspan:" + str(row_num - last_start[alias])
		else:
			span_string = ""
		flushed += "cell:" + colmap[alias] + str(last_start[alias]) + ":t:" + last_value[alias]+span_string + ":f:1\n"
	return flushed


def number_to_letter(number):
	# Currently support up to 26 columns; no support for multiletter column headers beyond letter Z
	if number < 27:
		return chr(number + ord('a')-1).upper()
	else:
		return None


def sgml_to_ether(sgml, ignore_elements=False):
	sgml = sgml.replace("\r","")
	current_row = 2
	open_annos = defaultdict(list)
	aliases = defaultdict(list)
	last_value = {}
	last_start = {}
	colmap = OrderedDict()
	maxcol = 1

	preamble = """socialcalc:version:1.0
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary=SocialCalcSpreadsheetControlSave
--SocialCalcSpreadsheetControlSave
Content-type: text/plain; charset=UTF-8

# SocialCalc Spreadsheet Control Save
version:1.0
part:sheet
part:edit
part:audit
--SocialCalcSpreadsheetControlSave
Content-type: text/plain; charset=UTF-8

version:1.5

"""

	output = ""

	for line in sgml.strip().split("\n"):
		line = line.strip()
		line = line.replace(":","\\c")
		if line.startswith("<?") or line.endswith("/>"):  # Skip unary tags and XML instructions
			pass
		elif line.startswith("<meta") or line.startswith("</meta"):  # meta tags
			pass
		elif line.startswith("</"):  # Closing tag
			my_match = re.match("</([^>]+)>",line)
			element = my_match.groups(0)[0]
			output+=flush_close(element, last_value, last_start, current_row, colmap, aliases)
		elif line.startswith("<"): # Opening tag
			my_match = re.match("<([^ >]+)[ >]",line)
			element = my_match.groups(0)[0]
			aliases[element] = []  # Reset element aliases to see which attributes this instance has
			if "=" not in line:
				line = "<" + element + " " + element + '="' + element + '">'

			my_match = re.findall('([^" =]+)="([^"]+)"',line)
			anno_name = ""
			anno_value = ""
			for match in my_match:
				if element != match[0] and ignore_elements is False:
					anno_name = element + "_" + match[0]
				else:
					anno_name = match[0]
				anno_value = match[1]
				open_annos[current_row].append((anno_name,anno_value))
				last_value[anno_name] = anno_value
				last_start[anno_name] = current_row
				if element not in aliases:
					aliases[element] = [anno_name]
				elif anno_name not in aliases[element]:
					aliases[element].append(anno_name)
				if anno_name not in colmap:
					maxcol +=1
					colmap[anno_name] = number_to_letter(maxcol)

		elif len(line) > 0:  # Token
			token = line.strip()
			output += "cell:A"+str(current_row)+":t:"+token+":f:1\n"
			current_row +=1
		else:  # Empty line
			current_row +=1

	preamble += "cell:A1:t:tok:f:2\n"
	output = preamble + output
	for header in colmap:
		output += "cell:"+colmap[header]+"1:t:"+header+":f:2\n"

	output += "\nsheet:c:" + str(maxcol) + ":r:" + str(current_row-1) + ":tvf:1\n"

	# Prepare default Antinoou font for Coptic data

	output += """
font:1:* * Antinoou
font:2:normal bold * *
valueformat:1:text-wiki
--SocialCalcSpreadsheetControlSave
Content-type: text/plain; charset=UTF-8

version:1.0
rowpane:0:1:1
colpane:0:1:1
ecell:A1
--SocialCalcSpreadsheetControlSave
Content-type: text/plain; charset=UTF-8

--SocialCalcSpreadsheetControlSave--
"""

	return output

def ether_to_sgml(ether, doc_id,config=None):
	"""

	:param ether: String in SocialCalc format
	:param doc_id: GitDox database internal document ID number as string
	:return:
	"""

	if config is None or config == "--default--":
		config = ExportConfig()
	else:
		config = ExportConfig(config=config)

	colmap = {}
	cells = []

	if isinstance(ether,unicode):
		ether = ether.encode("utf8")

	for line in ether.splitlines():
		parsed_cell = re.match(r'cell:([A-Z]+)(\d+):(.*)$', line)
		if parsed_cell is not None:
			col = parsed_cell.group(1)
			row = int(parsed_cell.group(2))
			other = parsed_cell.group(3).split(':')
			cellinfo = {}
			i = 0
			while i+1 < len(other):
				cellinfo[other[i]] = other[i+1]
				i += 2
			cells.append((col, row, cellinfo))

	cells = sorted(cells, key=itemgetter(1)) # so header row gets read first

	open_tags = defaultdict(lambda: defaultdict(list))
	last_open_index = defaultdict(int)
	open_tag_length = defaultdict(int)
	open_tag_order = defaultdict(list)
	last_row = 1
	toks = {}
	sec_element_checklist = []
	row = 1

	close_tags = defaultdict(list)
	for cell in cells:
		if cell[1] == 1:  # Header row
			colname = cell[2]['t']
			if colname in config.aliases:
				colmap[cell[0]] = config.aliases[colname]
			else:
				colmap[cell[0]] = colname
			# Make sure that everything that should be exported has some priority
			if colname not in config.priorities and config.export_all:
				if not colname.lower().startswith("ignore:"):  # Never export columns prefixed with "ignore:"
					if "@" in colname:
						elem = colname.split("@",1)[0]
					else:
						elem = colname
					config.priorities.append(elem)
		else:
			col = cell[0]
			row = cell[1]
			if col in colmap:
				col_name = colmap[col]
			else:
				raise IOError("Column " + col + " not found in doc_id " + str(doc_id))
			if "@" in col_name:
				element, attrib = col_name.split("@",1)
			else:
				element = col_name
				attrib = element

			if 'rowspan' in cell[2]:
				rowspan = int(cell[2]['rowspan'])
			else:
				rowspan = 1

			if "|" in element:  # Check for flexible element, e.g. m|w@x means 'prefer to attach x to m, else to w'
				element, sec_element = element.split("|",1)
			else:
				sec_element = ""

			if element not in config.priorities:  # Guaranteed to be in priorities if it should be included
				continue  # Move on to next cell if this is not a desired column
			if row != last_row:  # New row starting, sort previous lists for opening and closing orders
				#close_tags[row].sort(key=lambda x: (-last_open_index[x],x))
				close_tags[row].sort(key=lambda x: (last_open_index[x],config.priorities.index(x)), reverse=True)
				for element in open_tags[last_row]:
					open_tag_order[last_row].append(element)
				#open_tag_order[last_row].sort(key=lambda x: (open_tag_length[x],x), reverse=True)
				open_tag_order[last_row].sort(key=lambda x: (-open_tag_length[x],config.priorities.index(x)))

				for sec_tuple in sec_element_checklist:
					prim_found = False
					e_prim, e_sec, attr, val, span = sec_tuple
					if e_prim in open_tags[last_row] and e_prim in open_tag_length:
						if span == open_tag_length[e_prim]:
							open_tags[last_row][e_prim].append((attr, val))
							prim_found = True
					if not prim_found:
						if e_sec in open_tags[last_row] and e_sec in open_tag_length:
							if span == open_tag_length[e_sec]:
								open_tags[last_row][e_sec].append((attr, val))
				sec_element_checklist = []  # Purge sec_elements

				last_row = row
			if 't' in cell[2]:  # cell contains text
				content = cell[2]['t']
			elif 'v' in cell[2]: # cell contains numerical value
				content = cell[2]['v']
			elif col_name != 'tok':
				continue  # cell does not contain a value and this is not a token entry

			if col_name == 'tok':
				if "<" in content or "&" in content or ">" in content:
					content = escape(content)
				toks[row] = content
			else:
				if element in config.no_content:
					if element == attrib:
						attrib = ""
				else:
					attrib = col_name

				if attrib in config.tok_annos:
					# TT SGML token annotation, append to token with tab separator and move on
					if "<" in content or "&" in content or ">" in content:
						content = escape(content)
					toks[row] += "\t" + content
					continue

				if element not in config.priorities and len(config.priorities) > 0:
					# Priorities have been supplied, but this column is not in them
					continue

				if sec_element != "":
					#open_tags[row][sec_element].append((attrib, content))
					sec_element_checklist.append((element,sec_element,attrib,content,rowspan))
					continue

				open_tags[row][element].append((attrib, content))
				last_open_index[element] = int(row)

				if 'rowspan' in cell[2]:
					close_row = row + rowspan
				else:
					close_row = row + 1
				if element not in close_tags[close_row]:
					close_tags[close_row].append(element)
				open_tag_length[element] = int(close_row) - int(last_open_index[element])

	# Sort last row tags
	close_tags[row].sort(key=lambda x: (last_open_index[x],config.priorities.index(x)), reverse=True)
	if row + 1 in close_tags:
		close_tags[row+1].sort(key=lambda x: (last_open_index[x],config.priorities.index(x)), reverse=True)
	for element in open_tags[last_row]:
		open_tag_order[last_row].append(element)
	open_tag_order[last_row].sort(key=lambda x: (-open_tag_length[x],config.priorities.index(x)))

	#output = build_meta_tag(doc_id)
	template = fill_meta_template(doc_id,config.template)
	output = ""

	for r in xrange(2,len(toks)+3):
		if r == 30:
			pass
		for element in close_tags[r]:
			if element not in config.milestones:
				output += '</' + element + '>\n'

		if r == len(toks)+2:
			break

		for element in open_tag_order[r]:
			tag = '<' + element
			for attrib, value in open_tags[r][element]:
				if attrib != "":
					tag += ' ' + attrib + '="' + value + '"'
			if element in config.milestones:
				tag += '/>\n'
			else:
				tag += '>\n'
			output += tag

		if r not in toks:
			toks[r] = ""  # Caution - empty token!
		output += toks[r] + '\n'

	output = output.replace('\c', ':')
	#output += "</meta>\n"
	if "%%body%%" in template:
		output = template.replace("%%body%%",output.strip())
	return output


def exec_via_temp(input_text, command_params, workdir=""):
	temp = tempfile.NamedTemporaryFile(delete=False,mode='wb')
	exec_out = ""
	try:
		temp.write(input_text)
		temp.close()

		#command_params = [x if 'tempfilename' not in x else x.replace("tempfilename",temp.name) for x in command_params]
		command_params = command_params.replace("tempfilename",temp.name)

		if workdir == "":
			proc = subprocess.Popen(command_params, stdout=subprocess.PIPE,stdin=subprocess.PIPE,stderr=subprocess.PIPE,shell=True)
			(stdout, stderr) = proc.communicate()
		else:
			proc = subprocess.Popen(command_params, stdout=subprocess.PIPE,stdin=subprocess.PIPE,stderr=subprocess.PIPE,cwd=workdir)
			(stdout, stderr) = proc.communicate()

	except Exception as e:
		return str(e)
	finally:
		os.remove(temp.name)
		return stdout, stderr


def fix_colnames(socialcalc):
	socialcalc = re.sub(r'(:[A-Z]1:t:)norm_group_(orig_group:)',r'\1\2',socialcalc)
	socialcalc = re.sub(r'(:[A-Z]1:t:)norm_(orig|pos|lemma:)', r'\1\2', socialcalc)
	return socialcalc


def make_spreadsheet(data, ether_path, format="sgml", ignore_elements=False):
	if format=="sgml":
		socialcalc_data = sgml_to_ether(data, ignore_elements)
		socialcalc_data = fix_colnames(socialcalc_data)
		ether_command = "curl --netrc --request PUT --header 'Content-Type: text/x-socialcalc' --data-binary @tempfilename " + ether_path  # e.g. ether_path "http://127.0.0.1:8000/_/nlp_snippet"
	elif format=="socialcalc":
		socialcalc_data = data.encode("utf8")
		ether_command = "curl --netrc --request PUT --header 'Content-Type: text/x-socialcalc' --data-binary @tempfilename " + ether_path  # e.g. ether_path "http://127.0.0.1:8000/_/nlp_snippet"
	else:
		socialcalc_data = data
		ether_command = "curl --netrc -i -X PUT --data-binary @tempfilename " + ether_path # e.g. ether_path "http://127.0.0.1:8000/_/nlp_snippet"
	#ether_command = ["curl","--request","PUT","--header","'Content-Type: text/x-socialcalc'", "--data-binary", "@" + "tempfilename",
	#				 ether_path] # e.g. ether_path "http://127.0.0.1:8000/_/nlp_snippet"
	#ether_command = ["less","tempfilename",">","/var/www/html/gitdox/out.eth"]
	#outfile = open("/var/www/html/gitdox/out.eth",'wb')
	#outfile.write(socialcalc_data.encode("utf8"))
	#outfile.close()
	out, err = exec_via_temp(socialcalc_data,ether_command)
	return out, err


def delete_spreadsheet(ether_url, name):
	"""
	Forcibly deletes EtherCalc spreadsheet from redis DB

	:param name: name of the spreadsheet (last part of URL)
	:return: void
	"""

	ether_command = "curl --netrc -X DELETE " + ether_url + "_/" + name
	del_proc = subprocess.Popen(ether_command,shell=True)

	(stdout, stderr) = del_proc.communicate()

	return stdout, stderr


def sheet_exists(ether_path, name):
	return len(get_socialcalc(ether_path,name)) > 0


def get_socialcalc(ether_path, name):
	command = "curl --netrc -X GET " + ether_path + "_/" + name
	proc = subprocess.Popen(command, stdout=subprocess.PIPE, stdin=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
	(stdout, stderr) = proc.communicate()
	return stdout.decode("utf8")


def get_timestamps(ether_path):
	command = "curl --netrc -X GET " + ether_path + "_roomtimes"
	proc = subprocess.Popen(command, stdout=subprocess.PIPE, stdin=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
	(stdout, stderr) = proc.communicate()
	times = json.loads(stdout)
	output = {}
	for room in times:
		output[room.replace("timestamp-","")] = times[room]
	return output


if __name__  == "__main__":
	data = ""
	storage = cgi.FieldStorage()
	if "data" in storage:
		data = storage.getvalue("data")
	else:
		data = ""

	data = re.sub('>', '>\n', data)
	data = re.sub('</', '\n</', data)
	data = re.sub('\n+', '\n', data)
	ether_out = sgml_to_ether(data)
	print(ether_out)
