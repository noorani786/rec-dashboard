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

Requires only the Python 3 standard library.
"""
import csv, datetime, io, json, os, sys, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
WEB_DIR = os.path.join(ROOT, "web")

QLEVELS = {"Adequate", "Moderate", "Low", "None"}


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
    if "DateofClass1" in h and "M1" in h:
        return "attendance"
    if {"StudentActive", "StudentInActive"} <= h:
        return "registration"
    if "Week ending" in h and "REC" in h:
        return "holidays"
    if {"PersonID", "JamatiTitle"} <= h:
        return "contact"  # detected but not used by the reports
    return None


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
    data = {"access": [], "registration": [], "attendance": [], "holidays": []}

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
            q = x.get("AccessQ")
            q = q if q in QLEVELS else "None"
            out.append({
                "loc": x.get("Location", ""),
                "grade": x.get("Grade", ""),
                "person": x.get("Person", ""),
                "hours": round(_fnum(x.get("TotalAccessHours")), 1),
                "q": q,
            })
        data["access"] = out
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
        } for x in rows]
        data["registration"] = out
        note("registration", path, len(out))

    # ATTENDANCE (daily audit)
    if "attendance" in found:
        path = found["attendance"][0]
        _, rows = _read_csv(path)
        out = [{
            "loc": x.get("Location1", ""),
            "cat": x.get("GradeCategory1", ""),
            "grade": x.get("Grade1", ""),
            "section": x.get("Section1", ""),
            "date": _parse_attendance_date(x.get("DateofClass1")),
            "P": _num(x.get("P")), "A": _num(x.get("A")),
            "T": _num(x.get("T")), "E": _num(x.get("E")),
            "M": _num(x.get("M1")), "total": _num(x.get("TotalPosition")),
        } for x in rows]
        data["attendance"] = out
        note("attendance", path, len(out))

    # HOLIDAYS (loc|date pairs excluded from missing-attendance)
    if "holidays" in found:
        path = found["holidays"][0]
        _, rows = _read_csv(path)
        keys = set()
        for x in rows:
            loc = (x.get("REC") or "").strip()
            dt = _parse_short_date(x.get("Week ending"))
            if loc and dt:
                keys.add(loc + "|" + dt)
        data["holidays"] = sorted(keys)
        note("holidays", path, len(keys))

    if "contact" in found:
        note("contact", found["contact"][0], -1)  # detected, unused

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
}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_GET(self):
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
            httpd = ThreadingHTTPServer(("127.0.0.1", p), Handler)
            port = p
            break
        except OSError:
            continue
    if httpd is None:
        print("Could not bind to a port. Try: python3 serve.py <port>")
        sys.exit(1)

    url = f"http://localhost:{port}/"
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
    print(f"\nServing at {url}")
    print("Add/replace CSVs under data/<region>/<year>/ and refresh to update. Ctrl+C to stop.")
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
