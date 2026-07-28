#!/usr/bin/python
# -*- coding: utf-8 -*-

"""
This script takes CWB-SGML format input
and outputs SocialCalc spreadsheet data

Author: Amir Zeldes
"""

import re, os
from collections import defaultdict
from collections import OrderedDict
from operator import itemgetter
from nlp_modules.reorder_sgml import reorder
from os import listdir
from os.path import isfile, join
from configobj import ConfigObj
from ast import literal_eval
from copy import copy
from xml.sax.saxutils import escape

CELL_ID_PATTERN = re.compile(r'^([A-Z]+)([0-9]+)$')

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
            self.reorder = kwargs.get("reorder",False)
            self.map_entities = kwargs.get("map_entities", [])
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
        for anno in self.tok_annos:
            if anno not in self.priorities:
                self.priorities.append(anno)

    def read_config(self,config_file):

        config = ConfigObj(os.path.dirname(os.path.realpath(__file__)) + os.sep + ".." + os.sep + "schemas" + os.sep + config_file)
        if "aliases" in config:
            self.aliases = literal_eval(config["aliases"])
        else:
            self.aliases = {}
        if "priorities" in config:
            self.priorities = literal_eval(config["priorities"])
        else:
            self.priorities = []
        if "milestones" in config:
            self.milestones = literal_eval(config["milestones"])
        else:
            self.milestones = []
        if "no_content" in config:
            self.no_content = literal_eval(config["no_content"])
        else:
            self.no_content = []
        if "tok_annos" in config:
            self.tok_annos = literal_eval(config["tok_annos"])
        else:
            self.tok_annos = []
        if "export_all" in config:
            self.export_all = config["export_all"].lower() == "true"
        if "map_entities" in config:
            self.map_entities = literal_eval(config["map_entities"])
        else:
            self.map_entities = []
        if "no_ignore" in config:
            self.no_ignore = config["no_ignore"].lower() == "true"
        else:
            self.no_ignore = True
        if "template" in config:
            self.template = config["template"]
        else:
            self.template = "<meta %%all%%>\n%%body%%\n</meta>\n"
        if "reorder" in config:
            self.reorder = config["reorder"]
        else:
            self.reorder = False


def parse_social(social):
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

    social_lines = social.splitlines()

    # find col letter corresponding to col name
    parsed = defaultdict(list)
    colmap = defaultdict(list)
    rev_colmap = {}
    all_cells = []
    for line in social_lines:
        if line.startswith("cell:"):  # Cell row
            # A maximal row looks like this incl. span: cell:F2:t:LIRC2014_chw0oir:f:1:rowspan:289
            # A minimal row without formatting: cell:C2:t:JJ:f:1
            parts = line.split(":")
            if len(parts) > 3:  # Otherwise invalid row
                cell_id = parts[1]
                match = re.match(CELL_ID_PATTERN, cell_id)
                if not match:
                    raise Exception('malformed socialcalc cell ID: "' + cell_id + '"')
                cell_col, cell_row = match.groups()
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
            raise IOError("Undocumented column: " + cell.col + " in '" + str(cell) + " from document")

    parsed["__colmap__"] = colmap  # Save colmap for apply_rule
    return parsed


def unescape_xml(text):
    # Fix various common compounded XML escapes
    text = text.replace("&amp;lt;","<").replace("&amp;gt;",">")
    text = text.replace("&lt;","<").replace("&gt;",">")
    text = text.replace("&amp;","&")
    return text


def build_meta_tag(meta_dict=None):
    meta = "<meta"
    meta_items = []
    # docid,metaid,key,value - four cols
    if meta_dict:
        for key, value in meta_dict.items():
            if not key.startswith("ignore:"):
                key = key.replace("=", "&equals;")  # Key may not contain equals sign
                value = value.replace('"', "'")  # Value may not contain double quotes
                value = unescape_xml(value)
                meta_items.append(key + '="' + value + '"')

    meta_props = " ".join(meta_items)
    if meta_props != "":
        meta_props = " " + meta_props
    output = meta + meta_props + ">\n"
    output = output.replace("<meta >","<meta>")
    return output


def fill_meta_template(docname, corpus, template, meta_dict=None, entity_mappings=None):
    meta_items = []
    meta_processed = {}
    # docid,metaid,key,value - four cols
    if meta_dict:
        for key, value in meta_dict.items():
            if not key.startswith("ignore:"):
                key = key.replace("=", "&equals;")
                value = value.replace('"', "&quot;")
                value = unescape_xml(value)
                meta_items.append(escape(key) + '="' + escape(value) + '"')
                meta_processed[escape(key)] = escape(value)

    meta_props = " ".join(meta_items)

    template = template.replace("%%all%%", meta_props)
    template = template.replace("%%name%%", docname)
    template = template.replace("%%corpus%%", corpus)

    for key in meta_processed:
        if key != "body": # Never overwrite body template position
            template = template.replace("%%" + key + "%%",meta_dict[key])

    entity_lookup = defaultdict(set)
    if entity_mappings:
        for tup in entity_mappings:
            doc, corpus, words, head, etype, eref, mentionnum = tup
            if eref != "(pass)":
                entity_lookup[etype].add(eref)
    ent_meta = re.findall(r'%%ent:([^% "]+)%%',template)
    for etype in ent_meta:
        names = "; ".join(sorted(list(entity_lookup[etype])))
        if len(names) == 0:
            names = "none"
        template = template.replace("%%ent:" + etype + "%%",names)

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


def get_social_stylesheets():
    scriptpath = os.path.dirname(os.path.realpath(__file__)) + os.sep
    stylesheet_dir = scriptpath + os.sep + ".." + os.sep + "schemas" + os.sep
    stylesheet_list = get_file_list(stylesheet_dir,"ini",hide_extension=True)
    if "tt_sgml" in stylesheet_list:
        stylesheet_list.remove("tt_sgml")
        stylesheet_list = ["tt_sgml"] + stylesheet_list # tt_sgml is always first
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


def sgml_to_social(sgml, ignore_elements=False):
    """
    Convert TT SGML (one token, opening element or closing element per line) to Ether/SocialCalc format

    :param sgml: TT SGML input
    :param ignore_elements: Elements to ignore
    :return: SocialCalc format, meta_dict
    """
    def normalize_text_meta(sgml):
        """
        Helper to check if the input has top level <text ..></text> tags instead of <meta> and replace
        """
        if sgml.strip().startswith("<text") and sgml.strip().endswith("</text>"):
            sgml = "<meta" + sgml.strip()[5:-7] + "</meta>"
        return sgml

    def tabs_to_elements(tt_format, col1="pos",col2="lemma"):
        """Transform tab delimited annotations into element annotations, for example:

        <s>
        Come    VB    come
        here    RB    here
        </s>

        Becomes

        <s>
        <pos pos="VB">
        <lemma lemma="come">
        Come
        </lemma>
        </pos>
        <pos> ...
        """
        if "\t" in tt_format:
            tab_lines = [l for l in tt_format.split("\n") if "\t" in l]
            if all([l.count("\t") == 2 for l in tab_lines]):
                repl = r'<col1 col1="\2"\>\n<col2 col2="\3">\n\1\n</col2>\n</col1>'
                repl = repl.replace("col1",col1).replace("col2",col2)
                return re.sub(r'([^\t\n]+)\t([^\t\n]+)\t([^\t\n]+)',repl,tt_format)
        return tt_format

    sgml = tabs_to_elements(sgml)
    sgml = normalize_text_meta(sgml)
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

    # TODO: de-hardwire special anno name list for which element name is ignored
    ignore_element_annos = [("norm","lang"),("morph","lang"),("entity","group\\ccoref"),("entity","group\\cbridge"),
                            ("entity","infstat")]

    meta_dict = {}

    for line in sgml.strip().split("\n"):
        line = line.strip()

        if line.startswith("<?") or line.endswith("/>"):  # Skip unary tags and XML instructions
            continue
        elif line.startswith("<meta ") and '=' in line:  # Get metadata key vals
            line = line.replace("<meta ","")
            meta_attrs = re.findall(r'([^" =]+)\s*=\s*"([^"]+)"',line)
            for attr in meta_attrs:
                meta_dict[attr[0]] = attr[1]
            continue
        else:
            # SocialCalc uses colons internally, \\c used to repr colon in data
            line = line.replace(":", "\\c")
            if line.startswith("<meta") or line.startswith("</meta"):  # meta tags
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

                attrs = re.findall(r'([^" =]+)\s*=\s*"([^"]+)"',line)

                for attr in attrs:
                    if element != attr[0] and ignore_elements is False and (element,attr[0]) not in ignore_element_annos:
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

            elif len(line) > 0:  # Token (optionally with tab-delimited inline annotations)
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

    output = reorder_multicols(output)

    output = fix_colnames(output)
    output = re.sub(r'cell:[A-Z]+[0-9]+:t:(:bg:[0-9]+)?\n', '', output)  # Remove blank cells

    return output, meta_dict


def reorder_multicols(socialcalc):
    cols = re.findall(r'cell:([A-Z]+)1:.:([^:]+):',socialcalc)
    counts = defaultdict(int)
    for col_letter, col_header in cols:
        counts[col_header] += 1
    multicols = []
    for col_header in counts:
        if counts[col_header] > 1:
            multicols.append(col_header)
    if len(multicols) == 0:  # No need to reorder
        return socialcalc

    mapping = {"A":"A"}  # Token col does not move
    counter = 1
    for col_letter, col_header  in cols:
        if col_header not in multicols and col_header != "tok":
            counter += 1
            mapping[col_letter] = number_to_letters(counter)
    # Now place the multicols adjacently at the end
    for col_letter, col_header in cols:
        if col_header in multicols:
            counter += 1
            mapping[col_letter] = number_to_letters(counter)

    for key in mapping:
        socialcalc = re.sub(r"cell:" + key + r"(\d+:)","cell:REP" + mapping[key] + r"\1",socialcalc)
    socialcalc = socialcalc.replace("cell:REP","cell:")
    return socialcalc


def strip_unique_identifier(tag):
    """Given an SGML closing or opening tag, replace anything that looks
    like __\\d+__ on the end of the tag name, assuming that we were the
    ones who added it."""

    try:
        tag_name = re.match("^</?([^ >]+)", tag).groups(0)[0]
    except AttributeError:
        return tag

    orig_tag_name = re.sub(r"__\d+__$", "", tag_name)
    tag = tag.replace("<" + tag_name, "<" + orig_tag_name)
    tag = tag.replace("</" + tag_name, "</" + orig_tag_name)
    tag = tag.replace(tag_name + "=" + '"' + orig_tag_name + '"',
                      orig_tag_name + "=" + '"' + orig_tag_name + '"')  # Tags like <x x="x">
    tag = tag.replace(tag_name + "=" + '"', orig_tag_name + "=" + '"')  # Tags like <x x="val">
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

    multitags = set(re.findall(r'([^<> ]+__\d+__)',sgml))
    for tag in list(multitags):
        multitags.add(re.sub(r'__\d+__','',tag))

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
                if element in multitags:
                    open_counts[element] -= 1
                if element == open_element:
                    break
            else:
                element = re.match("<([^ >]+)[ >]", line2).groups(0)[0]
                if element in multitags:
                    open_counts[element] += 1

        # element is properly nested if no element was opened in the block that
        # was not also closed in the block or vice versa
        if sum(open_counts.values()) == 0:
            output[i] = strip_unique_identifier(output[i])
            output[i+j] = strip_unique_identifier(output[i+j])

    output = reverse_adjacent_closing_tags(output)

    return "\n".join(output)


def add_entities(sgml, entity_table, entity_anno="entity", identity_anno="identity", word_anno="tok", ignore_identity=None):

    # Make entity lookup
    entity_lookup = {}
    for row in entity_table:
        doc, corpus, words, head, etype, eref, mentionnum = row
        entity_lookup[(words, etype, str(mentionnum))] = eref

    # First pass, get entity spans and positions
    lines = sgml.split("\n")
    stack = []
    spans = {}
    words = []
    word_idx = 1
    for i, line in enumerate(lines):
        if " " + entity_anno + '="' in line:
            entity_type = re.search(" " + entity_anno + '="([^"]*)"', line).group(1)
            stack.append((i,word_idx,entity_type))
        elif "</" + entity_anno + ">" in line:
            start_line, start_word, entity_type = stack.pop()
            entity_text = words[start_word-1:]
            spans[start_line] = (" ".join(entity_text), entity_type)
        if word_anno == "tok":
            if not line.startswith("<") and not line.endswith(">"):
                word_idx += 1
                words.append(line)
        else:
            if " " + word_anno + '="' in line:
                word = re.search(" " + word_anno + '="([^"]*)"', line).group(1)
                word_idx += 1
                words.append(word)

    # Second pass, insert identity annotations
    output = []
    for i, line in enumerate(lines):
        skip = False
        if i in spans:
            entity_text, entity_type = spans[i]
            key = (entity_text, entity_type, "None")
            if key in entity_lookup:
                identity = entity_lookup[key]
                if ignore_identity is not None:
                    if ignore_identity.match(identity) is not None:
                        skip = True
                if " " + entity_anno + '="' in line and not skip:
                    line = line.replace(" " + entity_anno + "=", " " + identity_anno + '="' + identity + '" ' + entity_anno + "=")
        output.append(line)

    return "\n".join(output)


def social_to_sgml(social, docname="", corpus="", config=None, meta_dict=None, entity_mappings=None):
    """
    :param social: String in SocialCalc format
    :param config: Name of an export config (.ini file) under schemas/
    :param meta_dict: dict of meta properties to add to the meta tag, e.g. {"author": "Kim", "corpus": "corpus1"}
    :enitity_mappings: list of tuples: [(doc, corpus, words, head, etype, eref, mentionnum),..]
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

    # Destroy empty span cells without content, typically nested underneath longer, filled spans
    social = re.sub(r'cell:[A-Z]+[0-9]+:f:1:rowspan:[0-9]+','',social)

    # Ensure that cell A1 is treated as 'tok' if the header was deleted
    social = re.sub(r'cell:A1:f:([0-9]+)',r"cell:A1:t:tok:f:\1",social)

    # parse cell contents into cells
    for line in social.splitlines():
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
                raise IOError("Column " + col + " not found in document")

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
                toks[row] = {"tok":content}
            else:
                if element in config.no_content:
                    if element == attrib:
                        attrib = ""

                if attrib in config.tok_annos:
                    # TT SGML token annotation, append to token with tab separator and move on
                    if "<" in content or "&" in content or ">" in content:
                        content = escape(content)
                    toks[row][attrib] = content
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

    #output = build_meta_tag(meta_dict)
    template = fill_meta_template(docname, corpus ,config.template, entity_mappings=entity_mappings, meta_dict=meta_dict)
    output = ""
    close_tag_debt = defaultdict(int)

    try:
        for r in range(2, sorted(close_tags.keys())[-1] + 1):
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
                toks[r] = {"tok":""}  # Caution - empty token!

            if len(config.tok_annos) > 0:
                tab_annos = []
                for attr in config.tok_annos:
                    if attr in toks[r]:
                        tab_annos.append(toks[r][attr])
                if len(tab_annos) > 0:
                    toks[r]["tok"] = "\t".join([toks[r]["tok"]] + tab_annos)
            output += toks[r]["tok"] + '\n'
    except:
        import sys
        sys.stderr.write(corpus + ": " + docname)
        raise IOError("Missing closing tag in document " + docname + ": " + close_tags)

    output = output.replace('\\c', ':')
    #output += "</meta>\n"
    if "%%body%%" in template:
        output = template.replace("%%body%%",output.strip())

    output = re.sub("%%[^%]+%%", "none", output)

    # attempt to reorder SGML by nesting hierarchy for next step, since deunique requires ordered input
    if config.reorder:
        output = reorder(output,priorities=config.priorities)

    # fix tags that look like elt__2__ if it still gives correct sgml
    output = deunique_properly_nested_tags(output)

    # deunique can destroy ordering, so we repeat it again
    if config.reorder or len(config.map_entities) > 0:
        output = reorder(output,priorities=config.priorities)

    if len(config.map_entities) > 0:
        entity_key, identity_key, word_key, ignore_identity = config.map_entities
        ignore_identity = re.compile(ignore_identity)
        entity_table = [row for row in entity_mappings] if entity_mappings else []
        output = add_entities(output, entity_table, entity_key, identity_key, word_key, ignore_identity)

    lines = output.split("\n")
    if lines[0].startswith("<meta ") and "=" in lines[0]:  # Sort metadata
        meta = re.sub('^<meta ','',lines[0]).strip()[:-1]
        sorted_meta = []
        keyvals = re.findall(r'([^ =]+?="[^"]*?")',meta)
        for kv in keyvals:
            sorted_meta.append(kv)
        sorted_meta.sort(key=lambda x:x.lower())
        lines[0] = "<meta " + " ".join(sorted_meta) + ">"
        output = "\n".join(lines)

    return output


def fix_colnames(socialcalc):
    # Hard-wired fixes for Scriptorium layer names that should be collapsed if they appear
    # TODO: make this configurable somewhere
    socialcalc = re.sub(r'(:[A-Z]1:t:)norm_group_((orig_group):)',r'\1\2',socialcalc)
    socialcalc = re.sub(r'(:[A-Z]1:t:)norm_((orig|pos|lemma|lang):)', r'\1\2', socialcalc)
    socialcalc = re.sub(r'(:[A-Z]1:t:)morph_((orig|pos|lemma|lang):)', r'\1\2', socialcalc)
    socialcalc = re.sub(r'(:[A-Z]1:t:)norm_xml\\c((orig|pos|lemma|lang):)', r'\1\2', socialcalc)
    socialcalc = re.sub(r'(:[A-Z]1:t:)morph_xml\\c((orig|pos|lemma|lang):)', r'\1\2', socialcalc)
    socialcalc = re.sub(r'(:[A-Z]1:t:)entity_(group\\c(coref|bridge):|(identity|infstat|salience):)', r'\1\2', socialcalc)

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


def merge_entities(spreadsheet_sgml, entity_sgml, merge_anno="entity", word_anno=None, other_annos=None,
                   sent_anno="translation", use_entity_tokens=False):
    """
    Take TT SGML from an socialcalc spreadsheet and TT SGML from entity annotation;
    merge entity data from a selected markup annotation based on identical word offsets

    :param spreadsheet_sgml: TT SGML containing all annotations except the entity information
                            (entity annotations will be overwritten if present)
    :param entity_sgml: TT SGML containing the entity spans
    :param merge_anno: name of the XML tag AND attribute to import from entity_sgml
    :param word_anno: name of the SGML tag AND attribute representing the 'words' in spreadsheet SGML;
                            If None, use plain text tokens as words
    :param other_annos: list of other annotation key names to allow merging from entity_sgml
    :param sent_anno: an element name to use for inserted sentence breaks
    :param use_entity_tokens: if True, use the tokens from the entity SGML instead of the spreadsheet SGML
    :return: merged TT SGML
    """

    def is_token(line, anno=None):
        if anno is None:
            return not (line.startswith("<") and line.endswith(">"))
        else:
            return ' '+anno+'="' in line

    def match_elem(line, elem):
        return line.startswith("<" + elem + ">") or line.startswith("<" + elem + " ") or line.startswith("</" + elem + ">")

    # Validate token counts match
    entity_tokens = [line for line in entity_sgml.strip().split("\n") if is_token(line.strip(), anno=None)]
    social_tokens = [line for line in spreadsheet_sgml.strip().split("\n") if is_token(line.strip(), word_anno)]
    if word_anno is not None:
        social_tokens = [l.split(word_anno+'="')[1].split('"')[0] for l in social_tokens]

    if len(entity_tokens) != len(social_tokens):
        return False

    open_entities = []
    entity_starts = defaultdict(list)
    entity_ends = defaultdict(list)
    sent_insertions = []
    toknum = 1
    for line in entity_sgml.strip().split("\n"):
        line = line.strip()
        if len(line.strip())==0:
            continue
        m = re.match(r'<'+merge_anno+r' ' + merge_anno + r'="([^"]*)"',line)
        if m is not None:  # Entity opener
            entity_type = m.group(1)
            entity_start = toknum
            groups = []
            group_search = re.findall(r' (group:[^=\s]+="[^"]*")',line)
            for group in group_search:
                groups.append(group)
            annos = []
            if other_annos is not None:
                anno_search = re.findall(r' (([^=\s]+)="[^"]*")',line)
                for anno in anno_search:
                    if anno[1] in other_annos:
                        annos.append(anno[0])
            open_entities.append((entity_start,entity_type,groups,annos))
            continue
        if line.strip() == "</" + merge_anno + ">":  # Entity closer
            entity_start, entity_type, groups, annos = open_entities.pop()
            entity_starts[entity_start].append((toknum-1, entity_type, groups, annos))
            entity_ends[toknum-1].append((entity_start, entity_type))
            continue
        if not (line.startswith("<") and line.endswith(">")):  # Token
            toknum += 1
        if "<s/>" in line:  # Unary added sentence split
            sent_insertions.append(toknum)

    toknum = 1
    output = []
    has_verse_n = "<verse_n " in spreadsheet_sgml
    has_translation = "<translation translation=" in spreadsheet_sgml
    made_insertions = False
    for line in spreadsheet_sgml.strip().split("\n"):
        if match_elem(line, merge_anno) or any([match_elem(line,e) for e in other_annos]) or " group:" in line or "</group:" in line:
            continue  # Ignore lines with existing entity annotations
        if (not (line.startswith("<") and line.endswith(">"))) or " " + str(word_anno) + '="' in line:  # Token begins
            # Determine the word form to use
            try:
                if use_entity_tokens:
                    word_form = entity_tokens[toknum-1]
                else:
                    word_form = social_tokens[toknum-1]
            except IndexError:
                print("toknum:", toknum, "ent tokens:",len(entity_tokens), "social tokens:", len(social_tokens), "line:", line)
                raise ValueError("Token count mismatch in merge_entities")

            # Add any needed entities sorted descending by length
            if word_anno is None or " " + str(word_anno) + '="' in line:  # Token is immediately over
                for _, entity_type, groups, annos in sorted(entity_starts[toknum],reverse=True):
                    entity_tag = "<" + merge_anno + " " + merge_anno + '="' + entity_type + '"'
                    if len(groups) > 0:
                        entity_tag += " " + " ".join(groups)
                    if len(annos) > 0:
                        entity_tag += " " + " ".join(annos)
                    entity_tag += '>'
                    output.append(entity_tag)
            if word_anno is None:
                output.append(word_form)  # line
                for _, entity_type in entity_ends[toknum]:
                    output.append("</" + merge_anno + ">")
                toknum += 1
                if toknum in sent_insertions:
                    output.append("</" + sent_anno + ">")
                    if has_verse_n:
                        output.append('</verse_n>\n<verse_n verse_n="x">')
                    output.append("<" + sent_anno + " " + sent_anno + '="...">')
                    made_insertions = True
                continue
        if not use_entity_tokens:
            output.append(line)
        elif word_anno is not None:
            output.append(line.replace(word_anno + '="'+social_tokens[toknum-1]+'"',word_anno + '="'+entity_tokens[toknum-1]+'"'))
        else:
            if (toknum < len(entity_tokens) and toknum < len(social_tokens)) or not (line.startswith("<") and line.endswith(">")):
                output.append(line)
        if word_anno is not None:
            if "</" + word_anno + ">" in line:  # Token based on annotation ends
                for _, entity_type in entity_ends[toknum]:
                    output.append("</" + merge_anno + ">")
                toknum += 1
                if toknum in sent_insertions:
                    output.append("</" + sent_anno + ">")
                    if has_verse_n:
                        output.append('</verse_n>\n<verse_n verse_n="x">')
                    output.append("<" + sent_anno + " " + sent_anno + '="...">')
                    made_insertions = True

    tmp = []
    vnum = 1
    initial = True
    if made_insertions and has_verse_n:  # renumber verses
        for line in output:
            if '</chapter>' in line or '</chapter_n>' in line:
                vnum = 1
            if "<translation translation" in line:
                if not initial:
                    tmp.append("</verse_n>")
                else:
                    initial = False
                tmp.append('<verse_n verse_n="'+str(vnum)+'">')
                vnum +=1
            if '<verse_n verse_n=' in line:
                if not has_translation:
                    line = re.sub(r' verse_n="[^"]+?"', ' verse_n="'+str(vnum)+'"',line)
                    vnum += 1
                else:
                    continue  # ignore original verse_n tags
            if "</verse_n>" in line and has_translation:
                continue  # ignore original verse_n tags
            tmp.append(line)
        if has_translation :
            tmp.append("</verse_n>")
        output = tmp

    return "\n".join(output)


def get_pos_list(tt_string,pos_tag_name):
    output = []
    tt_string = tt_string.replace("|","&#124;")
    for line in tt_string.split("\n"):
        m = re.search(r' ' + pos_tag_name + '="([^"]*)"',line)
        if m is not None:
            output.append(m.group(1))
    return "|".join(output)


if __name__  == "__main__":

    sgml = """<text id="GUM_fiction_falling" author="Benjamin Rosenbaum" dateCollected="2017-09-13" dateCreated="2008-08-05" dateModified="2008-08-05" modality="written" production="formal/prepared/public" shortTitle="falling" sourceURL="http://smallbeerpress.com/wp-content/uploads/Rosenbaum_Ant_King.pdf" speakerCount="4" speakerList="#Protagonist, #Woman, #Derya, #CivicAgent" title="Falling" type="fiction">
<head>
<s type="frag">
Falling
</s>
</head>
<p>
<s type="decl">
<hi rend="small caps">
You
’re
on
the
<w>
236th
-
level
</w>
Kaiserstrasse
</hi>
moving
sidewalk
when
you
see
her
.
</s>
</text>
"""
    social = r"""# SocialCalc Spreadsheet Control Save
version:1.0
part:sheet
part:edit
part:audit
--SocialCalcSpreadsheetControlSave
Content-type: text/plain; charset=UTF-8

version:1.5

cell:A1:t:tok:f:2
cell:A2:t:Falling:f:1:tvf:1
cell:P2:t:frag:f:1:tvf:1
cell:O2:t:head:f:1:tvf:1
cell:A3:t:You:f:1:tvf:1
cell:A4:t:’re:f:1:tvf:1
cell:A5:t:on:f:1:tvf:1
cell:A6:t:the:f:1:tvf:1
cell:A7:t:236th:f:1:tvf:1
cell:A8:t:-:f:1:tvf:1
cell:A9:t:level:f:1:tvf:1
cell:S7:t:w:f:1:tvf:1:rowspan:3
cell:A10:t:Kaiserstrasse:f:1:tvf:1
cell:R3:t:small caps:f:1:tvf:1:rowspan:8
cell:A11:t:moving:f:1:tvf:1
cell:A12:t:sidewalk:f:1:tvf:1
cell:A13:t:when:f:1:tvf:1
cell:A14:t:you:f:1:tvf:1
cell:A15:t:see:f:1:tvf:1
cell:A16:t:her:f:1:tvf:1
cell:A17:t:.:f:1:tvf:1
cell:P3:t:decl:f:1:tvf:1:rowspan:15
cell:B2:t:GUM_fiction_falling:f:1:tvf:1:rowspan:16
cell:C2:t:Benjamin Rosenbaum:f:1:tvf:1:rowspan:16
cell:D2:t:2017-09-13:f:1:tvf:1:rowspan:16
cell:E2:t:2008-08-05:f:1:tvf:1:rowspan:16
cell:F2:t:2008-08-05:f:1:tvf:1:rowspan:16
cell:G2:t:written:f:1:tvf:1:rowspan:16
cell:H2:t:formal/prepared/public:f:1:tvf:1:rowspan:16
cell:I2:t:falling:f:1:tvf:1:rowspan:16
cell:J2:t:http\c//smallbeerpress.com/wp-content/uploads/Rosenbaum_Ant_King.pdf:f:1:tvf:1:rowspan:16
cell:K2:t:4:f:1:tvf:1:rowspan:16
cell:L2:t:#Protagonist, #Woman, #Derya, #CivicAgent:f:1:tvf:1:rowspan:16
cell:M2:t:Falling:f:1:tvf:1:rowspan:16
cell:N2:t:fiction:f:1:tvf:1:rowspan:16
cell:B1:t:text_id:f:2
cell:C1:t:text_author:f:2
cell:D1:t:text_dateCollected:f:2
cell:E1:t:text_dateCreated:f:2
cell:F1:t:text_dateModified:f:2
cell:G1:t:text_modality:f:2
cell:H1:t:text_production:f:2
cell:I1:t:text_shortTitle:f:2
cell:J1:t:text_sourceURL:f:2
cell:K1:t:text_speakerCount:f:2
cell:L1:t:text_speakerList:f:2
cell:M1:t:text_title:f:2
cell:N1:t:text_type:f:2
cell:O1:t:head:f:2
cell:P1:t:s_type:f:2
cell:Q1:t:p:f:2
cell:R1:t:hi_rend:f:2
cell:S1:t:w:f:2

sheet:c:19:r:17:tvf:1

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

--SocialCalcSpreadsheetControlSave--"""
    data = ""
    data = re.sub('>', '>\n', data)
    data = re.sub('</', '\n</', data)
    data = re.sub('\n+', '\n', data)
    social_out = sgml_to_social(sgml)
    print(social_out)

    sgml_out = social_to_sgml(social,config="gum_export.ini")
    
    print(sgml_out)