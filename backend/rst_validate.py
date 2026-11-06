"""
Structural RST validation straight from the parsed SocialCalc cells (no tree model is built).

Cell encoding (see frontend/src/components/rstweb/rst-io.js), cell values are already unescaped:
  edu column    "id:relname:parent" ("3" for a root EDU), one cell per EDU
  node columns  "id:kind:relname:parent" (kind span|multinuc; "7:span" for a root), any number of same-named columns
The graph is defined by the ids and parents only, as in the widget. Ids are read as written, so cells that are stale
after a Segmenter edit simply leave the affected EDUs out of the graph until the RST editor rewrites them.

Checks (rule key; rule operator is always "!exists", i.e. the pathology must not occur), ported from legacy rstWeb:
  empty_hierarchy   a span with a single span child, a span with a single multinuc child without satellites,
                    an EDU related to a span by "span" with no satellites of its own
  multiple_flat     a span or EDU with two or more satellites (non-"span" relation children) - too little hierarchy
  single_multinuc   a multinuc with exactly one multinuc-relation child
"""

from collections import defaultdict
from typing import Dict, List, Optional, Tuple

RST_CHECKS = ("empty_hierarchy", "multiple_flat", "single_multinuc")

_DEFAULT_COLUMNS = {"edu": "edu", "node": "node"}
_RESERVED_RELATIONS = {"span", "multinuc"}


def _to_list(value) -> List[str]:
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str):
        return [s.strip() for s in value.replace(";", ",").split(",") if s.strip()]
    return []


def _column_name(rst_config: dict, key: str) -> str:
    value = rst_config.get(key)
    return value.strip() if isinstance(value, str) and value.strip() else _DEFAULT_COLUMNS[key]


class _Node:
    __slots__ = ("id", "kind", "relname", "parent", "coord")

    def __init__(self, node_id: int, kind: str, relname: str, parent: Optional[int], coord: str):
        self.id = node_id
        self.kind = kind
        self.relname = relname
        self.parent = parent
        self.coord = coord


def _int_or_none(text: str) -> Optional[int]:
    return int(text) if text.isdigit() else None


class RstGraph:
    """Nodes and children of the RST tree encoded in a SpreadsheetValidator's cells"""

    def __init__(self, sheet, rst_config: Optional[dict]):
        rst_config = rst_config if isinstance(rst_config, dict) else {}
        relations = rst_config.get("relations")
        multinuc = relations.get("multinuc") if isinstance(relations, dict) else None
        self.multinuc_relations = set(_to_list(multinuc)) - _RESERVED_RELATIONS

        # Ids are renumbered as the widget does when reading: EDUs by position, groups after them in old id order,
        # so that ids reported in violations are the ones shown in the editor even when the cells are stale
        edu_raw = []
        edu_cols = sheet.headers.get(_column_name(rst_config, "edu"), [])
        for cell in (sheet.columns.get(edu_cols[0], []) if edu_cols else []):
            parts = cell.value.strip().split(":")
            relname = parts[1] if len(parts) > 1 else ""
            parent = _int_or_none(parts[2]) if len(parts) > 2 else None
            edu_raw.append((cell.row, _int_or_none(parts[0]), relname, parent, cell.coord))
        edu_raw.sort(key=lambda t: t[0])

        group_raw = []
        for col in sheet.headers.get(_column_name(rst_config, "node"), []):
            for cell in sheet.columns.get(col, []):
                parts = cell.value.strip().split(":")
                old_id = _int_or_none(parts[0])
                if old_id is None or len(parts) < 2 or parts[1] not in ("span", "multinuc"):
                    continue
                relname = parts[2] if len(parts) > 2 else ""
                parent = _int_or_none(parts[3]) if len(parts) > 3 else None
                group_raw.append((old_id, parts[1], relname, parent, cell.coord))

        old_to_new: Dict[int, int] = {}
        pending = []  # (node, old parent id)
        self.nodes: Dict[int, _Node] = {}
        for i, (_, old_id, relname, parent, coord) in enumerate(edu_raw):
            node = self.nodes[i + 1] = _Node(i + 1, "edu", relname, None, coord)
            if old_id is not None and old_id not in old_to_new:
                old_to_new[old_id] = node.id
            pending.append((node, parent))
        for old_id, kind, relname, parent, coord in sorted(group_raw, key=lambda t: t[0]):
            if old_id in old_to_new:
                continue
            node = self.nodes[len(self.nodes) + 1] = _Node(len(self.nodes) + 1, kind, relname, None, coord)
            old_to_new[old_id] = node.id
            pending.append((node, parent))

        self.children: Dict[int, List[_Node]] = defaultdict(list)
        self.attached = set()  # ids of nodes with an existing parent; the relation of any other node is meaningless
        for node, old_parent in pending:
            # A reference to a missing node leaves the node detached, as when the widget reads the sheet
            parent = old_to_new.get(old_parent) if old_parent is not None else None
            if parent is not None and parent != node.id:
                node.parent = parent
                self.children[parent].append(node)
                self.attached.add(node.id)

    def relation_type(self, relname: str) -> str:
        if relname == "span":
            return "span"
        return "multinuc" if relname in self.multinuc_relations else "rst"

    def ordered(self) -> List[_Node]:
        return sorted(self.nodes.values(), key=lambda n: n.id)


def _empty_hierarchy(graph: RstGraph) -> List[_Node]:
    flagged: Dict[int, _Node] = {}
    for node in graph.ordered():
        kids = graph.children[node.id]
        if node.kind == "span":
            for child in kids:
                if child.kind == "span" and child.relname == "span" and len(graph.children[child.id]) == 1:
                    flagged[child.id] = child
                elif child.kind == "multinuc" and child.relname == "span":
                    if not any(graph.relation_type(g.relname) == "rst" for g in graph.children[child.id]):
                        flagged[child.id] = child
        if node.kind == "edu" and node.relname == "span" and node.id in graph.attached and not kids:
            flagged[node.id] = node
    return list(flagged.values())


def _multiple_flat(graph: RstGraph) -> List[_Node]:
    return [
        node for node in graph.ordered()
        if node.kind != "multinuc" and sum(1 for c in graph.children[node.id] if c.relname != "span") > 1
    ]


def _single_multinuc(graph: RstGraph) -> List[_Node]:
    return [
        node for node in graph.ordered()
        if node.kind == "multinuc"
        and sum(1 for c in graph.children[node.id] if graph.relation_type(c.relname) == "multinuc") == 1
    ]


_CHECKS = {
    "empty_hierarchy": _empty_hierarchy,
    "multiple_flat": _multiple_flat,
    "single_multinuc": _single_multinuc,
}


def validate_rst(sheet, key: str, operator: str, rst_config: Optional[dict]) -> Tuple[List[str], List[int]]:
    """
    Runs one check on a SpreadsheetValidator. Returns (violations, node_ids): the violations are the coordinates of the
    offending nodes' cells (as for spreadsheet rules, so they can be highlighted there) and node_ids are their RST ids.
    """
    check = _CHECKS.get(key)
    if check is None or operator != "!exists":
        return [f"rst:unknown rule '{key} {operator}'"], []

    graph = getattr(sheet, "_rst_graph", None)
    if graph is None:
        graph = sheet._rst_graph = RstGraph(sheet, rst_config)

    flagged = check(graph)
    return [n.coord for n in flagged], [n.id for n in flagged]
