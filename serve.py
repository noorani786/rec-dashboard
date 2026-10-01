#!/usr/bin/env python3
"""
REC Reporting Dashboard - local server.

Organise your CSV exports by region and academic year:

    data/<region>/<year>/*.csv       e.g. data/central/2025-2026/

Filenames don't matter - files are identified by their column headers, so the
"(17)" suffixes are fine. Run this script and open the printed URL. The Region
and Year pickers in the dashboard switch between datasets; refreshing re-reads
the whole data/ tree - no build step, no renaming.

    python3 serve.py            # starts on http://localhost:8000
    python3 serve.py 9000       # custom port

Auth (optional for local; recommended when exposed):

    export DASHBOARD_USER=rec
    export DASHBOARD_PASSWORD='your-strong-password'
    python3 serve.py

For a public VPS deploy, bind to localhost and put nginx in front
(see deploy/README.md):

    export DASHBOARD_BIND=127.0.0.1
    export DASHBOARD_PASSWORD='...'   # optional extra gate behind nginx

Requires only the Python 3 standard library.
"""
import base64, csv, datetime, io, json, os, secrets, sys, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
WEB_DIR = os.path.join(ROOT, "web")

QLEVELS = {"Adequate", "Moderate", "Low", "None"}

# Auth: when DASHBOARD_PASSWORD is set, every request requires HTTP Basic Auth.
AUTH_USER = os.environ.get("DASHBOARD_USER", "rec").strip() or "rec"
AUTH_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "")
# Bind address: 127.0.0.1 for local / behind nginx; 0.0.0.0 only if you know the risk.
BIND_HOST = os.environ.get("DASHBOARD_BIND", "127.0.0.1").strip() or "127.0.0.1"

# Test / non-reporting centers omitted from all aggregates.
def _excluded_loc(name):
    """True for known test centers (e.g. NTX Virtual REC)."""
    n = (name or "").strip().lower().replace("  ", " ")
    return ("ntx virtual" in n) or n in {"ntx virtual", "ntx virtual rec"}


# ----------------------------- helpers -----------------------------
def _num(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0


def _fnum(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _read_csv(path):
    """Return (headers, list-of-dict-rows). Tolerates BOM."""
    with open(path, encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        rows = list(reader)
        return (reader.fieldnames or []), rows


def _parse_attendance_date(s):
    s = (s or "").strip()
    for fmt in ("%A, %B %d, %Y", "%B %d, %Y", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return s  # leave as-is if unrecognised


def _parse_short_date(s):
    """Holidays file: M/D/YY or M/D/YYYY -> YYYY-MM-DD."""
    s = (s or "").strip()
    if not s:
        return None
    try:
        m, d, y = s.split("/")
        y = int(y)
        y = 2000 + y if y < 100 else y
        return datetime.date(y, int(m), int(d)).isoformat()
    except (ValueError, TypeError):
        return None


# ----------------------- file classification ----------------------
def classify(headers):
    h = set(headers)
    if {"TotalAccessHours", "AccessQ"} <= h:
        return "access"
    # Per-student attendance marks (PersonID + date; not the daily class aggregate).
    if "PersonID" in h and ("DateofClass1" in h or "DateofClass" in h):
        if "M1" not in h and "TotalPosition" not in h:
            return "attendance_student"
    if "DateofClass1" in h and "M1" in h:
        return "attendance"
    if {"StudentActive", "StudentInActive"} <= h:
        return "registration"
    if "Week ending" in h and "REC" in h:
        return "holidays"
    # Grade-specific REC session dates (e.g. STEP 11–12 at Dallas / Lewisville).
    if "REC" in h and "Grade" in h and (
        "Date" in h or "Week ending" in h or "Session date" in h
    ):
        return "session_dates"
    # Student roster with PersonID (detail export); phone-only exports lack PersonID
    if "PersonID" in h and ("JamatiTitle" in h or "Grade" in h):
        return "contact"
    return None


Q_RANK = {"Adequate": 3, "Moderate": 2, "Low": 1, "None": 0}


def _person_name(row):
    parts = [
        (row.get("textbox68") or "").strip(),
        (row.get("MName") or "").strip(),
        (row.get("LName") or "").strip(),
    ]
    return " ".join(p for p in parts if p)


def _dedupe_access(rows):
    """Collapse duplicate Person rows: sum hours, keep best quality / primary loc."""
    best = {}
    dup_people = set()
    for row in rows:
        p = (row.get("person") or "").strip()
        key = p or id(row)
        if key not in best:
            best[key] = dict(row)
            best[key]["_seg"] = row["hours"]
            continue
        dup_people.add(key)
        b = best[key]
        b["hours"] = round(b["hours"] + row["hours"], 1)
        if row["hours"] > b.get("_seg", 0):
            b["_seg"] = row["hours"]
            b["loc"] = row["loc"]
            b["grade"] = row["grade"]
        if Q_RANK.get(row["q"], 0) > Q_RANK.get(b["q"], 0):
            b["q"] = row["q"]
    out = []
    for b in best.values():
        b.pop("_seg", None)
        out.append(b)
    return out, len(dup_people)


def _student_mark(row):
    """Parse a single P/A/T/E/M mark from a student attendance row."""
    for col in ("Mark", "Attendance", "AttCode", "AttendanceCode", "Status"):
        v = (row.get(col) or "").strip().upper()
        if v in ("P", "A", "T", "E", "M"):
            return v
        if v.startswith("PRESENT"):
            return "P"
        if v.startswith("ABSENT"):
            return "A"
        if "TARDY" in v:
            return "T"
        if "EXCUSED" in v:
            return "E"
        if "UNMARKED" in v:
            return "M"
    if _num(row.get("P")) == 1:
        return "P"
    if _num(row.get("A")) == 1:
        return "A"
    if _num(row.get("T")) == 1:
        return "T"
    if _num(row.get("E")) == 1:
        return "E"
    if _num(row.get("M")) == 1 or _num(row.get("M1")) == 1:
        return "M"
    return None


def _build_session_index(entries):
    """Map (pattern, grade) -> set of ISO dates. Pattern matches as substring of Location."""
    idx = {}
    for e in entries:
        key = (e["pattern"], e["grade"])
        idx.setdefault(key, set()).add(e["date"])
    return idx


def _session_day_allowed(idx, loc, grade, date):
    """True/False if a grade-specific schedule applies; None if this class is unrestricted."""
    grade = (grade or "").strip()
    if not grade or not date:
        return None
    loc_l = (loc or "").lower()
    dates = None
    for (pattern, g), pattern_dates in idx.items():
        if g != grade or pattern.lower() not in loc_l:
            continue
        dates = pattern_dates if dates is None else (dates | pattern_dates)
    if dates is None:
        return None
    return date in dates


def _aggregate_student_attendance(rows):
    """Sum P/A/T/E/M marks per PersonID from student-level attendance rows."""
    best = {}
    for row in rows:
        pid = row["id"]
        if pid not in best:
            best[pid] = {
                "id": pid,
                "name": row.get("name") or "",
                "loc": row.get("loc") or "",
                "grade": row.get("grade") or "",
                "section": row.get("section") or "",
                "P": 0, "A": 0, "T": 0, "E": 0, "M": 0,
            }
        b = best[pid]
        if row.get("name"):
            b["name"] = row["name"]
        if row.get("loc"):
            b["loc"] = row["loc"]
        if row.get("grade"):
            b["grade"] = row["grade"]
        if row.get("section"):
            b["section"] = row["section"]
        mark = row.get("mark")
        if mark in ("P", "A", "T", "E", "M"):
            b[mark] += 1
    return list(best.values())


def _roster_duplicates(rows):
    """Build PersonID duplicate summary from contact roster rows."""
    by_id = {}
    for r in rows:
        pid = r["id"]
        by_id.setdefault(pid, []).append(r)
    details = []
    for pid, items in by_id.items():
        if len(items) < 2:
            continue
        details.append({
            "id": pid,
            "name": items[0].get("name") or pid,
            "count": len(items),
            "locs": sorted({x["loc"] for x in items if x.get("loc")}),
            "grades": sorted({x["grade"] for x in items if x.get("grade")}),
        })
    details.sort(key=lambda d: (-d["count"], d["name"]))
    extra = sum(d["count"] - 1 for d in details)
    return {
        "students": len(details),
        "extraEnrollments": extra,
        "uniqueStudents": len(by_id),
        "rows": len(rows),
        "details": details,
    }


def _region_year(path):
    """Derive (region, year) from a CSV path relative to data/.

    data/<region>/<year>/file.csv -> (region, year)
    data/<region>/file.csv        -> (region, "(unspecified)")
    data/file.csv                 -> ("(default)", "(unspecified)")   [legacy]
    """
    rel = os.path.relpath(path, DATA_DIR)
    parts = rel.split(os.sep)
    if len(parts) >= 3:
        return parts[0], parts[1]
    if len(parts) == 2:
        return parts[0], "(unspecified)"
    return "(default)", "(unspecified)"


def scan_catalog():
    """Walk data/ and group CSVs by (region, year), newest file per type.

    Returns { (region, year): { type: (path, mtime) } }.
    """
    groups = {}
    if os.path.isdir(DATA_DIR):
        for dirpath, _dirs, files in os.walk(DATA_DIR):
            for name in files:
                if not name.lower().endswith((".csv", ".tsv")):
                    continue
                path = os.path.join(dirpath, name)
                try:
                    headers, _ = _read_csv(path)
                except Exception:
                    continue
                kind = classify(headers)
                if not kind:
                    continue
                key = _region_year(path)
                mtime = os.path.getmtime(path)
                g = groups.setdefault(key, {})
                if kind not in g or mtime > g[kind][1]:
                    g[kind] = (path, mtime)
    return groups


def catalog_json(groups):
    """Shape the catalog for the client: regions, years-per-region, file detail."""
    regions = {}
    detail = {}
    for (region, year), types in groups.items():
        regions.setdefault(region, set()).add(year)
        files = {}
        for kind, (path, _m) in types.items():
            files[kind] = {
                "name": os.path.basename(path),
                "modified": datetime.datetime.fromtimestamp(
                    os.path.getmtime(path)
                ).strftime("%Y-%m-%d %H:%M"),
            }
        detail.setdefault(region, {})[year] = files
    return {
        "regions": sorted(regions.keys()),
        # years newest-first (academic-year strings sort correctly)
        "years": {r: sorted(ys, reverse=True) for r, ys in regions.items()},
        "files": detail,
    }


def pick_default(groups):
    cat = catalog_json(groups)
    if not cat["regions"]:
        return None, None
    region = cat["regions"][0]
    year = cat["years"][region][0]
    return region, year


# --------------------------- aggregation ---------------------------
def build_payload(region=None, year=None):
    groups = scan_catalog()
    if region is None or year is None or (region, year) not in groups:
        region, year = pick_default(groups)
    found = groups.get((region, year), {}) if region is not None else {}

    meta = {
        "files": {},
        "region": region,
        "year": year,
        "catalog": catalog_json(groups),
        "generated": datetime.datetime.now().isoformat(timespec="seconds"),
    }
    data = {
        "access": [],
        "registration": [],
        "attendance": [],
        "holidays": [],
        "students": [],
        "studentAttendance": [],
        "studentAttendanceRecords": [],
        "sessionSchedule": {"entries": []},
        "duplicates": {
            "students": 0,
            "extraEnrollments": 0,
            "uniqueStudents": 0,
            "rows": 0,
            "details": [],
            "available": False,
        },
    }

    def note(kind, path, count):
        meta["files"][kind] = {
            "name": os.path.basename(path),
            "rows": count,
            "modified": datetime.datetime.fromtimestamp(
                os.path.getmtime(path)
            ).strftime("%Y-%m-%d %H:%M"),
        }

    # ACCESS
    if "access" in found:
        path = found["access"][0]
        _, rows = _read_csv(path)
        out = []
        for x in rows:
            if x.get("LocationType") != "REC":
                continue
            if _excluded_loc(x.get("Location")):
                continue
            q = x.get("AccessQ")
            q = q if q in QLEVELS else "None"
            out.append({
                "loc": x.get("Location", ""),
                "grade": x.get("Grade", ""),
                "person": x.get("Person", ""),
                "hours": round(_fnum(x.get("TotalAccessHours")), 1),
                "q": q,
            })
        raw_n = len(out)
        out, access_dups = _dedupe_access(out)
        data["access"] = out
        meta["access_raw_rows"] = raw_n
        meta["access_duplicate_people"] = access_dups
        note("access", path, len(out))

    # REGISTRATION (student count by class)
    if "registration" in found:
        path = found["registration"][0]
        _, rows = _read_csv(path)
        out = [{
            "loc": x.get("Location", ""),
            "cat": x.get("GradeCategory", ""),
            "subcat": x.get("GradeSubCategory1", ""),
            "grade": x.get("Grade", ""),
            "section": x.get("Section", ""),
            "active": _num(x.get("StudentActive")),
            "inactive": _num(x.get("StudentInActive")),
        } for x in rows if not _excluded_loc(x.get("Location"))]
        data["registration"] = out
        note("registration", path, len(out))

    session_entries = []
    session_idx = {}

    # SESSION DATES (optional — grade-specific REC days; substring match on REC column)
    if "session_dates" in found:
        path = found["session_dates"][0]
        _, rows = _read_csv(path)
        for x in rows:
            pattern = (x.get("REC") or x.get("Center") or "").strip()
            grade = (x.get("Grade") or "").strip()
            if not pattern or not grade:
                continue
            raw = x.get("Date") or x.get("Week ending") or x.get("Session date")
            dt = _parse_attendance_date(raw) or _parse_short_date(raw)
            if not dt:
                continue
            session_entries.append({"pattern": pattern, "grade": grade, "date": dt})
        session_idx = _build_session_index(session_entries)
        data["sessionSchedule"] = {"entries": session_entries}
        note("session_dates", path, len(session_entries))

    # ATTENDANCE (daily audit)
    if "attendance" in found:
        path = found["attendance"][0]
        _, rows = _read_csv(path)
        out = []
        for x in rows:
            if _excluded_loc(x.get("Location1")):
                continue
            loc = x.get("Location1", "")
            grade = x.get("Grade1", "")
            dt = _parse_attendance_date(x.get("DateofClass1"))
            allowed = _session_day_allowed(session_idx, loc, grade, dt)
            if allowed is False:
                continue
            out.append({
                "loc": loc,
                "cat": x.get("GradeCategory1", ""),
                "grade": grade,
                "section": x.get("Section1", ""),
                "date": dt,
                "P": _num(x.get("P")), "A": _num(x.get("A")),
                "T": _num(x.get("T")), "E": _num(x.get("E")),
                "M": _num(x.get("M1")), "total": _num(x.get("TotalPosition")),
            })
        data["attendance"] = out
        note("attendance", path, len(out))

    # STUDENT ATTENDANCE (optional — one row per student per date with a mark)
    if "attendance_student" in found:
        path = found["attendance_student"][0]
        _, rows = _read_csv(path)
        parsed = []
        for x in rows:
            loc = (x.get("Location") or x.get("Location1") or "").strip()
            if _excluded_loc(loc):
                continue
            pid = (x.get("PersonID") or "").strip()
            if not pid:
                continue
            mark = _student_mark(x)
            if not mark:
                continue
            dt = _parse_attendance_date(
                x.get("DateofClass1") or x.get("DateofClass") or x.get("Date")
            )
            grade = (x.get("Grade") or x.get("Grade1") or "").strip()
            allowed = _session_day_allowed(session_idx, loc, grade, dt)
            if allowed is False:
                continue
            parsed.append({
                "id": pid,
                "name": _person_name(x),
                "loc": loc,
                "grade": grade,
                "section": (x.get("Section") or x.get("Section1") or "").strip(),
                "date": dt,
                "mark": mark,
            })
        data["studentAttendanceRecords"] = parsed
        data["studentAttendance"] = _aggregate_student_attendance(parsed)
        note("attendance_student", path, len(data["studentAttendance"]))

    # HOLIDAYS (loc|date pairs excluded from missing-attendance)
    if "holidays" in found:
        path = found["holidays"][0]
        _, rows = _read_csv(path)
        keys = set()
        for x in rows:
            loc = (x.get("REC") or "").strip()
            if _excluded_loc(loc):
                continue
            dt = _parse_short_date(x.get("Week ending"))
            if loc and dt:
                keys.add(loc + "|" + dt)
        data["holidays"] = sorted(keys)
        note("holidays", path, len(keys))

    if "contact" in found:
        path = found["contact"][0]
        _, rows = _read_csv(path)
        roster = []
        students = []
        for x in rows:
            if _excluded_loc(x.get("Location")):
                continue
            pid = (x.get("PersonID") or "").strip()
            if not pid:
                continue
            pos = (x.get("Position") or "").strip().lower()
            entry = {
                "id": pid,
                "name": _person_name(x),
                "loc": x.get("Location", ""),
                "grade": x.get("Grade", ""),
                "section": x.get("Section", ""),
            }
            roster.append(entry)
            if pos == "student":
                students.append(entry)
        data["students"] = students
        data["duplicates"] = _roster_duplicates(roster)
        data["duplicates"]["available"] = True
        note("contact", path, len(students))

    data["meta"] = meta
    # note which expected types are missing
    meta["missing_types"] = [
        t for t in ("access", "registration", "attendance")
        if t not in found
    ]
    return data


# ------------------------------ server -----------------------------
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype, extra_headers=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _unauthorized(self):
        self._send(
            401,
            "Authentication required",
            "text/plain; charset=utf-8",
            {"WWW-Authenticate": 'Basic realm="REC Dashboard", charset="UTF-8"'},
        )

    def _authorized(self):
        """True when auth is disabled or credentials match."""
        if not AUTH_PASSWORD:
            return True
        header = self.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            return False
        try:
            raw = base64.b64decode(header[6:].strip()).decode("utf-8")
            user, _, password = raw.partition(":")
        except Exception:
            return False
        ok_user = secrets.compare_digest(user, AUTH_USER)
        ok_pass = secrets.compare_digest(password, AUTH_PASSWORD)
        return ok_user and ok_pass

    def do_GET(self):
        if not self._authorized():
            self._unauthorized()
            return
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/catalog":
            try:
                self._send(200, json.dumps(catalog_json(scan_catalog())),
                           CONTENT_TYPES[".json"])
            except Exception as e:
                self._send(500, json.dumps({"error": str(e)}), CONTENT_TYPES[".json"])
            return
        if path == "/api/data":
            try:
                q = parse_qs(parsed.query)
                region = q.get("region", [None])[0]
                year = q.get("year", [None])[0]
                payload = build_payload(region, year)
                self._send(200, json.dumps(payload), CONTENT_TYPES[".json"])
            except Exception as e:
                self._send(500, json.dumps({"error": str(e)}), CONTENT_TYPES[".json"])
            return
        # static files from web/
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        fpath = os.path.normpath(os.path.join(WEB_DIR, rel))
        if not fpath.startswith(WEB_DIR) or not os.path.isfile(fpath):
            self._send(404, "Not found", "text/plain; charset=utf-8")
            return
        ext = os.path.splitext(fpath)[1].lower()
        with open(fpath, "rb") as fh:
            self._send(200, fh.read(), CONTENT_TYPES.get(ext, "application/octet-stream"))

    do_HEAD = do_GET

    def log_message(self, *args):  # keep console quiet
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    httpd = None
    for p in range(port, port + 20):
        try:
            httpd = ThreadingHTTPServer((BIND_HOST, p), Handler)
            port = p
            break
        except OSError:
            continue
    if httpd is None:
        print("Could not bind to a port. Try: python3 serve.py <port>")
        sys.exit(1)

    display_host = "localhost" if BIND_HOST in ("127.0.0.1", "::1") else BIND_HOST
    url = f"http://{display_host}:{port}/"
    cat = catalog_json(scan_catalog())
    print("REC Reporting Dashboard")
    print("=" * 44)
    if cat["regions"]:
        print("Detected datasets (region / years):")
        for region in cat["regions"]:
            years = ", ".join(cat["years"][region])
            print(f"  - {region:<14} {years}")
    else:
        print("No datasets found yet. Organise exports as:")
        print(f"  {os.path.join(DATA_DIR, '<region>', '<year>')}/*.csv")
        print(f"  e.g. {os.path.join(DATA_DIR, 'central', '2025-2026')}/")
    print(f"\nServing at {url} (bind {BIND_HOST}:{port})")
    if AUTH_PASSWORD:
        print(f"HTTP Basic Auth enabled (user: {AUTH_USER})")
    else:
        print("HTTP Basic Auth OFF — set DASHBOARD_PASSWORD to require a password.")
    print("Add/replace CSVs under data/<region>/<year>/ and refresh to update. Ctrl+C to stop.")
    if BIND_HOST in ("127.0.0.1", "localhost", "::1") and not os.environ.get("DASHBOARD_NO_BROWSER"):
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
