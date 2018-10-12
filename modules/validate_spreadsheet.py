#!/usr/bin/python
# -*- coding: utf-8 -*-

from gitdox_sql import *
from ether import get_socialcalc, make_spreadsheet, exec_via_temp, get_timestamps
from collections import defaultdict
import re
import cgi
import json
from pprint import pformat

class Cell:
	def __init__(self, col, row, content, span):
		self.col = col
		self.row = row
		self.header = ""
		self.content = content
		self.span = span

	def __repr__(self):
		return "<Cell (" + repr((self.col, self.row, self.header, self.content, self.span)) + ")>"


def highlight_cells(cells, ether_url, ether_doc_name):
	old_ether = get_socialcalc(ether_url, ether_doc_name)
	old_ether_lines = old_ether.splitlines()
	new_ether_lines = []

	old_color_numbers = []
	new_color_number = '1'
	for line in old_ether_lines:
		color_line = re.match(r'color:(\d+):(rgb.*$)', line)
		if color_line is not None:
			if color_line.group(2) == 'rgb(242, 242, 142)':
				old_color_numbers.append(color_line.group(1))
			else:
				new_color_number = str(1 + int(color_line.group(1)))
	if len(old_color_numbers) > 0:
		new_color_number = old_color_numbers[0]

	for line in old_ether_lines:

		parts = line.split(":")
		# Check for pure formatting cells, e.g. cell:K15:f:1
		if len(parts) == 4:
			if parts[2] == "f":  # Pure formatting cell, no content
				continue

		parsed_cell = re.match(r'cell:([A-Z]+\d+)(:.*)$', line)
		if parsed_cell is not None:
			col_row = parsed_cell.group(1)
			other = parsed_cell.group(2)
			bg = re.search(r':bg:(\d+)($|:)', other)
			if bg is not None:
				bg = bg.group(1)

			if col_row in cells:
				if bg is not None:
					if bg != new_color_number:
						new_line = re.sub(r':bg:' + bg, r':bg:' + new_color_number, line)
					else:
						new_line = line
				else:
					new_line = line + ':bg:' + new_color_number
			else:
				if bg is not None:
					if bg in old_color_numbers:
						new_line = re.sub(r':bg:' + bg, r'', line)
					else:
						new_line = line
				else:
					new_line = line
			new_ether_lines.append(new_line)
		elif re.match(r'sheet:', line) is not None:
			new_ether_lines.append(line)
			if new_color_number not in old_color_numbers:
				new_ether_lines.append('color:' + new_color_number + ':rgb(242, 242, 142)')
		else:
			new_ether_lines.append(line)

	new_ether = '\n'.join(new_ether_lines)
	make_spreadsheet(new_ether, ether_url + "_/" + ether_doc_name, "socialcalc")


def validate_all_docs():
	docs = generic_query("SELECT id, name, corpus, mode, schema, validation, timestamp FROM docs", None)
	doc_timestamps = get_timestamps(ether_url)
	reports = {}

	for doc in docs:
		doc_id, doc_name, corpus, doc_mode, doc_schema, validation, timestamp = doc
		if doc_mode == "ether":
			ether_name = "_".join(["gd",corpus,doc_name])
			if ether_name in doc_timestamps and validation is not None and len(validation) > 0:
				if timestamp == doc_timestamps[ether_name]:
					reports[doc_id] = json.loads(validation)
				else:
					reports[doc_id] = validate_doc(doc_id)
					update_validation(doc_id, json.dumps(reports[doc_id]))
					update_timestamp(doc_id, doc_timestamps[ether_name])
			else:
				reports[doc_id] = validate_doc(doc_id)
				#reports[doc_id] = {"ether":"sample_ether","meta":"sample_meta"}
				update_validation(doc_id, json.dumps(reports[doc_id]))
				if ether_name in doc_timestamps:
					update_timestamp(doc_id, doc_timestamps[ether_name])
		elif doc_mode == "xml":
			if validation is None:
				reports[doc_id] = validate_doc_xml(doc_id, doc_schema)
				try:
					validation_report = json.dumps(reports[doc_id])
				except UnicodeDecodeError:
					reports[doc_id]["xml"] = "UnicodeDecodeError; unable to print XML validation report for " + doc_name
					validation_report = json.dumps(reports[doc_id])
				update_validation(doc_id,validation_report)
			else:
				reports[doc_id] = json.loads(validation)

	return json.dumps(reports)


def validate_doc(doc_id, editor=False):
	doc_info = get_doc_info(doc_id)
	doc_name = doc_info[0]
	doc_corpus = doc_info[1]

	ether_doc_name = "gd_" + doc_corpus + "_" + doc_name
	ether = get_socialcalc(ether_url, ether_doc_name)
	parsed_ether = parse_ether(ether, doc_name, doc_corpus)
	meta = get_doc_meta(doc_id)

	ether_report = ''
	meta_report = ''
	cells = []

	rules = get_validate_rules()
	for rule in rules:
		rule_applies = True
		rule_corpus = rule[0]
		rule_doc = rule[1]
		rule_domain = rule[2]
		if rule_corpus is not None:
			if re.search(rule_corpus, doc_corpus) is None:
				rule_applies = False
		if rule_doc is not None:
			if re.search(rule_doc, doc_name) is None:
				rule_applies = False

		if rule_applies:
			rule_report, rule_extra, rule_cells = apply_rule(rule, parsed_ether, meta)
			cells += rule_cells
			if editor is True and len(rule_extra) > 0:
				new_report = """<div class="tooltip">""" + rule_report[:-5] + """ <i class="fa fa-ellipsis-h"> </i>""" + "<span>" + rule_extra + "</span>" + "</div>"
			else:
				new_report = rule_report

			if rule_domain == "ether":
				ether_report += new_report
			elif rule_domain == "meta":
				meta_report += new_report

	if editor:
		highlight_cells(cells, ether_url, ether_doc_name)

	if editor:
		full_report = ether_report + meta_report
		if len(full_report) == 0:
			full_report = "Document is valid!"
		return full_report
	else:
		json_report = {}
		if len(ether_report) == 0:
			ether_report = "spreadsheet is valid"
		if len(meta_report) == 0:
			meta_report = "metadata is valid"
		json_report['ether'] = ether_report
		json_report['meta'] = meta_report
		return json_report


def parse_ether(ether, doc, corpus):
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
				#for c in cell_id:
				#	if c in ["0","1","2","3","4","5","6","7","8","9"]:
				#		cell_row += c
				#	else:
				#		cell_col += c
				cell_content = parts[3].replace("\\c",":")
				cell_span = parts[-1] if "rowspan:" in line else "1"

				# record col name
				if cell_row == "1":
					colmap[cell_content].append(cell_col)
					rev_colmap[cell_col] = cell_content

				cell = Cell(cell_col, cell_row, cell_content, cell_span)
				parsed[cell_col].append(cell)
				all_cells.append(cell)

	for cell in all_cells:
		cell.header = rev_colmap[cell.col]

	parsed["__colmap__"] = colmap  # Save colmap for apply_rule
	return parsed


def apply_rule(rule, parsed_ether, meta):
	domain = rule[2]
	name = rule[3]
	operator = rule[4]
	argument = rule[5]

	report = ''
	extra = ''
	cells = []

	colmap = parsed_ether['__colmap__'] # name -> list of col letters

	if name is None:
		return report, extra, cells

	# list of letters with col name
	col_letters = colmap[name]

	if domain == "ether":
		# check to see if column exists
		if operator == "exists":
			if len(col_letters) == 0:
				report += "Column named " + name + " not found<br/>"
				return report, extra, cells

		# check to see that all cells are of a certain row span
		elif operator == "|":
			# do any exist?
			if len(col_letters) == 0:
				report += "Column named " + name + " not found<br/>"
				return report, extra, cells

			for letter in col_letters:
				for cell in parsed_ether[letter]:
					if cell.row == "1":
						continue

					if argument == "1":
						if cell.span != "1":
							report += "Cell " + cell.col + cell.row + ": row span is not 1<br/>"
							cells.append(cell.col + cell.row)
					else:
						if cell.span != "" and cell.span is not None:
							report += "Cell " + cell.col + cell.row + ": row span is not " + argument + "<br/>"
							cells.append(cell.col + cell.row)

		elif operator == "~":
			for letter in col_letters:
				for cell in parsed_ether[letter]:
					if cell.row == "1":
						continue
					match = re.search(argument, cell.content)
					if match is None:
						report += "Cell " + cell.col + cell.row + ": content does not match pattern <br/>"
						extra += "Cell " + cell.col + cell.row + ":<br/>" + "Content: " + cell.content + "<br/>" + "Pattern: " + argument + "<br/>"
						cells.append(cell.col + cell.row)

		elif operator in ["=", ">", "=="]:
			name_letters = colmap[name]
			arg_letters = colmap[argument]

			if len(name_letters) == 0:
				if operator != "==":
					report += "Column named " + name + " not found<br/>"
				return report, extra, cells
			if len(arg_letters) == 0:
				if operator != "==":
					report += "Column named " + argument + " not found<br/>"
				return report, extra, cells

			name_tuples = defaultdict(list)
			arg_tuples = defaultdict(list)
			start_rows = defaultdict(list)
			all_rows = []

			for letter in name_letters:
				for cell in parsed_ether[letter]:
					start_rows[letter].append(cell.row)
					# "de-merge" cell so we have an entry for every row in its span with its letter and content
					for i in range(int(cell.span) or 1):
						row = str(int(cell.row) + i)
						name_tuples[row].append((letter, cell.content))
						all_rows.append(row)

			# same as above with arg_letters
			for letter in arg_letters:
				for cell in parsed_ether[letter]:
					start_rows[letter].append(cell.row)
					for i in range(int(cell.span) or 1):
						row = str(int(cell.row) + i)
						arg_tuples[row].append((letter, cell.content))
						if row not in all_rows:
							all_rows.append(row)

			for row in all_rows:
				# check to see if all cells in rhs are contained within cells on lhs
				if operator == ">":
					if row in arg_tuples and row not in name_tuples:
						for letter, _ in arg_tuples[row]:
							cells.append(letter + row)
							report += ("Cell " + letter + row
									   + " must appear in the span of a cell in one of these columns: "
									   + ", ".join(name_letters) + "<br/>")

				# operator in ["=", "=="], i.e. span equivalence and span and content equivalence
				else:
					name_len = len(name_tuples[row])
					arg_len = len(arg_tuples[row])

					if name_len > arg_len:
						for letter, _ in name_tuples[row][arg_len:]:
							cells.append(letter + row)
							report += ("Cell " + letter + row
									   + " lacks a corresponding value in one of these columns: "
									   + ", ".join(arg_letters) + "<br/>")
					elif arg_len < name_len:
						for letter, _ in arg_tuples[row][name_len:]:
							cells.append(letter + row)
							report += ("Cell " + letter + row
									   + " lacks a corresponding value in one of these columns: "
									   + ", ".join(name_letters) + "<br/>")

					if operator == "==":
						for i in range(min(len(name_tuples[row]), len(arg_tuples[row]))):
							name_letter, name_content = name_tuples[row][i]
							arg_letter, arg_content = arg_tuples[row][i]

							if arg_content != name_content and (row in start_rows[arg_letter] or row in start_rows[name_letter]):
								cells.append(name_letter + row)
								cells.append(arg_letter + row)
								report += ("Cells " + name_letter + row
										   + " and " + arg_letter + row
										   + " must have equivalent content.<br/>")

	elif domain == "meta":
		meta_report, meta_extra = apply_meta_rule(rule, meta)
		report += meta_report
		extra += meta_extra

	return report, extra, cells


def apply_meta_rule(rule, meta):
	name = rule[3]
	operator = rule[4]
	argument = rule[5]
	report = ''
	extra = ''
	if operator == "~":
		for metadatum in meta:
			if metadatum[2] == name:
				value = metadatum[3]
				match = re.search(argument, value)
				if match is None:
					report += "Metadata for " + name + " does not match pattern" + "<br/>"
					extra += "Metadata: " + value + "<br/>" + "Pattern: " + argument + "<br/>"
	elif operator == "exists":
		exists = False
		for metadatum in meta:
			if metadatum[2] == name:
				exists = True
				break
		if exists is False:
			report += "No metadata for " + name + '<br/>'
	return report, extra


def validate_doc_xml(doc_id, schema, editor=False):
	xml_report = ''
	# xml validation
	if schema == "--none--":
		xml_report += "No schema<br/>"
	else:
		command = "xmllint --htmlout --schema " + "../schemas/" + schema + ".xsd" + " tempfilename"
		xml = generic_query("SELECT content FROM docs WHERE id=?", (doc_id,))[0][0]
		out, err = exec_via_temp(xml.encode("utf8"), command)
		err = err.strip()
		err = err.replace("<br>","").replace("\n","").replace('<h1 align="center">xmllint output</h1>',"")
		err = re.sub(r'/tmp/[A-Za-z0-9]+:','XML schema: <br>',err)
		err = re.sub(r'/tmp/[A-Za-z0-9]+','XML schema ',err)
		err = re.sub(r'\n','<br/>',err)
		xml_report += err + "<br/>"

	# metadata validation
	meta_report = ''
	meta_rules = generic_query("SELECT  corpus, doc, domain, name, operator, argument, id FROM validate WHERE domain = 'meta'", None)
	meta = get_doc_meta(doc_id)
	doc_info = get_doc_info(doc_id)
	doc_name = doc_info[0]
	doc_corpus = doc_info[1]
	for rule in meta_rules:
		rule_applies = True
		rule_corpus = rule[0]
		rule_doc = rule[1]
		if rule_corpus is not None:
			if re.search(rule_corpus, doc_corpus) is None:
				rule_applies = False
		if rule_doc is not None:
			if re.search(rule_doc, doc_name) is None:
				rule_applies = False
		if rule_applies is True:
			rule_report, rule_extra = apply_meta_rule(rule, meta)
			if editor and len(rule_extra) > 0:
				meta_report += """<div class="tooltip">""" + rule_report[
															 :-5] + """ <i class="fa fa-ellipsis-h"> </i>""" + "<span>" + rule_extra + "</span>" + "</div>"
			else:
				meta_report += rule_report

	# report
	if editor is True:
		try:
			#full_report = xml_report.decode("utf8") + meta_report.decode("utf8")
			full_report = xml_report + meta_report
		except Exception as e:
			full_report = "[Encoding error: " + str(e) + "]"
		if len(full_report) == 0:
			full_report = "Document is valid!"
		return full_report
	else:
		json_report = {}
		if len(xml_report) == 0:
			ether_report = "xml is valid"
		if len(meta_report) == 0:
			meta_report = "metadata is valid"
		json_report['xml'] = xml_report
		json_report['meta'] = meta_report
		return json_report


if __name__ == "__main__":
	if __name__ == '__main__' and __package__ is None:
		from os import sys, path

		sys.path.append(path.dirname(path.dirname(path.abspath(__file__))))
		from paths import ether_url
	else:
		from ..paths import ether_url

	parameter = cgi.FieldStorage()
	doc_id = parameter.getvalue("doc_id")
	mode = parameter.getvalue("mode")
	schema = parameter.getvalue("schema")

	if doc_id == "all":
		print "Content-type:application/json\n\n"
		print validate_all_docs().encode("utf8")
	else:
		print "Content-type:text/html\n\n"
		if mode == "ether":
			print validate_doc(doc_id, editor=True).encode("utf8")
		elif mode == "xml":
			print validate_doc_xml(doc_id, schema, editor=True).encode("utf8")
