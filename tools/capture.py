"""
Records what the real planner does, for the explainer site.

    python tools/capture.py PATH/TO/team-project-planner

Run it with a Python that has the planner's requirements installed. The script
extracts the planner's latest commit into a temporary folder (so the planner's
own db/ and out/ folders are never touched), drives the real services through
the scenarios below and writes what happened to data/*.json.

Nothing on the site is typed by hand: requests, responses, error messages, the
checks each request went through, the SQL statements and the source lines all
come from these runs, and the site names the commit they came from. To record
which checks ran, the script wraps the planner's own validation and lookup
helpers; every wrapper calls straight through to the original, so behaviour is
unchanged.
"""

import ast
import functools
import io
import json
import os
import platform
import subprocess
import sys
import tarfile
import tempfile
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
DATA = SITE / "data"
REPO_URL = "https://github.com/Aryan7512/team-project-planner"

STAGES = ["parse", "check", "rules", "save", "reply"]
VALIDATORS = ["parse_request", "object_field", "text_field", "id_field", "id_list_field", "choice_field"]
LOOKUPS = ["get_by_id", "get_many_by_id"]


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()


def extract_commit(repo):
    if git(repo, "status", "--porcelain"):
        sys.exit("The planner repo has uncommitted changes. Commit them first so the site can cite an exact commit.")
    commit = git(repo, "rev-parse", "HEAD")
    work = Path(tempfile.mkdtemp(prefix="planner-capture-"))
    archive = subprocess.run(["git", "-C", str(repo), "archive", commit], check=True, capture_output=True).stdout
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(work, filter="data")
    return commit, work


class Recorder:
    """Collects the validation and lookup calls made during one request."""

    def __init__(self):
        self.events = []

    def wrap_validator(self, name, original):
        @functools.wraps(original)
        def wrapper(*args, **kwargs):
            event = {"helper": name}
            if name != "parse_request":
                data, key = args[0], args[1]
                event["field"] = key
                event["present"] = isinstance(data, dict) and key in data
                if "max_length" in kwargs:
                    event["limit"] = kwargs["max_length"]
                if "max_items" in kwargs:
                    event["limit"] = kwargs["max_items"]
                if name == "choice_field":
                    event["choices"] = list(args[2])
            self.events.append(event)
            try:
                result = original(*args, **kwargs)
            except Exception as exc:
                event["ok"] = False
                event["error"] = str(exc)
                raise
            event["ok"] = True
            if isinstance(result, str):
                event["length"] = len(result)
            elif isinstance(result, list):
                event["count"] = len(result)
            elif isinstance(result, dict) and name == "parse_request":
                event["keys"] = list(result)
            elif isinstance(result, dict):
                event["keys"] = list(result)
            elif result is None:
                event["absent"] = True
            return result

        return wrapper

    def wrap_lookup(self, name, original):
        @functools.wraps(original)
        def wrapper(source, raw, label):
            event = {"helper": name, "label": label}
            self.events.append(event)
            try:
                result = original(source, raw, label)
            except Exception as exc:
                event["ok"] = False
                event["error"] = str(exc)
                raise
            event["ok"] = True
            records = result if isinstance(result, list) else [result]
            event["found"] = [getattr(r, "name", None) or getattr(r, "title", None) or str(r.pk) for r in records]
            return result

        return wrapper


def method_landmarks(path, method_name):
    """Line numbers inside a service method where each stage begins, read from the source."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == method_name:
            source_lines = path.read_text(encoding="utf-8").splitlines()
            body = list(range(node.lineno, node.end_lineno + 1))

            def first(*needles):
                for number in body:
                    if any(needle in source_lines[number - 1] for needle in needles):
                        return number
                raise AssertionError(f"{method_name}: none of {needles} found")

            return {
                "def": node.lineno,
                "parse": first("parse_request("),
                "check": first("text_field(", "id_field(", "id_list_field(", "object_field(", "choice_field("),
                "rules": first("transaction.atomic()", "get_by_id("),
                "save": first(".create(", "bulk_create(", ".save(", ".delete(", "write_board_export("),
                "reply": first("return to_json("),
            }
    raise AssertionError(f"method {method_name} not found in {path}")


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    repo = Path(sys.argv[1]).resolve()
    commit, work = extract_commit(repo)
    sys.path.insert(0, str(work))
    os.environ.pop("DJANGO_SETTINGS_MODULE", None)

    from django import get_version
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    import planner.services.boards as boards_module
    import planner.services.teams as teams_module
    import planner.services.users as users_module
    from planner import limits
    from planner.models import Board, Task, Team, TeamMembership, User
    from planner.services import ProjectBoardService, TeamService, UserService
    from planner.views import ERROR_STATUS

    service_modules = {"UserService": users_module, "TeamService": teams_module, "ProjectBoardService": boards_module}
    services = {"UserService": UserService(), "TeamService": TeamService(), "ProjectBoardService": ProjectBoardService()}
    recorder = Recorder()
    for module in service_modules.values():
        for name in VALIDATORS:
            if hasattr(module, name):
                setattr(module, name, recorder.wrap_validator(name, getattr(module, name)))
        for name in LOOKUPS:
            if hasattr(module, name):
                setattr(module, name, recorder.wrap_lookup(name, getattr(module, name)))

    def source(rel, line, context=0):
        lines = (work / rel).read_text(encoding="utf-8").splitlines()
        excerpt = lines[line - 1 - context:line]
        indent = min(len(text) - len(text.lstrip()) for text in excerpt if text.strip())
        return {
            "file": rel,
            "line": line,
            "url": f"{REPO_URL}/blob/{commit}/{rel}#L{line}",
            "code": "\n".join(text[indent:] for text in excerpt),
        }

    def counts():
        return {model.__name__: model.objects.count() for model in (User, Team, TeamMembership, Board, Task)}

    def plain(service, method, payload):
        return json.loads(getattr(services[service], method)(json.dumps(payload)))

    # The state every scenario starts from, built with the real APIs.
    alice = plain("UserService", "create_user", {"name": "alice", "display_name": "Alice Smith"})["id"]
    bob = plain("UserService", "create_user", {"name": "bob", "display_name": "Bob Lee"})["id"]
    core = plain("TeamService", "create_team", {"name": "core", "description": "Core platform", "admin": alice})["id"]
    plain("TeamService", "add_users_to_team", {"id": core, "users": [alice, bob]})
    sprint0 = plain("ProjectBoardService", "create_board", {"name": "Sprint 0", "team_id": core})["id"]
    setup_task = plain("ProjectBoardService", "add_task", {"title": "Set up repo", "board_id": sprint0, "user_id": bob})["id"]
    plain("ProjectBoardService", "update_task_status", {"id": setup_task, "status": "COMPLETE"})
    plain("ProjectBoardService", "close_board", {"id": sprint0})
    setup = [
        "Users alice (Alice Smith) and bob (Bob Lee) exist.",
        "Team core has admin alice and members alice and bob.",
        "Board Sprint 0 belongs to core and is CLOSED; its one task is COMPLETE.",
        "The requests then ran in the order listed, so the ones after the first also see carol, whom the first one adds.",
    ]

    long_name = "alexandra-catherine-montgomery-wellington-fitzgerald-hamilton-the"
    assert len(long_name) == limits.NAME_MAX_LENGTH + 1
    unknown_id = str(uuid.uuid4())
    carol = {}

    scenarios = [
        {
            "id": "new-user", "service": "UserService", "method": "create_user", "expect": "reply",
            "title": "A new user",
            "summary": "Create a user whose name is free.",
            "payload": lambda: {"name": "carol", "display_name": "Carol Diaz"},
        },
        {
            "id": "broken-json", "service": "UserService", "method": "create_user", "expect": "parse",
            "title": "JSON cut short",
            "summary": "The request text stops before its closing brace.",
            "raw": '{"name": "dave", "display_name": "Dave"',
        },
        {
            "id": "name-too-long", "service": "UserService", "method": "create_user", "expect": "check",
            "title": "Name one character too long",
            "summary": f"A name of {len(long_name)} characters, one over the limit.",
            "payload": lambda: {"name": long_name, "display_name": "Alexandra"},
        },
        {
            "id": "duplicate-name", "service": "UserService", "method": "create_user", "expect": "rules",
            "title": "Name already taken",
            "summary": "Try to create a second user called alice.",
            "payload": lambda: {"name": "alice", "display_name": "Another Alice"},
        },
        {
            "id": "unknown-member", "service": "TeamService", "method": "add_users_to_team", "expect": "rules",
            "title": "One unknown id in a batch",
            "summary": "Add carol and an id that matches nobody to team core.",
            "payload": lambda: {"id": core, "users": [carol["id"], unknown_id]},
        },
        {
            "id": "closed-board", "service": "ProjectBoardService", "method": "add_task", "expect": "rules",
            "title": "Task for a closed board",
            "summary": "Add a task to Sprint 0, which is already closed.",
            "payload": lambda: {"title": "Fix login", "board_id": sprint0, "user_id": bob},
        },
    ]

    records = []
    for scenario in scenarios:
        service, method = scenario["service"], scenario["method"]
        module = service_modules[service]
        rel = f"planner/services/{Path(module.__file__).name}"
        landmarks = method_landmarks(work / rel, method)
        request = scenario.get("raw") or json.dumps(scenario["payload"]())

        recorder.events = []
        before = counts()
        error = None
        with CaptureQueriesContext(connection) as queries:
            try:
                response = getattr(services[service], method)(request)
            except Exception as exc:  # the planner's own errors are what we want to show
                error = exc
        after = counts()

        if scenario["id"] == "new-user":
            carol["id"] = json.loads(response)["id"]

        stage = "reply"
        outcome = {"kind": "response", "body": response} if error is None else None
        if error is not None:
            frames = [f for f in traceback.extract_tb(error.__traceback__) if f.filename.startswith(str(work))]
            last = frames[-1]
            raised_rel = Path(last.filename).relative_to(work).as_posix()
            if raised_rel == "planner/validators.py":
                stage = "parse" if last.name == "parse_request" else "check"
            elif raised_rel == rel and last.lineno < landmarks["rules"]:
                stage = "check"
            else:
                stage = "rules"
            status = next(code for cls, code in ERROR_STATUS if isinstance(error, cls))
            outcome = {
                "kind": "error",
                "exception": type(error).__name__,
                "builtin": next((b.__name__ for b in (ValueError, LookupError) if isinstance(error, b)), None),
                "code": error.code,
                "http": status,
                "message": str(error),
                "raised_at": {**source(raised_rel, last.lineno, context=1), "function": last.name},
            }
        assert stage == scenario["expect"], f"{scenario['id']}: expected to stop at {scenario['expect']}, stopped at {stage}"

        sql = []
        for query in queries.captured_queries:
            text = query["sql"]
            verb = text.split(None, 1)[0].upper()
            kind = "read" if verb == "SELECT" else "write" if verb in ("INSERT", "UPDATE", "DELETE") else "transaction"
            sql.append({"sql": text, "kind": kind})

        reached = STAGES.index(stage)
        stages = []
        for index, key in enumerate(STAGES):
            if index < reached or error is None:
                state = "passed"
            elif index == reached:
                state = "failed"
            else:
                state = "skipped"
            stages.append({"key": key, "status": state, "source": source(rel, landmarks[key])})

        records.append({
            "id": scenario["id"],
            "title": scenario["title"],
            "summary": scenario["summary"],
            "service": service,
            "method": method,
            "request": request,
            "python": f"{service}().{method}({request!r})",
            "stopped_at": stage,
            "stages": stages,
            "events": list(recorder.events),
            "sql": sql,
            "outcome": outcome,
            "rows_before": before,
            "rows_after": after,
            "changed": before != after,
        })

    from types import SimpleNamespace

    from capture_chapters import capture_all
    from planner.exceptions import PlannerError
    from planner.serializers import format_time

    model_list = [User, Team, TeamMembership, Board, Task]
    DATA.mkdir(exist_ok=True)
    capture_all(SimpleNamespace(
        work=work, commit=commit, repo_url=REPO_URL, data=DATA, services=services, plain=plain, source=source,
        error_status=ERROR_STATUS, planner_error=PlannerError, model_list=model_list,
        models={m.__name__: m for m in model_list}, limits=limits, format_time=format_time,
        ids={"alice": alice, "bob": bob, "core": core, "carol": carol["id"]},
    ))

    tests = subprocess.run([sys.executable, "manage.py", "test"], cwd=work, capture_output=True, text=True)
    ran = next(line for line in tests.stderr.splitlines() if line.startswith("Ran "))
    assert tests.returncode == 0, tests.stderr[-2000:]

    meta = {
        "tests": {"count": int(ran.split()[1]), "passed": True},
        "repo": REPO_URL,
        "commit": commit,
        "commit_url": f"{REPO_URL}/commit/{commit}",
        "captured_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "python": platform.python_version(),
        "django": get_version(),
    }
    import inspect

    from project_board_base import ProjectBoardBase
    from team_base import TeamBase
    from user_base import UserBase

    brief = []
    for base, impl in ((UserBase, "UserService"), (TeamBase, "TeamService"), (ProjectBoardBase, "ProjectBoardService")):
        module_file = f"{base.__module__}.py"
        methods = []
        for name, member in vars(base).items():
            if callable(member) and not name.startswith("_"):
                line = inspect.getsourcelines(member)[1]
                implementation = inspect.getsource(getattr(services[impl].__class__, name))
                if "transaction.atomic()" in implementation:
                    kind = "write"
                elif "write_board_export(" in implementation:
                    kind = "export"
                else:
                    kind = "read"
                methods.append({"name": name, "signature": f"{name}{inspect.signature(member)}",
                                "kind": kind, "source": source(module_file, line)})
        brief.append({"base": base.__name__, "implementation": impl, "file": module_file, "methods": methods})

    kinds = [method["kind"] for cls in brief for method in cls["methods"]]
    # The page's prose states these numbers; if the planner changes, update the prose and these checks together.
    assert (kinds.count("write"), kinds.count("read"), kinds.count("export")) == (10, 7, 1), kinds

    DATA.mkdir(exist_ok=True)
    (DATA / "brief.json").write_text(json.dumps({"meta": meta, "classes": brief}, indent=2) + "\n", encoding="utf-8")
    labels = {alice: "user alice", bob: "user bob", core: "team core", sprint0: "board Sprint 0 (closed)",
              carol["id"]: "user carol", unknown_id: "matches no record"}
    payload = {"meta": meta, "setup": setup, "labels": labels, "scenarios": records}
    (DATA / "pipeline.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"captured {len(records)} scenarios from {commit[:7]} -> {DATA / 'pipeline.json'}")


if __name__ == "__main__":
    main()
