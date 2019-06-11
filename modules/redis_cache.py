import redis

r = redis.Redis()
GITDOX_PREFIX = "__gitdox"
SEP = "|"
REPORT = "report"
TIMESTAMP = "timestamp"

def make_key(doc_id, validation_type):
    if validation_type not in ["xml", "ether", "meta", "export"]:
        raise Exception("Unknown validation type: " + validation_type)

    return SEP.join([GITDOX_PREFIX, str(doc_id), validation_type])

# Functions for xml and meta ----------------------------------------------------
def get_validation_result(doc_id, validation_type):
    key = make_key(doc_id, validation_type)
    if key + SEP + REPORT in r:
        return r.get(key + SEP + REPORT)
    return False

def cache_validation_result(doc_id, validation_type, report):
    """Caching for non-ethercalc-based validation types, currently ether and export."""
    if validation_type not in ["xml", "meta"]:
        raise Exception("Mode must be one of 'xml', 'meta'.")
    key = make_key(doc_id, validation_type)
    r.set(key + SEP + REPORT, report)

# Functions for ether and export ------------------------------------------------
def cache_timestamped_validation_result(doc_id, validation_type, report, timestamp):
    """Caching for ethercalc-based validation types, currently ether and export.
    For xml and meta we are able to maintain the cache because Gitdox knows when
    xml or meta has changed, but with ethercalc, Gitdox is not informed of
    changes, so we must compare timestamps."""
    if validation_type not in ["ether", "export"]:
        raise Exception("Mode must be one of 'ether', 'export'.")
    key = make_key(doc_id, validation_type)
    r.set(key + SEP + REPORT, report)
    r.set(key + SEP + TIMESTAMP, timestamp)

# common ------------------------------------------------------------------------
def invalidate_validation_result(doc_id, validation_type):
    key = make_key(doc_id, validation_type)
    r.delete(key + SEP + REPORT)
    if key + SEP + TIMESTAMP in r:
        r.delete(key + SEP + TIMESTAMP)
