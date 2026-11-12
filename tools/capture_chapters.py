"""
Recordings for chapters 3 to 10. capture.py calls capture_all() with the planner
already running from the extracted commit, so every value here comes from the
real code. Assertions stop the run if the planner ever behaves differently from
what the page's prose says.
"""

import json
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
import uuid
from pathlib import Path


def write(ctx, name, payload):
    (ctx.data / name).write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def call(ctx, service, method, payload=None):
    """Call a real API the way a client would and record what happened."""
    request = None if payload is None else json.dumps(payload)
    handler = getattr(ctx.services[service], method)
    try:
        body = handler() if request is None else handler(request)
        return {"method": method, "request": request, "ok": True, "body": body}
    except ctx.planner_error as exc:
        status = next(code for cls, code in ctx.error_status if isinstance(exc, cls))
        return {"method": method, "request": request, "ok": False, "exception": type(exc).__name__,
                "code": exc.code, "http": status, "message": str(exc)}


def capture_all(ctx):
    capture_http(ctx)
    capture_schema(ctx)
    capture_team(ctx)
    capture_board(ctx)
    capture_export(ctx)
    capture_quality(ctx)
    capture_decisions(ctx)
    capture_race(ctx)


# Chapter 10: the same methods over HTTP ------------------------------------------------

def capture_http(ctx):
    from django.test import Client

    client = Client(SERVER_NAME="127.0.0.1")
    exchanges = []
    ids = {}

    def exchange(label, method, path, body=None, content_type="application/json", note=None):
        if method == "GET":
            response = client.get(path)
        else:
            response = client.post(path, data=body if body is not None else "", content_type=content_type)
        record = {
            "label": label, "method": method, "path": path, "body": body, "content_type": content_type if method == "POST" else None,
            "status": response.status_code, "response": response.content.decode("utf-8"),
            "allow": response.get("Allow"), "note": note,
        }
        exchanges.append(record)
        return json.loads(record["response"]) if record["response"] else None

    j = json.dumps
    ids["dana"] = exchange("create_user", "POST", "/api/users/create_user", j({"name": "dana", "display_name": "Dana Kim"}))["id"]
    ids["eve"] = exchange("create_user", "POST", "/api/users/create_user", j({"name": "eve", "display_name": "Eve Park"}))["id"]
    exchange("list_users", "GET", "/api/users/list_users")
    exchange("describe_user", "POST", "/api/users/describe_user", j({"id": ids["dana"]}))
    exchange("update_user", "POST", "/api/users/update_user", j({"id": ids["eve"], "user": {"name": "eve", "display_name": "Eve Park-Lee"}}))
    ids["mobile"] = exchange("create_team", "POST", "/api/teams/create_team", j({"name": "mobile", "description": "Mobile apps", "admin": ids["dana"]}))["id"]
    exchange("list_teams", "GET", "/api/teams/list_teams")
    exchange("describe_team", "POST", "/api/teams/describe_team", j({"id": ids["mobile"]}))
    exchange("update_team", "POST", "/api/teams/update_team", j({"id": ids["mobile"], "team": {"description": "iOS and Android apps"}}))
    exchange("add_users_to_team", "POST", "/api/teams/add_users_to_team", j({"id": ids["mobile"], "users": [ids["dana"], ids["eve"]]}))
    exchange("remove_users_from_team", "POST", "/api/teams/remove_users_from_team", j({"id": ids["mobile"], "users": [ids["dana"]]}))
    exchange("list_team_users", "POST", "/api/teams/list_team_users", j({"id": ids["mobile"]}))
    exchange("get_user_teams", "POST", "/api/users/get_user_teams", j({"id": ids["eve"]}))
    ids["release"] = exchange("create_board", "POST", "/api/boards/create_board", j({"name": "Release 1", "description": "First store release", "team_id": ids["mobile"]}))["id"]
    ids["task"] = exchange("add_task", "POST", "/api/boards/add_task", j({"title": "Submit to the store", "board_id": ids["release"], "user_id": ids["eve"]}))["id"]
    exchange("list_boards", "POST", "/api/boards/list_boards", j({"id": ids["mobile"]}))
    exchange("update_task_status", "POST", "/api/boards/update_task_status", j({"id": ids["task"], "status": "COMPLETE"}))
    exchange("close_board", "POST", "/api/boards/close_board", j({"id": ids["release"]}))
    exchange("export_board", "POST", "/api/boards/export_board", j({"id": ids["release"]}))

    errors = []
    before = len(exchanges)
    exchange("Malformed JSON", "POST", "/api/users/create_user", '{"name": ', note="400: the body is not valid JSON")
    exchange("Unknown id", "POST", "/api/users/describe_user", j({"id": str(uuid.uuid4())}), note="404: no user has this id")
    exchange("Name taken", "POST", "/api/users/create_user", j({"name": "dana", "display_name": "Dana again"}), note="409: a duplicate name")
    exchange("Closed board", "POST", "/api/boards/add_task", j({"title": "Late fix", "board_id": ids["release"], "user_id": ids["eve"]}), note="409: not allowed in the current state")
    exchange("Wrong HTTP method", "GET", "/api/users/create_user", note="405: this endpoint takes POST; the Allow header says so")
    exchange("Not JSON", "POST", "/api/users/create_user", j({"name": "x", "display_name": "X"}), content_type="text/plain", note="415: the body must be sent as application/json")
    exchange("No such endpoint", "POST", "/api/users/delete_user", "{}", note="404: there is no delete API")
    errors = exchanges[before:]
    calls = exchanges[:before]
    index = exchange("Endpoint list", "GET", "/api/")
    exchanges.pop()

    assert len({c["label"] for c in calls}) == 18, sorted({c["label"] for c in calls})
    assert all(c["status"] == 200 for c in calls), [(c["label"], c["status"]) for c in calls if c["status"] != 200]
    assert [e["status"] for e in errors] == [400, 404, 409, 409, 405, 415, 404], [e["status"] for e in errors]
    labels = {ids["dana"]: "user dana", ids["eve"]: "user eve", ids["mobile"]: "team mobile",
              ids["release"]: "board Release 1", ids["task"]: "task Submit to the store"}
    write(ctx, "http.json", {"calls": calls, "errors": errors, "index": index, "labels": labels})


# Chapter 3: where the data lives -------------------------------------------------------

def capture_schema(ctx):
    from django.db import connection

    tables = []
    for model in ctx.model_list:
        fields = []
        for field in model._meta.get_fields():
            if field.auto_created and not field.concrete:
                continue
            if field.many_to_many:
                continue
            entry = {"name": field.attname, "pk": bool(field.primary_key), "unique": bool(field.unique and not field.primary_key),
                     "null": bool(field.null)}
            kind = field.get_internal_type()
            if field.is_relation:
                entry["type"] = "uuid"
                entry["references"] = field.related_model.__name__
                entry["on_delete"] = field.remote_field.on_delete.__name__
            elif kind == "UUIDField":
                entry["type"] = "uuid"
            elif kind == "CharField":
                entry["type"] = f"text, up to {field.max_length}"
                if field.choices:
                    entry["choices"] = [value for value, _ in field.choices]
            elif kind == "DateTimeField":
                entry["type"] = "date and time"
            else:
                entry["type"] = kind
            fields.append(entry)
        constraints = []
        for constraint in model._meta.constraints:
            if hasattr(constraint, "fields") and constraint.fields:
                constraints.append({"kind": "unique", "name": constraint.name, "fields": list(constraint.fields)})
            else:
                constraints.append({"kind": "check", "name": constraint.name})
        tables.append({"model": model.__name__, "table": model._meta.db_table, "fields": fields, "constraints": constraints})

    with connection.cursor() as cursor:
        cursor.execute("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name LIKE 'planner_%' ORDER BY name")
        create = dict(cursor.fetchall())
        cursor.execute("SELECT count(*) FROM sqlite_master WHERE type = 'index' AND tbl_name LIKE 'planner_%'")
        index_count = cursor.fetchone()[0]
        cursor.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'planner_%' ORDER BY name")
        other_tables = [row[0] for row in cursor.fetchall()]
    def check_sql(sql, name):
        start = sql.index("(", sql.index(f'CONSTRAINT "{name}" CHECK'))
        depth = 0
        for end in range(start, len(sql)):
            depth += {"(": 1, ")": -1}.get(sql[end], 0)
            if depth == 0:
                return sql[start:end + 1]
        raise AssertionError(name)

    for table in tables:
        sql = create[table["table"]]
        table["create_sql"] = sql
        for constraint in table["constraints"]:
            if constraint["kind"] == "check":
                constraint["sql"] = check_sql(sql, constraint["name"])

    db_dir = ctx.work / "db"
    files = sorted(p.name for p in db_dir.iterdir() if p.name != ".gitkeep")
    write(ctx, "schema.json", {
        "tables": tables,
        "index_count": index_count,
        "other_tables": other_tables,
        "db_files": files,
        "db_file": "db/planner.sqlite3",
        "settings": ctx.source("planner_project/settings.py", next(
            n for n, line in enumerate((ctx.work / "planner_project/settings.py").read_text().splitlines(), 1)
            if '"NAME": DB_DIR / "planner.sqlite3"' in line)),
    })


# Chapter 4: fifty seats ----------------------------------------------------------------

def capture_team(ctx):
    alice = ctx.ids["alice"]
    users = [ctx.plain("UserService", "create_user", {"name": f"dev{n:02d}", "display_name": f"Developer {n:02d}"})["id"]
             for n in range(1, 61)]
    names = {uid: f"dev{n:02d}" for n, uid in enumerate(users, 1)}
    unknown = str(uuid.uuid4())
    names[unknown] = None
    team = ctx.plain("TeamService", "create_team", {"name": "platform", "description": "Platform engineering", "admin": alice})["id"]

    plan = [
        ("add", users[0:30], "Add thirty developers."),
        ("add", users[25:40], "Add fifteen more, five of whom are already members."),
        ("add", users[40:45] + [unknown], "Add five new developers and one id that matches nobody."),
        ("add", users[40:50], "Add ten new developers."),
        ("add", users[50:51], "Add one more developer to the full team."),
        ("add", users[0:3], "Add three people who are already members."),
        ("remove", users[0:2] + users[55:56], "Remove two members and one developer who is not a member."),
        ("add", users[50:52], "Add two developers to the two free seats."),
        ("add", users[0:51], "Send fifty-one ids in one request."),
    ]
    steps = []
    previous = []
    for kind, batch, summary in plan:
        method = "add_users_to_team" if kind == "add" else "remove_users_from_team"
        result = call(ctx, "TeamService", method, {"id": team, "users": batch})
        members = [u["name"] for u in json.loads(ctx.services["TeamService"].list_team_users(json.dumps({"id": team})))]
        steps.append({
            "kind": kind, "summary": summary, "sent": [names[u] for u in batch], "count_sent": len(batch),
            "result": result, "members": members,
            "added": [m for m in members if m not in previous], "removed": [m for m in previous if m not in members],
        })
        previous = members
    sizes = [len(s["members"]) for s in steps]
    assert sizes == [30, 40, 40, 50, 50, 50, 48, 50, 50], sizes
    assert [s["result"]["ok"] for s in steps] == [True, True, False, True, False, True, True, True, False]
    team_info = json.loads(ctx.services["TeamService"].describe_team(json.dumps({"id": team})))
    write(ctx, "team.json", {"team": team_info, "admin": "alice", "admin_is_member": "alice" in previous,
                             "limit": ctx.limits.TEAM_MAX_MEMBERS, "per_request": ctx.limits.USER_IDS_PER_REQUEST_MAX,
                             "steps": steps})


# Chapter 5: a board from open to closed ------------------------------------------------

def capture_board(ctx):
    Board, Task = ctx.models["Board"], ctx.models["Task"]
    core, alice, bob, carol = ctx.ids["core"], ctx.ids["alice"], ctx.ids["bob"], ctx.ids["carol"]
    labels = {core: "team core", alice: "user alice", bob: "user bob", carol: "user carol"}
    state = {}

    def snapshot():
        board = Board.objects.get(pk=uuid.UUID(state["board"]))
        tasks = [{"title": t.title, "status": t.status, "assignee": t.assignee.name}
                 for t in board.tasks.select_related("assignee").order_by("creation_time", "title")]
        return {"status": board.status, "end_time": ctx.format_time(board.end_time), "tasks": tasks}

    steps = []

    def step(summary, *calls):
        steps.append({"summary": summary, "calls": list(calls), "board": snapshot()})

    created = call(ctx, "ProjectBoardService", "create_board", {"name": "Sprint 1", "description": "Ship the planner API", "team_id": core})
    state["board"] = json.loads(created["body"])["id"]
    labels[state["board"]] = "board Sprint 1"
    step("Create the board.", created)

    task_ids = {}
    adds = []
    for title, who in (("Design the data model", alice), ("Write the API", bob), ("Write the README", carol)):
        result = call(ctx, "ProjectBoardService", "add_task", {"title": title, "description": "", "board_id": state["board"], "user_id": who})
        task_ids[title] = json.loads(result["body"])["id"]
        labels[task_ids[title]] = f"task {title}"
        adds.append(result)
    step("Add three tasks.", *adds)

    def status(title, value):
        return call(ctx, "ProjectBoardService", "update_task_status", {"id": task_ids[title], "status": value})

    def close():
        return call(ctx, "ProjectBoardService", "close_board", {"id": state["board"]})

    def boards():
        return call(ctx, "ProjectBoardService", "list_boards", {"id": core})

    step("Try to close the board.", close())
    step("Start two tasks.", status("Design the data model", "IN_PROGRESS"), status("Write the API", "IN_PROGRESS"))
    step("Finish the data model.", status("Design the data model", "COMPLETE"))
    step("Try to close the board again.", close())
    step("Finish the other two tasks. The README goes straight from OPEN to COMPLETE.",
         status("Write the API", "COMPLETE"), status("Write the README", "COMPLETE"))
    step("List the team's open boards.", boards())
    step("Close the board.", close())
    step("List the team's open boards again.", boards())
    step("Try to change the closed board.",
         call(ctx, "ProjectBoardService", "add_task", {"title": "Hotfix", "board_id": state["board"], "user_id": bob}),
         status("Write the README", "OPEN"), close())

    outcomes = [[c["ok"] for c in s["calls"]] for s in steps]
    assert outcomes == [[True], [True] * 3, [False], [True, True], [True], [False], [True, True], [True], [True], [True], [False, False, False]], outcomes
    write(ctx, "board.json", {"labels": labels, "steps": steps})


# Chapter 7: the export -----------------------------------------------------------------

def capture_export(ctx):
    core, alice, bob, carol = ctx.ids["core"], ctx.ids["alice"], ctx.ids["bob"], ctx.ids["carol"]
    wei = ctx.plain("UserService", "create_user", {"name": "wei", "display_name": "王伟"})["id"]
    board = ctx.plain("ProjectBoardService", "create_board", {"name": "Sprint 2", "description": "Teams and boards over HTTP", "team_id": core})["id"]
    tasks = [
        ("Add the web endpoints", "Every API method at /api/<group>/<method>.", alice, "COMPLETE"),
        ("Write the HTTP tests", "", bob, "COMPLETE"),
        ("Map errors to status codes", "400, 404 and 409,\nwith a JSON body.", wei, "IN_PROGRESS"),
        ("Document the API", "", carol, "OPEN"),
        ("Check the 50-member cap under load", "Six processes at once.", bob, "OPEN"),
    ]
    for title, description, who, status in tasks:
        task = ctx.plain("ProjectBoardService", "add_task", {"title": title, "description": description, "board_id": board, "user_id": who})["id"]
        if status != "OPEN":
            ctx.plain("ProjectBoardService", "update_task_status", {"id": task, "status": status})
    first = ctx.plain("ProjectBoardService", "export_board", {"id": board})["out_file"]
    text = (ctx.work / "out" / first).read_text(encoding="utf-8")
    second = ctx.plain("ProjectBoardService", "export_board", {"id": board})["out_file"]
    assert second != first and (ctx.work / "out" / first).read_text(encoding="utf-8") == text

    lines = text.splitlines()

    def find(prefix, start=0):
        return next(i for i in range(start, len(lines)) if lines[i].startswith(prefix))

    parts = [
        ("Header", "The board's name, its status and how long it has been running.", 0, 3),
        ("Details", "Who owns the board and when it was created and closed.", find("  Team "), find("  Closed")),
        ("Progress", "Rounded down, so the bar is only full when every task is complete.", find("  Progress"), find("  Tasks")),
        ("Columns", "One section per status, in the order work moves across a board.", find("  OPEN  ·", find("  Tasks")) - 1, find("  WHO IS WORKING") - 3),
        ("Workload", "How many tasks each person has, and how many of those are complete.", find("  WHO IS WORKING") - 1, find("═", find("  WHO IS WORKING")) - 2),
        ("Footer", "When the file was made, and the board's id.", find("  Exported") - 1, len(lines) - 1),
    ]
    assert "\t" not in text
    write(ctx, "export.json", {
        "out_file": first, "second_out_file": second, "text": text, "bytes": len(text.encode("utf-8")),
        "parts": [{"title": t, "text": d, "start": s, "end": e} for t, d, s, e in parts],
        "cleaned": {"description": tasks[2][1], "shown": "400, 404 and 409, with a JSON body."},
    })
    assert "400, 404 and 409, with a JSON body." in text


# Chapter 9: how we know it works -------------------------------------------------------

MUTATIONS = [
    ("The fifty-member cap is off by one", "planner/services/teams.py", "> limits.TEAM_MAX_MEMBERS", ">= limits.TEAM_MAX_MEMBERS"),
    ("Existing members are added again", "planner/services/teams.py", "if user.pk not in already_members]", "]"),
    ("A new display name may be 128 characters", "planner/services/users.py", "limits.DISPLAY_NAME_CREATE_MAX_LENGTH", "limits.DISPLAY_NAME_UPDATE_MAX_LENGTH"),
    ("A user's name can be changed", "planner/services/users.py", "            if name is not None and name != user.name:\n                raise", "            if False:\n                raise"),
    ("Surrounding whitespace is kept", "planner/validators.py", "    return value.strip()", "    return value"),
    ("The same id in two spellings counts twice", "planner/lookups.py", "return list(records.values())", "return [found[pk] for pk in parsed.values()]"),
    ("A board closes with unfinished tasks", "planner/services/boards.py", "            if unfinished:\n", "            if False:\n"),
    ("Tasks can be added to a closed board", "planner/services/boards.py", "            if board.status != BoardStatus.OPEN:\n                raise InvalidStateError(f\"Tasks", "            if False:\n                raise InvalidStateError(f\"Tasks"),
    ("list_boards includes closed boards", "planner/services/boards.py", "team.boards.filter(status=BoardStatus.OPEN)", "team.boards.all()"),
    ("An export can overwrite an older one", "planner/export.py", 'open(out_dir / name, "x"', 'open(out_dir / name, "w"'),
    ("Control characters reach the export", "planner/export.py", '" " if unicodedata.category(char) == "Cc" else char', "char"),
    ("Progress is rounded up", "planner/export.py", "percent = complete * 100 // total", "percent = round(complete * 100 / total)"),
    ("A duplicate name answers HTTP 400", "planner/views.py", "    (DuplicateError, 409),", "    (DuplicateError, 400),"),
    ("Any content type is accepted", "planner/views.py", '    if request.content_type != "application/json":', "    if False:"),
]


def run_tests(path):
    result = subprocess.run([sys.executable, "manage.py", "test", "-v", "2"], cwd=path, capture_output=True, text=True)
    ran = re.search(r"^Ran (\d+) tests", result.stderr, re.M)
    failed = re.search(r"^FAILED \((.*)\)", result.stderr, re.M)
    broken = sum(int(n) for n in re.findall(r"(?:failures|errors)=(\d+)", failed.group(1))) if failed else 0
    return result, int(ran.group(1)) if ran else 0, broken


def capture_quality(ctx):
    result, total, broken = run_tests(ctx.work)
    assert result.returncode == 0 and broken == 0, result.stderr[-2000:]
    per_module = {}
    for module in re.findall(r"\(planner\.tests\.(test_\w+)\.", result.stderr):
        per_module[module] = per_module.get(module, 0) + 1
    assert sum(per_module.values()) == total, (per_module, total)

    mutations = []
    for title, rel, old, new in MUTATIONS:
        copy = Path(tempfile.mkdtemp(prefix="planner-mutant-"))
        shutil.copytree(ctx.work, copy, dirs_exist_ok=True, ignore=shutil.ignore_patterns("db", "out", "__pycache__"))
        target = copy / rel
        text = target.read_text(encoding="utf-8")
        assert text.count(old) == 1, title
        start = text.index(old)
        line_start = text.rfind("\n", 0, start) + 1
        line_end = text.find("\n", start + len(old))
        line = text[:start].count("\n") + 1
        mutated = text.replace(old, new)
        before_lines = textwrap.dedent(text[line_start:line_end]).rstrip()
        after_lines = textwrap.dedent(mutated[line_start:line_end + len(new) - len(old)]).rstrip()
        target.write_text(mutated, encoding="utf-8")
        mutant, ran, failing = run_tests(copy)
        shutil.rmtree(copy, ignore_errors=True)
        mutations.append({"title": title, "file": rel, "line": line, "before": before_lines, "after": after_lines,
                          "url": f"{ctx.repo_url}/blob/{ctx.commit}/{rel}#L{line}", "failing_tests": failing,
                          "caught": mutant.returncode != 0})
    assert all(m["caught"] for m in mutations), [m["title"] for m in mutations if not m["caught"]]

    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    def queries(service, method, payload=None):
        with CaptureQueriesContext(connection) as captured:
            handler = getattr(ctx.services[service], method)
            handler() if payload is None else handler(json.dumps(payload))
        return len(captured)

    admin = ctx.ids["alice"]
    team = ctx.plain("TeamService", "create_team", {"name": "metrics", "admin": admin})["id"]
    people = [ctx.plain("UserService", "create_user", {"name": f"metric{n:02d}", "display_name": f"Metric {n:02d}"})["id"] for n in range(1, 51)]
    small_team = ctx.plain("TeamService", "create_team", {"name": "metrics-small", "admin": admin})["id"]
    add_one = queries("TeamService", "add_users_to_team", {"id": small_team, "users": people[:1]})
    add_fifty = queries("TeamService", "add_users_to_team", {"id": team, "users": people})
    small_board = ctx.plain("ProjectBoardService", "create_board", {"name": "one task", "team_id": team})["id"]
    big_board = ctx.plain("ProjectBoardService", "create_board", {"name": "forty tasks", "team_id": team})["id"]
    ctx.plain("ProjectBoardService", "add_task", {"title": "task 1", "board_id": small_board, "user_id": people[0]})
    for n in range(40):
        ctx.plain("ProjectBoardService", "add_task", {"title": f"task {n + 1}", "board_id": big_board, "user_id": people[n]})
    users_now = ctx.models["User"].objects.count()
    teams_now = ctx.models["Team"].objects.count()
    query_counts = [
        {"api": "list_users", "size": f"{users_now} users", "queries": queries("UserService", "list_users")},
        {"api": "list_teams", "size": f"{teams_now} teams", "queries": queries("TeamService", "list_teams")},
        {"api": "list_team_users", "size": "50 members", "queries": queries("TeamService", "list_team_users", {"id": team})},
        {"api": "get_user_teams", "size": "a member of 2 teams", "queries": queries("UserService", "get_user_teams", {"id": people[0]})},
        {"api": "add_users_to_team", "size": "1 user", "queries": add_one},
        {"api": "add_users_to_team", "size": "50 users", "queries": add_fifty},
        {"api": "export_board", "size": "1 task", "queries": queries("ProjectBoardService", "export_board", {"id": small_board})},
        {"api": "export_board", "size": "40 tasks", "queries": queries("ProjectBoardService", "export_board", {"id": big_board})},
    ]
    # The page states these numbers in words.
    assert [q["queries"] for q in query_counts[:4]] == [1, 1, 2, 2], query_counts
    assert query_counts[4]["queries"] == query_counts[5]["queries"]
    assert query_counts[6]["queries"] == query_counts[7]["queries"]

    workflow = (ctx.work / ".github/workflows/tests.yml").read_text(encoding="utf-8")
    versions = re.findall(r'"(\d\.\d+)"', re.search(r"python-version: \[(.*?)\]", workflow).group(1))
    write(ctx, "quality.json", {"tests": total, "per_module": per_module, "mutations": mutations,
                                "query_counts": query_counts, "ci_python": versions})


# Chapter 8: reading between the lines ---------------------------------------------------

EVIDENCE = {
    "Display name: at most 64": [("user_base.py", "display name can be max 64 characters"), ("user_base.py", "display name can be max 128 characters")],
    "`update_user` accepts `name`": [("user_base.py", "user name cannot be updated")],
    "`describe_user` returns `description`": [("user_base.py", '"description" : "<some description>",')],
    "The admin must be an existing user": [("team_base.py", '"admin": "<id of a user>"')],
    "A team has at most 50 members": [("team_base.py", "Cap the max users that can be added to 50")],
    "`add_task` needs a `board_id`": [("project_board_base.py", ":param request: A json string with the task details.")],
    "In `add_task`, `title` is the task title": [("project_board_base.py", '"title" : "<board_name>",'), ("project_board_base.py", '"user_id" : "<team id>"')],
    "A `creation_time` sent": [("project_board_base.py", '"creation_time" : "<date:time when board was created>"')],
    "A board with no tasks can be closed": [("project_board_base.py", "You can only close boards with all tasks marked as COMPLETE")],
    "`list_boards` returns open boards only": [("project_board_base.py", "# list all open boards for a team")],
    "Methods whose `:return:` is blank": [("user_base.py", "=:return:")],
}


def capture_decisions(ctx):
    readme = (ctx.work / "README.md").read_text(encoding="utf-8")
    section = readme.split("## Assumptions", 1)[1].split("\n## ", 1)[0]
    groups = []
    parts = re.split(r"\n\*\*(.+?)\*\*\n", section)
    for title, block in zip(parts[1::2], parts[2::2]):
        groups.append({"title": title})
        rows = [line for line in block.splitlines() if line.startswith("| ") and not line.startswith("| Decision") and not line.startswith("|---")]
        decisions = []
        for row in rows:
            decision, why = [cell.strip() for cell in row.strip().strip("|").split(" | ")]
            evidence = []
            for key, quotes in EVIDENCE.items():
                if decision.startswith(key):
                    for file, needle in quotes:
                        file_lines = (ctx.work / file).read_text(encoding="utf-8").splitlines()
                        number = next(n for n, line in enumerate(file_lines, 1)
                                      if (line.strip() == needle[1:] if needle.startswith("=") else needle in line))
                        evidence.append({**ctx.source(file, number), "quote": file_lines[number - 1].strip()})
            decisions.append({"decision": decision, "why": why, "evidence": evidence})
        groups[-1]["decisions"] = decisions
    intro = section.strip().split("\n\n", 1)[0].replace("\n", " ")
    found = {key for key in EVIDENCE if any(d["decision"].startswith(key) for g in groups for d in g["decisions"])}
    assert found == set(EVIDENCE), set(EVIDENCE) - found
    write(ctx, "decisions.json", {"intro": intro, "groups": groups,
                                  "readme_url": f"{ctx.repo_url}/blob/{ctx.commit}/README.md#assumptions"})


# Chapter 6: two requests at the same moment --------------------------------------------

DRIVER = r'''
import json, sys, time
sys.path.insert(0, sys.argv[1])
from planner.services import TeamService, UserService
command = sys.argv[2]
if command == "setup":
    users, teams = UserService(), TeamService()
    make = lambda n: json.loads(users.create_user(json.dumps({"name": n, "display_name": n})))["id"]
    admin = make("admin")
    batches = [[make(f"p{b}u{i:02d}") for i in range(int(sys.argv[4]))] for b in range(int(sys.argv[3]))]
    rounds = int(sys.argv[5])
    team_ids = [json.loads(teams.create_team(json.dumps({"name": f"race{r}", "admin": admin})))["id"] for r in range(rounds)]
    print(json.dumps({"batches": batches, "teams": team_ids}))
elif command == "size":
    print(len(json.loads(TeamService().list_team_users(json.dumps({"id": sys.argv[3]})))))
else:
    team, batch, go_at = sys.argv[3], json.loads(sys.argv[4]), float(sys.argv[5])
    service = TeamService()
    while time.time() < go_at:
        pass
    start = time.time()
    try:
        service.add_users_to_team(json.dumps({"id": team, "users": batch}))
        outcome = {"ok": True}
    except Exception as exc:
        outcome = {"ok": False, "exception": type(exc).__name__, "message": str(exc)}
    outcome.update(start_ms=(start - go_at) * 1000, end_ms=(time.time() - go_at) * 1000)
    print(json.dumps(outcome))
'''


def capture_race(ctx):
    processes, batch_size, rounds = 6, 30, 3
    modes = []
    for mode in ("immediate", "deferred"):
        copy = Path(tempfile.mkdtemp(prefix=f"planner-race-{mode}-"))
        shutil.copytree(ctx.work, copy, dirs_exist_ok=True, ignore=shutil.ignore_patterns("db", "out", "__pycache__"))
        settings = copy / "planner_project/settings.py"
        if mode == "deferred":
            text = settings.read_text(encoding="utf-8")
            assert text.count('"transaction_mode": "IMMEDIATE",') == 1
            settings.write_text(text.replace('"transaction_mode": "IMMEDIATE",', ""), encoding="utf-8")
        driver = copy / "race_driver.py"
        driver.write_text(DRIVER, encoding="utf-8")
        run = lambda *args: subprocess.run([sys.executable, str(driver), str(copy), *map(str, args)], check=True,
                                           capture_output=True, text=True).stdout
        setup = json.loads(run("setup", processes, batch_size, rounds))
        results = []
        for team in setup["teams"]:
            go_at = time.time() + 3
            workers = [subprocess.Popen([sys.executable, str(driver), str(copy), "add", team, json.dumps(batch), str(go_at)],
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for batch in setup["batches"]]
            outcomes = []
            for worker in workers:
                out, err = worker.communicate(timeout=120)
                outcomes.append(json.loads(out) if out.strip() else {"ok": False, "exception": "Crash", "message": err.strip().splitlines()[-1]})
            results.append({"processes": outcomes, "team_size": int(run("size", team))})
        shutil.rmtree(copy, ignore_errors=True)
        modes.append({"mode": mode, "rounds": results})

    immediate, deferred = modes
    for result in immediate["rounds"]:
        # The page says: with the setting, every losing request gets the planner's own error.
        assert sum(p["ok"] for p in result["processes"]) == 1 and result["team_size"] == batch_size
        assert all(p["exception"] == "InvalidStateError" for p in result["processes"] if not p["ok"])
    # The page says: without the setting the cap still holds, but a losing request may get either the planner's
    # error or a raw "database is locked", depending on timing; at least one run must show the raw error.
    for result in deferred["rounds"]:
        assert result["team_size"] <= ctx.limits.TEAM_MAX_MEMBERS
        assert all(p["exception"] == "InvalidStateError" or (p["exception"] == "OperationalError" and "database is locked" in p["message"])
                   for p in result["processes"] if not p["ok"]), result
    assert any(p.get("exception") == "OperationalError" for r in deferred["rounds"] for p in r["processes"]), deferred
    write(ctx, "race.json", {"processes": processes, "batch_size": batch_size, "limit": ctx.limits.TEAM_MAX_MEMBERS,
                             "setting": ctx.source("planner_project/settings.py", next(
                                 n for n, line in enumerate((ctx.work / "planner_project/settings.py").read_text().splitlines(), 1)
                                 if '"transaction_mode": "IMMEDIATE"' in line), context=4),
                             "modes": modes})
