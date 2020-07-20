import os
import platform
import redis
from modules.configobj import ConfigObj

r = redis.Redis()
GITDOX_PREFIX = "__gitdox"
SEP = "|"
REPORT = "report"
TIMESTAMP = "timestamp"

if platform.system() == "Windows":
        prefix = "transc\\"
else:
        prefix = ""
rootpath = os.path.dirname(os.path.dirname(os.path.realpath(__file__))) + os.sep
userdir = rootpath + "users" + os.sep
config = ConfigObj(userdir + 'config.ini')
PROJECT_NAME = "_" + (config['project'].lower().replace(" ", "_") if 'project' in config else 'default_project')


def make_key_base(doc_id, validation_type):
    """Keys for this cache have the form, e.g., __gitdox|_gum|123|ether|report
    This function formats the first four pieces of this string."""
    if validation_type not in ["xml", "ether", "meta", "export"]:
        raise Exception("Unknown validation type: " + validation_type)

    return SEP.join([GITDOX_PREFIX, PROJECT_NAME, str(doc_id), validation_type])

# common ------------------------------------------------------------------------
def get_report(doc_id, validation_type):
    """Returns the report for the given validation type if present in the cache,
    False otherwise"""
    key_base = make_key_base(doc_id, validation_type)
    if key_base + SEP + REPORT in r:
        return r.get(key_base + SEP + REPORT)
    return False

def get_timestamp(doc_id, validation_type):
    """For ether and export validation types, returns the associated timestamp
    obtained from roomtimes at the time of validation."""
    key_base = make_key_base(doc_id, validation_type)
    if key_base + SEP + TIMESTAMP in r:
        return r.get(key_base + SEP + TIMESTAMP)
    return False

def invalidate_by_doc(doc_id, validation_type):
    """Invalidates the report for a given validation type for a given doc."""
    key_base = make_key_base(doc_id, validation_type)
    r.delete(key_base + SEP + REPORT)
    if key_base + SEP + TIMESTAMP in r:
        r.delete(key_base + SEP + TIMESTAMP)

def invalidate_by_type(validation_type):
    """Invalidates the reports for a given validation type for all docs."""
    pattern = GITDOX_PREFIX + "*" + SEP + validation_type + SEP + "*"
    for key in r.keys(pattern=pattern):
        r.delete(key)

def reset_cache():
    """Invalidates all reports."""
    pattern = GITDOX_PREFIX + "*"
    for key in r.keys(pattern=pattern):
        r.delete(key)

# Functions for xml and meta ----------------------------------------------------
def cache_validation_result(doc_id, validation_type, report):
    """Caching for non-ethercalc-based validation types, currently xml and meta."""
    if validation_type not in ["xml", "meta"]:
        raise Exception("Mode must be one of 'xml', 'meta'.")
    key_base = make_key_base(doc_id, validation_type)
    r.set(key_base + SEP + REPORT, report)

# Functions for ether and export ------------------------------------------------
def cache_timestamped_validation_result(doc_id, validation_type, report, timestamp):
    """Caching for ethercalc-based validation types, currently ether and export.
    For xml and meta we are able to maintain the cache because Gitdox knows when
    xml or meta has changed, but with ethercalc, Gitdox is not informed of
    changes, so we must compare timestamps."""
    if validation_type not in ["ether", "export"]:
        raise Exception("Mode must be one of 'ether', 'export'.")
    key_base = make_key_base(doc_id, validation_type)
    r.set(key_base + SEP + REPORT, report)
    r.set(key_base + SEP + TIMESTAMP, timestamp)
