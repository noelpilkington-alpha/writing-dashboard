# Writing Dashboard

Internal dashboard for tracking AlphaWrite student progress across all campuses.

**Live site:** https://noelpilkington-alpha.github.io/writing-dashboard/

## Pages

- **Students** -- Per-student cards showing current level, XP, test scores, daily minutes, and flagged issues (stalled, rushing, failing tests)
- **Metrics** -- Aggregate stats: students per level, pass/fail rates, average XP and minutes by campus
- **EG Analysis** -- Expected Grade comparison between Session 1 and current session
- **Test Results** -- Searchable table of all writing test attempts with scores, dates, and test types
- **Test Analysis** -- Cohort breakdowns: by grade level, by session, before/after curriculum updates, cohort x session matrix, attempts distribution
- **Testing Loops** -- Students stuck retaking the same test, with Claude-generated analysis of their test responses. Filter by name, loop grade, flag, and campus (multi-select); summary stats and grade tiles follow the selection

## Student Issue Flags

The Students page flags issues based on these criteria:

| Flag | Trigger |
|---|---|
| **Deep Dive** | 3+ failed tests at the same grade level (with rushed count if applicable) |
| **Low Accuracy** | AlphaWrite activities completed below 80% accuracy |
| **Repeating Activity** | Same activity attempted 3+ times in a course |
| **XP Behind Target** | Below 12.5 XP/school day pace for the session |
| **Enrollment Mismatch** | Student enrolled in a course whose content grade differs from HMG+1. Only titles that carry a content grade count (hole-filling `G#`, Roman-tier Sentences/Paragraphs, `... G# 2025-26`); SY26-27 `<Track> G# Class` titles use the student's age grade and are ignored |
| **Stale Enrollment** | Still actively enrolled in a class titled `... 2025-26` during SY26-27 |

Tests are marked **RUSHED** if completed in under 25 minutes (G3-G5) or under 60 minutes (G6-G8). The pass threshold for all tests is 90%.

### Testing Loop Flags

The Testing Loops page adds additional flags:

- **Rushing** -- Student has rushed one or more tests in the loop
- **Depreciating** -- Skills that were previously passing but are now failing
- **AW/Test Gap** -- Skills mastered in AlphaWrite activities but still failing on tests

## Data

The dashboard is a static site. `years.json` lists the available school years (the header toggle reads it; the default year is shown first); each year has its own folder:

- `data/2026-27/data.json` -- live SY26-27 student data (`collect_data.py`)
- `data/2026-27/loop_data.json` -- testing-loop analysis (`collect_loop_data.py`)
- `data/2025-26/` -- SY25-26 archive (year-end snapshot as of 2026-06-05; loop and remediation data frozen)
- `identity_links.json` -- old -> new Timeback account links for students whose email changed (`build_identity_links.py`); the collector merges their test and activity history

Sessions, holidays and calendars live in `writing_automation/config.py` (`SCHOOL_YEARS`). SY26-27 has two campus calendars (A: Aug 12 start, B: Sep 8 start); `writing_automation/calendars.py` maps each roster campus to a calendar and counts school days (weekdays inside sessions, minus holidays). Virtual programs and campuses without a published calendar default to A with a logged warning.

Writing XP rule: a result counts as Writing when its `metadata.subject` is Writing, its line item is an AlphaWrite item, or its course (`metadata.courseSourcedId`) is a Writing course. Lesson type alone is not evidence, because PowerPath quizzes and reading articles are shared with Math, Science and Reading hole-filling. Lesson names for rows without a title come from the component resource or line-item title; both lookups are cached in `_course_cache.json` and `_lesson_name_cache.json` (gitignored, safe to delete).

Population = students with an active Writing enrollment in the API whose email appears in the A&D Master Roster as Enrolled with the `school_year_2026_2027` group tag (shadow, test, mock, guide and test-record rows are excluded). Former Legacy Dash campuses are included.

### Updating data

Both scripts pull from the Timeback OneRoster API and require the `writing_automation` package in the parent directory.

```bash
# From the dashboard/ directory:
PYTHONIOENCODING=utf-8 python collect_data.py "../Daily workflow/writing-results-<date>.csv"   # data/2026-27/data.json
PYTHONIOENCODING=utf-8 python collect_loop_data.py                                          # data/2026-27/loop_data.json
python inactive_students.py                                                                 # 5+ weekday inactivity report
python build_identity_links.py                                                              # refresh identity_links.json after a roster change
```

Useful flags: `--year 2025-26 --as-of 2026-06-05` regenerates the archive; `--limit 5` runs a quick smoke test; `--output` overrides the destination.

After running, commit and push to update the GitHub Pages site.

### Prerequisites

- Python 3.12+
- The `writing_automation` package (in the parent directory -- not published to PyPI)
- A `.env` file in the parent directory with Timeback API credentials:
  - `TIMEBACK_CLIENT_ID`
  - `TIMEBACK_CLIENT_SECRET`
  - `TIMEBACK_IDP_URL`
  - `ONEROSTER_BASE_URL`
- `ANTHROPIC_API_KEY` environment variable (only needed for `collect_loop_data.py`)
- `ALPHA_SESSION_COOKIE` in `.env` (only needed for `collect_loop_data.py` -- fetches test page content from timebackanalytics.com)

## REST API

A FastAPI wrapper (`api/`) serves `data.json` over HTTP for external integrations. Deployed on Render (see `render.yaml`). Requires an `API_KEYS` environment variable for authentication.

## Tech stack

- Frontend: vanilla HTML/CSS/JS (no build step)
- Data collection: Python + Timeback OneRoster API
- Testing loop analysis: Claude API (Anthropic)
- Hosting: GitHub Pages (frontend), Render (API)

## Data sources

All student data comes from the **Timeback OneRoster API** (`api.alpha-1edtech.ai`):

- **Enrollments**: `/ims/oneroster/rostering/v1p2/enrollments/` -- active Writing course enrollments
- **Students**: `/ims/oneroster/rostering/v1p2/students/` -- student profiles and campus info
- **Assessment results**: `/ims/oneroster/gradebook/v1p2/assessmentResults` -- test scores and activity completions
- **Test page content**: `timebackanalytics.com/test/{assignmentId}` -- actual test questions and student responses (used for testing loop analysis)
