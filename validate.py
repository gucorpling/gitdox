#!/usr/bin/python
# -*- coding: utf-8 -*-

from collections import defaultdict
import re, sys
import cgi, cgitb
import json

from paths import ether_url
from modules.gitdox_sql import *
from modules.ether import get_socialcalc, make_spreadsheet, exec_via_temp, get_timestamps, parse_ether
from modules.validation.legacy_xml_validator import LegacyXmlValidator
from modules.validation.xml_validator import XmlValidator
from modules.validation.meta_validator import MetaValidator
from modules.validation.ether_validator import EtherValidator
from modules.validation.export_validator import ExportValidator


def highlight_cells(cells, ether_url, ether_doc_name, doc_id=None, dirty=True):
	old_ether = get_socialcalc(ether_url, ether_doc_name, doc_id=doc_id, dirty=dirty)
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

		parsed_cell = re.match(r'cell:([A-Z]+)(\d+)(:.*)$', line)
		if parsed_cell is not None:
			col = parsed_cell.group(1)
			row = parsed_cell.group(2)
			col_row = col + row
			other = parsed_cell.group(3)
			bg = re.search(r':bg:(\d+)($|:)', other)
			if bg is not None:
				bg = bg.group(1)
			span = parts[-1] if "rowspan:" in line else "1"

			spanned_rows = [col + str(int(row) + x) for x in range(int(span))]
			highlighted_spanned_rows = [x for x in spanned_rows if x in cells]
			if len(highlighted_spanned_rows) > 0:
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
	report = {"report":"","tooltip":""}
	rules = [MetaValidator(x) for x in get_meta_rules()]

	meta = get_doc_meta(doc_id)
	doc_info = get_doc_info(doc_id)
	doc_name = doc_info[0]
	doc_corpus = doc_info[1]
	meta_rule_fired = False
	for rule in rules:
		res, fired = rule.validate(meta, doc_name, doc_corpus)
		meta_rule_fired = meta_rule_fired or fired
		if editor and len(res['tooltip']) > 0:
			report["tooltip"] += ("""<div class="tooltip">"""
					+ res['report'][:-5]
					+ """ <i class="fa fa-ellipsis-h"></i>"""
					+ "<span>" + res['tooltip'] + "</span>"
					+ "</div>")
		else:
			report["report"] += res['report']

	if not meta_rule_fired:
		report["report"] = "<strong>No applicable metadata rules<br></strong>"
	elif len(report["report"]) == 0:
		report["report"] = "<strong>Metadata is valid<br></strong>"
	else:
		report["report"] = "<strong>Metadata Problems:</strong><br>" + report["report"]

	return report

#@profile
def validate_doc_ether(doc_id, editor=False, dirty=True):
	"""
	Validate a document in spreadsheet mode

	:param doc_id: doc ID in the sqlite DB docs table
	:param editor: boolean - is this being run by user from editor.py?
	:param dirty: boolean - if spreadsheet already cached, has its SocialCalc changed since last recorded timestamp?
	:return: dictionary with validation report
	"""
	ether_rules = [EtherValidator(x) for x in get_ether_rules()]
	export_rules = [ExportValidator(x) for x in get_export_rules()]

	doc_info = get_doc_info(doc_id)
	doc_name = doc_info[0]
	doc_corpus = doc_info[1]

	ether_doc_name = "gd_" + doc_corpus + "_" + doc_name
	socialcalc = get_socialcalc(ether_url, ether_doc_name, doc_id=doc_id, dirty=dirty)
	parsed_ether = parse_ether(socialcalc,doc_id=doc_id)

	report = ''
	cells = []

	# check metadata
	meta_validation = validate_doc_meta(doc_id, editor)

	ether_rule_fired = False
	for rule in ether_rules:
		res, fired = rule.validate(parsed_ether, doc_name, doc_corpus)
		ether_rule_fired = ether_rule_fired or fired
		if editor and len(res['tooltip']) > 0:
			report += ("""<div class="tooltip">"""
					+ res['report'][:-5]
					+ """ <i class="fa fa-ellipsis-h"></i>"""
					+ "<span>" + res['tooltip'] + "</span>"
					+ "</div>")
		else:
			report += res['report']
		cells += res['cells']
	if not ether_rule_fired:
		report = "<strong>No applicable spreadsheet validation rules<br></strong>"
	elif report:
		report = "<strong>Spreadsheet Problems:</strong><br>" + report
	else:
		report = "<strong>Spreadsheet is valid</strong><br>"

	export_report = ""
	export_rule_fired = False
	for rule in export_rules:
		res, fired = rule.validate(socialcalc, doc_id, doc_name, doc_corpus)
		export_rule_fired = export_rule_fired or fired
		export_report += res
	if not export_rule_fired:
		export_report = "<strong>No applicable export validation rules<br></strong>"
	elif export_report:
		export_report = "<strong>Export Problems:</strong><br>" + export_report
	else:
		export_report = "<strong>Export is valid</strong><br>"

	if editor:
		highlight_cells(cells, ether_url, ether_doc_name, doc_id=doc_id, dirty=dirty)
		full_report = report + meta_validation["report"] + export_report
		if len(full_report) == 0:
			full_report = "Document is valid!"
		return full_report
	else:
		json_report = {}
		json_report['ether'] = report
		json_report['meta'] = meta_validation["report"]
		json_report['export'] = export_report
		return json_report

#@profile
def validate_doc_xml(doc_id, schema, editor=False):
	rules = [XmlValidator(x) for x in get_xml_rules()]

	doc_info = get_doc_info(doc_id)
	doc_name = doc_info[0]
	doc_corpus = doc_info[1]
	doc_content = get_doc_content(doc_id)

	# Schemas used to be assigned per document--do not support this anymore
	#xml_report = LegacyXmlValidator(schema).validate(doc_content)

	xml_report = ""
	xml_rule_fired = False
	for rule in rules:
		res, fired = rule.validate(doc_content, doc_name, doc_corpus)
		xml_report += res
		xml_rule_fired = xml_rule_fired or fired
	if not xml_rule_fired:
		xml_report = "<strong>No applicable XML schemas<br></strong>"
	elif xml_report:
		xml_report = "<strong>XML problems:</strong><br>" + xml_report
	else:
		xml_report = "<strong>XML is valid</strong><br>"

	meta_validation = validate_doc_meta(doc_id, editor)
	meta_report = meta_validation["report"]

	# report
	if editor is True:
		try:
			#full_report = xml_report.decode("utf8") + meta_report.decode("utf8")
			full_report = xml_report + meta_report
		except Exception as e:
			full_report = "[Encoding error: " + str(e) + "]"

		return full_report
	else:
		json_report = {}

		json_report['xml'] = xml_report
		json_report['meta'] = meta_report
		return json_report

#@profile
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
					reports[doc_id] = validate_doc_ether(doc_id, dirty=True)
					update_validation(doc_id, json.dumps(reports[doc_id]))
					update_timestamp(doc_id, doc_timestamps[ether_name])
			else:
				if ether_name in doc_timestamps:
					new_time = doc_timestamps[ether_name]
				else:
					new_time = None
				if new_time == timestamp:
					reports[doc_id] = validate_doc_ether(doc_id, dirty=False)
				else:
					reports[doc_id] = validate_doc_ether(doc_id, dirty=True)
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

	mode = ""
	schema = ""
	if len(sys.argv) > 1:
		from argparse import ArgumentParser
		p = ArgumentParser()
		p.add_argument("-d","--doc",help="doc ID in gitdox.db or 'all'", default="all")
		p.add_argument("-i","--invalidate",action="store_true",help="invalidate all documents before running validation")

		opts = p.parse_args()
		doc_id = opts.doc
		if opts.invalidate:
			invalidate_doc_by_name("%","%")
		if doc_id != "all":
			_, _, _, _, _, mode, schema = get_doc_info(doc_id)
	else:
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
