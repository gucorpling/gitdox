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
import json
import cgi

__version__ = "2.0.0"


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

		elif len(line)>0:  # Token
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

def ether_to_sgml(ether, doc_id):
	"""

	:param ether: String in SocialCalc format
	:param doc_id: GitDox databsed internal document ID number as string
	:return:
	"""

	colmap = {}
	cells = []
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
	row = 1

	close_tags = defaultdict(list)
	for cell in cells:
		if cell[1] == 1:
			colname = cell[2]['t']
			colmap[cell[0]] = colname
		else:
			col = cell[0]
			row = cell[1]
			if row != last_row:  # New row starting, sort previous lists for opening and closing orders
				close_tags[row].sort(key=lambda x: (-last_open_index[x],x))
				for element in open_tags[last_row]:
					open_tag_order[last_row].append(element)
				open_tag_order[last_row].sort(key=lambda x: (open_tag_length[x],x), reverse=True)
				last_row = row
			col_name = colmap[col]
			if 't' in cell[2]:  # cell contains text
				content = cell[2]['t']
			elif 'v' in cell[2]: # cell contains numerical value
				content = cell[2]['v']
			elif col_name != 'tok':
				continue  # cell does not contain a value and this is not a token entry

			if col_name == 'tok':
				toks[row] = content
			else:
				element = col_name
				attrib = col_name

				open_tags[row][element].append((attrib, content))
				last_open_index[element] = int(row)

				if 'rowspan' in cell[2]:
					rowspan = int(cell[2]['rowspan'])
					close_row = row + rowspan
				else:
					close_row = row + 1
				if element not in close_tags[close_row]:
					close_tags[close_row].append(element)
				open_tag_length[element] = int(close_row) - int(last_open_index[element])

	# Sort last row tags
	close_tags[row].sort(key=lambda x: (-last_open_index[x], x))
	if row + 1 in close_tags:
		close_tags[row+1].sort(key=lambda x: (-last_open_index[x], x))
	for element in open_tags[last_row]:
		open_tag_order[last_row].append(element)
	open_tag_order[last_row].sort(key=lambda x: (open_tag_length[x], x), reverse=True)

	meta = "<meta"
	meta_items = []
	meta_rows = get_doc_meta(doc_id)
	# docid,metaid,key,value - four cols
	for item in meta_rows:
		key, value = item[2], item[3]
		if not key.startswith("ignore:"):
			key = key.replace("=","&equals;")
			value = value.replace('"',"&quot;")
			meta_items.append(key + '="' + value + '"')

	meta_props = " ".join(meta_items)
	if meta_props != "":
		meta_props = " " + meta_props
	output = meta + meta_props + ">\n"

	for r in xrange(2,len(toks)+3):
		if r == 30:
			pass
		for element in close_tags[r]:
			output += '</' + element + '>\n'

		if r == len(toks)+2:
			break

		for element in open_tag_order[r]:
			tag = '<' + element
			for attrib, value in open_tags[r][element]:
				tag += ' ' + attrib + '="' + value + '"'
			tag += '>\n'
			output += tag

		output += toks[r] + '\n'

	output = output.replace('\c', ':')
	output += "</meta>\n"
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
