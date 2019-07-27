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
from copy import copy
import cgi
import requests
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
			self.no_ignore = kwargs.get("no_ignore",True)
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
		if config.has_key("no_ignore"):
			self.no_ignore = config["no_ignore"].lower() == "true"
		else:
			self.no_ignore = True
		if config.has_key("template"):
			self.template = config["template"]
		else:
			self.template = "<meta %%all%%>\n%%body%%\n</meta>\n"


def parse_ether(ether, doc_id=None):
	"""Take in raw socialcalc data and turn it into a dict of Cells. Used in validation."""

	class Cell:
		def __init__(self, col, row, content, span):
			self.col = col
			self.row = row
			self.header = ""
			self.content = content
			self.span = span

		def __repr__(self):
			return "<Cell (" + repr((self.col, self.row, self.header, self.content, self.span)) + ")>"

	ether_lines = ether.splitlines()

	# find col letter corresponding to col name
	parsed = defaultdict(list)
	colmap = defaultdict(list)
	rev_colmap = {}
	all_cells = []
	for line in ether_lines:
		if line.startswith("cell:"):  # Cell row
			# A maximal row looks like this incl. span: cell:F2:t:LIRC2014_chw0oir:f:1:rowspan:289
			# A minimal row without formatting: cell:C2:t:JJ:f:1
			parts = line.split(":")
			if len(parts) > 3:  # Otherwise invalid row
				cell_id = parts[1]
				cell_row = cell_id[1:]
				cell_col = cell_id[0]
				# We'd need something like this to support more than 26 cols, i.e. columns AA, AB...
				# for c in cell_id:
				#	if c in ["0","1","2","3","4","5","6","7","8","9"]:
				#		cell_row += c
				#	else:
				#		cell_col += c
				cell_content = parts[3].replace("\\c", ":")
				cell_span = parts[-1] if "rowspan:" in line else "1"

				# record col name
				if cell_row == "1":
					colmap[cell_content].append(cell_col)
					rev_colmap[cell_col] = cell_content

				cell = Cell(cell_col, cell_row, cell_content, cell_span)
				parsed[cell_col].append(cell)
				all_cells.append(cell)

	for cell in all_cells:
		if cell.col in rev_colmap:
			cell.header = rev_colmap[cell.col]
		else:
			if doc_id is None:
				doc_id = "unknown"
			raise IOError("Undocumented column: " + cell.col + " in '" + str(cell) + " from doc: " + str(doc_id))

	parsed["__colmap__"] = colmap  # Save colmap for apply_rule
	return parsed


def unescape_xml(text):
	# Fix various common compounded XML escapes
	text = text.replace("&amp;lt;","<").replace("&amp;gt;",">")
	text = text.replace("&lt;","<").replace("&gt;",">")
	text = text.replace("&amp;","&")
	return text

def build_meta_tag(doc_id):
	meta = "<meta"
	meta_items = []
	meta_rows = get_doc_meta(doc_id)
	# docid,metaid,key,value - four cols
	for item in meta_rows:
		key, value = item[2], item[3]
		if not key.startswith("ignore:"):
			key = key.replace("=", "&equals;")  # Key may not contain equals sign
			value = value.replace('"', "&quot;")  # Value may not contain double quotes
			value = unescape_xml(value)
			meta_items.append(key + '="' + value + '"')

	meta_props = " ".join(meta_items)
	if meta_props != "":
		meta_props = " " + meta_props
	output = meta + meta_props + ">\n"
	output = output.replace("<meta >","<meta>")
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
			value = unescape_xml(value)
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

	template = template.replace("<meta >","<meta>")
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


def get_ether_stylesheets():
	scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
	stylesheet_dir = scriptpath + os.sep + ".." + os.sep + "schemas" + os.sep
	stylesheet_list = get_file_list(stylesheet_dir,"ini",hide_extension=True)
	return stylesheet_list


def flush_open(annos, row_num, colmap):
	flushed = ""
	for anno in annos:
		element, name, value = anno
		flushed += "cell:"+colmap[name] + str(row_num) + ":t:" + value + "\n"  # NO t >TVF
	return flushed


def flush_close(closing_element, last_value, last_start, row_num, colmap, aliases):
	flushed = ""

	for alias in aliases[closing_element][-1]:
		stack_len = len(last_start[alias])

		if stack_len > 0 and last_start[alias][-1] < row_num - 1:
			span_string = ":rowspan:" + str(row_num - last_start[alias][-1])
		else:
			span_string = ""

		# Use t for tvf to leave links on
		flushed += ("cell:"
			+ colmap[alias][stack_len - 1]
			+ str(last_start[alias][-1])
			+ ":t:" + str(last_value[alias][-1])
			+ ":f:1:tvf:1" + span_string + "\n")

		# pop the stack since we've closed a tag
		last_value[alias].pop()
		last_start[alias].pop()

	aliases[closing_element].pop()
	return flushed


def number_to_letters(number):
	if number < 27:
		return chr(number + ord('a') - 1).upper()
	else:
		char1 = chr((number // 26) + ord('a')-1).upper()
		char2 = chr((number % 26) + ord('a')-1).upper()
		return char1 + char2


def sgml_to_ether(sgml, ignore_elements=False):
	open_annos = defaultdict(list)

	# a mapping from a tag name to a list of values. the list is a stack
	# where the most recently encountered opening tag's value/start row
	# is kept on the right side of the list. whenever we see a closing tag
	# we pop from the stack, and whenever we see an opening tag we push
	# (append) to the stack
	last_value = defaultdict(list)
	last_start = defaultdict(list)

	# maps from tags to a similar stack data structure where the top of the stack
	# (i.e. the right side of the list) contains all the annotations that were
	# present on the most recently opened nested element
	aliases = defaultdict(list)

	# values in this dict are also lists which follow the pattern described above
	colmap = OrderedDict()

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

	sgml = sgml.replace("\r","")

	output = ""
	maxcol = 1
	current_row = 2

	for line in sgml.strip().split("\n"):
		line = line.strip()
		# SocialCalc uses colons internally, \\c used to repr colon in data
		line = line.replace(":","\\c")

		if line.startswith("<?") or line.endswith("/>"):  # Skip unary tags and XML instructions
			continue
		elif line.startswith("<meta") or line.startswith("</meta"):  # meta tags
			continue
		elif line.startswith("</"):  # Closing tag
			my_match = re.match("</([^>]+)>",line)
			element = my_match.groups(0)[0]
			output += flush_close(element, last_value, last_start, current_row, colmap, aliases)
		elif line.startswith("<"): # Opening tag
			my_match = re.match("<([^ >]+)[ >]",line)
			element = my_match.groups(0)[0]
			aliases[element].append([])  # Add new set of aliases to see which attributes this instance has
			if "=" not in line:
				line = "<" + element + " " + element + '="' + element + '">'

			attrs = re.findall('([^" =]+)="([^"]+)"',line)
			anno_name = ""
			anno_value = ""
			for attr in attrs:
				if element != attr[0] and ignore_elements is False:
					if attr[0] == "xml\\clang":
						anno_name = "lang"  # TODO: de-hardwire fix for xml:lang
					else:
						anno_name = element + "_" + attr[0]
				else:
					anno_name = attr[0]
				anno_value = attr[1]
				open_annos[current_row].append((anno_name,anno_value))
				last_value[anno_name].append(anno_value)
				last_start[anno_name].append(current_row)
				if anno_name not in aliases[element][-1]:
					aliases[element][-1].append(anno_name)

				if anno_name not in colmap:
					maxcol += 1
					colmap[anno_name] = [number_to_letters(maxcol)]
				elif anno_name in colmap and \
					 len(last_start[anno_name]) > len(colmap[anno_name]):
					maxcol += 1
					colmap[anno_name].append(number_to_letters(maxcol))

		elif len(line) > 0:  # Token
			token = line.strip()
			output += "cell:A"+str(current_row)+":t:"+token+":f:1:tvf:1\n"  # NO f <> tvf for links
			current_row +=1
		else:  # Empty line
			current_row +=1

	preamble += "cell:A1:t:tok:f:2\n" # f <> tvf for links
	output = preamble + output
	for header in colmap:
		for entry in colmap[header]:
			output += "cell:"+entry+"1:t:"+header+":f:2\n" # NO f <> tvf for links

	output += "\nsheet:c:" + str(maxcol) + ":r:" + str(current_row-1) + ":tvf:1\n"

	# Prepare default Antinoou font for Coptic data

	output += """
font:1:* * Antinoou
font:2:normal bold * *
valueformat:1:text-plain
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


def ether_to_csv(ether_path, name):
	try:
		r = requests.get(ether_path + "_/" + name + "/csv/")
	except:
		return ""

	return r.text


def strip_unique_identifier(tag):
	"""Given an SGML closing or opening tag, replace anything that looks
	like __\d+__ on the end of the tag name, assuming that we were the
	ones who added it."""

	try:
		tag_name = re.match("^</?([^ >]+)", tag).groups(0)[0]
	except AttributeError:
		return tag

	orig_tag_name = re.sub("__\d+__$", "", tag_name)
	tag = tag.replace("<" + tag_name, "<" + orig_tag_name)
	tag = tag.replace("</" + tag_name, "</" + orig_tag_name)
	tag = tag.replace(tag_name + "=" + '"' + orig_tag_name + '"',
					  orig_tag_name + "=" + '"' + orig_tag_name + '"')
	return tag

def deunique_should_skip_line(line):
	return (not line.startswith("<")      # tokens
			or line.startswith("<?")      # xml instrs
			or line.endswith("/>")        # unary tags
			or line.startswith("<meta")   # meta
			or line.startswith("</meta"))

def reverse_adjacent_closing_tags(lines):
	"""Finds sublists like ['</e>', '</e__2__>'] and replaces them with
	  ['</e__2__>', '</e>']"""
	def swap_run(l, start, end):
		l[start:end] = l[start:end][::-1]

	run_start = None
	for i, line in enumerate(lines):
		if line.startswith("</"):
			if run_start is not None:
				deuniqued_tag = strip_unique_identifier(line)
				if deuniqued_tag != lines[run_start]:
					swap_run(lines, run_start, i)
					run_start = None
			else:
				run_start = i
		elif run_start is not None:
			swap_run(lines, run_start, i)
			run_start = None
		else:
			run_start = None

	if run_start is not None:
		swap_run(lines, run_start, i+1)

	return lines

def deunique_properly_nested_tags(sgml):
	"""Use a silly n^2 algorithm to detect properly nested tags and strip
	them of their unique identifiers. Probably an n algorithm to do this."""
	lines = sgml.split("\n")
	lines = reverse_adjacent_closing_tags(lines)

	output = copy(lines)

	for i, line in enumerate(lines):
		if deunique_should_skip_line(line) or line.startswith("</"):
			continue

		# if we've gotten this far, we have an opening tag--store the tag name
		open_element = re.match("<([^ >]+)[ >]", line).groups(0)[0]
		open_counts = defaultdict(int)

		for j, line2 in enumerate(lines[i:]):
			if deunique_should_skip_line(line2):
				continue

			if line2.startswith("</"):
				element = re.match("</([^>]+)>", line2).groups(0)[0]
				open_counts[element] -= 1
				if element == open_element:
					break
			else:
				element = re.match("<([^ >]+)[ >]", line2).groups(0)[0]
				open_counts[element] += 1

		# element is properly nested if no element was opened in the block that
		# was not also closed in the block or vice versa
		if sum(open_counts.values()) == 0:
			output[i] = strip_unique_identifier(output[i])
			output[i+j] = strip_unique_identifier(output[i+j])

	output = reverse_adjacent_closing_tags(output)

	return "\n".join(output)


def ether_to_sgml(ether, doc_id,config=None):
	"""
	:param ether: String in SocialCalc format
	:param doc_id: GitDox database internal document ID number as string
	:param config: Name of an export config (.ini file) under schemas/
	:return:
	"""

	if config is None or config == "--default--":
		config = ExportConfig()
	else:
		config = ExportConfig(config=config)

	# mapping from col header (meaningful string) to the col letter
	colmap = {}
	# list of 3-tuples of parsed cells: (col, row, contents)
	cells = []

	if isinstance(ether,unicode):
		ether = ether.encode("utf8")

	# Destroy empty span cells without content, typically nested underneath longer, filled spans
	ether = re.sub(r'cell:[A-Z]+[0-9]+:f:1:rowspan:[0-9]+','',ether)

	# Ensure that cell A1 is treated as 'tok' if the header was deleted
	ether = re.sub(r'cell:A1:f:([0-9]+)',r"cell:A1:t:tok:f:\1",ether)

	# parse cell contents into cells
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

	# added to support duplicate columns
	namecount = defaultdict(int)

	close_tags = defaultdict(list)
	for cell in cells:
		# Header row
		if cell[1] == 1:
			colname = cell[2]['t'].replace("\\c",":")
			if colname in config.aliases:
				colname = config.aliases[colname]

			# if we've already seen a tag of this name, prepare to make it unique
			namecount[colname] += 1
			if namecount[colname] > 1:
				dupe_suffix = "__" + str(namecount[colname]) + "__"
			else:
				dupe_suffix = ""

			if "@" in colname:
				unique_colname = colname.replace("@", dupe_suffix + "@")
			else:
				unique_colname = colname + dupe_suffix

			colmap[cell[0]] = unique_colname

			# Make sure that everything that should be exported has some priority
			if unique_colname.split("@",1)[0] not in config.priorities and config.export_all:
				if not unique_colname.lower().startswith("ignore:"):
					elem = unique_colname.split("@",1)[0]
					config.priorities.append(elem)
		# All other rows
		else:
			col = cell[0]
			row = cell[1]
			if col in colmap:
				col_name = colmap[col]
			else:
				raise IOError("Column " + col + " not found in doc_id " + str(doc_id))

			# If the column specifies an attribute name, use it, otherwise use the element's name again
			if "@" in col_name:
				element, attrib = col_name.split("@",1)
			else:
				element = col_name
				attrib = element

			# Check whether attrib contains a constant value instruction
			const_val = ""
			if "=" in attrib:
				attrib, const_val = attrib.split("=",1)

			# Check to see if the cell has been merged with other cells
			if 'rowspan' in cell[2]:
				rowspan = int(cell[2]['rowspan'])
			else:
				rowspan = 1

			# Check for flexible element, e.g. m|w@x means 'prefer to attach x to m, else to w'
			if "|" in element:
				element, sec_element = element.split("|",1)
			else:
				sec_element = ""

			# Move on to next cell if this is not a desired column
			if element not in config.priorities or (element.startswith("ignore:") and config.no_ignore):  # Guaranteed to be in priorities if it should be included
				continue

			# New row starting from this cell, sort previous lists for opening and closing orders
			if row != last_row:
				for element in open_tags[last_row]:
					open_tag_order[last_row].append(element)

				open_tag_order[last_row].sort(key=lambda x: (-open_tag_length[x],config.priorities.index(x)))

				for sec_tuple in sec_element_checklist:
					prim_found = False
					prim_elt, sec_elt, attr, val, span = sec_tuple
					if prim_elt in open_tags[last_row] and prim_elt in open_tag_length:
						if span == open_tag_length[prim_elt]:
							open_tags[last_row][prim_elt].append((attr, val))
							close_tags[last_row + span].append(prim_elt)
							prim_found = True
					if not prim_found:
						if sec_elt in open_tags[last_row] and sec_elt in open_tag_length:
							if span == open_tag_length[sec_elt]:
								open_tags[last_row][sec_elt].append((attr, val))
								close_tags[last_row + span].append(sec_elt)
				sec_element_checklist = []  # Purge sec_elements

				close_tags[row].sort(key=lambda x: (last_open_index[x],config.priorities.index(x)), reverse=True)

				last_row = row

			if const_val != "":
				content = const_val
			else:
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

				if attrib in config.tok_annos:
					# TT SGML token annotation, append to token with tab separator and move on
					if "<" in content or "&" in content or ">" in content:
						content = escape(content)
					toks[row] += "\t" + content
					continue

				if element not in config.priorities and len(config.priorities) > 0:
					# Priorities have been supplied, but this column is not in them
					continue

				# content may not contain straight double quotes in span annotations in SGML export
				# Note that " is allowed in tokens and in tab-delimited token annotations!
				content = content.replace('"', "&quot;")

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

				# this introduces too many close tags for elts that have more than one attr.
				# We take care of this later with close_tag_debt
				close_tags[close_row].append(element)
				open_tag_length[element] = int(close_row) - int(last_open_index[element])


	# Sort last row tags
	if row + 1 in close_tags:
		close_tags[row+1].sort(key=lambda x: (last_open_index[x],config.priorities.index(x)), reverse=True)
	for element in open_tags[last_row]:
		open_tag_order[last_row].append(element)
	open_tag_order[last_row].sort(key=lambda x: (-open_tag_length[x],config.priorities.index(x)))

	#output = build_meta_tag(doc_id)
	template = fill_meta_template(doc_id,config.template)
	output = ""
	close_tag_debt = defaultdict(int)

	for r in xrange(2, sorted(close_tags.keys())[-1] + 1):
		for element in close_tags[r]:
			if element != "" and element not in config.milestones:
				if close_tag_debt[element] > 0:
					close_tag_debt[element] -= 1
				else:
					output += '</' + element + '>\n'

		for element in open_tag_order[r]:
			tag = '<' + element
			attr_count = 0
			for attrib, value in open_tags[r][element]:
				if attrib != "":
					tag += ' ' + attrib + '="' + value + '"'
					attr_count += 1
			close_tag_debt[element] = len(open_tags[r][element]) - 1

			if element in config.milestones:
				tag += '/>\n'
			else:
				tag += '>\n'
			output += tag

		if r not in toks:
			toks[r] = ""  # Caution - empty token!
		output += toks[r] + '\n'

	output = output.replace('\\c', ':')
	#output += "</meta>\n"
	if "%%body%%" in template:
		output = template.replace("%%body%%",output.strip())

	output = re.sub("%%[^%]+%%", "none", output)

	# fix tags that look like elt__2__ if it still gives correct sgml
	output = deunique_properly_nested_tags(output)

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
	# Hard-wired fixes for Scriptorium layer names that should be collapsed if they appear
	# TODO: make this configurable somewhere
	socialcalc = re.sub(r'(:[A-Z]1:t:)norm_group_((orig_group):)',r'\1\2',socialcalc)
	socialcalc = re.sub(r'(:[A-Z]1:t:)norm_((orig|pos|lemma|lang):)', r'\1\2', socialcalc)
	socialcalc = re.sub(r'(:[A-Z]1:t:)morph_((orig|pos|lemma|lang):)', r'\1\2', socialcalc)
	socialcalc = re.sub(r'(:[A-Z]1:t:)norm_xml\\c((orig|pos|lemma|lang):)', r'\1\2', socialcalc)
	socialcalc = re.sub(r'(:[A-Z]1:t:)morph_xml\\c((orig|pos|lemma|lang):)', r'\1\2', socialcalc)
	return socialcalc


def postprocess_sgml(sgml,instructions=None):
	"""Function to clean up NLP output"""
	if instructions is None:
		return sgml
	else:
		remove = set([])
		rename = {}
		for instruction in instructions:
			parts = instruction.split("/")
			if len(parts) ==3:
				subj, pred, obj = parts
			elif len(parts) ==2:
				subj, pred = parts
			else:
				subj, pred, obj = None, None, None
			if pred == "remove":
				remove.add(subj)
			elif pred == "rename":
				rename[subj] = obj
		removes = "|".join(list(remove))
		sgml = re.sub(r'</?'+removes+'(>| [^<>\n]*>)\n','',sgml,re.DOTALL|re.MULTILINE)
		for f in rename:
			r = rename[f]
			# Run twice to catch both element and attribute name
			sgml = re.sub(r'(<[^<>\n]*)'+f+r'([^<>\n]*>)',r'\1'+r+r'\2',sgml)
			sgml = re.sub(r'(<[^<>\n]*)'+f+r'([^<>\n]*>)',r'\1'+r+r'\2',sgml)
		return sgml


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
	try:
		r = requests.delete(ether_url + "_/" + name)
	except:
		pass


def sheet_exists(ether_path, name):
	return len(get_socialcalc(ether_path,name)) > 0


def get_socialcalc(ether_path, name):
	"""
	Get SocialCalc format serialization for an EtherCalc spreadsheet
	DB is available for a specified doc_id

	:param ether_path: The EtherCalc server base URL, e.g. http://server.com/ethercalc/
	:param name: spreadsheet name, e.g. gd_corpname_docname
	:return: SocialCalc string
	"""
	command = "curl --netrc -X GET " + ether_path + "_/" + name
	proc = subprocess.Popen(command, stdout=subprocess.PIPE, stdin=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
	(stdout, stderr) = proc.communicate()
	socialcalc = stdout.decode("utf8")
	# Destroy empty span cells without content, typically nested underneath longer, filled spans
	socialcalc = re.sub(r'cell:[A-Z]+[0-9]+:f:1:rowspan:[0-9]+\n','',socialcalc)

	return socialcalc


def get_timestamps(ether_path):
	r = requests.get(ether_path + "_roomtimes")
	times = r.json()
	output = {}
	for room in times:
		output[room.replace("timestamp-", "")] = times[room]
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
