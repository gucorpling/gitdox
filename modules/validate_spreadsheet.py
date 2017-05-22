from gitdox_sql import *
from paths import ether_url
from ether import get_socialcalc, make_spreadsheet
import re


def validate_all_docs():
	docs = generic_query("SELECT id FROM docs", None)
	report = ""

	for doc in docs:
		report += validate_doc(doc[0])

	return report


def validate_doc(doc_id, highlight=False):
	doc_info = get_doc_info(doc_id)
	doc_name = doc_info[0]
	doc_corpus = doc_info[1]

	report = ''

	rules = get_validate_rules()
	for rule in rules:
		rule_applies = True
		rule_corpus = rule[0]
		rule_doc = rule[1]
		if rule_corpus is not None:
			if re.match(rule_corpus, doc_corpus) is None:
				rule_applies = False
		if rule_doc is not None:
			if re.match(rule_doc, doc_name) is None:
				rule_applies = False

		if rule_applies is True:
			rule_report = apply_rule(doc_id, rule)
			if rule_report is not None:
				report += rule_report

	return report


def apply_rule(doc_id, rule):
	doc_info = get_doc_info(doc_id)
	doc_name = doc_info[0]

	domain = rule[2]
	name = rule[3]
	operator = rule[4]
	argument = rule[5]

	report = ""

	if domain == "ether":
		ether = get_socialcalc(ether_url, doc_name)
		ether_lines = ether.splitlines()

		if operator in ["~", "|", "exists"]:

			# find col letter corresponding to col name
			col_letter = None
			for line in ether_lines:
				if '1:t:' + name + ':' in line:
					parsed_cell = re.match(r'cell:([A-Z]+)(\d+):(.*)$', line)
					col_letter = parsed_cell.group(1)
					break
			if col_letter is None:
				report += doc_name + ": Column named " + name + " not found.\n"
				return report

			for line in ether_lines:
				parsed_cell = re.match(r'cell:([A-Z]+)(\d+):(.*)$', line)
				if parsed_cell is not None:
					col = parsed_cell.group(1)
					row = parsed_cell.group(2)
					other = parsed_cell.group(3)

					if col == col_letter and row != "1":
						if operator == "|": # rowspan
							if argument == '1':
								if ':rowspan:' in other:
									# TODO: highlight cell
									report += doc_name + ": Cell " + col + row + ": row span is not 1.\n"
							else:
								rowspan = re.search(r':rowspan:' + str(argument) + r'\b', other)
								if rowspan is None:
									# TODO: highlight cell
									report += doc_name + ": Cell " + col + row + ": row span is not " + argument + ".\n"

						elif operator == "~": # regex
							cell_content = re.search(r':t:([^:]*):', line)
							if cell_content is not None:
								cell_content = cell_content.group(1)
								match = re.match(argument, cell_content)
								if match is None:
									# TODO: highlight cell
									report += doc_name + ": Cell " + col + row + ": content " + cell_content \
											  + " does not match pattern " + argument + ".\n"

		elif operator in ["=", ">"]:

			# find col letters corresponding to col names
			name_letter = None
			arg_letter = None
			for line in ether_lines:
				if '1:t:' + name + ':' in line:
					parsed_cell = re.match(r'cell:([A-Z]+)(\d+):(.*)$', line)
					name_letter = parsed_cell.group(1)
				elif '1:t:' + argument + ':' in line:
					parsed_cell = re.match(r'cell:([A-Z]+)(\d+):(.*)$', line)
					arg_letter = parsed_cell.group(1)
			if name_letter is None:
				report += doc_name + ": Column named " + name + " not found.\n"
				return report
			if arg_letter is None:
				report += doc_name + ": Column named " + argument + " not found.\n"
				return report

			name_boundaries = []
			arg_boundaries = []

			# find boundary rows
			for line in ether_lines:
				parsed_cell = re.match(r'cell:([A-Z]+)(\d+):(.*)$', line)
				if parsed_cell is not None:
					col = parsed_cell.group(1)
					row = parsed_cell.group(2)

					if col == name_letter:
						name_boundaries.append(row)
					elif col == arg_letter:
						arg_boundaries.append(row)

			for boundary in name_boundaries:
				if boundary not in arg_boundaries:
					report += doc_name + ": Span break on line " + boundary + " in " + name + " but not " \
							  + argument + ".\n"
					# Todo: highlight
			if operator == "=":
				for boundary in arg_boundaries:
					if boundary not in name_boundaries:
						report += doc_name + ": Span break on line " + boundary + " in " + argument + " but not " \
							  + name + ".\n"
						# Todo: highlight

	elif domain == "meta":
		meta = get_doc_meta(doc_id)
		if operator == "~":
			for metadatum in meta:
				if metadatum[2] == name:
					value = metadatum[3]
					match = re.match(argument, value)
					if match is None:
						report += doc_name + ": Metadata for " + name + ": " + value + " does not match pattern " + argument + "\n"

		elif operator == "exists":
			exists = False
			for metadatum in meta:
				if metadatum[2] == name:
					exists = True
					break
			if exists is False:
				report += doc_name + ": No metadata for " + name + '\n'

	return report


if __name__ == "__main__":
	print validate_all_docs()