# Writing Dashboard SY26-27 Rollover — Design

Date: 2026-09-14
Status: approved by Noel (design presented in chat; approved "yes, follow your recommendations")

## Goal

Bring the Writing Dashboard from its frozen 2026-05-25 snapshot to a live SY26-27 view, while preserving the SY25-26 year as a browsable archive behind a header toggle (SY26-27 default). The SY26-27 population includes the former Legacy Dash campuses.

## Decisions already made

- **Year view, not cumulative.** `starting_hmg` = HMG at the start of SY26-27; `grades_advanced` measures this year only. Test history (`all_tests`, `hmg`) stays lifetime.
- **Keep EG Analysis, Remediation, Testing Loops**, refreshed where inputs allow.
- **Toggle 25-26 / 26-27**, 26-27 default.
- **Legacy Dash campuses are in scope** (Alpha Anywhere (homeschool), Novatio, Unbound Academy, Kairos Learning Solutions, Lipscomb Academy Accelerate).
- **No SY26-27 Session 1 snapshot exists**; EG Analysis for 26-27 uses data we already have plus the API.
- **Calendar defaults:** virtual programs (TSA Online, GT Anywhere, Alpha Anywhere (homeschool), Unbound, Novatio, TSA sub-campuses) and Nashville use Calendar A.

## Architecture: two static snapshots, one frontend

```
dashboard/
  years.json                          # {"default": "2026-27", "years": {"2025-26": {...}, "2026-27": {...}}}
  data/2025-26/data.json              # regenerated once, as-of 2026-06-05 (year-end)
  data/2025-26/loop_data.json         # frozen copy of today's loop_data.json (2026-05-11)
  data/2025-26/remediation_data.json  # frozen copy (2026-04-29)
  data/2026-27/data.json              # live, regenerated daily
  data/2026-27/loop_data.json         # regenerated with the renewed cookie
  identity_links.json                 # old sourcedId -> new sourcedId (email-changed students)
  index.html / app.js / style.css     # one frontend, year toggle in header
  collect_data.py --year ...          # reads SCHOOL_YEARS from writing_automation.config
  collect_loop_data.py --year ...
  build_identity_links.py             # produces identity_links.json
  inactive_students.py                # reads data/<default year>/data.json
  api/data_loader.py                  # reads years.json, loads default year
  tests/                              # pytest
```

Root-level `data.json`, `loop_data.json`, `remediation_data.json` are moved (git mv) into `data/2025-26/` and are no longer written at the root.

## Components

### 1. Year and calendar configuration (`writing_automation/config.py`, new `writing_automation/calendars.py`)

`SCHOOL_YEARS` replaces `SESSIONS` / `CURRENT_SESSION` and the duplicated tables in `collect_data.py`, `collect_loop_data.py`, `student_progress.py`:

```python
SCHOOL_YEARS = {
  "2025-26": {
    "year_start": "2025-08-01",          # boundary for "before this year" (starting HMG)
    "activity_start": "2025-08-11",      # lower bound for activity/XP fetch (old YEAR_START)
    "year_end": "2026-06-05",
    "roster": "A&D Master Roster 25-26 - Master.csv",   # Timeback root (May 11 export)
    "calendars": {"default": {
      "sessions": {
        "S1": {"start": "2025-08-11", "end": "2025-10-17"},
        "S2": {"start": "2025-10-20", "end": "2026-01-02"},
        "S3": {"start": "2026-01-05", "end": "2026-02-20"},
        "S4": {"start": "2026-02-21", "end": "2026-04-17", "school_start": "2026-03-02"},
        "S5": {"start": "2026-04-27", "end": "2026-06-05"},
      },
      "holidays": [],                    # 25-26 keeps weekday counting as today
    }},
    # existing gap-date rules, kept verbatim: dates before 2025-10-18 -> S1,
    # 2025-10-18..2025-10-19 -> S2, 2026-04-18..2026-04-26 -> S5
    "session_gap_rules": [("<", "2025-10-18", "S1"), ("between", "2025-10-18", "2025-10-19", "S2"),
                          ("between", "2026-04-18", "2026-04-26", "S5")],
  },
  "2026-27": {
    "year_start": "2026-08-01",
    "activity_start": "2026-08-01",
    "year_end": "2027-06-18",
    "roster": "Daily workflow/A&D Master Roster 25-26 - Master.csv",   # Sep 14 export (source keeps the old file name)
    "calendars": {
      "A": {"first_day": "2026-08-12", "sessions": {
        "S1": {"start": "2026-08-12", "end": "2026-10-09"},
        "S2": {"start": "2026-10-19", "end": "2026-12-18"},
        "S3": {"start": "2027-01-04", "end": "2027-02-19"},
        "S4": {"start": "2027-03-01", "end": "2027-04-16"},
        "S5": {"start": "2027-04-26", "end": "2027-06-04"}},
        "holidays": ["2026-09-07", "2026-11-23..2026-11-27", "2027-01-18", "2027-05-31"]},
      "B": {"first_day": "2026-09-08", "sessions": {
        "S1": {"start": "2026-09-08", "end": "2026-10-16"},
        "S2": {"start": "2026-10-19", "end": "2026-12-18"},
        "S3": {"start": "2027-01-04", "end": "2027-02-19"},
        "S4": {"start": "2027-02-24", "end": "2027-04-16"},
        "S5": {"start": "2027-04-26", "end": "2027-06-18"}},
        "holidays": ["2026-11-23..2026-11-27", "2027-01-18", "2027-05-31"]},
    },
  },
}
CURRENT_YEAR = "2026-27"
```

`calendars.py` provides:

- `CAMPUS_CALENDAR: dict[str, str]` — normalised campus name -> "A"/"B". Sources, in precedence order: PDF folder (Calendar A / Calendar B / Specialty = A), API term start (2026-08-12 -> A, 2026-09-08 -> B), explicit defaults (virtual programs, Nashville -> A). Unknown campuses -> "A" with one `logger.warning` per campus.
- `normalise_campus(name)` — lowercases, drops "school", "the", parentheticals and punctuation; handles roster aliases ("Alpha Austin" == "Alpha School Austin", "Alpha Austin High School" == "Alpha High School"); "Alpha Miami Beach" resolves to B, not to Miami's A.
- `resolve_calendar(year, campus) -> calendar_key`.
- `session_for_date(year, calendar_key, date) -> session name or None` (applies the 25-26 gap rules only for that year).
- `current_session(year, calendar_key, as_of)`.
- `school_days(year, calendar_key, start, end)` — weekdays inside session windows, minus holidays. For 25-26 this equals today's `_count_weekdays` behaviour.
- `expand_holidays()` handles the `a..b` range notation.

The compatibility names `SESSIONS` and `CURRENT_SESSION` remain in `config.py` as views onto the current year's Calendar A so the daily CLI (`writing_automation/cli.py`) keeps working unchanged; CLI updates are out of scope.

### 2. Population and roster (`collect_data.py`)

- Roster path from `SCHOOL_YEARS[year]["roster"]`.
- `Student Group` parsed as a comma-separated token list. Exclude if any token is in {shadow, test, mock, mock student, guide, test-record} or `is_test == TRUE`.
- For 26-27, require the `school_year_2026_2027` token in addition to `Admission Status == Enrolled` (plus the existing `_STATUS_OVERRIDES`).
- Remove `_LEGACY_CAMPUSES` from the exclusion path: `_classify_dashboard` returns "timeback" for them. `_TIMEBACK_EXCLUDED_CAMPUSES` and `_EXCLUDED_EMAILS` remain.
- Campus matching uses `normalise_campus`; the roster campus string is what is stored and displayed.
- Population = students with active Writing enrollments in the API (existing `fetch_writing_enrollments`), whose profile email is in the roster whitelist, with at least one core (non-excluded) enrollment or test history (existing rule). Expected ~1,510 for 26-27.

### 3. Identity merge (`build_identity_links.py`, `identity_links.json`)

- Inputs: old roster (May 11), new roster (Sep 14), API users (`/students/`: sourcedId, email, givenName, familyName, metadata.dob).
- A link is created when the same (first name, last name, DOB) appears in both rosters with different emails AND both emails resolve to distinct API sourcedIds. Output: `{"generated_at", "links": [{"old_sourced_id", "new_sourced_id", "old_email", "new_email", "name"}]}`.
- `collect_data.py` loads the file; for each student in the population, test results and activity results are fetched for the primary id and every linked old id, concatenated, de-duplicated on (test name, date) for tests and on result sourcedId for activities, then processed as today. `data.json` records `linked_ids` per merged student. The run log reports the number of merged students.

### 4. Per-student metrics (`collect_data.py`)

- `calendar = resolve_calendar(year, roster_campus)`; sessions, current session, school days, XP goal-to-date and `session_tests` all resolve through it.
- `school_days_elapsed` = `school_days(calendar, school_start_of_current_session, as_of - 1 day)`; holidays excluded.
- `starting_hmg` (26-27) = max(HMG over tests dated before `year_start`, HMG from passed placement tests at any date); default 2 if neither. `grades_advanced = hmg - starting_hmg`. `starting_hmg_basis` records which rule applied.
- For 25-26 the existing placement-only rule is preserved so the archive matches historical reporting.
- Enrollment content grade derived per enrollment, in order: `[AlphaWrite] Writing G# hole-filling` title -> G#; Roman tier (`Sentences I/II/III` = G3/4/5, `Paragraphs I/II/III` = G4/5/6); `Sentences G# 2025-26`-style titles -> G#; new `<Track> G# Class` titles -> no content grade (age-grade semantics). `enrollment_mismatch` fires only when at least one enrollment yields a content grade and none equals `hmg + 1`.
- New `stale_enrollment` insight (severity medium) when any active enrollment title contains "2025-26" during the 26-27 year.
- `start_session` uses `session_for_date` for the student's calendar; the 25-26 gap rules apply only to the 25-26 year.
- `--as-of YYYY-MM-DD` (default today) bounds activity fetch, inactivity, school-day counting and current-session detection; stored as `as_of` in the output alongside `generated_at`.
- `--limit N` processes only the first N students (smoke tests). `--year` selects the school year; `--session` is removed (derived from as-of and calendar).

### 5. Output schema additions (`data.json`)

Top level: `year`, `as_of`, `calendars` (the year's calendar table: sessions and holidays), `campus_calendar` (campus -> key, for the campuses present), and `all_sessions` retained for backward compatibility as the "A"/default calendar's sessions with labels. Per student: `calendar`, `starting_hmg_basis` ("prior_year_tests" | "placement" | "default"), `linked_ids`, `stale_enrollments`. `session` (header) keeps `name`, `start`, `end`, `school_start`, `school_days_elapsed` for calendar A and adds `by_calendar: {"A": {...}, "B": {...}}`.

### 6. SY25-26 archive

One-off run with the May 11 roster and the original 25-26 session table:

```
python collect_data.py --year 2025-26 --as-of 2026-06-05 \
  --output data/2025-26/data.json \
  --effective-grades ../Student_Progress_Tra_1773079782808.csv \
  --s1-snapshot "../SY25-26 Session 1 Snapshot (Academics).xlsx" \
  "../Daily workflow/writing-results-2026-09-14.csv"
```

Today's `loop_data.json` and `remediation_data.json` are moved unchanged into `data/2025-26/`. The May 25 `data.json` remains in git history only.

### 7. Frontend (`index.html`, `app.js`, `style.css`)

- Boot reads `years.json`, picks the `?year=` query parameter or the default, fetches `data/<year>/data.json`, and stores `YEAR`. The header gains a two-button toggle ("2025-26" / "2026-27"); switching updates the query parameter, refetches, clears cached loop and remediation data, and re-renders the current page.
- `sessionsFor(student)` returns `DATA.calendars[student.calendar].sessions` (falls back to `DATA.all_sessions`). The three global consumers (Metrics per-session breakdown, Test Results current-session filter, Test Analysis `getSession`) and `computeSessionWeeks` use it.
- Header meta shows the session name plus school-day counts per calendar when more than one calendar is present.
- EG Analysis: when `YEAR` is 2026-27, the S1 cohort is students whose first SY26-27 XP date falls within their calendar's S1 (the collector emits `s1_cohort` accordingly), and EG values shown are carried forward from the 25-26 snapshot by email with a visible "Effective Grade as of Mar 2026" label. The collector implements the carry-forward by reading `data/2025-26/data.json` when building 26-27.
- Test Analysis "Before/After Updates" cohorts and the MAP date constant render only for 2025-26.
- The Remediation nav link is hidden when the year has no remediation file (per `years.json`).
- Testing Loops loads `data/<year>/loop_data.json`.

### 8. Ancillary scripts

- `collect_loop_data.py`: `--year`; reads `data/<year>/data.json`, writes `data/<year>/loop_data.json`; scoreDate window from `SCHOOL_YEARS`.
- `inactive_students.py`: `--year` (default `CURRENT_YEAR`); reads from `data/<year>/`; roster path from config.
- `api/data_loader.py`: loads the default year from `years.json`.
- `legacy_dash_completions.py` is untouched.

## Error handling

- Unknown campus -> Calendar A plus a warning, never a crash.
- Roster missing -> hard error (the whitelist is required).
- Linked old id whose API fetch fails -> log and continue with the primary id.
- Frontend: missing `years.json` falls back to `data/2026-27/data.json`; missing per-year loop or remediation files show the existing "no data" placeholders.

## Testing

`dashboard/tests/` (pytest, no network):

- `test_calendars.py`: `session_for_date` across A/B boundaries and 25-26 gap rules; `school_days` excludes weekends, breaks and holidays; `resolve_calendar` for PDF campuses, API-fallback campuses, aliases and the unknown default.
- `test_roster.py`: token parsing, exclusion tokens, school-year requirement, is_test, status overrides.
- `test_identity.py`: link building from synthetic rosters and users; merge de-duplication.
- `test_metrics.py`: starting_hmg rule (prior-year vs placement vs default), enrollment content-grade derivation, mismatch and stale flags.
- Smoke: `collect_data.py --year 2026-27 --limit 5` completes and the output validates against the schema.

Manual verification after the full run: five students spot-checked against the API (HMG, last test, XP totals); population and campus counts against the 2026-09-14 probe (~1,510); `inactive_students.py` runs; both years render in the browser.

## Out of scope

- Changes to the daily `python -m writing_automation` CLI beyond keeping it importable.
- A regenerated remediation dataset (no generator exists).
- Deriving a true SY26-27 Effective Grade (needs a new Progress Tracker export).
- MAP RIT integration into EG Analysis.
