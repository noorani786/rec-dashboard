# REC Reporting Dashboard

An interactive dashboard for Religious Education Centre reporting — **Access**,
**Registration**, **Attendance**, and **Attendance Entry / Missing-Attendance** —
across **multiple regions** and **academic years**.

Organise your CSV exports by region and year, then refresh the page. The reports
rebuild automatically — no build step, no renaming files.

## Quick start

1. Make sure you have Python 3 (macOS and most systems already do — check with
   `python3 --version`).
2. Put your CSV exports into `data/<region>/<year>/` (see below).
3. From this folder, run:

   ```bash
   python3 serve.py
   ```

4. Your browser opens `http://localhost:8000`. Use the **Region** and **Year**
   pickers at the top right to switch datasets.

To update later, add or replace exports under `data/<region>/<year>/` and click
**↻ Refresh** (or reload the page). The server re-reads the whole `data/` tree on
every request.

## Where to put your files — regions & years

Each dataset lives in its own **region / year** folder:

```
data/
├── central/
│   ├── 2025-2026/     ← current year's CSVs for the Central region
│   └── 2024-2025/     ← last year's CSVs (historical)
├── western/
│   └── 2025-2026/
└── southeast/
    └── 2025-2026/
```

- **Region** = the first-level folder name (e.g. `central`, `western`). It shows
  up verbatim in the Region picker, so name it however you like.
- **Year** = the second-level folder name (e.g. `2025-2026`). Use a consistent
  format; years are listed newest-first, and the newest is selected by default.
- Drop the four exports (plus optional `holidays.csv`) into each year folder.

Filenames don't matter — files are identified by their column headers, so exports
like `Access Data Dump (17).csv` work as-is. If two files of the same type land
in the same year folder, the most recently modified one wins.

To add a new region or year, just create the folder and drop the CSVs in — no
code changes needed. Each region/year keeps its own `holidays.csv`.

| Report            | Which export to drop in                              | Identified by columns            |
|-------------------|------------------------------------------------------|----------------------------------|
| Access Summary    | Access Data Dump                                     | `TotalAccessHours`, `AccessQ`    |
| Registration      | General Count of Students By Location and Class       | `StudentActive`, `StudentInActive` |
| Attendance        | Attendance Audit – Daily Attendance                  | `DateofClass1`, `M1`             |
| Holidays (opt.)   | `holidays.csv` (`REC`, `Week ending`)                | `Week ending`, `REC`             |

The contact-information export is detected but not currently used by any report.

### holidays.csv

Excludes scheduled breaks from the missing-attendance count. Two columns:

```csv
REC,Week ending
Mid-Cities Primary REC,11/29/2025
Plano Secondary REC,12/27/2025
```

Each row is one location + one Saturday (M/D/YY or M/D/YYYY). Those dates are
never flagged as missing for that location.

## What the reports show

- **Overview** — headline KPIs and a per-location scorecard.
- **Access Summary** — access-hour quality mix and per-person detail.
- **Registration Summary** — active vs inactive students by location, grade, section.
- **Attendance Summary** — present-% trend, by-grade and by-location breakdowns.
- **Attendance Entry & Missing** — an entry matrix (classes × dates) plus a list
  of every date/class combination where no attendance was entered.

### How "missing attendance" is defined

A class is flagged as missing a date only when **all** of these hold:

1. the date is within the class's own active window (first-to-last recorded date),
2. it lands on the class's weekly cadence,
3. the location was in session that day (another class recorded attendance), and
4. it is not a scheduled holiday (from `holidays.csv`).

Partial sessions — where some students were left unmarked but the session was
entered — are **not** counted here; those show as "Unmarked" on the Attendance tab.

## Project layout

```
rec-dashboard/
├── serve.py          # local server: scans data/, aggregates, serves the app
├── data/
│   └── <region>/<year>/*.csv   # ← your CSV exports, one folder per region/year
├── web/
│   ├── index.html    # dashboard markup
│   ├── styles.css    # styling
│   └── app.js        # reports + charts (fetches /api/data)
└── README.md
```

### Endpoints (for reference)

- `GET /api/catalog` — available regions and years.
- `GET /api/data?region=<r>&year=<y>` — aggregated reports for one dataset
  (defaults to the first region and its newest year if omitted).

## Notes

- Requires only the Python standard library — nothing to `pip install`.
- Charts load Chart.js from a CDN, so the page needs internet access the first
  time (or cache it if you need fully offline use).
- Run on a different port with `python3 serve.py 9000`.
- **Privacy:** the exports contain student personal information. `data/*.csv` is
  git-ignored so real data is never committed. Keep the folder local.
