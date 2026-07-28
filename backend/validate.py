import re
from collections import defaultdict
from typing import Dict, List, Optional, Set, Union, Tuple, Match, Iterable


class Cell:
    """
    Lightweight representation of a SocialCalc cell.
    Uses __slots__ for memory efficiency and fast attribute access during validations.
    """
    __slots__ = ['coord', 'col', 'row', 'type', 'value', 'attrs']

    def __init__(self, coord: str, col: str, row: int, cell_type: str, value: str, attrs: Dict[str, str]):
        self.coord = coord
        self.col = col
        self.row = row
        self.type = cell_type
        self.value = value
        self.attrs = attrs

    @property
    def rowspan(self) -> int:
        return int(self.attrs.get('rowspan', 1))

    @property
    def colspan(self) -> int:
        return int(self.attrs.get('colspan', 1))


class ValidationRule:
    """Represents a single validation instruction."""

    def __init__(self, domain: str, key: str, operator: str, value: Optional[str] = None):
        self.domain = domain
        self.key = key
        self.operator = operator
        self.value = value


class BaseValidator:
    """Base class providing shared utilities like cached regex checking."""

    def __init__(self):
        self._compiled_regexes: Dict[str, Union[re.Pattern, Set[str]]] = {}

    def _check_regex(self, pattern: str, string: str) -> bool:
        """
        Evaluates a regex, with caching and runtime conversion to O(1) set-lookups
        if the regex is a simple literal enumeration (e.g. /^(A|B|C)$/ or A|B|C).
        """
        if pattern not in self._compiled_regexes:
            clean_pattern = pattern
            if clean_pattern.startswith('/') and clean_pattern.endswith('/'):
                clean_pattern = clean_pattern[1:-1]

            core = clean_pattern
            exact_core = None

            if core.startswith('^') and core.endswith('$'):
                core = core[1:-1]
                if core.startswith('(') and core.endswith(')'):
                    core = core[1:-1]
                exact_core = core
            elif '|' in core:
                exact_core = core

            if exact_core and re.fullmatch(r'[a-zA-Z0-9_\-\s|]+', exact_core):
                literals = exact_core.split('|')
                if all(literal != "" for literal in literals):
                    self._compiled_regexes[pattern] = set(literals)
                else:
                    try:
                        self._compiled_regexes[pattern] = re.compile(clean_pattern)
                    except re.error:
                        return False
            else:
                try:
                    self._compiled_regexes[pattern] = re.compile(clean_pattern)
                except re.error:
                    return False

        compiled = self._compiled_regexes[pattern]

        if isinstance(compiled, set):
            return string in compiled
        return bool(compiled.search(string))


class MetadataValidator(BaseValidator):
    """Validates metadata dictionary against rules."""

    def __init__(self, metadata: Dict[str, str]):
        super().__init__()
        self.metadata = metadata

    def validate(self, rule: ValidationRule) -> List[str]:
        violations = []
        if rule.domain != "metadata":
            return violations

        val = self.metadata.get(rule.key)

        if rule.operator == "exists":
            if rule.key not in self.metadata:
                violations.append(f"metadata:{rule.key}")

        elif rule.operator == "!exists":
            if rule.key in self.metadata:
                violations.append(f"metadata:{rule.key}")

        elif rule.operator == "=":
            if rule.key in self.metadata and val != rule.value:
                violations.append(f"metadata:{rule.key}")

        elif rule.operator == "~":
            if rule.key in self.metadata and not self._check_regex(rule.value, val):
                violations.append(f"metadata:{rule.key}")

        return violations


class SpreadsheetValidator(BaseValidator):
    """
    Parses a SocialCalc spreadsheet efficiently and runs validation rules against it.
    """

    def __init__(self, socialcalc_string: str):
        super().__init__()
        self.headers: Dict[str, List[str]] = {}  # Maps header string to one or more column letters (e.g. 'entity' -> ['D', 'E'])
        self.columns: Dict[str, List[Cell]] = defaultdict(list)  # Maps Column Letter to list of Cell objects
        self.row_maps: Dict[str, Dict[int, Cell]] = defaultdict(dict)  # Maps Col -> Row Num -> Cell
        self.max_row: int = 1  # Total rows reported by sheet:c:X:r:Y (fallback: max seen row)

        self._parse_socialcalc(socialcalc_string)

    def _parse_socialcalc(self, sc_string: str) -> None:
        """
        Single-pass parser extracting coordinates, values, attributes, and sheet bounds.
        Also builds a fast O(1) row-lookup map resolving rowspans.
        """
        max_seen_row = 1

        for line in sc_string.splitlines():
            # Capture sheet dimensions (e.g. sheet:c:6:r:8:tvf:2)
            if line.startswith('sheet:'):
                parts = line.split(':')
                for i in range(len(parts) - 1):
                    if parts[i] == 'r':
                        try:
                            self.max_row = max(self.max_row, int(parts[i + 1]))
                        except ValueError:
                            pass
                continue

            # We only care about spreadsheet cell definitions below
            if not line.startswith('cell:'):
                continue

            parts = line.split(':')
            if len(parts) < 3:
                continue

            coord = parts[1]
            match = re.match(r'^([A-Z]+)(\d+)$', coord)
            if not match:
                continue

            col, row_str = match.groups()
            row = int(row_str)
            max_seen_row = max(max_seen_row, row)

            # Check if parts[2] is a recognized value type (t=text, v=value, vt=value/text)
            # If not, the cell has no value and goes straight to formatting attributes.
            value = ""
            attrs = {}

            if parts[2] in ('t', 'v', 'vt'):
                cell_type = parts[2]
                if len(parts) >= 4:
                    raw_val = parts[3]
                    # SocialCalc escapes colons in text as \c and newlines as \n
                    value = raw_val.replace('\\c', ':').replace('\\n', '\n')
                attr_start = 4
            else:
                cell_type = ""
                attr_start = 2

            # Extract attributes (f, tvf, rowspan, bgcolor, etc.)
            for i in range(attr_start, len(parts) - 1, 2):
                attrs[parts[i]] = parts[i + 1]

            cell = Cell(coord, col, row, cell_type, value, attrs)

            # Row 1 determines our validation keys; duplicate headers are allowed.
            if row == 1:
                self.headers.setdefault(value, []).append(col)
            else:
                self.columns[col].append(cell)
                # Map every row within the span directly to this cell for O(1) lookups
                for r in range(row, row + cell.rowspan):
                    self.row_maps[col][r] = cell

        # If no explicit sheet:r was found, fall back to highest seen row
        self.max_row = max(self.max_row, max_seen_row)

    def _iter_column_validation_targets(self, col: str, start_row: int = 2) -> List[Tuple[str, str]]:
        """
        Return (coord, value) pairs for all independently fillable rows in a column.

        - Includes rows that are absent from SocialCalc serialization as empty values.
        - Excludes rows covered by another cell's rowspan in the same column.
        """
        targets: List[Tuple[str, str]] = []
        row_map = self.row_maps.get(col, {})

        for row in range(start_row, self.max_row + 1):
            cell = row_map.get(row)

            if cell is None:
                # No serialized cell at this coordinate -> treat as empty value
                targets.append((f"{col}{row}", ""))
                continue

            # If this row is inside a rowspan but not at its anchor, it is not fillable.
            if cell.row != row:
                continue

            targets.append((f"{col}{row}", cell.value))

        return targets

    def _iter_anchor_cells(self, col: str, start_row: int = 2) -> List[Cell]:
        """
        Return anchor cells for a column from start_row..max_row.
        Anchor means the top row of a (possibly rowspan) cell.
        """
        anchors: List[Cell] = []
        row_map = self.row_maps.get(col, {})
        seen_coords: Set[str] = set()

        for row in range(start_row, self.max_row + 1):
            cell = row_map.get(row)
            if not cell:
                continue
            if cell.row != row:
                continue
            if cell.coord in seen_coords:
                continue
            seen_coords.add(cell.coord)
            anchors.append(cell)

        return anchors

    def _header_cols(self, header_name: str) -> List[str]:
        """
        Return all columns whose row-1 header text equals header_name.
        Supports duplicate logical headers (e.g. multiple 'entity' columns).
        """
        return self.headers.get(header_name, [])

    def _first_header_col(self, header_name: str) -> Optional[str]:
        """
        Return first column for a header (legacy single-column semantics).
        """
        cols = self._header_cols(header_name)
        return cols[0] if cols else None

    def validate(self, rule: ValidationRule,
            ner_pos_config: Optional[Dict[str, Dict[str, List[str]]]] = None
            ) -> List[str]:
        """
        Tests a validation rule and returns a list of violating positions/keys.
        """
        violations: List[str] = []

        if rule.domain == "spreadsheet":
            if rule.operator == "exists":
                if not self._header_cols(rule.key):
                    violations.append(f"header:{rule.key}")

            elif rule.operator == "!exists":
                if self._header_cols(rule.key):
                    violations.append(f"header:{rule.key}")

            elif rule.operator in ("=", "~"):
                # Standard value matching checks across all valid row positions in one column.
                # Legacy behavior: if duplicates exist, use first matching column.
                col = self._first_header_col(rule.key)
                if not col:
                    return []

                targets = self._iter_column_validation_targets(col, start_row=2)

                if rule.operator == "=":
                    for coord, value in targets:
                        if value != rule.value:
                            violations.append(coord)

                elif rule.operator == "~":
                    for coord, value in targets:
                        if not self._check_regex(rule.value, value):
                            violations.append(coord)

            elif rule.operator in ("==", "|", ">"):
                # Column-to-column structural/value comparisons.
                # Legacy behavior: if duplicates exist, use first column for each logical header.
                key_col = self._first_header_col(rule.key)
                val_col = self._first_header_col(rule.value) if rule.value else None
                if not key_col or not val_col:
                    return []

                key_cells = self.columns[key_col]

                for key_cell in key_cells:
                    if rule.operator in ("==", "|"):
                        val_cell = self.row_maps[val_col].get(key_cell.row)

                        if not val_cell:
                            violations.append(key_cell.coord)
                            continue

                        if rule.operator == "==":
                            if key_cell.value != val_cell.value:
                                violations.append(key_cell.coord)

                        elif rule.operator == "|":
                            if key_cell.row != val_cell.row or key_cell.rowspan != val_cell.rowspan:
                                violations.append(key_cell.coord)

                    elif rule.operator == ">":
                        key_start = key_cell.row
                        key_end = key_cell.row + key_cell.rowspan - 1

                        overlapping_val_cells = set()
                        for r in range(key_start, key_end + 1):
                            v_cell = self.row_maps[val_col].get(r)
                            if v_cell:
                                overlapping_val_cells.add(v_cell)

                        if not overlapping_val_cells:
                            violations.append(key_cell.coord)
                        else:
                            ok = True
                            for v_cell in overlapping_val_cells:
                                val_start = v_cell.row
                                val_end = v_cell.row + v_cell.rowspan - 1
                                if not (key_start <= val_start and key_end >= val_end):
                                    ok = False
                                    break
                            if not ok:
                                violations.append(key_cell.coord)

            elif rule.operator == "&":
                # rule.key (source/granular) concatenates to rule.value (target/aggregate).
                # Violations are reported on target anchor coordinates.
                # Legacy behavior: if duplicates exist, use first column for each logical header.
                source_col = self._first_header_col(rule.key)
                target_col = self._first_header_col(rule.value) if rule.value else None
                if not source_col or not target_col:
                    return []

                source_rows = self.row_maps.get(source_col, {})
                target_anchors = self._iter_anchor_cells(target_col, start_row=2)

                for target_cell in target_anchors:
                    span = max(1, target_cell.rowspan)
                    start = target_cell.row
                    end = start + span - 1

                    parts: List[str] = []
                    for r in range(start, end + 1):
                        source_cell = source_rows.get(r)
                        if source_cell is None:
                            # Missing serialized source cell behaves like empty text.
                            parts.append("")
                            continue

                        # Rowspan continuation rows are not independent source tokens.
                        if source_cell.row != r:
                            continue

                        parts.append(source_cell.value)

                    if "".join(parts) != target_cell.value:
                        violations.append(target_cell.coord)


            elif rule.operator == "nelink":
                # key = entity header, value = identity header
                entity_header = rule.key
                identity_header = rule.value or "identity"

                # Defaults if config is missing/malformed
                pos_header = "pos"
                named_pos = ["NP"]

                if ner_pos_config:
                    ann_cfg = ner_pos_config.get(entity_header, {})
                    # Expected: {"pos": ["NNP", "NNPS", ...]} (single key map)
                    if isinstance(ann_cfg, dict) and ann_cfg:
                        first_key = next(iter(ann_cfg.keys()))
                        first_vals = ann_cfg.get(first_key)

                        if isinstance(first_key, str) and first_key:
                            pos_header = first_key
                        if isinstance(first_vals, list):
                            cleaned = [str(v).strip() for v in first_vals if str(v).strip()]
                            if cleaned:
                                named_pos = cleaned

                result = self.validate_entity_linking(
                    pos_header=pos_header,
                    entity_header=entity_header,
                    identity_header=identity_header,
                    named_pos=named_pos,
                )

                if not result["is_valid"]:
                    violations.append(str(result["message"]))

        return violations

    def validate_entity_linking(
                self,
                pos_header: str = "pos",
                entity_header: str = "entity",
                identity_header: str = "identity",
                named_pos: Optional[Iterable[str]] = None,
        ) -> Dict[str, Union[bool, int, str, List[str]]]:
        """
        Validate that named entity spans in a spreadsheet, where tokens are in consecutive rows,
        are linked by non-empty identity spans. Evaluates at the distinct string type level.

        Rules:
        - Named rows are rows where any POS column matching `pos_header` has a value in `named_pos`.
        - For each named row, choose the smallest filled entity span containing that row
        (tie-breaker: earliest start row).
        - Expected entity types are the deduplicated set of text strings from these minimal spans.
        - Resolved entity types are those where ALL instances of that text string have a filled 
        identity span matched by exact (start, end). If ANY instance of a string type lacks
        an identity link, the entire type fails validation.
        - If the identity column is missing entirely, all found entity types will fail validation.
        - Named rows with no containing entity span are ignored.

        Returns a summary payload usable by callers/UI.
        """
        named_set: Set[str] = set(named_pos or ["PROPN"])

        def _header_cols(header_name: str) -> List[str]:
            # Duplicate headers are stored directly in self.headers.
            return self._header_cols(header_name)

        pos_cols = _header_cols(pos_header)
        entity_cols = _header_cols(entity_header)
        identity_cols = _header_cols(identity_header)

        # If we lack pos or entity columns, we cannot find any named entities,
        # so treat as 0 expected identities. 
        if not pos_cols or not entity_cols:
            return {
                "is_valid": True,
                "message": "No entity identities",
                "resolved": 0,
                "expected": 0,
                "missing_types": [],
            }

        # 1) Find named rows (any POS col marks the row as named).
        named_rows: Set[int] = set()
        for r in range(2, self.max_row + 1):
            for col in pos_cols:
                cell = self.row_maps.get(col, {}).get(r)
                if cell and cell.value in named_set:
                    named_rows.add(r)
                    break

        # 2) Collect all filled entity spans along with their string values.
        # Span key = (start_row, end_row, text_value)
        entity_spans: List[Tuple[int, int, str]] = []
        seen_entity_coords: Set[str] = set()

        for col in entity_cols:
            row_map = self.row_maps.get(col, {})
            for r in range(2, self.max_row + 1):
                cell = row_map.get(r)
                if not cell:
                    continue
                if cell.row != r:  # continuation row of a rowspan
                    continue
                if cell.coord in seen_entity_coords:
                    continue
                
                seen_entity_coords.add(cell.coord)
                
                if cell.value == "":
                    continue

                start = cell.row
                end = cell.row + max(1, cell.rowspan) - 1
                val = str(cell.value).strip()
                entity_spans.append((start, end, val))

        # 3) For each named row, choose minimal containing entity span.
        expected_span_instances: Set[Tuple[int, int, str]] = set()
        for r in named_rows:
            containing = [sp for sp in entity_spans if sp[0] <= r <= sp[1]]
            if not containing:
                # Per your rule: ignore named rows that have no entity span.
                continue

            containing.sort(key=lambda sp: ((sp[1] - sp[0] + 1), sp[0]))
            expected_span_instances.add(containing[0])

        # 4) Collect filled identity spans (we only need coordinates here).
        # If identity_cols is empty, this simply results in an empty set.
        identity_spans: Set[Tuple[int, int]] = set()
        seen_identity_coords: Set[str] = set()

        for col in identity_cols:
            row_map = self.row_maps.get(col, {})
            for r in range(2, self.max_row + 1):
                cell = row_map.get(r)
                if not cell:
                    continue
                if cell.row != r:
                    continue
                if cell.coord in seen_identity_coords:
                    continue
                
                seen_identity_coords.add(cell.coord)
                
                if cell.value == "":
                    continue

                start = cell.row
                end = cell.row + max(1, cell.rowspan) - 1
                identity_spans.add((start, end))

        # 5) Aggregate instances into distinct string types
        expected_types: Set[str] = set()
        unresolved_types: Set[str] = set()

        for start, end, val in expected_span_instances:
            expected_types.add(val)
            # If ANY specific instance lacks a linked identity, the whole string type counts as unresolved
            if (start, end) not in identity_spans:
                unresolved_types.add(val)

        expected = len(expected_types)
        if expected == 0:
            return {
                "is_valid": True,
                "message": "No entity identities",
                "resolved": 0,
                "expected": 0,
                "missing_types": [],
            }

        resolved_types = expected_types - unresolved_types
        resolved = len(resolved_types)
        missing_types = sorted(unresolved_types)

        return {
            "is_valid": resolved == expected,
            "message": f"{resolved}/{expected} entity types resolved",
            "resolved": resolved,
            "expected": expected,
            "missing_types": missing_types,
        }

class SGMLValidator(BaseValidator):
    """A class to validate well-formed SGML-like structures and SGML-specific rules."""

    # Pre-compile regexes at the class level to avoid recompiling on every parse
    _RE_NO_CONTENT = re.compile(r'<([^\s]+)( [^<>]+)?>_?</\1>', flags=re.DOTALL)
    _RE_BAD_UNARY = re.compile(r'<(note|gap)( [a-z:_]+="[^"]*")?/>', flags=re.DOTALL)
    _RE_ANGLE_BRACKETS = re.compile(r'>[^<>]*>|<[^<>]*<', flags=re.DOTALL)
    _RE_TAG = re.compile(r'<(/?)(\w+)(.*?)/?>', flags=re.UNICODE)

    # Validates attributes: starting with whitespace, followed by key="value" pairs
    _RE_ATTRS = re.compile(r'^(?:\s+[\w:]+="[^"]*")*\s*$', flags=re.UNICODE)

    def __init__(self):
        super().__init__()

    @staticmethod
    def _offset_to_line_number(sgml: str, offset: int) -> int:
        """Helper method to convert a character offset to a line number."""
        return sgml.count("\n", 0, offset) + 1

    def _parse_and_validate_wellformedness(self, sgml: str) -> Tuple[bool, Union[str, Set[str]]]:
        """
        Check SGML well-formedness and return the set of seen tag names on success.
        """
        no_content: Optional[Match[str]] = self._RE_NO_CONTENT.search(sgml)
        if no_content:
            line_num: int = self._offset_to_line_number(sgml, no_content.start())
            return False, f"Empty tags: {no_content.group(0)} opens and closes at position {no_content.start()}, line {line_num}"

        bad_unary: Optional[Match[str]] = self._RE_BAD_UNARY.search(sgml)
        if bad_unary:
            line_num = self._offset_to_line_number(sgml, bad_unary.start())
            return False, f"Unary tag: {bad_unary.group(1)} not allowed, found at position {bad_unary.start()}, line {line_num}"

        angle_brackets: Optional[Match[str]] = self._RE_ANGLE_BRACKETS.search(sgml)
        if angle_brackets:
            line_num = self._offset_to_line_number(sgml, angle_brackets.start())
            return False, f"Angle brackets outside tags: {angle_brackets.group(0)} at position {angle_brackets.start()}, line {line_num}"

        seen_tags: Set[str] = set()
        tag_stack: List[str] = []

        for match in self._RE_TAG.finditer(sgml):
            tag_full, closing_slash, tag_name, tag_attributes = match.group(0, 1, 2, 3)

            if tag_attributes and not self._RE_ATTRS.fullmatch(tag_attributes):
                line_num = self._offset_to_line_number(sgml, match.start())
                return False, f"Invalid attributes in tag {tag_full} at position {match.start()}, line {line_num}"

            if not closing_slash:
                seen_tags.add(tag_name)
                if not tag_full.endswith('/>'):
                    if tag_name in tag_stack:
                        line_num = self._offset_to_line_number(sgml, match.start())
                        return False, f"Nested tag {tag_name} at position {match.start()}, line {line_num}"
                    tag_stack.append(tag_name)
            else:
                if not tag_stack:
                    line_num = self._offset_to_line_number(sgml, match.start())
                    return False, f"Unexpected closing tag {tag_full} at position {match.start()}, line {line_num}"

                if tag_stack[-1] == tag_name:
                    tag_stack.pop()
                else:
                    try:
                        tag_stack.remove(tag_name)
                    except ValueError:
                        last_tag: str = tag_stack[-1]
                        line_num = self._offset_to_line_number(sgml, match.start())
                        return False, f"Mismatched tags: <{last_tag}> closed by </{tag_name}> at position {match.start()}, line {line_num}"

        if tag_stack:
            return False, f"Unclosed tags: {', '.join(tag_stack)}"

        return True, seen_tags

    def validate(self, sgml: str, rule: Optional[ValidationRule] = None) -> List[str]:
        """
        Validate SGML well-formedness and, optionally, apply an SGML rule.
        Returns a list of violations.
        """
        is_valid, result = self._parse_and_validate_wellformedness(sgml)
        if not is_valid:
            return [str(result)]

        seen_tags: Set[str] = result  # type: ignore[assignment]

        if rule is None:
            return []

        violations: List[str] = []

        if rule.key == "tag" and rule.operator in ("=", "~"):
            if not rule.value:
                return violations

            if rule.operator == "=":
                violations.extend(sorted(tag for tag in seen_tags if tag != rule.value))

            elif rule.operator == "~":
                violations.extend(sorted(tag for tag in seen_tags if not self._check_regex(rule.value, tag)))

        return violations


def run_all_validations(
    indata: str,
    input_type: str,
    metadata: Dict[str, str],
    rule_specs: List[Dict[str, str]],
    config: Optional[Dict[str, object]] = None
) -> List[Dict[str, Union[str, List[str]]]]:
    """
    Convenience function to run multiple validations on a single document.
    rule_specs should be a list of dictionaries, e.g.:
    [{"domain": "spreadsheet", "key": "pos", "operator": "~", "value": "/^(VBP|PP|VVG)$/"}]
    """
    results = []

    # Initialize the appropriate validators based on input_type
    ss_validator = SpreadsheetValidator(indata) if input_type == "spreadsheet" else None
    sgml_validator = SGMLValidator() if input_type == "xml" else None
    meta_validator = MetadataValidator(metadata)

    ner_pos_config: Dict[str, Dict[str, List[str]]] = {}
    if config:
        entities = config.get("entities")
        if isinstance(entities, dict):
            annotations = entities.get("annotations")
            if isinstance(annotations, dict):
                for ann_name, ann_cfg in annotations.items():
                    if not isinstance(ann_cfg, dict):
                        continue
                    ner_pos = ann_cfg.get("ner_pos")
                    if isinstance(ner_pos, dict):
                        # Keep only list-valued entries
                        normalized: Dict[str, List[str]] = {}
                        for k, v in ner_pos.items():
                            if isinstance(k, str) and isinstance(v, list):
                                normalized[k] = v
                        if normalized:
                            ner_pos_config[str(ann_name)] = normalized

    for spec in rule_specs:
        domain = spec.get("domain", "")
        rule = ValidationRule(
            domain=domain,
            key=spec.get("key", ""),
            operator=spec.get("operator", ""),
            value=spec.get("value")
        )

        # Skip domain rules that do not apply to the current input_type
        if domain in ("spreadsheet", "xml") and domain != input_type:
            continue

        violations = []
        if domain == "metadata":
            violations = meta_validator.validate(rule)
        elif domain == "spreadsheet" and ss_validator:
            violations = ss_validator.validate(rule, ner_pos_config=ner_pos_config)
        elif domain == "xml" and sgml_validator:
            violations = sgml_validator.validate(indata, rule)

        # Format a readable rule string for the output
        val_str = f" {rule.value}" if rule.value else ""
        rule_str = f"{rule.key} {rule.operator}{val_str}"

        results.append({
            "domain": domain,
            "rule": rule_str,
            "violations": violations
        })

    return results


# ==============
# Example Usage
# ==============
if __name__ == "__main__":
    import json

    sc_data = """version:1.5
cell:A1:t:tok:f:2:bgcolor:#f3f4f6
cell:B1:t:pos:f:2:bgcolor:#f3f4f6
cell:C1:t:pos_copy:f:2:bgcolor:#f3f4f6
cell:D1:t:s_type:f:2:bgcolor:#f3f4f6

cell:B2:t:VVG:f:1:tvf:1
cell:C2:t:VVG:f:1:tvf:1

cell:B3:t:PPK:f:1:tvf:1
cell:C3:t:PP_ERROR:f:1:tvf:1

cell:D3:t:decl:f:1:tvf:1:rowspan:15
cell:B4:t:VBP:f:1:tvf:1
cell:C4:t:VBP:f:1:tvf:1"""


    sc_data2 = """
cell:A1:t:tok:f:2:bgcolor:#f3f4f6
cell:B1:t:orig_group:f:2:bgcolor:#f3f4f6
cell:C1:t:norm_group:f:2:bgcolor:#f3f4f6
cell:D1:t:pos:f:2:bgcolor:#f3f4f6
cell:E1:t:lemma:f:2:bgcolor:#f3f4f6
cell:F1:t:orig:f:2:bgcolor:#f3f4f6
cell:G1:t:norm:f:2:bgcolor:#f3f4f6
cell:H1:t:lb_n:f:2:bgcolor:#f3f4f6
cell:I1:t:xml:f:2:bgcolor:#f3f4f6
cell:J1:t:hi_rend:f:2:bgcolor:#f3f4f6
cell:A2:t:ⲁ:f:1:tvf:1
cell:B2:t:ⲁϥⲥⲱⲧⲙ:f:1:tvf:1:rowspan:3
cell:C2:t:ⲁϥⲥⲱⲧⲙ:f:1:tvf:1:rowspan:3
cell:D2:t:APST:f:1:tvf:1
cell:E2:t:ⲁ:f:1:tvf:1
cell:F2:t:ⲁ:f:1:tvf:1
cell:G2:t:ⲁ:f:1:tvf:1
cell:H2:t:1:f:1:tvf:1:rowspan:3
cell:I2:t:xml:f:1:tvf:1:rowspan:3
cell:A3:t:ϥ:f:1:tvf:1
cell:D3:t:PPERS:f:1:tvf:1
cell:E3:t:ⲛⲧⲟϥ:f:1:tvf:1
cell:F3:t:ϥ:f:1:tvf:1
cell:G3:t:ϥ:f:1:tvf:1
cell:J3:t:gold:f:1:tvf:1
cell:A4:t:ⲥⲱⲧⲙ:f:1:tvf:1
cell:D4:t:V:f:1:tvf:1
cell:E4:t:ⲥⲱⲧⲙ:f:1:tvf:1
cell:F4:t:ⲥⲱⲧⲙ:f:1:tvf:1
cell:G4:t:ⲥⲱⲧⲙ:f:1:tvf:1
cell:A5:t:ⲉ:f:1:tvf:1
cell:B5:t:ⲉⲡⲉⲡⲛⲁ:f:1:tvf:1:rowspan:3
cell:C5:t:ⲉⲡⲉⲡⲛⲁ:f:1:tvf:1:rowspan:3
cell:D5:t:PREP:f:1:tvf:1
cell:E5:t:ⲉ:f:1:tvf:1
cell:F5:t:ⲉ:f:1:tvf:1
cell:G5:t:ⲉ:f:1:tvf:1
cell:A6:t:ⲡⲉ:f:1:tvf:1
cell:D6:t:ART:f:1:tvf:1
cell:E6:t:ⲡ:f:1:tvf:1
cell:F6:t:ⲡⲉ:f:1:tvf:1
cell:G6:t:ⲡⲉ:f:1:tvf:1
cell:A7:t:ⲡⲛⲁ:f:1:tvf:1
cell:D7:t:N:f:1:tvf:1
cell:E7:t:ⲡⲛⲉⲩⲙⲁ:f:1:tvf:1
cell:F7:t:ⲡⲛⲁ:f:1:tvf:1
cell:G7:t:ⲡⲛⲉⲩⲙⲁ:f:1:tvf:1
"""

    sc_data3 = """cell:A1:t:tok:f:1
cell:B1:t:pos:f:2:bgcolor:#f3f4f6
cell:C1:t:sent:f:1
cell:D1:t:entity:f:2:bgcolor:#f3f4f6
cell:E1:t:entity:f:2:bgcolor:#f3f4f6
cell:F1:t:identity:f:2:bgcolor:#f3f4f6
cell:G1:t:identity:f:2:bgcolor:#f3f4f6
cell:A2:t:People
cell:B2:t:NOUN:bg:1
cell:C2:t:1:rowspan:9
cell:D2:t:person
cell:A3:t:like
cell:B3:t:VERB:bg:1
cell:A4:t:Paris
cell:B4:t:PROPN:bg:1
cell:D4:t:place:rowspan:2
cell:F4:t:Paris (France):rowspan:2
cell:A5:t:France
cell:B5:t:PROPN:bg:1
cell:E5:t:place
cell:G5:t:France
cell:A6:t:more
cell:B6:t:ADV:bg:1
cell:A7:t:than
cell:B7:t:PROPN:bg:1
cell:A8:t:Paris
cell:B8:t:ADJ:bg:1
cell:D8:t:place:rowspan:2
cell:F8:t:Paris (Ontario):rowspan:2
cell:A9:t:Ontario
cell:B9:t:PROPN:bg:1
cell:E9:t:place
cell:A10:t:.
cell:B10:t:SENT:bg:1"""

    meta = {"author": "John Doe", "status": "draft"}


    # Define a batch of rules to run at once
    rules_batch = [
        {"domain": "spreadsheet", "key": "pos", "operator": "==", "value": "pos_copy"},
        {"domain": "spreadsheet", "key": "pos", "operator": "|", "value": "pos_copy"},
        {"domain": "spreadsheet", "key": "s_type", "operator": ">", "value": "pos"},
        {"domain": "spreadsheet", "key": "pos", "operator": "~", "value": "/^(VBP|PP|VVG)$/"},
        {"domain": "spreadsheet", "key": "lang", "operator": "~", "value": "/^(Greek|Arabic|Hebrew|)$/"},
        {"domain": "metadata", "key": "editor", "operator": "exists"},
    ]

    # Run the aggregated validations for spreadsheet
    print("=== Spreadsheet & Metadata Validation ===")
    spreadsheet_results = run_all_validations(sc_data3, "spreadsheet", meta, rules_batch)
    print(json.dumps(spreadsheet_results, indent=2))


    quit()

    rules_batch = [
        {"domain": "xml", "key": "wellformed", "operator": "exists"},
        {"domain": "xml", "key": "tag", "operator": "~", "value": "ed_line|ed_pg|pb|chapter"},
                   ]

    sgml_data = """<ed_line n="1"><ed_pg n="512"/><pb xml:id="MERC.AM135"/><chapter n="1"/><verse n="1"/>ⲞⲨ|ⲖⲞⲄⲞⲤ_·_Ⲉ|Ⲁ|Ϥ|ⲦⲀⲨⲞ|Ϥ_ⲚϬⲒ|Ⲡ|ϨⲀⲄⲒⲞⲤ_</ed_line>
    <ed_line n="2">ⲆⲒⲘⲰⲐⲈⲞⲤ_Ⲡ|ⲀⲢⲬ<pb></pb>ⲎⲈ<q></q>ⲠⲒⲤⲔⲞⲠⲞⲤ_Ⲛ̄|ⲢⲀ</ed_line>
    <ed_line n="3">ⲔⲞⲦⲈ_·_ⲈⲦⲂⲈ|Ⲡ|ϢⲀ_·_Ⲙ|Ⲡ|ⲀⲢⲬⲀⲄⲄⲈⲖⲞⲤ_·_</ed_line>"""

    # Run the aggregated validations for SGML
    print("\n=== SGML & Metadata Validation ===")
    sgml_results = run_all_validations(sgml_data, "xml", meta, rules_batch)
    print(json.dumps(sgml_results, indent=2))


    # Second test, test sums operator
    rules_batch = [
        {"domain": "spreadsheet", "key": "norm_group", "operator": ">", "value": "norm"},
        {"domain": "spreadsheet", "key": "norm", "operator": "&", "value": "norm_group"},
        {"domain": "spreadsheet", "key": "entity", "operator": "nelink", "value": "identity"},
    ]
    print("=== Spreadsheet Validation 2 - sums up to (&) ===")
    spreadsheet_results = run_all_validations(sc_data3, "spreadsheet", {}, rules_batch)


    print(json.dumps(spreadsheet_results, indent=2))

