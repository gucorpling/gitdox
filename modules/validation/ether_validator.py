from validator import Validator
from collections import defaultdict
import re


class EtherValidator(Validator):
    def __init__(self, rule):
        self.corpus = rule[0]
        self.doc = rule[1]
        self.domain = rule[2]
        self.name = rule[3]
        self.operator = rule[4]
        self.argument = rule[5]


    def _apply_exists(self, parsed_ether):
        report = ''
        tooltip = ''
        cells = []
        colmap = parsed_ether['__colmap__'] # name -> list of col letters
        col_letters = colmap[self.name]     # list of letters with col name

        if len(col_letters) == 0:
            report += "Column named '" + self.name + "' not found<br/>"
        return report, tooltip, cells

    def _apply_doesntexist(self, parsed_ether):
        report = ''
        tooltip = ''
        cells = []
        colmap = parsed_ether['__colmap__'] # name -> list of col letters
        col_letters = colmap[self.name]     # list of letters with col name

        if len(col_letters) > 0:
            report += "Columns named '" + self.name + "' are not allowed<br/>"
            cells += [letter + "1" for letter in col_letters]
        return report, tooltip, cells

    def _apply_span_equals_number(self, parsed_ether):
        report = ''
        tooltip = ''
        cells = []
        colmap = parsed_ether['__colmap__'] # name -> list of col letters
        col_letters = colmap[self.name]     # list of letters with col name

        if len(col_letters) == 0:
            report += "Column named " + self.name + " not found<br/>"
            return report, tooltip, cells

        for letter in col_letters:
            for cell in parsed_ether[letter]:
                if cell.row == "1":
                    continue

                if self.argument == "1":
                    if cell.span != "1":
                        report += "Cell " + cell.col + cell.row + ": span is not 1<br/>"
                        cells.append(cell.col + cell.row)
                else:
                    if cell.span != "" and cell.span != self.argument:
                        report += "Cell " + cell.col + cell.row + ": span is not " + self.argument + "<br/>"
                        cells.append(cell.col + cell.row)
        return report, tooltip, cells

    def _apply_regex(self, parsed_ether):
        report = ''
        tooltip = ''
        cells = []
        colmap = parsed_ether['__colmap__'] # name -> list of col letters
        col_letters = colmap[self.name]     # list of letters with col name

        for letter in col_letters:
            for cell in parsed_ether[letter]:
                if cell.row == "1":
                    continue
                match = re.search(self.argument, cell.content)
                if match is None:
                    report += ("Cell " + cell.col + cell.row
                               + ": content does not match pattern " + self.argument + "<br/>")
                    tooltip += ("Cell " + cell.col + cell.row + ":<br/>"
                                + "Content: " + cell.content + "<br/>"
                                + "Pattern: " + self.argument + "<br/>")
                    cells.append(cell.col + cell.row)
        return report, tooltip, cells

    def _binary_op_check_cols_exist(self, colmap):
        name_letters = colmap[self.name]
        arg_letters = colmap[self.argument]

        if len(name_letters) == 0:
            if self.operator != "==":
                return "Column named " + self.name + " not found<br/>"
        if len(arg_letters) == 0:
            if self.operator != "==":
                return "Column named " + self.argument + " not found<br/>"

        return ""

    def _binary_op_setup(self, parsed_ether):
        colmap = parsed_ether['__colmap__'] # name -> list of col letters
        name_letters = colmap[self.name]
        arg_letters = colmap[self.argument]

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

        name_start_cells = []
        name_start_rows = set() # for O(1) lookup
        for letter in name_letters:
            name_start_cells += [(letter, row) for row in start_rows[letter]]
            name_start_rows = name_start_rows.union(set(row for row in start_rows[letter]))

        arg_start_cells = []
        arg_start_rows = set()
        for letter in arg_letters:
            arg_start_cells += [(letter, row) for row in start_rows[letter]]
            arg_start_rows = arg_start_rows.union(set(row for row in start_rows[letter]))

        return name_letters, arg_letters, name_tuples, arg_tuples, start_rows, all_rows, \
            name_start_cells, name_start_rows, arg_start_cells, arg_start_rows

    def _apply_subspan(self, parsed_ether):
        report = ''
        tooltip = ''
        cells = []
        colmap = parsed_ether['__colmap__'] # name -> list of col letters
        col_letters = colmap[self.name]     # list of letters with col name

        err = self._binary_op_check_cols_exist(colmap)
        if err:
            report += err
            return report, tooltip, cells

        name_letters, arg_letters, name_tuples, \
                arg_tuples, start_rows, all_rows, \
                name_start_cells, name_start_rows, \
                arg_start_cells, arg_start_rows = self._binary_op_setup(parsed_ether)

        for row in all_rows:
            # check to see if all cells in rhs are contained within cells on lhs
            if row in arg_tuples and row not in name_tuples:
                for letter, _ in arg_tuples[row]:
                    cells.append(letter + row)
                    report += ("Cell " + letter + row
                            + " must appear in the span of a cell in one of these columns: "
                            + ", ".join(name_letters) + "<br/>")

        return report, tooltip, cells

    def _apply_equal_span_length(self, parsed_ether):
        report = ''
        tooltip = ''
        cells = []
        colmap = parsed_ether['__colmap__'] # name -> list of col letters
        col_letters = colmap[self.name]     # list of letters with col name

        err = self._binary_op_check_cols_exist(colmap)
        if err:
            report += err
            return report, tooltip, cells

        name_letters, arg_letters, name_tuples, \
                arg_tuples, start_rows, all_rows, \
                name_start_cells, name_start_rows, \
                arg_start_cells, arg_start_rows = self._binary_op_setup(parsed_ether)

        for row in all_rows:
            if row == "1":
                continue
            name_len = len(name_tuples[row])
            arg_len = len(arg_tuples[row])

            if name_len > arg_len:
                for letter, _ in name_tuples[row][arg_len:]:
                    if row not in name_start_rows:
                        cells.append(letter + row)
                        report += ("Cell " + letter + row
                                + " has no corresponding value in one of these columns: "
                                + ", ".join(arg_letters) + "<br/>")
            elif arg_len > name_len:
                for letter, _ in arg_tuples[row][name_len:]:
                    if row not in arg_start_rows:
                        cells.append(letter + row)
                        report += ("Cell " + letter + row
                                + " has no corresponding value in one of these columns: "
                                + ", ".join(name_letters) + "<br/>")

        for letter, row in name_start_cells:
            if row not in arg_start_rows:
                cells.append(letter + row)
                report += ("Cell " + letter + row
                           + " needs a span of equal length beginning in one of these columns: "
                           + ", ".join(arg_letters) + "<br/>")

        for letter, row in arg_start_cells:
            if row not in name_start_rows:
                cells.append(letter + row)
                report += ("Cell " + letter + row
                           + " needs a span of equal length beginning in one of these columns: "
                           + ", ".join(name_letters) + "<br/>")

        return report, tooltip, cells

    def _apply_equal_span_length_and_content(self, parsed_ether):
        report = ''
        tooltip = ''
        cells = []
        colmap = parsed_ether['__colmap__'] # name -> list of col letters
        col_letters = colmap[self.name]     # list of letters with col name

        err = self._binary_op_check_cols_exist(colmap)
        if err:
            report += err
            return report, tooltip, cells


        name_letters, arg_letters, name_tuples, \
                arg_tuples, start_rows, all_rows, \
                name_start_cells, name_start_rows, \
                arg_start_cells, arg_start_rows = self._binary_op_setup(parsed_ether)

        for row in all_rows:
            if row == "1":
                continue

            name_len = len(name_tuples[row])
            arg_len = len(arg_tuples[row])

            if name_len > arg_len:
                for letter, _ in name_tuples[row][arg_len:]:
                    if row not in name_start_rows:
                        cells.append(letter + row)
                        report += ("Cell " + letter + row
                                + " has no corresponding value in one of these columns: "
                                + ", ".join(arg_letters) + "<br/>")
            elif arg_len > name_len:
                for letter, _ in arg_tuples[row][name_len:]:
                    if row not in arg_start_rows:
                        cells.append(letter + row)
                        report += ("Cell " + letter + row
                                + " has no corresponding value in one of these columns: "
                                + ", ".join(name_letters) + "<br/>")

            for i in range(min(len(name_tuples[row]), len(arg_tuples[row]))):
                name_letter, name_content = name_tuples[row][i]
                arg_letter, arg_content = arg_tuples[row][i]

                if arg_content != name_content and (row in start_rows[arg_letter] or row in start_rows[name_letter]):
                    cells.append(name_letter + row)
                    cells.append(arg_letter + row)
                    report += ("Cells " + name_letter + row
                            + " and " + arg_letter + row
                            + " must have equivalent content.<br/>")

        for letter, row in name_start_cells:
            if row not in arg_start_rows:
                cells.append(letter + row)
                report += ("Cell " + letter + row
                           + " needs a span of equal length beginning in one of these columns: "
                           + ", ".join(arg_letters) + "<br/>")

        for letter, row in arg_start_cells:
            if row not in name_start_rows:
                cells.append(letter + row)
                report += ("Cell " + letter + row
                           + " needs a span of equal length beginning in one of these columns: "
                           + ", ".join(name_letters) + "<br/>")

        return report, tooltip, cells

    def _apply_rule(self, parsed_ether):
        if self.name is None:
            return "", "", []

        if self.operator == "exists":
            return self._apply_exists(parsed_ether)
        if self.operator == "doesntexist":
            return self._apply_doesntexist(parsed_ether)
        elif self.operator == "|":
            return self._apply_span_equals_number(parsed_ether)
        elif self.operator == "~":
            return self._apply_regex(parsed_ether)
        elif self.operator == ">":
            return self._apply_subspan(parsed_ether)
        elif self.operator == "=":
            return self._apply_equal_span_length(parsed_ether)
        elif self.operator == "==":
            return self._apply_equal_span_length_and_content(parsed_ether)
        else:
            raise Exception("Unknown EtherCalc validation operator: '" + str(self.operator) + "'")

    def applies(self, doc_name, doc_corpus):
        if self.corpus is not None and re.search(self.corpus, doc_corpus) is None:
            return False
        if self.doc is not None and re.search(self.doc, doc_name) is None:
            return False
        return True

    def validate(self, parsed_ether):
        report, tooltip, cells = self._apply_rule(parsed_ether)
        return {"report": report,
                "tooltip": tooltip,
                "cells": cells}
