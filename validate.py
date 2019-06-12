#!/usr/bin/python
# -*- coding: utf-8 -*-

from collections import defaultdict
import re, sys
import traceback
import cgi, cgitb
import json

from paths import ether_url
from modules.gitdox_sql import *
from modules.ether import get_socialcalc, make_spreadsheet, exec_via_temp, get_timestamps, parse_ether
from modules.validation.xml_validator import XmlValidator
from modules.validation.meta_validator import MetaValidator
from modules.validation.ether_validator import EtherValidator
from modules.validation.export_validator import ExportValidator
from modules.validation.bulk_export_validator import BulkExportValidator
import modules.redis_cache as cache


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


def validate_doc_xml(doc_id, rules):
	doc_info = get_doc_info(doc_id)
	doc_name = doc_info[0]
	doc_corpus = doc_info[1]
	doc_content = get_doc_content(doc_id)

	cache_hit = cache.get_report(doc_id, "xml")
	if cache_hit:
		return cache_hit

	report = ""
	xml_rule_fired = False
	for rule in rules:
		if not rule.applies(doc_name, doc_corpus):
			continue

		xml_rule_fired = True
		res = rule.validate(doc_content)
		report += res

	if not xml_rule_fired:
		report = "<strong>No applicable XML schemas</strong><br>"
	elif report:
		report = "<strong>XML problems:</strong><br>" + report
	else:
		report = "<strong>XML is valid</strong><br>"

	cache.cache_validation_result(doc_id, "xml", report)
	return report


def validate_doc_meta(doc_id, rules):
	# metadata validation
	report = ""

	meta = get_doc_meta(doc_id)
	doc_info = get_doc_info(doc_id)
	doc_name = doc_info[0]
	doc_corpus = doc_info[1]

	cache_hit = cache.get_report(doc_id, "meta")
	if cache_hit:
		return cache_hit

	meta_rule_fired = False
	for rule in rules:
		if not rule.applies(doc_name, doc_corpus):
			continue

		meta_rule_fired = True
		res = rule.validate(meta)
		if len(res['tooltip']) > 0:
			report += ("""<div class="tooltip">"""
					+ res['report'][:-5]
					+ """ <i class="fa fa-ellipsis-h"></i>"""
					+ "<span class=\"msg\">" + res['tooltip'] + "</span>"
					+ "</div>")
		else:
			report += res['report']

	if not meta_rule_fired:
		report = "<strong>No applicable metadata rules</strong><br>"
	elif len(report) == 0:
		report = "<strong>Metadata is valid<br></strong>"
	else:
		report = "<strong>Metadata Problems:</strong><br>" + report

	cache.cache_validation_result(doc_id, "meta", report)
	return report

def validate_doc_ether(doc_id, rules, timestamps=None, editor=False):
	doc_info = get_doc_info(doc_id)
	doc_name = doc_info[0]
	doc_corpus = doc_info[1]

	ether_doc_name = "gd_" + doc_corpus + "_" + doc_name
	if not timestamps:
		timestamps = get_timestamps(ether_url)
	last_edit = int(timestamps[ether_doc_name])
	if last_edit <= int(cache.get_timestamp(doc_id, "ether")):
		return cache.get_report(doc_id, "ether")

	socialcalc = get_socialcalc(ether_url, ether_doc_name)
	parsed_ether = parse_ether(socialcalc,doc_id=doc_id)

	report = ''
	cells = []

	ether_rule_fired = False
	for rule in rules:
		if not rule.applies(doc_name, doc_corpus):
			continue

		ether_rule_fired = True
		res = rule.validate(parsed_ether)
		if len(res['tooltip']) > 0:
			report += ("""<div class="tooltip">"""
					+ res['report'][:-5]
					+ """ <i class="fa fa-ellipsis-h"></i>"""
					+ "<span class=\"msg\">" + res['tooltip'] + "</span>"
					+ "</div>")
		else:
			report += res['report']
		cells += res['cells']

	if not ether_rule_fired:
		report = "<strong>No applicable spreadsheet validation rules</strong><br>"
	elif report:
		report = "<strong>Spreadsheet Problems:</strong><br>" + report
	else:
		report = "<strong>Spreadsheet is valid</strong><br>"

	cache.cache_timestamped_validation_result(doc_id, "ether", report, last_edit)

	if editor:
		highlight_cells(cells, ether_url, ether_doc_name)
	return report


def validate_doc_export(doc_id, rules, timestamps=None):
	doc_info = get_doc_info(doc_id)
	doc_name = doc_info[0]
	doc_corpus = doc_info[1]
	doc_content = get_doc_content(doc_id)

	ether_doc_name = "gd_" + doc_corpus + "_" + doc_name
	if not timestamps:
		timestamps = get_timestamps(ether_url)
	last_edit = int(timestamps[ether_doc_name])
	if last_edit <= int(cache.get_timestamp(doc_id, "export")):
		return cache.get_report(doc_id, "export")

	socialcalc = get_socialcalc(ether_url, ether_doc_name)

	report = ""
	export_rule_fired = False
	for rule in rules:
		if not rule.applies(doc_name, doc_corpus):
			continue

		export_rule_fired = True
		res = rule.validate(socialcalc, doc_id)
		report += res

	if not export_rule_fired:
		report = "<strong>No applicable export schemas</strong><br>"
	elif report:
		report = "<strong>Export problems:</strong><br>" + report
	else:
		report = "<strong>Export is valid</strong><br>"

	cache.cache_timestamped_validation_result(doc_id, "export", report, last_edit)

	return report


def validate_doc(doc_id):
	_, _, _, _, _, doc_mode, _ = get_doc_info(doc_id)
	report = ""

	# metadata
	meta_rules = [MetaValidator(x) for x in get_meta_rules()]
	report += validate_doc_meta(doc_id, meta_rules)

	# data
	if doc_mode == "xml":
		xml_rules = [XmlValidator(x) for x in get_xml_rules()]
		report += validate_doc_xml(doc_id, xml_rules)
	else:
		ether_rules = [EtherValidator(x) for x in get_ether_rules()]
		report += validate_doc_ether(doc_id, ether_rules, editor=True)
		export_rules = [ExportValidator(x) for x in get_export_rules()]
		report += validate_doc_export(doc_id, export_rules)

	return report

def validate_all_meta(docs):
	reports = {}
	rules = [MetaValidator(x) for x in get_meta_rules()]

	for doc in docs:
		doc_id, doc_name, corpus, doc_mode, doc_schema, validation, timestamp = doc
		reports[doc_id] = validate_doc_meta(doc_id, rules)

	return json.dumps(reports)

def validate_all_xml(docs):
	reports = {}
	rules = [XmlValidator(x) for x in get_xml_rules()]

	for doc in docs:
		doc_id, doc_name, corpus, doc_mode, doc_schema, validation, timestamp = doc
		if doc_mode != "xml":
			continue

		reports[doc_id] = validate_doc_xml(doc_id, rules)

	return json.dumps(reports)

def validate_all_ether(docs):
	reports = {}
	rules = [EtherValidator(x) for x in get_ether_rules()]
	timestamps = get_timestamps(ether_url)

	for doc in docs:
		doc_id, doc_name, corpus, doc_mode, doc_schema, validation, timestamp = doc
		if doc_mode != "ether":
			continue

		reports[doc_id] = validate_doc_ether(doc_id, rules, timestamps=timestamps)

	return json.dumps(reports)

def validate_all_export(docs):
	reports = {}
	rules = [ExportValidator(x) for x in get_export_rules()]
	timestamps = get_timestamps(ether_url)

	for doc in docs:
		doc_id, doc_name, corpus, doc_mode, doc_schema, validation, timestamp = doc
		if doc_mode != "ether":
			continue

		reports[doc_id] = validate_doc_export(doc_id, rules, timestamps=timestamps)

	return json.dumps(reports)

def validate_all_export_bulk(docs):
	cached_reports = {}
	reports = []
	rules = [BulkExportValidator(x) for x in get_export_rules()]
	timestamps = get_timestamps(ether_url)

	doc_ids = []
	for doc in docs:
		doc_id, doc_name, doc_corpus, doc_mode, doc_schema, validation, timestamp = doc
		if doc_mode != "ether":
			continue

		ether_doc_name = "gd_" + doc_corpus + "_" + doc_name
		last_edit = int(timestamps[ether_doc_name])
		if last_edit <= int(cache.get_timestamp(doc_id, "export")):
			cached_reports[doc_id] = cache.get_report(doc_id, "export")
			continue

		doc_ids.append(doc_id)

	for rule in rules:
		report, fired = rule.validate(doc_ids)
		if fired:
			reports.append(report)

	def merge_dicts(dictlist):
		keys = apply(set().union, dictlist)
		ret_dict = {}
		for k in keys:
			for d in dictlist:
				ret_dict[k] = "".join(d.get(k,''))
		#return {k: "".join(d.get(k, '') for d in dictlist) for k in keys}
		return ret_dict

	reports = merge_dicts([cached_reports] + reports)
	for doc_id in doc_ids:
		if doc_id not in reports:
			reports[doc_id] = "No applicable export schemas"

	for doc_id, report in reports.items():
		if doc_id in cached_reports:
			continue
		doc_name, doc_corpus, _, _, _, _, _ = get_doc_info(doc_id)
		ether_doc_name = "gd_" + doc_corpus + "_" + doc_name
		last_edit = int(timestamps[ether_doc_name])
		cache.cache_timestamped_validation_result(doc_id, "export", report, last_edit)
	return json.dumps(reports)


#@profile
def validate_all_docs(validation_type):
	docs = generic_query("SELECT id, name, corpus, mode, schema, validation, timestamp FROM docs", None)
	if validation_type == "meta":
		return validate_all_meta(docs)
	elif validation_type == "xml":
		return validate_all_xml(docs)
	elif validation_type == "ether":
		return validate_all_ether(docs)
	elif validation_type == "export":
		# Faster, but not correct at the moment because of xmllint output oddities
		# E.g.: when only one doc is supplied, output does not appear to contain the
		# "<docname> fails to validate" text
		#return validate_all_export_bulk(docs)
		return validate_all_export(docs)
	else:
		raise Exception("Unknown validation type: " + validation_type)

if __name__ == "__main__":
	mode = ""
	schema = ""
	if len(sys.argv) > 1:
		from argparse import ArgumentParser
		p = ArgumentParser()
		p.add_argument("-d","--doc",help="doc ID in gitdox.db or 'all'", default="all")
		p.add_argument("-t","--type",help="if --doc is all, the kind of validation (meta, xml, ether, or export)", default="export")
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

	# Either we validate specific docs...
	if doc_id != "all":
		print("Content-type:text/html\n\n")
		try:
			print(validate_doc(doc_id).encode("utf8"))
		except Exception as e:
			print("""<html><body><h1>Loading Error</h1>
			<p>For some reason, this page failed to load.</p>
			<p>Please send this to your system administrator:</p>
			<pre>""")
			traceback.print_exc(e, file=sys.stdout)
			print("""</pre></body></html>""")
	# or we validate all docs, but only for one kind of validation
	else:
		print("Content-type:application/json\n\n")
		form = cgi.FieldStorage()
		validation_type = opts.type if len(sys.argv) > 1 else form['validation_type'].value
		print validate_all_docs(validation_type).encode('utf8')
		#print validate_all_docs().encode("utf8")
