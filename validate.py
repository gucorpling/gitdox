#!/usr/bin/python
# -*- coding: utf-8 -*-

from collections import defaultdict
import re
import cgi
import json

from paths import ether_url
from modules.gitdox_sql import *
from modules.ether import get_socialcalc, make_spreadsheet, exec_via_temp, get_timestamps, parse_ether
from modules.validation.xml_validator import XmlValidator
from modules.validation.meta_validator import MetaValidator
from modules.validation.ether_validator import EtherValidator

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

def validate_doc_meta(doc_id, editor):
	# metadata validation
	report = ''
	rules = [MetaValidator(x) for x in get_meta_rules()]

	meta = get_doc_meta(doc_id)
	doc_info = get_doc_info(doc_id)
	doc_name = doc_info[0]
	doc_corpus = doc_info[1]
	for rule in rules:
		res = rule.validate(meta, doc_name, doc_corpus)
		if editor and len(res['tooltip']) > 0:
			report += ("""<div class="tooltip">"""
					+ res['report'][:-5]
					+ """ <i class="fa fa-ellipsis-h"></i>"""
					+ "<span>" + res['tooltip'] + "</span>"
					+ "</div>")
		else:
			report += res['report']
	return report

def validate_doc_ether(doc_id, editor=False):
	rules = [EtherValidator(x) for x in get_ether_rules()]

	doc_info = get_doc_info(doc_id)
	doc_name = doc_info[0]
	doc_corpus = doc_info[1]

	ether_doc_name = "gd_" + doc_corpus + "_" + doc_name
	parsed_ether = parse_ether(get_socialcalc(ether_url, ether_doc_name))

	report = ''
	cells = []

	# check metadata
	meta_report = validate_doc_meta(doc_id, editor)

	# check ethercalc rules
	for rule in rules:
		res = rule.validate(parsed_ether, doc_name, doc_corpus)
		if editor and len(res['tooltip']) > 0:
			report += ("""<div class="tooltip">"""
					+ res['report'][:-5]
					+ """ <i class="fa fa-ellipsis-h"></i>"""
					+ "<span>" + res['tooltip'] + "</span>"
					+ "</div>")
		else:
			report += res['report']
		cells += res['cells']

	if editor:
		highlight_cells(cells, ether_url, ether_doc_name)
		full_report = report + meta_report
		if len(full_report) == 0:
			full_report = "Document is valid!"
		return full_report
	else:
		json_report = {}
		if len(report) == 0:
			report = "spreadsheet is valid"
		if len(meta_report) == 0:
			meta_report = "metadata is valid"
		json_report['ether'] = report
		json_report['meta'] = meta_report
		return json_report

def validate_doc_xml(doc_id, schema, editor=False):
	xml_report = ""

	doc_content = get_doc_content(doc_id)
	xml_report = XmlValidator(schema).validate(doc_content)
	meta_report = validate_doc_meta(doc_id, editor)

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
			xml_report = "xml is valid"
		if len(meta_report) == 0:
			meta_report = "metadata is valid"
		json_report['xml'] = xml_report
		json_report['meta'] = meta_report
		return json_report

def validate_all_docs():
	docs = generic_query("SELECT id, name, corpus, mode, schema, validation, timestamp FROM docs", None)
	doc_timestamps = get_timestamps(ether_url)
	reports = {}

	for doc in docs:
		doc_id, doc_name, corpus, doc_mode, doc_schema, validation, timestamp = doc
		if doc_mode == "ether":
			ether_name = "_".join(["gd", corpus, doc_name])
			if ether_name in doc_timestamps and validation is not None and len(validation) > 0:
				if timestamp == doc_timestamps[ether_name]:
					reports[doc_id] = json.loads(validation)
				else:
					reports[doc_id] = validate_doc_ether(doc_id)
					update_validation(doc_id, json.dumps(reports[doc_id]))
					update_timestamp(doc_id, doc_timestamps[ether_name])
			else:
				reports[doc_id] = validate_doc_ether(doc_id)
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

if __name__ == "__main__":
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
			print validate_doc_ether(doc_id, editor=True).encode("utf8")
		elif mode == "xml":
			print validate_doc_xml(doc_id, schema, editor=True).encode("utf8")
