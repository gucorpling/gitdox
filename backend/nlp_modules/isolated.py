"""Run memory-hungry NLP tools in a short-lived child process.

Torch/stanza/diaparser do not reliably return memory to the OS after a model is
freed, so the API process would keep growing. Running each call in its own
process guarantees all memory is released when the call finishes.
"""
import json
import os
import subprocess
import sys
import threading

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
_slots = threading.BoundedSemaphore(int(os.environ.get("NLP_MAX_PARALLEL", "2")))
TIMEOUT = int(os.environ.get("NLP_TIMEOUT_SECONDS", "900"))


def run_isolated(tool, *args, **kwargs):
    payload = json.dumps({"tool": tool, "args": args, "kwargs": kwargs})
    with _slots:
        proc = subprocess.run(
            [sys.executable, "-m", "nlp_modules.isolated", ],
            input=payload, capture_output=True, text=True, encoding="utf-8",
            cwd=_BACKEND, timeout=TIMEOUT,
        )
    if proc.returncode != 0:
        tail = (proc.stderr or "").strip().splitlines()[-5:]
        raise RuntimeError(f"{tool} subprocess failed: " + " | ".join(tail))
    return json.loads(proc.stdout)["result"]


def _main():
    req = json.loads(sys.stdin.read())
    real_stdout = sys.stdout
    sys.stdout = sys.stderr  # keep library prints out of the result channel

    tool = req["tool"]
    if tool == "diaparse":
        from nlp_modules.diaparse import diaparse as fn
    elif tool == "stanza_tag":
        from nlp_modules.stanza_tag import main as fn
    elif tool == "flair_tag":
        from nlp_modules.flair_tag import main as fn
    else:
        raise ValueError(f"Unknown tool: {tool}")

    result = fn(*req["args"], **req["kwargs"])
    real_stdout.write(json.dumps({"result": result}))
    real_stdout.flush()


if __name__ == "__main__":
    _main()
