import time
from pathlib import Path

from validate import run_all_validations

EXAMPLES = Path(__file__).resolve().parent.parent / "frontend" / "src" / "components" / "rstweb" / "examples"
CONFIG = {"rstweb": {"relations": {"rst": ["elaboration", "evidence"], "multinuc": ["joint", "sequence"]}}}
RULES = [{"domain": "rst", "key": k, "operator": "!exists", "value": ""}
         for k in ("empty_hierarchy", "multiple_flat", "single_multinuc")]


def sheet(edus, nodes=()):
    """edus: list of edu cell strings, one token each; nodes: list of node cell strings (single column, one row each)"""
    lines = ["cell:A1:t:tok", "cell:B1:t:edu", "cell:C1:t:node"]
    for i, cell in enumerate(edus):
        lines += [f"cell:A{i + 2}:t:w{i}", f"cell:B{i + 2}:t:{cell.replace(':', chr(92) + 'c')}"]
    for i, cell in enumerate(nodes):
        lines.append(f"cell:C{i + 2}:t:{cell.replace(':', chr(92) + 'c')}")
    return "\n".join(lines + [f"sheet:c:3:r:{len(edus) + 1}"])


def run(edus, nodes=()):
    res = run_all_validations(sheet(edus, nodes), "spreadsheet", {}, RULES, config=CONFIG)
    return {r["rule"].split()[0]: r for r in res}


def test_clean_tree():
    res = run(["1:span:3", "2:elaboration:1", "3"], ["3:span"])
    assert all(not r["violations"] for r in res.values())


def test_empty_span_edu():
    res = run(["1:span:3", "2"], ["3:span"])
    assert res["empty_hierarchy"]["nodes"] == [1]
    assert res["empty_hierarchy"]["violations"] == ["B2"]


def test_lone_edu_with_stale_span_relation():
    # parent 9 does not exist: the EDU is a detached root and its relation is ignored
    res = run(["1:span:9"])
    assert not res["empty_hierarchy"]["violations"]


def test_empty_span_chain():
    res = run(["1:span:2", "2:elaboration:4", "3"], ["4:span:span:5", "5:span"])
    assert 4 in res["empty_hierarchy"]["nodes"] or 5 in res["empty_hierarchy"]["nodes"]


def test_multiple_flat():
    res = run(["1:span:4", "2:elaboration:1", "3:evidence:1"], ["4:span"])
    assert res["multiple_flat"]["nodes"] == [1]


def test_single_multinuc():
    res = run(["1:joint:4", "2:elaboration:1", "3"], ["4:multinuc"])
    assert res["single_multinuc"]["nodes"] == [4]


def test_multinuc_example_runs():
    text = (EXAMPLES / "multinuc.socialcalc").read_text(encoding="utf-8")
    res = run_all_validations(text, "spreadsheet", {}, RULES, config={"rstweb": {}})
    assert len(res) == 3


def test_skipped_without_spreadsheet():
    assert run_all_validations("<a/>", "xml", {}, RULES, config=CONFIG) == []


def test_stale_ids_are_renumbered_like_the_widget():
    # EDU cells say ids 5 and 6 (stale); positions make them 1 and 2, the group becomes 3
    res = run(["5:span:7", "6:elaboration:5", "8"], ["7:span"])
    assert not res["empty_hierarchy"]["violations"]
    assert res["multiple_flat"]["nodes"] == []


def test_speed():
    n = 5000
    edus = ["1:joint:%d" % (n + 1)] + ["%d:joint:%d" % (i, n + 1) for i in range(2, n + 1)]
    start = time.perf_counter()
    run(edus, ["%d:multinuc" % (n + 1)])
    elapsed = time.perf_counter() - start
    print(f"{n} EDUs: {elapsed * 1000:.0f} ms")
    assert elapsed < 2
