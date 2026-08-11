import json
import hashlib
import secrets
import asyncio
import time
import sys, os, zipfile, re
import xml.etree.ElementTree as ET
import yaml
import redis
from io import BytesIO
from typing import Optional, Any, Literal, List, Tuple, Callable
from fastapi import FastAPI, HTTPException, Header, Depends, Body, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from gdutils import social_to_sgml, sgml_to_social, get_social_stylesheets
from github_utils import GitHubUtility
from validate import run_all_validations    
from pathlib import Path
from redis.exceptions import RedisError
from nlp_modules.reorder_sgml import reorder

# NLP modules
from nlp_modules.whitespace_tokenize import tokenize
from nlp_modules.sentence import ssplit
from nlp_modules.tabulation import validate_tt
from nlp_modules.coptic import coptic_tokenize, coptic_nlp_tabulate, coptic_ner
from nlp_modules.identify import suggest_identities
from nlp_modules.indent import reindent
from nlp_modules.stype_classifier import STypeClassifier

MASTER_INIT_SECRET = "my_super_secret_master_password"  # CHANGE THIS BEFORE DEPLOYMENT!
API_PREFIX = (os.environ.get("GITDOX_API_PREFIX", "/gdapi") or "/gdapi").strip()


def _normalize_api_prefix(prefix: str) -> str:
    normalized = (prefix or "").strip()
    if not normalized:
        return ""
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"
    if normalized != "/":
        normalized = normalized.rstrip("/")
    return normalized


def _with_api_prefix(path: str) -> str:
    if not path:
        path = "/"
    if not path.startswith("/"):
        path = f"/{path}"

    if not API_PREFIX:
        return path

    if path == API_PREFIX or path.startswith(f"{API_PREFIX}/"):
        return path

    return f"{API_PREFIX}{path}"


def _prefix_route_decorators(fastapi_app: FastAPI) -> None:
    """
    Wrap route decorator helpers so every new route is registered under API_PREFIX.
    This avoids touching each @app.get/@app.post declaration individually.
    """
    methods = ("get", "post", "put", "delete", "patch", "options", "head")

    for method_name in methods:
        original_method = getattr(fastapi_app, method_name)

        def _wrapped(path: str, *args, _original: Callable = original_method, **kwargs):
            return _original(_with_api_prefix(path), *args, **kwargs)

        setattr(fastapi_app, method_name, _wrapped)


API_PREFIX = _normalize_api_prefix(API_PREFIX)

# --- App & DB Initialization ---
app = FastAPI(
    title="GitDOX Redis Backend",
    docs_url=_with_api_prefix("/docs"),
    redoc_url=_with_api_prefix("/redoc"),
    openapi_url=_with_api_prefix("/openapi.json"),
)
_prefix_route_decorators(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RedisError)
async def handle_redis_error(_, exc: RedisError):
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Redis is unavailable. Start Redis and retry.",
            "error": str(exc)
        }
    )


# Initialize Redis connection. decode_responses=True automatically decodes bytes to strings.
r = redis.Redis(host='127.0.0.1', port=6379, db=0, decode_responses=True)

# Project config
BASE_DIR = Path(__file__).resolve().parent
XML_TAG_SCHEMA_DIR = (BASE_DIR / ".." / "schemas" / "xml_tags").resolve()

def resolve_config_path(project_name: Optional[str] = None) -> Path:
    """Resolve the config file path, prioritizing project-specific configs."""
    if project_name:
        config_path = (BASE_DIR / ".." / f"{project_name}-config.yaml").resolve()
        if config_path.exists():
            return config_path
    return (BASE_DIR / ".." / "gitdox-config.yaml").resolve()

def get_project_config(project_name: Optional[str] = None) -> dict:
    """Helper to load config safely for internal API processes like validation."""
    config_path = resolve_config_path(project_name)
    if not config_path.exists():
        return {}
    try:
        with config_path.open("r", encoding="utf-8") as f:
            loaded = yaml.safe_load(f) or {}
            return loaded if isinstance(loaded, dict) else {}
    except Exception:
        return {}


VALID_DOCUMENT_MODES = {"xml", "spreadsheet", "entities"}


def normalize_document_mode(mode: Optional[str]) -> str:
    normalized = (mode or "").strip().lower()
    return normalized if normalized in VALID_DOCUMENT_MODES else ""


def get_default_document_mode(project_config: Optional[dict]) -> str:
    editors = project_config.get("instance", {}).get("editors") if isinstance(project_config, dict) else None
    if isinstance(editors, dict):
        for raw_key in editors.keys():
            normalized = normalize_document_mode(raw_key)
            if normalized:
                return normalized
    return "xml"

# --- Pydantic Models for Data Validation ---
ALLOWED_VALIDATION_DOMAINS = {"xml", "spreadsheet", "metadata"}
COMMON_IMPORT_EXTENSIONS = (".xml", ".sgml", ".tt")
OVERRIDE_KEYS_REPO = ("repo",)
OVERRIDE_KEYS_ASSIGNED = ("user", "assignee", "assigned")


class ValidationBase(BaseModel):
    document: str = ""
    corpus: str = ""
    domain: str
    key: str
    operator: Literal["exists", "!exists", "=", "==", "|", ">", "~", "&", "nelink"]
    value: str = ""

    @field_validator("document", "corpus", "domain", "key", "value", mode="before")
    @classmethod
    def normalize_string_fields(cls, v):
        if v is None:
            return ""
        if not isinstance(v, str):
            raise ValueError("Field must be a string")
        return v.strip()

    @field_validator("domain")
    @classmethod
    def validate_domain(cls, v):
        if v.lower() not in ALLOWED_VALIDATION_DOMAINS:
            raise ValueError(f"domain must be one of: {', '.join(sorted(ALLOWED_VALIDATION_DOMAINS))}")
        return v.lower()

    @field_validator("key")
    @classmethod
    def validate_key(cls, v):
        if not v:
            raise ValueError("key cannot be empty")
        return v


class ValidationCreate(ValidationBase):
    pass


class ValidationRule(ValidationBase):
    id: str


class UserCreate(BaseModel):
    username: str
    password: str
    realname: str
    adminlevel: int
    email: str
    git_username: Optional[str] = ""
    token: Optional[str] = ""


class UserUpdate(BaseModel):
    password: Optional[str] = ""
    realname: str
    adminlevel: int
    email: str
    git_username: Optional[str] = ""
    token: Optional[str] = ""


class PasswordChange(BaseModel):
    new_password: str


class AuthLogin(BaseModel):
    project_name: str
    username: str
    password: str


class DocumentCreate(BaseModel):
    id: Optional[str] = None
    project: str
    corpus: str
    docname: str
    repo: str = ""
    validation: dict = {}
    mode: Optional[str] = None
    status: str = "init"
    assigned: str = ""
    content_xml: str = ""
    content_spreadsheet: str = ""
    metadata: dict = {}


class DocumentUpdate(BaseModel):
    corpus: str
    docname: str
    repo: str
    mode: str
    status: str
    assigned: str
    metadata: dict


class DocumentRename(BaseModel):
    new_docname: str


class DocumentContentUpdate(BaseModel):
    content_xml: Optional[str] = None
    content_spreadsheet: Optional[str] = None
    format: Optional[str] = "socialcalc"
    last_modified_at: Optional[float] = None

class StatusCategoryList(BaseModel):
    categories: List[str]

    @field_validator("categories")
    @classmethod
    def validate_categories(cls, v):
        if not isinstance(v, list):
            raise ValueError("categories must be a list")

        cleaned = []
        seen = set()

        for item in v:
            if not isinstance(item, str):
                raise ValueError("Each category must be a string")
            name = item.strip()
            if not name:
                continue

            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(name)

        if not cleaned:
            raise ValueError("categories must contain at least one non-empty category")

        return cleaned


class InitProject(BaseModel):
    project_name: str
    admin_username: str
    admin_password: str
    init_secret: str


class NlpMutationRequest(BaseModel):
    tool: str
    content_xml: Optional[str] = None
    content_spreadsheet: Optional[str] = None
    entities: Optional[List[Tuple[str, str]]] = Field(default_factory=list)

    @field_validator("entities")
    @classmethod
    def validate_entities(cls, value):
        if value is None:
            return []

        cleaned = []
        for index, pair in enumerate(value):
            if not isinstance(pair, (list, tuple)) or len(pair) != 2:
                raise ValueError(f"entities[{index}] must be a [name, type] pair")

            name = str(pair[0] if pair[0] is not None else "").strip()
            entity_type = str(pair[1] if pair[1] is not None else "").strip()
            if not name or not entity_type:
                raise ValueError(f"entities[{index}] must include non-empty name and type")

            cleaned.append((name, entity_type))

        return cleaned


class NlpMutationResponse(BaseModel):
    tool: str
    content_xml: Optional[str] = None
    content_spreadsheet: Optional[str] = None
    metadata: Optional[dict] = {}
    identities: Optional[List[str]] = []


# Payload model for GitHub PUT requests
class GitHubCommitRequest(BaseModel):
    file_path: str
    commit_message: str
    content: str
    format: Optional[str] = "xml"
    metadata: Optional[dict] = None


# --- Helper Functions ---
def hash_password(password: str, salt: str = None) -> str:
    """Hashes a password using PBKDF2."""
    if not salt:
        salt = secrets.token_hex(16)
    pwd_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000)
    return f"{salt}${pwd_hash.hex()}"


def verify_password(stored_password: str, provided_password: str) -> bool:
    """Verifies a password against its stored hash."""
    try:
        salt, _ = stored_password.split('$')
        return stored_password == hash_password(provided_password, salt)
    except ValueError:
        return False


def _validation_key(project_name: str, validation_id: str) -> str:
    return f"project:{project_name}:validation:{validation_id}"


def _validation_set_key(project_name: str) -> str:
    return f"project:{project_name}:validations"


def _next_project_doc_id(project_name: str) -> str:
    """
    Return next incremental integer doc ID (as string) for a project,
    based on numeric IDs currently present in project:{project}:docs.
    Non-numeric IDs are ignored.
    """
    max_id = 0
    for existing_id in r.smembers(f"project:{project_name}:docs"):
        try:
            n = int(str(existing_id))
            if n > max_id:
                max_id = n
        except (TypeError, ValueError):
            # Ignore legacy/non-numeric IDs
            continue
    return str(max_id + 1)


def _status_categories_key(project_name: str) -> str:
    return f"project:{project_name}:status_categories"


def _default_status_categories() -> list[str]:
    return ["init"]


def _project_doc_counter_key(project_name: str) -> str:
    return f"project:{project_name}:doc_id_counter"


def _allocate_project_doc_id(project_name: str) -> str:
    """
    Allocate the next numeric document ID for a project.

    Uses a Redis counter for concurrency safety and initializes it from existing
    project docs for backwards compatibility with legacy data.
    """
    counter_key = _project_doc_counter_key(project_name)

    if not r.exists(counter_key):
        # Seed counter to current max numeric doc id so first INCR returns next id.
        current_max = int(_next_project_doc_id(project_name)) - 1
        r.setnx(counter_key, current_max)

    while True:
        candidate = str(r.incr(counter_key))
        if not r.exists(f"doc:{candidate}"):
            return candidate


def _normalize_status(value: str) -> str:
    return (value or "").strip().lower()


def _collect_project_status_usage(project_name: str) -> dict[str, list[str]]:
    """
    Returns a map: normalized_status -> list of doc IDs currently using that status.
    """
    usage: dict[str, list[str]] = {}
    doc_ids = r.smembers(f"project:{project_name}:docs")

    for doc_id in doc_ids:
        doc_key = f"doc:{doc_id}"
        if not r.exists(doc_key):
            # stale doc id in set
            continue

        raw_status = r.hget(doc_key, "status") or ""
        normalized = _normalize_status(raw_status)
        if not normalized:
            continue

        usage.setdefault(normalized, []).append(str(doc_id))

    return usage


def _get_project_status_categories(project_name: str) -> list[str]:
    """
    Returns project status categories, ensuring a non-empty persisted list.
    """
    key = _status_categories_key(project_name)
    raw = r.get(key)

    if raw is None:
        categories = _default_status_categories()
        r.set(key, json.dumps(categories))
        return categories

    try:
        categories = json.loads(raw)
    except Exception:
        categories = _default_status_categories()
        r.set(key, json.dumps(categories))
        return categories

    if not isinstance(categories, list) or len(categories) == 0:
        categories = _default_status_categories()
        r.set(key, json.dumps(categories))
        return categories

    cleaned = [
        c.strip() for c in categories
        if isinstance(c, str) and c.strip()
    ]

    if not cleaned:
        cleaned = _default_status_categories()
        r.set(key, json.dumps(cleaned))

    return cleaned


def _delete_project_corpus_documents(project_name: str, corpus_name: str, delete_metadata: bool = True) -> list[str]:
    """
    Deletes all documents in a project that belong to a specific corpus.
    Returns sorted deleted document ids.
    """
    doc_ids = r.smembers(f"project:{project_name}:docs")
    deleted_doc_ids: list[str] = []

    for doc_id in doc_ids:
        doc_key = f"doc:{doc_id}"
        doc_data = r.hgetall(doc_key)
        if not doc_data:
            # stale id in set; ignore
            continue

        if doc_data.get("corpus") == corpus_name:
            r.delete(doc_key)
            r.srem(f"project:{project_name}:docs", doc_id)
            deleted_doc_ids.append(str(doc_id))

    if delete_metadata:
        r.delete(f"corpus:{corpus_name}:metadata")

    return sorted(deleted_doc_ids)


def _strip_common_extensions(filename: str) -> str:
    """
    Strip common extensions repeatedly (case-insensitive), e.g.: foo.xml -> foo
    """
    name = os.path.basename(filename or "").strip()
    if not name:
        return ""

    lower_name = name.lower()
    changed = True
    while changed:
        changed = False
        for ext in COMMON_IMPORT_EXTENSIONS:
            if lower_name.endswith(ext):
                name = name[: -len(ext)]
                lower_name = lower_name[: -len(ext)]
                changed = True
                break

    return name.strip()


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _meta_first(meta_dict: dict, keys: tuple[str, ...]) -> str:
    for k in keys:
        v = _safe_text(meta_dict.get(k))
        if v:
            return v
    return ""


def _extract_xml_meta_attrib(xml_text: str, target_attribs: tuple[str, ...]) -> str:
    """
    Try to extract corpus from a tag like <meta corpus="..."> or <text corpus="..."> attribute.
    Uses localname matching so namespaces won't break it.
    """
    if not xml_text or not xml_text.strip():
        return ""

    try:
        root = ET.fromstring(xml_text)
    except Exception:
        return ""

    for el in root.iter():
        # localname without namespace: {ns}level -> level
        tag = el.tag.split("}", 1)[-1] if isinstance(el.tag, str) else ""
        if tag.lower() in ["meta", "text"]:
            for attr in target_attribs:
                corpus_attr = _safe_text(el.attrib.get(attr))
                if corpus_attr:
                    return corpus_attr
    return ""


def _extract_import_overrides(meta_dict: dict | None, xml_text: str | None = None) -> dict:
    """
    Resolve defaults/overrides for corpus/repo/assigned/status:
    - corpus: meta['corpus'] OR XML <text/meta corpus="...">
    - repo: meta['repo'] OR XML <text/meta repo="..."> ...
    - assigned: meta['user'] or meta['assignee'] or meta['assigned'] OR XML ...
    - status: meta['status'] OR XML <text/meta status=...
    """
    meta = meta_dict if isinstance(meta_dict, dict) else {}

    corpus = _safe_text(meta.get("corpus"))
    if not corpus and xml_text:
        corpus = _extract_xml_meta_attrib(xml_text, target_attribs=("corpus",))
    repo = _meta_first(meta, OVERRIDE_KEYS_REPO)
    if not repo and xml_text:
        repo = _extract_xml_meta_attrib(xml_text, target_attribs=OVERRIDE_KEYS_REPO)
    assigned = _meta_first(meta, OVERRIDE_KEYS_ASSIGNED)
    if not assigned:
        assigned = _extract_xml_meta_attrib(xml_text, target_attribs=OVERRIDE_KEYS_ASSIGNED)
    status = _safe_text(meta.get("status"))
    if not status:
        status = _extract_xml_meta_attrib(xml_text, target_attribs=("status",))

    return {
        "corpus": corpus,
        "repo": repo,
        "assigned": assigned,
        "status": status,
    }


def _decode_zip_text(raw_bytes: bytes) -> str:
    """
    Decode text payload from ZIP entry. UTF-8 first, then latin-1 fallback.
    """
    try:
        return raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        return raw_bytes.decode("latin-1")


def _parse_corpus_metadata_tab(tab_text: str) -> dict:
    """
    Parse corpus metadata from a two-column tab-delimited file.

    Each non-empty row contributes one key/value pair. Later rows overwrite
    earlier rows with the same key.
    """
    metadata = {}
    if not tab_text or not tab_text.strip():
        return metadata

    for raw_line in tab_text.splitlines():
        line = raw_line.rstrip("\r")
        if not line.strip():
            continue

        key, separator, value = line.partition("\t")
        key = key.strip()
        if not key:
            continue

        metadata[key] = value if separator else ""

    return metadata


def check_and_clean_corpus(project_name: str, corpus_name: str):
    """Checks if a corpus is empty. If no docs use it, deletes its metadata."""
    doc_ids = r.smembers(f"project:{project_name}:docs")
    for doc_id in doc_ids:
        doc_corpus = r.hget(f"doc:{doc_id}", "corpus")
        if doc_corpus == corpus_name:
            return  # The corpus is still in use by at least one document

    # If loop finishes without returning, the corpus is orphaned
    r.delete(f"corpus:{corpus_name}:metadata")


def _load_json_field(value, default):
    if value is None:
        return default
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return default
    return value


def _dump_json_field(value):
    return json.dumps(value if value is not None else {})


def _rule_applies_to_document(rule_data: dict, docname: str, corpus: str) -> bool:
    rule_doc = (rule_data.get("document") or "").strip()
    rule_corpus = (rule_data.get("corpus") or "").strip()

    doc_match = (not rule_doc) or (rule_doc in docname)
    corpus_match = (not rule_corpus) or (rule_corpus in corpus)

    return doc_match and corpus_match


def _get_project_documents(project_name: str) -> list[dict]:
    docs = []
    for doc_id in r.smembers(f"project:{project_name}:docs"):
        doc_data = r.hgetall(f"doc:{doc_id}")
        if doc_data:
            docs.append(doc_data)
    return docs


def _validation_rule_matches_doc(rule_data: dict, doc_data: dict) -> bool:
    docname = doc_data.get("docname", "")
    corpus = doc_data.get("corpus", "")
    return _rule_applies_to_document(rule_data, docname, corpus)


def _collect_docs_affected_by_rule_change(project_name: str, *rules: dict) -> list[str]:
    """
    Return document IDs whose matching set could have changed because of one or more
    validation rule definitions being added, removed, or edited.
    """
    affected_doc_ids = set()

    for doc_data in _get_project_documents(project_name):
        doc_id = doc_data.get("id")
        if not doc_id:
            continue

        for rule_data in rules:
            if rule_data and _validation_rule_matches_doc(rule_data, doc_data):
                affected_doc_ids.add(doc_id)
                break

    return sorted(affected_doc_ids)


VALIDATION_QUEUE_KEY = "validation:queue:doc_ids"
VALIDATION_QUEUE_ACTIVE_KEY = "validation:queue:active"
CONTENT_VALIDATION_DEBOUNCE_MS = 2000


def _validation_debounce_key(doc_id: str) -> str:
    return f"validation:debounce:{doc_id}"


def _build_validation_pending_payload(state: str = "queued") -> dict:
    return {
        "status": "validating",
        "state": state,
        "rules_run": 0,
        "results": []
    }


def _set_document_validation_pending(doc_id: str, state: str = "queued") -> None:
    doc_key = f"doc:{doc_id}"
    if not r.exists(doc_key):
        return
    r.hset(doc_key, "validation", _dump_json_field(_build_validation_pending_payload(state=state)))


def _set_document_validation_error(doc_id: str, error_message: str) -> None:
    doc_key = f"doc:{doc_id}"
    if not r.exists(doc_key):
        return

    r.hset(doc_key, "validation", _dump_json_field({
        "status": "error",
        "rules_run": 1,
        "results": [{
            "rule": "system.validation",
            "violations": [str(error_message or "Validation failed")]
        }]
    }))


def _process_validation_queue() -> None:
    # Only one worker should drain the queue at a time.
    if not r.setnx(VALIDATION_QUEUE_ACTIVE_KEY, "1"):
        return

    r.expire(VALIDATION_QUEUE_ACTIVE_KEY, 600)
    try:
        while True:
            queued_doc_id = r.spop(VALIDATION_QUEUE_KEY)
            if not queued_doc_id:
                break

            doc_id = str(queued_doc_id)
            _set_document_validation_pending(doc_id, state="processing")

            try:
                _run_document_validations(doc_id)
            except HTTPException as exc:
                _set_document_validation_error(doc_id, str(getattr(exc, "detail", str(exc))))
            except Exception as exc:
                _set_document_validation_error(doc_id, str(exc))

            r.expire(VALIDATION_QUEUE_ACTIVE_KEY, 600)
    finally:
        r.delete(VALIDATION_QUEUE_ACTIVE_KEY)

    # If requests enqueued more work while the lock was held, process it now.
    if r.scard(VALIDATION_QUEUE_KEY) > 0:
        _process_validation_queue()


async def _enqueue_document_after_debounce(doc_id: str, token: str, debounce_ms: int) -> None:
    await asyncio.sleep(max(0, int(debounce_ms)) / 1000.0)

    key = _validation_debounce_key(doc_id)
    current_token = r.get(key)
    if not current_token or str(current_token) != str(token):
        return

    if not r.exists(f"doc:{doc_id}"):
        r.delete(key)
        return

    r.sadd(VALIDATION_QUEUE_KEY, doc_id)
    r.delete(key)
    _process_validation_queue()


def _enqueue_validation_for_documents(
        doc_ids: list[str],
        background_tasks: Optional[BackgroundTasks] = None,
        debounce_ms: int = 0
) -> dict:
    unique_ids = []
    seen = set()
    for doc_id in doc_ids:
        normalized_id = str(doc_id)
        if normalized_id in seen:
            continue
        seen.add(normalized_id)
        if not r.exists(f"doc:{normalized_id}"):
            continue
        unique_ids.append(normalized_id)

    if not unique_ids:
        return {
            "documents_revalidated": 0,
            "documents_queued_for_revalidation": 0,
            "doc_ids": [],
            "async_validation": True
        }

    if debounce_ms > 0:
        for doc_id in unique_ids:
            _set_document_validation_pending(doc_id, state="debounced")
            token = str(time.time_ns())
            r.set(_validation_debounce_key(doc_id), token)
            if background_tasks is not None:
                background_tasks.add_task(_enqueue_document_after_debounce, doc_id, token, debounce_ms)
            else:
                r.sadd(VALIDATION_QUEUE_KEY, doc_id)

        if background_tasks is None:
            _process_validation_queue()
    else:
        for doc_id in unique_ids:
            _set_document_validation_pending(doc_id, state="queued")
            r.sadd(VALIDATION_QUEUE_KEY, doc_id)

        if background_tasks is not None:
            background_tasks.add_task(_process_validation_queue)
        else:
            _process_validation_queue()

    return {
        "documents_revalidated": 0,
        "documents_queued_for_revalidation": len(unique_ids),
        "doc_ids": unique_ids,
        "async_validation": True
    }


def _rerun_validations_for_documents(doc_ids: list[str]) -> dict:
    # Legacy helper retained for compatibility; now queues async validation.
    return _enqueue_validation_for_documents(doc_ids)


def _run_document_validations(doc_id: str) -> dict:
    """
    Resolve all project validation rules applicable to this document,
    run them against the current spreadsheet + metadata, and overwrite
    the document's `validation` field in Redis.
    """
    doc_key = f"doc:{doc_id}"
    doc_data = r.hgetall(doc_key)

    if not doc_data:
        raise HTTPException(status_code=404, detail="Document not found")

    project = doc_data.get("project", "")
    docname = doc_data.get("docname", "")
    corpus = doc_data.get("corpus", "")
    mode = (doc_data.get("mode", "") or "").strip().lower()

    spreadsheet_content = doc_data.get("content_spreadsheet", "") or ""
    sgml_content = doc_data.get("content_xml", "") or ""
    metadata = _load_json_field(doc_data.get("metadata"), {})

    validation_ids = r.smembers(_validation_set_key(project))
    rule_specs = []

    for validation_id in validation_ids:
        rule_data = r.hgetall(_validation_key(project, validation_id))
        if not rule_data:
            continue

        if not _rule_applies_to_document(rule_data, docname, corpus):
            continue

        rule_specs.append({
            "domain": rule_data.get("domain", ""),
            "key": rule_data.get("key", ""),
            "operator": rule_data.get("operator", ""),
            "value": rule_data.get("value", ""),
        })

    if rule_specs:
        if mode == "spreadsheet":
            input_type = "spreadsheet"
            indata = spreadsheet_content
        elif mode == "entities":
            input_type = "spreadsheet"
            indata = spreadsheet_content
        elif mode == "xml":
            # In this application, xml mode means SGML/XML source stored in content_xml.
            input_type = "xml"
            indata = sgml_content
        else:
            # Conservative fallback to current spreadsheet behavior.
            input_type = "spreadsheet"
            indata = spreadsheet_content

        project_config = get_project_config(project)
        results = run_all_validations(indata, input_type, metadata, rule_specs, config=project_config)
    else:
        results = []

    validation_obj = {
        "status": "ready",
        "rules_run": len(rule_specs),
        "results": results
    }

    r.hset(doc_key, "validation", _dump_json_field(validation_obj))
    return validation_obj


# --- Authentication Dependency ---
# --- Authentication Dependency ---
def get_current_user(token: Optional[str] = Header(None)) -> dict:
    """Validates the token and returns the user data."""
    if not token:
        raise HTTPException(status_code=401, detail="Missing authentication token")

    token_data = r.get(f"token:{token}")
    if not token_data or ":" not in token_data:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    project_name, username = token_data.split(":", 1)
    
    user_data = r.hgetall(f"user:{project_name}:{username}")
    if not user_data:
        raise HTTPException(status_code=404, detail="User not found")

    # Convert adminlevel back to int and inject project context
    user_data['adminlevel'] = int(user_data.get('adminlevel', 0))
    user_data['project_name'] = project_name
    return user_data


def require_admin(level: int):
    """Returns a dependency that checks for a minimum admin level."""

    def dependency(user: dict = Depends(get_current_user)):
        if user['adminlevel'] < level:
            raise HTTPException(status_code=403, detail=f"Requires admin level {level} or higher")
        return user

    return dependency


def get_github_client(current_user: dict, repo_name: str) -> GitHubUtility:
    """Helper to initialize GitHubUtility using the user's stored token."""
    gh_token = current_user.get("token")
    if not gh_token:
        raise HTTPException(status_code=400, detail="GitHub token not configured for your user profile.")

    if not repo_name:
        raise HTTPException(status_code=400, detail="Repository name is missing. Ensure the document has a 'repo' set.")

    try:
        return GitHubUtility(token=gh_token, repo_name=repo_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to initialize GitHub client: {str(e)}")


# --- 0. Initializing Redis for a project ---
@app.post("/init")
def init_project(data: InitProject):
    """Bootstraps the Redis database for a new project."""

    EXPECTED_SECRET = os.environ.get("GITDOX_INIT_SECRET", MASTER_INIT_SECRET)
    
    if data.init_secret != EXPECTED_SECRET:
        raise HTTPException(
            status_code=403, 
            detail="Forbidden: Invalid master initialization secret."
        )
    
    if r.exists(f"project:{data.project_name}"):
        raise HTTPException(status_code=400, detail="Project already initialized")

    user_key = f"user:{data.project_name}:{data.admin_username}"
    if r.exists(user_key):
        raise HTTPException(
            status_code=400, 
            detail="Username already taken. Choose a different admin username."
        )

    r.hset(user_key, mapping={
        "username": data.admin_username,
        "password": hash_password(data.admin_password),
        "realname": "System Admin",
        "adminlevel": 3,
        "email": "admin@local",
        "git_username": "",
        "token": ""
    })

    r.set(f"project:{data.project_name}", "initialized")
    return {"message": f"Project {data.project_name} initialized. Admin user {data.admin_username} created."}


# --- 1. User Management ---
@app.post("/auth")
def authenticate(login: AuthLogin):
    """Authenticates a user for a specific project and returns a token."""
    user_key = f"user:{login.project_name}:{login.username}"
    user_data = r.hgetall(user_key)

    if not user_data or not verify_password(user_data['password'], login.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = secrets.token_urlsafe(32)
    # Map the token to both project and user
    r.set(f"token:{token}", f"{login.project_name}:{login.username}")
    r.hset(user_key, "token_session", token)  

    return {
        "token": token, 
        "username": login.username, 
        "project_name": login.project_name, 
        "adminlevel": int(user_data.get('adminlevel', 0))
    }


@app.get("/projects/{project_name}/users")
def list_users(project_name: str, current_user: dict = Depends(require_admin(1))):
    """Lists all users for a specific project."""
    if current_user['project_name'] != project_name:
        raise HTTPException(status_code=403, detail="Access denied to this project")

    keys = r.keys(f"user:{project_name}:*")
    users = []
    for key in keys:
        user_data = r.hgetall(key)
        user_data.pop("password", None)
        user_data.pop("token_session", None)
        users.append(user_data)
    return users


@app.post("/projects/{project_name}/users")
def create_user(project_name: str, user: UserCreate, current_user: dict = Depends(require_admin(3))):
    """Creates a new user in a project (Requires AdminLevel > 2)."""
    if current_user['project_name'] != project_name:
        raise HTTPException(status_code=403, detail="Access denied to this project")

    user_key = f"user:{project_name}:{user.username}"
    if r.exists(user_key):
        raise HTTPException(status_code=400, detail="User already exists in this project")

    user_dict = user.model_dump()
    user_dict['password'] = hash_password(user_dict['password'])
    r.hset(user_key, mapping=user_dict)
    return {"message": f"User {user.username} created successfully"}


@app.put("/projects/{project_name}/users/{username}")
def update_user(project_name: str, username: str, data: UserUpdate, current_user: dict = Depends(require_admin(3))):
    """Updates an existing user (Requires AdminLevel > 2)."""
    if current_user['project_name'] != project_name:
        raise HTTPException(status_code=403, detail="Access denied to this project")

    user_key = f"user:{project_name}:{username}"
    if not r.exists(user_key):
        raise HTTPException(status_code=404, detail="User not found")

    user_dict = data.model_dump(exclude_unset=True)
    if user_dict.get('password'):
        user_dict['password'] = hash_password(user_dict['password'])
    else:
        user_dict.pop('password', None)

    r.hset(user_key, mapping=user_dict)
    return {"message": f"User {username} updated successfully"}


@app.delete("/projects/{project_name}/users/{username}")
def delete_user(project_name: str, username: str, current_user: dict = Depends(require_admin(3))):
    """Deletes a user (Requires AdminLevel > 2)."""
    if current_user['project_name'] != project_name:
        raise HTTPException(status_code=403, detail="Access denied to this project")

    if username == current_user['username']:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    user_key = f"user:{project_name}:{username}"
    if not r.exists(user_key):
        raise HTTPException(status_code=404, detail="User not found")

    reassigned_docs = 0
    # Optimised to only check docs belonging to this specific project
    for doc_id in r.smembers(f"project:{project_name}:docs"):
        doc_key = f"doc:{doc_id}"
        assigned_user = r.hget(doc_key, "assigned")
        if assigned_user == username:
            r.hset(doc_key, "assigned", "admin")
            reassigned_docs += 1

    if not r.delete(user_key):
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "message": f"User {username} deleted",
        "reassigned_to_admin": reassigned_docs
    }


@app.put("/projects/{project_name}/users/{username}/password")
def change_password(project_name: str, username: str, data: PasswordChange, current_user: dict = Depends(require_admin(3))):
    """Changes a user's password (Requires AdminLevel > 2)."""
    if current_user['project_name'] != project_name:
        raise HTTPException(status_code=403, detail="Access denied to this project")

    user_key = f"user:{project_name}:{username}"
    if not r.exists(user_key):
        raise HTTPException(status_code=404, detail="User not found")

    r.hset(user_key, "password", hash_password(data.new_password))
    return {"message": "Password updated successfully"}


# --- 2. Project / Instance / Corpus Management and Metadata ---
@app.get("/app-config")
def get_app_config(project: Optional[str] = None):
    """Returns the main application configuration dynamically based on the project."""
    config_path = resolve_config_path(project)

    if not config_path.exists():
        raise HTTPException(status_code=404, detail="App config not found")

    try:
        with config_path.open("r", encoding="utf-8") as f:
            config_data = yaml.safe_load(f) or {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading app config: {str(e)}")

    xml_cfg = config_data.get("xml")
    if isinstance(xml_cfg, dict):
        tags_file = xml_cfg.get("tags")
        if isinstance(tags_file, str) and tags_file.strip():
            tags_name = tags_file.strip()
            tags_path = (XML_TAG_SCHEMA_DIR / tags_name).resolve()

            # Prevent path traversal and only read local JSON schema files.
            is_safe_path = tags_path.parent == XML_TAG_SCHEMA_DIR
            is_json_file = tags_path.suffix.lower() == ".json"

            if is_safe_path and is_json_file and tags_path.exists() and tags_path.is_file():
                try:
                    with tags_path.open("r", encoding="utf-8") as schema_file:
                        xml_cfg["tags_schema"] = json.load(schema_file)
                except Exception as e:
                    xml_cfg["tags_schema_error"] = f"Failed to read XML tags schema '{tags_name}': {str(e)}"
            elif tags_file:
                xml_cfg["tags_schema_error"] = (
                    f"XML tags schema '{tags_name}' was not found in schemas/xml_tags/"
                )

    return config_data


@app.get("/corpora/{corpus_name}/metadata")
def get_corpus_metadata(corpus_name: str, current_user: dict = Depends(require_admin(0))):
    """Gets metadata for a specific corpus."""
    data = r.get(f"corpus:{corpus_name}:metadata")
    if data:
        return json.loads(data)
    return {}


@app.put("/corpora/{corpus_name}/metadata")
def update_corpus_metadata(corpus_name: str, metadata: dict = Body(...),
                           current_user: dict = Depends(require_admin(1))):
    """Updates metadata for a specific corpus."""
    r.set(f"corpus:{corpus_name}:metadata", json.dumps(metadata))
    return {"message": "Corpus metadata updated successfully"}


@app.get("/configs")
def list_export_configs(current_user: dict = Depends(require_admin(0))):
    """Returns available SGML export configuration names."""
    configs = get_social_stylesheets()
    return {"configs": configs}


@app.get("/projects/{project_name}/status-categories")
def get_status_categories(project_name: str, current_user: dict = Depends(require_admin(0))):
    """
    Returns the project status categories.
    If none exist yet, initializes them to ["init"].
    """
    if current_user.get('project_name') != project_name: raise HTTPException(status_code=403, detail="Access denied to this project")
    categories = _get_project_status_categories(project_name)
    return {"categories": sorted(categories)}


@app.put("/projects/{project_name}/status-categories")
def update_status_categories(
        project_name: str,
        payload: StatusCategoryList = Body(...),
        current_user: dict = Depends(require_admin(1)),
):
    """
    Replaces status categories, but rejects removal of any category that is still used by docs.
    """
    if current_user.get('project_name') != project_name: raise HTTPException(status_code=403, detail="Access denied to this project")
    new_categories = payload.categories
    if not new_categories:
        raise HTTPException(status_code=400, detail="At least one status category is required")

    # Current categories (for delta check)
    raw_existing = r.get(_status_categories_key(project_name))
    if raw_existing:
        try:
            existing_categories = json.loads(raw_existing)
            if not isinstance(existing_categories, list):
                existing_categories = _default_status_categories()
        except Exception:
            existing_categories = _default_status_categories()
    else:
        # Keep behavior aligned with your GET initializer
        existing_categories = _default_status_categories()

    existing_norm = {_normalize_status(c) for c in existing_categories if isinstance(c, str) and c.strip()}
    new_norm = {_normalize_status(c) for c in new_categories if isinstance(c, str) and c.strip()}

    removed_statuses = existing_norm - new_norm
    if removed_statuses:
        usage = _collect_project_status_usage(project_name)

        # Which removed statuses are still referenced by docs
        blocking = {
            status: sorted(usage.get(status, []))
            for status in sorted(removed_statuses)
            if usage.get(status)
        }

        if blocking:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Cannot remove status categories that are still assigned to documents",
                    "blocking_statuses": list(blocking.keys()),
                    "documents_by_status": blocking,
                },
            )

    r.set(_status_categories_key(project_name), json.dumps(new_categories))
    return {
        "message": "Status categories updated successfully",
        "categories": new_categories,
    }


@app.get("/projects/{project_name}/corpora")
def list_project_corpora(project_name: str, current_user: dict = Depends(require_admin(0))):
    """Lists unique corpus names used by documents in a project."""
    if current_user.get('project_name') != project_name: raise HTTPException(status_code=403, detail="Access denied to this project")
    corpus_names = set()
    doc_ids = r.smembers(f"project:{project_name}:docs")

    for doc_id in doc_ids:
        corpus = r.hget(f"doc:{doc_id}", "corpus")
        if corpus is not None:
            corpus = corpus.strip()
            if corpus:
                corpus_names.add(corpus)

    return {
        "project": project_name,
        "count": len(corpus_names),
        "corpora": sorted(corpus_names)
    }


@app.delete("/projects/{project_name}/corpora/{corpus_name}")
def delete_corpus(
        project_name: str,
        corpus_name: str,
        current_user: dict = Depends(require_admin(2))
):
    """
    Deletes a corpus by deleting all documents in the project that use that corpus.
    Requires AdminLevel > 1.
    """
    if current_user.get('project_name') != project_name: raise HTTPException(status_code=403, detail="Access denied to this project")
    deleted_doc_ids = _delete_project_corpus_documents(project_name, corpus_name, delete_metadata=True)

    return {
        "message": f"Corpus '{corpus_name}' deleted",
        "project": project_name,
        "deleted_count": len(deleted_doc_ids),
        "deleted_doc_ids": sorted(deleted_doc_ids)
    }


@app.put("/projects/{project_name}/corpora/{corpus_name}/rename")
def rename_corpus(
        project_name: str,
        corpus_name: str,
    background_tasks: BackgroundTasks,
        new_corpus_name: str = Body(..., embed=True),
        current_user: dict = Depends(require_admin(1))
):
    """
    Renames a corpus by replacing corpus value in all matching project documents.
    Revalidates affected documents because applicable validation rules may change.
    Requires AdminLevel > 0.
    """
    if current_user.get('project_name') != project_name: raise HTTPException(status_code=403, detail="Access denied to this project")
    new_corpus_name = (new_corpus_name or "").strip()
    if not new_corpus_name:
        raise HTTPException(status_code=400, detail="new_corpus_name cannot be empty")

    if new_corpus_name == corpus_name:
        return {
            "message": "No-op rename (same corpus name)",
            "project": project_name,
            "updated_count": 0,
            "updated_doc_ids": [],
            "documents_revalidated": 0,
            "doc_ids": []
        }

    doc_ids = r.smembers(f"project:{project_name}:docs")
    updated_doc_ids = []

    for doc_id in doc_ids:
        doc_key = f"doc:{doc_id}"
        doc_data = r.hgetall(doc_key)
        if not doc_data:
            continue

        if doc_data.get("corpus") == corpus_name:
            r.hset(doc_key, "corpus", new_corpus_name)
            updated_doc_ids.append(doc_id)

    # Move corpus metadata to the new key if needed
    old_meta_key = f"corpus:{corpus_name}:metadata"
    new_meta_key = f"corpus:{new_corpus_name}:metadata"
    old_meta = r.get(old_meta_key)
    if old_meta is not None:
        # If destination already exists, keep destination and just drop old.
        if not r.exists(new_meta_key):
            r.set(new_meta_key, old_meta)
        r.delete(old_meta_key)

    revalidation = _enqueue_validation_for_documents(sorted(updated_doc_ids), background_tasks)

    return {
        "message": f"Corpus '{corpus_name}' renamed to '{new_corpus_name}'",
        "project": project_name,
        "updated_count": len(updated_doc_ids),
        "updated_doc_ids": sorted(updated_doc_ids),
        **revalidation
    }


# --- 3. Document Management ---
@app.post("/documents")
def add_document(
    doc: DocumentCreate,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_admin(1))
):
    """Adds a new document (Requires AdminLevel > 0)."""
    doc_id = _allocate_project_doc_id(doc.project)
    doc_key = f"doc:{doc_id}"

    doc_dict = doc.model_dump()
    project_config = get_project_config(doc.project)
    doc_dict["mode"] = normalize_document_mode(doc_dict.get("mode")) or get_default_document_mode(project_config)
    doc_dict["id"] = doc_id
    doc_dict["assigned"] = doc_dict.get("assigned") or current_user.get("username", "admin")
    doc_dict["metadata"] = _dump_json_field(doc_dict.get("metadata", {}))
    doc_dict["validation"] = _dump_json_field(_build_validation_pending_payload(state="queued"))
    doc_dict["last_modified_at"] = time.time()
    doc_dict["last_modified_by"] = current_user.get("username", "system")

    r.hset(doc_key, mapping=doc_dict)
    r.sadd(f"project:{doc.project}:docs", doc_id)

    _enqueue_validation_for_documents([doc_id], background_tasks)

    return {
        "id": doc_id,
        "message": f"Document {doc_id} created",
        "validation": _build_validation_pending_payload(state="queued"),
        "async_validation": True
    }


@app.get("/projects/{project_name}/documents")
def list_documents(project_name: str, current_user: dict = Depends(require_admin(0))):
    """Lists all documents for a project."""
    if current_user.get('project_name') != project_name: 
        raise HTTPException(status_code=403, detail="Access denied to this project")
    
    doc_ids = list(r.smembers(f"project:{project_name}:docs"))
    if not doc_ids:
        return []

    fields = ["id", "metadata", "validation", "mode", "status", "docname", "corpus", "repo", "assigned", "last_modified_at", "last_modified_by"] 
    
    pipe = r.pipeline()
    for doc_id in doc_ids:
        pipe.hmget(f"doc:{doc_id}", fields)
    
    # results is a list of lists matching the order of doc_ids
    results = pipe.execute()
    
    docs = []
    for doc_id, values in zip(doc_ids, results):
        # values will be [id_val, metadata_val, validation_val, ...]
        # If the hash didn't exist, values might be [None, None, None]
        if any(values): 
            # Zip the field names with the returned values to recreate the dict
            doc_data = dict(zip(fields, values))
            doc_data["metadata"] = _load_json_field(doc_data.get("metadata"), {})
            doc_data["validation"] = _load_json_field(doc_data.get("validation"), {})
            docs.append(doc_data)
            
    return docs


@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str, current_user: dict = Depends(require_admin(2))):
    """Deletes a document (Requires AdminLevel > 1)."""
    doc_key = f"doc:{doc_id}"
    doc_data = r.hgetall(doc_key)

    if not doc_data:
        raise HTTPException(status_code=404, detail="Document not found")

    project = doc_data.get("project")
    corpus = doc_data.get("corpus")

    r.delete(doc_key)
    r.srem(f"project:{project}:docs", doc_id)

    # Check if the corpus is orphaned and clean up if necessary
    if corpus and project:
        check_and_clean_corpus(project, corpus)

    return {"message": f"Document {doc_id} deleted"}


@app.put("/documents/{doc_id}")
def update_document(
        doc_id: str,
        data: DocumentUpdate,
        background_tasks: BackgroundTasks,
        current_user: dict = Depends(require_admin(0))
):
    """Updates document metadata and queues validation refresh.

    Admin level 0 users may update only `status`.
    """
    doc_key = f"doc:{doc_id}"
    old_doc_data = r.hgetall(doc_key)

    if not old_doc_data:
        raise HTTPException(status_code=404, detail="Document not found")

    old_corpus = old_doc_data.get("corpus")
    project = old_doc_data.get("project")

    # Level-0 users can update status only.
    if int(current_user.get("adminlevel", 0)) < 1:
        protected_field_checks = [
            ("corpus", old_doc_data.get("corpus", "")),
            ("docname", old_doc_data.get("docname", "")),
            ("repo", old_doc_data.get("repo", "")),
            ("mode", old_doc_data.get("mode", "")),
            ("assigned", old_doc_data.get("assigned", "")),
        ]

        for field_name, old_value in protected_field_checks:
            new_value = getattr(data, field_name)
            if str(new_value or "") != str(old_value or ""):
                raise HTTPException(
                    status_code=403,
                    detail=f"Admin level 0 can only update status (field '{field_name}' is restricted)."
                )

        old_metadata = _load_json_field(old_doc_data.get("metadata"), {})
        new_metadata = data.metadata if isinstance(data.metadata, dict) else {}
        if old_metadata != new_metadata:
            raise HTTPException(
                status_code=403,
                detail="Admin level 0 can only update status (metadata is restricted)."
            )

    data_dict = data.model_dump()
    data_dict["metadata"] = _dump_json_field(data_dict.get("metadata", {}))

    r.hset(doc_key, mapping=data_dict)

    # If the corpus name was changed, check if the old one is orphaned
    if old_corpus and old_corpus != data.corpus and project:
        check_and_clean_corpus(project, old_corpus)

    _enqueue_validation_for_documents([doc_id], background_tasks)

    return {
        "message": "Document updated successfully",
        "validation": _build_validation_pending_payload(state="queued"),
        "async_validation": True
    }


@app.put("/documents/{doc_id}/rename")
def rename_document(doc_id: str, data: DocumentRename, current_user: dict = Depends(require_admin(1))):
    """Renames a document (Requires AdminLevel > 0)."""
    doc_key = f"doc:{doc_id}"
    if not r.exists(doc_key):
        raise HTTPException(status_code=404, detail="Document not found")

    r.hset(doc_key, "docname", data.new_docname)
    return {"message": "Document renamed successfully"}


# --- 4. Document I/O ---
@app.get("/documents/{doc_id}/contents")
def read_document_contents(doc_id: str, current_user: dict = Depends(require_admin(0))):
    """Reads document contents (Requires AdminLevel >= 0)."""
    doc_key = f"doc:{doc_id}"
    if not r.exists(doc_key):
        raise HTTPException(status_code=404, detail="Document not found")

    content_xml = r.hget(doc_key, "content_xml")
    content_spreadsheet = r.hget(doc_key, "content_spreadsheet")
    last_modified_at = r.hget(doc_key, "last_modified_at")
    last_modified_by = r.hget(doc_key, "last_modified_by")

    return {
        "id": doc_id,
        "content_xml": content_xml if content_xml is not None else "",
        "content_spreadsheet": content_spreadsheet if content_spreadsheet is not None else "",
        "last_modified_at": float(last_modified_at) if last_modified_at else 0.0,
        "last_modified_by": last_modified_by if last_modified_by else "unknown"
    }


@app.put("/documents/{doc_id}/contents")
def write_document_contents(
        doc_id: str,
        data: DocumentContentUpdate,
        background_tasks: BackgroundTasks,
        current_user: dict = Depends(require_admin(0))
):
    """Writes/updates document contents and queues validation refresh (Requires AdminLevel >= 0)."""
    doc_key = f"doc:{doc_id}"
    if not r.exists(doc_key):
        raise HTTPException(status_code=404, detail="Document not found")

    # Concurrency check: if client provided a timestamp, compare with current DB value and reject if DB is newer.
    current_db_time = r.hget(doc_key, "last_modified_at")
    current_db_user = r.hget(doc_key, "last_modified_by")

    if current_db_time and data.last_modified_at is not None:
        # If DB timestamp is strictly greater than what the client thinks it is
        if float(current_db_time) > data.last_modified_at:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Document was modified in another session.",
                    "last_modified_by": current_db_user or "another user",
                    "last_modified_at": float(current_db_time)
                }
            )

    fmt = (data.format or "socialcalc").strip().lower()
    if fmt not in {"socialcalc", "sgml"}:
        raise HTTPException(
            status_code=400,
            detail="Unsupported format. Use 'sociavalidlcalc' or 'sgml'."
        )

    updates = {}

    if data.content_xml is not None:
        updates["content_xml"] = data.content_xml

    if data.content_spreadsheet is not None:
        spreadsheet_content = data.content_spreadsheet

        # If caller sends SGML in content_spreadsheet, convert before storing.
        if fmt == "sgml":
            sys.stdout.write("converting\n")
            try:
                spreadsheet_content, meta_dict = sgml_to_social(spreadsheet_content)

                # Persist metadata from SGML import, same style as update_document()
                if meta_dict is not None and len(meta_dict) > 0:
                    updates["metadata"] = _dump_json_field(meta_dict)
                sys.stdout.write(str(meta_dict))
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid SGML input: {str(e)}"
                )

        updates["content_spreadsheet"] = spreadsheet_content

    if updates:
        new_timestamp = time.time()
        updates["last_modified_at"] = new_timestamp
        updates["last_modified_by"] = current_user.get("username", "unknown")
        r.hset(doc_key, mapping=updates)

    _enqueue_validation_for_documents([doc_id], background_tasks, debounce_ms=CONTENT_VALIDATION_DEBOUNCE_MS)

    # Return canonical persisted values so UI can update immediately
    saved_content_xml = r.hget(doc_key, "content_xml")
    saved_content_spreadsheet = r.hget(doc_key, "content_spreadsheet")
    saved_metadata = _load_json_field(r.hget(doc_key, "metadata"), {})

    return {
        "message": "Contents updated successfully",
        "id": doc_id,
        "content_xml": saved_content_xml if saved_content_xml is not None else "",
        "content_spreadsheet": saved_content_spreadsheet if saved_content_spreadsheet is not None else "",
        "metadata": saved_metadata,
        "validation": _build_validation_pending_payload(state="debounced"),
        "async_validation": True,
        "last_modified_at": updates.get("last_modified_at") or float(current_db_time or 0.0),
        "last_modified_by": updates.get("last_modified_by") or current_db_user
    }


@app.post("/documents/{doc_id}/validate")
def queue_document_validation(
        doc_id: str,
        background_tasks: BackgroundTasks,
        current_user: dict = Depends(require_admin(0))
):
    """Queues immediate revalidation for an existing document."""
    doc_key = f"doc:{doc_id}"
    if not r.exists(doc_key):
        raise HTTPException(status_code=404, detail="Document not found")

    queue_result = _enqueue_validation_for_documents([doc_id], background_tasks)
    return {
        "message": "Validation queued",
        "id": doc_id,
        "validation": _build_validation_pending_payload(state="queued"),
        **queue_result
    }


@app.get("/documents/{doc_id}/sgml")
def get_document_sgml(doc_id: str, config: str = None, current_user: dict = Depends(require_admin(0))):
    """Converts document spreadsheet contents to SGML format, including metadata.

    Query parameters:
    - config: Optional configuration file name (without .ini extension) to control SocialCalc->SGML mapping
    """
    doc_key = f"doc:{doc_id}"
    if not r.exists(doc_key):
        raise HTTPException(status_code=404, detail="Document not found")

    doc_data = r.hgetall(doc_key)
    content_spreadsheet = doc_data.get("content_spreadsheet", "")

    if not content_spreadsheet:
        raise HTTPException(status_code=400, detail="Document has no spreadsheet content")

    docname = doc_data.get("docname", "")
    corpus = doc_data.get("corpus", "")

    # Extract and deserialize metadata
    meta_dict = None
    if 'metadata' in doc_data and isinstance(doc_data['metadata'], str):
        try:
            meta_dict = json.loads(doc_data['metadata'])
        except:
            meta_dict = None

    try:
        sgml_content = social_to_sgml(content_spreadsheet, docname=docname, corpus=corpus, config=config,
                                      meta_dict=meta_dict)
        return {
            "id": doc_id,
            "sgml": sgml_content
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error converting to SGML: {str(e)}")


@app.post("/projects/{project_name}/documents/import-zip")
async def import_documents_zip(
        project_name: str,
        background_tasks: BackgroundTasks,
        file_type: str = Form(...),
        overwrite_existing_corpus: bool = Form(False),
        default_status: str = Form(""),
        default_repo: str = Form(""),
        zip_file: UploadFile = File(...),
        current_user: dict = Depends(require_admin(1)),
        excluded_meta: list = Form([])
):
    """
    Batch-import documents from a ZIP archive.

    - file_type: 'xml' or 'sgml' (explicit, does not rely on extension)
    - Each ZIP file entry becomes one document
        - If corpus-meta.tab is present, its metadata is applied to each imported corpus
        - If not found, we fall back to look for legacy _meta*.tab
    - Basename rules:
      - strip common trailing extensions: .xml/.sgml/.tt
      - resulting basename is docname
    - Defaults and overrides:
      - corpus default: 'untitled', overridden by:
          - metadata['corpus']
          - XML <meta/text corpus="..."> (if present and metadata corpus missing)
      - repo default: 'default_repo' form value, similarly overridden by metadata['repo'] or XML meta attrib
      - assigned default: 'admin', similarly overridden by metadata['user'|'assignee'|'assigned'] or XML meta attrib
      - status default: 'default_status' form value (or 'init' when missing), similarly overridden by metadata['status'] or XML meta attrib
    - overwrite_existing_corpus: if true (AdminLevel >= 2), existing project documents in each imported corpus are deleted before the first import into that corpus
    - excluded_meta: optional list of metadata keys to ignore when importing documents or corpora
    """
    if current_user.get('project_name') != project_name:
        raise HTTPException(status_code=403, detail="Access denied to this project")

    fmt = (file_type or "").strip().lower()
    if fmt not in {"xml", "sgml"}:
        raise HTTPException(status_code=400, detail="file_type must be 'xml' or 'sgml'")

    try:
        current_admin_level = int(current_user.get("adminlevel", 0))
    except Exception:
        current_admin_level = 0

    if overwrite_existing_corpus and current_admin_level < 2:
        raise HTTPException(status_code=403, detail="overwrite_existing_corpus requires admin level 2 or higher")

    default_repo_value = _safe_text(default_repo)
    default_status_value = _safe_text(default_status)
    if not default_status_value:
        default_status_value = _default_status_categories()[0]

    project_statuses = _get_project_status_categories(project_name)
    if default_status_value not in project_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"default_status '{default_status_value}' is not a valid project status"
        )

    if not zip_file.filename or not zip_file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Upload must be a .zip file")

    try:
        payload = await zip_file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read uploaded file: {str(e)}")

    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded ZIP is empty")

    # Sanitize and prepare the excluded keys for fast lookups
    excluded_keys = set(k.strip() for k in excluded_meta if k and k.strip())

    results = []
    created_count = 0
    skipped_count = 0
    error_count = 0
    error_filenames = []
    imported_corpora = set()
    overwritten_corpora = set()
    created_doc_ids = []
    corpus_metadata = None
    existing_corpora = set()

    if overwrite_existing_corpus:
        for doc_id in r.smembers(f"project:{project_name}:docs"):
            existing_corpus = _safe_text(r.hget(f"doc:{doc_id}", "corpus"))
            if existing_corpus:
                existing_corpora.add(existing_corpus)

    try:
        with zipfile.ZipFile(BytesIO(payload), "r") as zf:
            entries = zf.infolist()

            if not entries:
                raise HTTPException(status_code=400, detail="ZIP has no entries")

            for entry in entries:
                filename = entry.filename

                # Skip directories
                if entry.is_dir():
                    skipped_count += 1
                    results.append({
                        "filename": filename,
                        "status": "skipped",
                        "detail": "Directory entry"
                    })
                    continue

                # Skip hidden/system metadata files if present
                basename = os.path.basename(filename)
                if basename == "corpus-meta.tab" or (basename.startswith("_meta") and basename.endswith(".tab")):
                    try:
                        corpus_metadata = _parse_corpus_metadata_tab(_decode_zip_text(zf.read(entry)))
                        # Remove excluded keys from corpus metadata
                        if isinstance(corpus_metadata, dict):
                            for key in excluded_keys:
                                corpus_metadata.pop(key, None)
                    except Exception:
                        corpus_metadata = {}
                        skipped_count += 1
                        results.append({
                            "filename": filename,
                            "status": "skipped",
                            "detail": "Invalid corpus metadata file"
                        })
                    continue

                if not basename or basename.startswith(".") or filename.startswith("__MACOSX/"):
                    skipped_count += 1
                    results.append({
                        "filename": filename,
                        "status": "skipped",
                        "detail": "Hidden/system entry"
                    })
                    continue

                try:
                    raw = zf.read(entry)
                    text = _decode_zip_text(raw)

                    docname = _strip_common_extensions(basename)
                    if not docname:
                        # fallback if stripping removed everything
                        docname = os.path.splitext(basename)[0].strip() or "doc"

                    # Defaults
                    corpus = "untitled"
                    repo = default_repo_value
                    assigned = "admin"
                    status = default_status_value
                    mode = "xml" if fmt == "xml" else "spreadsheet"

                    # Content + metadata resolution
                    content_xml = ""
                    content_spreadsheet = ""
                    metadata = {}

                    if fmt == "xml":
                        content_xml = text

                        # Check for metadata
                        open_match = re.match(r'^\s*<meta\s+([^\n]*?)>\n', content_xml, re.IGNORECASE)
                        close_match = re.search(r'\s*</meta>\s*$', content_xml, re.IGNORECASE)
                        
                        if open_match and close_match:
                            attrs_str = open_match.group(1)
                            
                            for k, v in re.findall(r'([a-zA-Z0-9_\-]+)="([^"]*)"', attrs_str):
                                metadata[k] = v
                                
                            # Strip the wrapping <meta> tags from content
                            content_xml = re.sub(r'</?meta[^\n]*?>\n', '', content_xml + "\n").strip()
                        
                        # Remove excluded keys from document metadata
                        for key in excluded_keys:
                            metadata.pop(key, None)

                        # Parallel to SGML approach: override using `metadata` dict rather than `xml_text` string parsing
                        overrides = _extract_import_overrides(metadata, xml_text=None)
                        if overrides["corpus"]:
                            corpus = overrides["corpus"]
                        if overrides["repo"]:
                            repo = overrides["repo"]
                        if overrides["assigned"]:
                            assigned = overrides["assigned"]
                        if overrides["status"]:
                            status = overrides["status"]

                    else:
                        # SGML -> SocialCalc + meta_dict
                        try:
                            converted_spreadsheet, meta_dict = sgml_to_social(text)
                        except Exception as e:
                            raise ValueError(f"Invalid SGML input: {str(e)}")

                        content_spreadsheet = converted_spreadsheet
                        metadata = meta_dict if isinstance(meta_dict, dict) else {}

                        # Remove excluded keys from document metadata
                        for key in excluded_keys:
                            metadata.pop(key, None)

                        overrides = _extract_import_overrides(metadata, xml_text=None)
                        if overrides["corpus"]:
                            corpus = overrides["corpus"]
                        if overrides["repo"]:
                            repo = overrides["repo"]
                        if overrides["assigned"]:
                            assigned = overrides["assigned"]
                        if overrides["status"]:
                            status = overrides["status"]

                    if overwrite_existing_corpus and corpus in existing_corpora and corpus not in overwritten_corpora:
                        deleted_doc_ids = _delete_project_corpus_documents(project_name, corpus, delete_metadata=True)
                        overwritten_corpora.add(corpus)
                        if deleted_doc_ids:
                            results.append({
                                "filename": filename,
                                "status": "overwrote_corpus",
                                "corpus": corpus,
                                "deleted_count": len(deleted_doc_ids),
                                "deleted_doc_ids": deleted_doc_ids
                            })

                    # Allocate ID server-side to avoid race conditions across tabs/clients.
                    doc_id = _allocate_project_doc_id(project_name)
                    doc_key = f"doc:{doc_id}"
                    doc_dict = {
                        "id": doc_id,
                        "project": project_name,
                        "corpus": corpus,
                        "docname": docname,
                        "repo": repo,
                        "validation": _dump_json_field({}),
                        "mode": mode,
                        "status": status,
                        "assigned": assigned,
                        "content_xml": content_xml,
                        "content_spreadsheet": content_spreadsheet,
                        "metadata": _dump_json_field(metadata),
                        "last_modified_at": time.time(),
                        "last_modified_by": current_user.get("username", "system")
                    }

                    r.hset(doc_key, mapping=doc_dict)
                    r.sadd(f"project:{project_name}:docs", doc_id)
                    imported_corpora.add(corpus)
                    created_doc_ids.append(doc_id)

                    created_count += 1
                    results.append({
                        "filename": filename,
                        "status": "created",
                        "doc_id": doc_id,
                        "docname": docname,
                        "mode": mode,
                        "corpus": corpus,
                        "repo": repo,
                        "assigned": assigned,
                        "status_value": status,
                        "validation": _build_validation_pending_payload(state="queued")
                    })

                except Exception as e:
                    error_count += 1
                    error_filenames.append(filename)
                    results.append({
                        "filename": filename,
                        "status": "error",
                        "detail": str(e)
                    })

    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid ZIP file")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected import error: {str(e)}")

    if corpus_metadata and imported_corpora:
        corpus_metadata_json = json.dumps(corpus_metadata)
        for corpus in sorted(imported_corpora):
            r.set(f"corpus:{corpus}:metadata", corpus_metadata_json)

    queue_result = _enqueue_validation_for_documents(created_doc_ids, background_tasks)

    return {
        "message": "Batch import finished",
        "project": project_name,
        "file_type": fmt,
        "total_entries": len(results),
        "created_count": created_count,
        "skipped_count": skipped_count,
        "error_count": error_count,
        "error_filenames": error_filenames,
        "overwrite_existing_corpus": overwrite_existing_corpus,
        "overwritten_corpora": sorted(overwritten_corpora),
        "results": results,
        **queue_result
    }

@app.post("/documents/mutate", response_model=NlpMutationResponse)
def mutate_document_contents(
        data: NlpMutationRequest,
        current_user: dict = Depends(require_admin(0))
):
    """
    Stateless NLP mutation endpoint.
    Does NOT persist to Redis; frontend applies returned content and saves via existing update route.
    """
    tool = (data.tool or "").strip().lower()
    if not tool:
        raise HTTPException(status_code=400, detail="tool is required")

    if tool == "tokenize":
        if data.content_xml is not None:
            source = data.content_xml
        else:
            raise HTTPException(status_code=400, detail="Provide content_xml")
        try:
            transformed = tokenize(source)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"tokenize failed: {str(e)}")

        return NlpMutationResponse(tool=tool, content_xml=transformed)
    elif tool == "ssplit":
        if data.content_xml is not None:
            source = data.content_xml
        else:
            raise HTTPException(status_code=400, detail="Provide content_xml")
        try:
            transformed = ssplit(source)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"tokenize failed: {str(e)}")

        return NlpMutationResponse(tool=tool, content_xml=transformed)
    elif tool == "stype":
        sclf = STypeClassifier()
        if data.content_xml is not None:
            source = data.content_xml
        else:
            raise HTTPException(status_code=400, detail="Provide content_xml")
        try:
            transformed = sclf.predict(source)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"stype classification failed: {str(e)}")

        return NlpMutationResponse(tool=tool, content_xml=transformed)
    elif tool == "reindent":
        if data.content_xml is not None:
            source = data.content_xml
        else:
            raise HTTPException(status_code=400, detail="Provide content_xml")
        try:
            transformed = reindent(source)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"reindent failed: {str(e)}")

        return NlpMutationResponse(tool=tool, content_xml=transformed)
    elif tool == "coptic_tokenize":
        if data.content_xml is not None:
            source = data.content_xml
        else:
            raise HTTPException(status_code=400, detail="Provide content_xml")
        try:
            transformed = coptic_tokenize(source)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"tokenize failed: {str(e)}")

        return NlpMutationResponse(tool=tool, content_xml=transformed)
    elif tool == "coptic_ner":
        if data.content_spreadsheet is not None:
            source = data.content_spreadsheet
        else:
            raise HTTPException(status_code=400, detail="Provide content_xml")
        try:
            sgml = social_to_sgml(source)
            transformed = coptic_ner(sgml)
            transformed = reorder(transformed)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"NER failed: {str(e)}")

        return NlpMutationResponse(tool=tool, content_xml=transformed)
    elif tool == "tabulate":
        if data.content_xml is not None:
            source = data.content_xml
        else:
            raise HTTPException(status_code=400, detail="Provide content_xml")
        try:
            sgml_valid = validate_tt(source)
            if sgml_valid:
                transformed, _ = sgml_to_social(source)
                return NlpMutationResponse(tool=tool, content_spreadsheet=transformed)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"tabulate failed: {str(e)}")
    elif tool == "coptic_nlp_tabulate":
        if data.content_xml is not None:
            source = data.content_xml
        else:
            raise HTTPException(status_code=400, detail="Provide content_xml")
        try:
            sgml_out = coptic_nlp_tabulate(source)
            if sgml_out:
                transformed, _ = sgml_to_social(sgml_out)
                return NlpMutationResponse(tool=tool, content_spreadsheet=transformed)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"tabulate failed: {str(e)}")
    elif tool == "identify":
        # Expect a list of pairs: [("Paris", "place"), ("Jim Smith", "person", ...)]
        # Return a list of strings: ["Paris (France)", "", ...]
        if not data.entities or not isinstance(data.entities, list):
            raise HTTPException(status_code=400, detail="Provide entities as a list of [name, type] pairs")
        try:
            identities = suggest_identities(data.entities)
            return NlpMutationResponse(tool=tool, identities=identities)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Guess NER identities failed: {str(e)}")
    elif tool == "identity_list":
        # Expect a list with a single pairs: [("", "place")]
        # Return a list of all strings for this type: ["Boston", "Paris (France)", ...]
        if not data.entities or not isinstance(data.entities, list):
            raise HTTPException(status_code=400, detail="Provide an entity type in a list like ["", type] pair")
        try:
            identities = suggest_identities(data.entities, return_all_of_type=True)
            return NlpMutationResponse(tool=tool, identities=identities)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Guess NER identities failed: {str(e)}")

    raise HTTPException(status_code=400, detail=f"Unknown tool: {tool}")


@app.get("/projects/{project_name}/corpora/{corpus_name}/export-zip")
def export_corpus_zip(
        project_name: str,
        corpus_name: str,
        mode: Literal["xml", "spreadsheet"] = "xml",
        extension: Optional[str] = None,
        config: Optional[str] = None,
        current_user: dict = Depends(require_admin(0))
):
    """
    Batch-export all documents in a corpus to a ZIP archive.

    Parameters:
    - project_name: The project containing the corpus
    - corpus_name: The corpus to export
    - mode: Export format 'xml' or 'spreadsheet' (default: 'xml')
    - extension: Optional file extension without the dot (default: 'xml' for xml mode, 'sgml' for spreadsheet)
    - config: Optional configuration file name for SGML export (for spreadsheet mode)

    Returns:
    - ZIP file containing exported documents

    In XML mode:
    - Exports content_xml for each document
    - Files named <docname>.<ext> inside the zip

    In Spreadsheet mode:
    - Converts content_spreadsheet to SGML using social_to_sgml
    - Includes metadata from each document
    - Files named <docname>.<ext> inside the zip (default ext: .sgml)
    """
    from fastapi.responses import StreamingResponse
    if current_user.get('project_name') != project_name: raise HTTPException(status_code=403, detail="Access denied to this project")

    fmt = (mode or "xml").strip().lower()
    if fmt not in {"xml", "spreadsheet"}:
        raise HTTPException(status_code=400, detail="mode must be 'xml' or 'spreadsheet'")

    # Determine file extension
    if extension is None:
        ext = "xml" if fmt == "xml" else "sgml"
    else:
        ext = extension.strip().lstrip(".")  # Remove leading dot if present
        if not ext:
            raise HTTPException(status_code=400, detail="extension cannot be empty")

    # Get all documents in the project that match the corpus
    doc_ids = r.smembers(f"project:{project_name}:docs")
    matching_docs = []

    for doc_id in doc_ids:
        doc_data = r.hgetall(f"doc:{doc_id}")
        if not doc_data:
            continue

        if doc_data.get("corpus") == corpus_name:
            matching_docs.append((doc_id, doc_data))

    if not matching_docs:
        raise HTTPException(
            status_code=404,
            detail=f"No documents found in corpus '{corpus_name}' for project '{project_name}'"
        )

    # Load corpus-level metadata once and include it as a separate tab file when present.
    corpus_meta_pairs = []
    raw_corpus_metadata = r.get(f"corpus:{corpus_name}:metadata")
    if raw_corpus_metadata:
        try:
            parsed_corpus_metadata = json.loads(raw_corpus_metadata)
            if isinstance(parsed_corpus_metadata, dict):
                for meta_key, meta_value in parsed_corpus_metadata.items():
                    key_text = str(meta_key).strip()
                    if not key_text:
                        continue
                    if isinstance(meta_value, (dict, list)):
                        value_text = json.dumps(meta_value, ensure_ascii=False)
                    elif meta_value is None:
                        value_text = ""
                    else:
                        value_text = str(meta_value)

                    # Keep output one row per key/value pair in a 2-column tab file.
                    safe_key = key_text.replace("\t", " ").replace("\r", " ").replace("\n", " ")
                    safe_value = value_text.replace("\t", " ").replace("\r", " ").replace("\n", " ")
                    corpus_meta_pairs.append((safe_key, safe_value))
        except Exception:
            corpus_meta_pairs = []

    # Build the ZIP file in memory
    zip_buffer = BytesIO()

    try:
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for doc_id, doc_data in matching_docs:
                docname = doc_data.get("docname", "")
                filename = f"{docname}.{ext}"

                try:
                    if fmt == "xml":
                        # Export as XML
                        content = doc_data.get("content_xml", "")
                        if not content:
                            continue

                    else:  # fmt == "spreadsheet"
                        # Convert spreadsheet to SGML
                        content_spreadsheet = doc_data.get("content_spreadsheet", "")
                        if not content_spreadsheet:
                            continue

                        # Extract metadata for SGML conversion
                        meta_dict = None
                        if 'metadata' in doc_data and isinstance(doc_data['metadata'], str):
                            try:
                                meta_dict = json.loads(doc_data['metadata'])
                            except:
                                meta_dict = None

                        try:
                            content = social_to_sgml(
                                content_spreadsheet,
                                docname=docname,
                                corpus=corpus_name,
                                config=config,
                                meta_dict=meta_dict
                            )
                        except Exception as e:
                            # Skip documents that fail SGML conversion
                            continue

                    # Add file to ZIP
                    zf.writestr(filename, content)

                except Exception:
                    # Skip individual document errors
                    continue

            if corpus_meta_pairs:
                # Deterministic ordering helps stable exports.
                corpus_meta_pairs.sort(key=lambda kv: kv[0].lower())
                corpus_meta_tab = "\n".join(f"{k}\t{v}" for k, v in corpus_meta_pairs)
                zf.writestr("corpus-meta.tab", corpus_meta_tab)

        # Reset buffer position for reading
        zip_buffer.seek(0)

        # Return ZIP as streaming response
        return StreamingResponse(
            iter([zip_buffer.getvalue()]),
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename={project_name}_{corpus_name}_{fmt}.zip"
            }
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Export error: {str(e)}")


# --- 5. Validation Rules ---
@app.get("/projects/{project_name}/validations")
def list_validations(project_name: str, current_user: dict = Depends(require_admin(0))):
    """Lists all validation rules for a project."""
    if current_user.get('project_name') != project_name: raise HTTPException(status_code=403, detail="Access denied to this project")
    validation_ids = r.smembers(_validation_set_key(project_name))
    rules = []

    for validation_id in validation_ids:
        rule_data = r.hgetall(_validation_key(project_name, validation_id))
        if rule_data:
            rule_data["id"] = validation_id
            rules.append(rule_data)

    # Stable ordering helps frontend rendering and deterministic behavior.
    rules.sort(key=lambda x: x.get("id", ""))
    return rules


@app.post("/projects/{project_name}/validations")
def create_validation(
    project_name: str,
    data: ValidationCreate,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_admin(1))
):
    """Creates a validation rule for a project (Requires AdminLevel > 0)."""
    if current_user.get('project_name') != project_name: raise HTTPException(status_code=403, detail="Access denied to this project")
    validation_id = secrets.token_urlsafe(8)
    rule_key = _validation_key(project_name, validation_id)
    rule_data = data.model_dump()

    r.hset(rule_key, mapping=rule_data)
    r.sadd(_validation_set_key(project_name), validation_id)

    affected_doc_ids = _collect_docs_affected_by_rule_change(project_name, rule_data)
    revalidation = _enqueue_validation_for_documents(affected_doc_ids, background_tasks)

    return {
        "message": "Validation created",
        "id": validation_id,
        **revalidation
    }


@app.put("/projects/{project_name}/validations/{validation_id}")
def update_validation(
        project_name: str,
        validation_id: str,
        data: ValidationCreate,
    background_tasks: BackgroundTasks,
        current_user: dict = Depends(require_admin(1))
):
    """Updates a validation rule and revalidates any documents affected by the change."""
    if current_user.get('project_name') != project_name: raise HTTPException(status_code=403, detail="Access denied to this project")
    rule_key = _validation_key(project_name, validation_id)

    if not r.exists(rule_key):
        raise HTTPException(status_code=404, detail="Validation not found")

    old_rule_data = r.hgetall(rule_key)
    new_rule_data = data.model_dump()

    r.hset(rule_key, mapping=new_rule_data)
    r.sadd(_validation_set_key(project_name), validation_id)

    affected_doc_ids = _collect_docs_affected_by_rule_change(project_name, old_rule_data, new_rule_data)
    revalidation = _enqueue_validation_for_documents(affected_doc_ids, background_tasks)

    return {
        "message": f"Validation {validation_id} updated",
        "id": validation_id,
        **revalidation
    }


@app.delete("/projects/{project_name}/validations/{validation_id}")
def delete_validation(
    project_name: str,
    validation_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_admin(1))
):
    """Deletes a validation rule from a project (Requires AdminLevel > 0)."""
    if current_user.get('project_name') != project_name: raise HTTPException(status_code=403, detail="Access denied to this project")
    rule_key = _validation_key(project_name, validation_id)

    if not r.exists(rule_key):
        raise HTTPException(status_code=404, detail="Validation not found")

    old_rule_data = r.hgetall(rule_key)

    r.delete(rule_key)
    r.srem(_validation_set_key(project_name), validation_id)

    affected_doc_ids = _collect_docs_affected_by_rule_change(project_name, old_rule_data)
    revalidation = _enqueue_validation_for_documents(affected_doc_ids, background_tasks)

    return {
        "message": f"Validation {validation_id} deleted",
        **revalidation
    }


# --- 6. GitHub Integration ---

@app.get("/documents/{doc_id}/github/commit-message")
def get_github_commit_message(
        doc_id: str,
        file_path: str,
        current_user: dict = Depends(require_admin(1))
):
    """Fetches the latest commit message for a file (Requires AdminLevel >= 1)"""
    doc_data = r.hgetall(f"doc:{doc_id}")
    if not doc_data:
        raise HTTPException(status_code=404, detail="Document not found")

    repo = doc_data.get("repo")
    gh = get_github_client(current_user, repo)

    try:
        latest_commit = gh.get_latest_commit_info(file_path)
        return {
            "commit_message": (latest_commit or {}).get("message", "") or "",
            "commit_url": (latest_commit or {}).get("url", "") or ""
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GitHub API Error: {str(e)}")


@app.get("/documents/{doc_id}/github/contents")
def get_github_file_contents(
        doc_id: str,
        file_path: str,
        current_user: dict = Depends(require_admin(1))
):
    """Fetches the latest file contents directly from GitHub (Requires AdminLevel >= 1)"""
    doc_data = r.hgetall(f"doc:{doc_id}")
    if not doc_data:
        raise HTTPException(status_code=404, detail="Document not found")

    repo = doc_data.get("repo")
    gh = get_github_client(current_user, repo)

    try:
        content = gh.get_file_contents(file_path)
        return {"content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GitHub API Error: {str(e)}")


@app.put("/documents/{doc_id}/github/contents")
def push_github_file_contents(
        doc_id: str,
        data: GitHubCommitRequest,
        current_user: dict = Depends(require_admin(1))
):
    """Pushes a new version of the file to GitHub (Requires AdminLevel >= 1)"""
    doc_data = r.hgetall(f"doc:{doc_id}")
    if not doc_data:
        raise HTTPException(status_code=404, detail="Document not found")

    repo = doc_data.get("repo")
    gh = get_github_client(current_user, repo)

    try:
        if data.format == "xml":
            gh.push_new_version(data.file_path, data.content, data.commit_message)
        elif data.format == "spreadsheet":
            meta_dict = data.metadata if isinstance(data.metadata, dict) else None

            # Backward compatibility: if clients do not send metadata yet,
            # fall back to persisted document metadata.
            if meta_dict is None and isinstance(doc_data.get('metadata'), str):
                try:
                    meta_dict = json.loads(doc_data['metadata'])
                except Exception:
                    meta_dict = None
            sgml_content = social_to_sgml(data.content, meta_dict=meta_dict)
            gh.push_new_version(data.file_path, sgml_content, data.commit_message)
        return {"message": "Successfully pushed new version to GitHub."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GitHub API Error: {str(e)}")


if __name__ == "__main__":
    import uvicorn

    # Run the server on port 8000
    uvicorn.run(app, host="0.0.0.0", port=8008)