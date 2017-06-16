#!/usr/bin/python
# -*- coding: UTF-8 -*-

from gitdox_sql import *
from ether import get_socialcalc, make_spreadsheet
import re
import cgi
import json


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
	docs = generic_query("SELECT id FROM docs", None)
	reports = {}

	for doc in docs:
		doc_id = doc[0]
		reports[doc_id] = validate_doc(doc_id)

	return json.dumps(reports)


def validate_doc(doc_id, highlight=False):
	doc_info = get_doc_info(doc_id)
	doc_name = doc_info[0]
	doc_corpus = doc_info[1]

	ether_doc_name = "gd_" + doc_corpus + "_" + doc_name
	ether = get_socialcalc(ether_url, ether_doc_name)
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
			if re.match(rule_corpus, doc_corpus) is None:
				rule_applies = False
		if rule_doc is not None:
			if re.match(rule_doc, doc_name) is None:
				rule_applies = False

		if rule_applies is True:
			rule_report, rule_extra, rule_cells = apply_rule(doc_id, rule, ether, meta)
			cells += rule_cells
			if highlight is True and len(rule_extra) > 0:  # highlight is True iff it was called from editor page
				new_report = """<div class="tooltip">""" + rule_report[:-5] + """ <i class="fa fa-ellipsis-h"> </i>""" + "<span>" + rule_extra + "</span>" + "</div>"
			else:
				new_report = rule_report

			if rule_domain == "ether":
				ether_report += new_report
			elif rule_domain == "meta":
				meta_report += new_report

	if highlight == True:
		highlight_cells(cells, ether_url, ether_doc_name)

	if highlight is True:  # editor page
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


def apply_rule(doc_id, rule, ether, meta):
	doc_info = get_doc_info(doc_id)
	doc_name = doc_info[0]
	doc_corpus = doc_info[1]

	domain = rule[2]
	name = rule[3]
	operator = rule[4]
	argument = rule[5]

	report = ''
	extra = ''
	cells = []

	if domain == "ether":
		ether_lines = ether.splitlines()

		if operator in ["~", "|", "exists"]:

			# find col letter corresponding to col name
			col_letter = None
			for line in ether_lines:
				if re.search(r'[A-Z]+1:t:' + name + r'(:|$)', line) is not None:
					parsed_cell = re.match(r'cell:([A-Z]+)(\d+)(:.*)$', line)
					col_letter = parsed_cell.group(1)
					break
			if col_letter is None:
				report += "Column named " + name + " not found<br/>"
				return report, extra, cells

			for line in ether_lines:
				parsed_cell = re.match(r'cell:([A-Z]+)(\d+)(:.*)$', line)
				if parsed_cell is not None:
					col = parsed_cell.group(1)
					row = parsed_cell.group(2)
					other = parsed_cell.group(3)

					if col == col_letter and row != "1":
						if operator == "|":  # rowspan
							if argument == '1':
								if ':rowspan:' in other:
									report += "Cell " + col + row + ": row span is not 1<br/>"
									cells.append(col + row)
							else:
								rowspan = re.search(r':rowspan:' + str(argument) + r'\b', other)
								if rowspan is None:
									report += "Cell " + col + row + ": row span is not " + argument + "<br/>"
									cells.append(col + row)

						elif operator == "~":  # regex
							cell_content = re.search(r':t:([^:]*)(:|$)', other)
							if cell_content is not None:
								cell_content = cell_content.group(1)
								match = re.match(argument, cell_content)
								if match is None:
									report += "Cell " + col + row + ": content does not match pattern <br/>"
									extra += "Cell " + col + row + ":<br/>" + "Content: " + cell_content + "<br/>" + "Pattern: " + argument + "<br/>"
									cells.append(col + row)

		elif operator in ["=", ">"]:  # care about two cols: name and argument

			# find col letters corresponding to col names
			name_letter = None
			arg_letter = None
			for line in ether_lines:
				if re.search(r'[A-Z]+1:t:' + name + r'(:|$)', line) is not None:
					parsed_cell = re.match(r'cell:([A-Z]+)(\d+)(:.*)$', line)
					name_letter = parsed_cell.group(1)
				elif re.search(r'[A-Z]+1:t:' + argument + r'(:|$)', line) is not None:
					parsed_cell = re.match(r'cell:([A-Z]+)(\d+)(:.*)$', line)
					arg_letter = parsed_cell.group(1)
			if name_letter is None:
				report += "Column named " + name + " not found<br/>"
				return report, extra, cells
			if arg_letter is None:
				report += "Column named " + argument + " not found<br/>"
				return report, extra, cells

			name_boundaries = []
			arg_boundaries = []

			# find boundary rows
			for line in ether_lines:
				parsed_cell = re.match(r'cell:([A-Z]+)(\d+)(:.*)$', line)
				if parsed_cell is not None:
					col = parsed_cell.group(1)
					row = parsed_cell.group(2)

					if col == name_letter:
						name_boundaries.append(row)
					elif col == arg_letter:
						arg_boundaries.append(row)

			for boundary in name_boundaries:
				if boundary not in arg_boundaries:
					report += "Span break on line " + boundary + " in column " + name + " but not " \
							  + argument + "<br/>"
					cells.append(name_letter + boundary)
			if operator == "=":
				for boundary in arg_boundaries:
					if boundary not in name_boundaries:
						report += "Span break on line " + boundary + " in column " + argument + " but not " \
								  + name + "<br/>"
						cells.append(arg_letter + boundary)

	elif domain == "meta":
		# meta = get_doc_meta(doc_id)
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

	return report, extra, cells


if __name__ == "__main__":
	if __name__ == '__main__' and __package__ is None:
		from os import sys, path

		sys.path.append(path.dirname(path.dirname(path.abspath(__file__))))
		from paths import ether_url
	else:
		from ..paths import ether_url

	parameter = cgi.FieldStorage()
	doc_id = parameter.getvalue("doc_id")

	if doc_id == "all":
		print "Content-type:application/json\n\n"
		print validate_all_docs()
	else:
		print "Content-type:text/html\n\n"
		print validate_doc(doc_id, highlight=True)
