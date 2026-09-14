import year_metrics as ym


def t(name, ttype, score, date):
    return {"name": f"Alpha Standardized Writing {name}", "test_type": ttype, "score": score,
            "date": date, "passed": score >= 90}


def test_hmg_from_tests_baseline_and_highest_pass():
    assert ym.hmg_from_tests([]) == 2
    assert ym.hmg_from_tests([t("G3.1", "placement", 95, "2025-09-01"), t("G5.2", "end of course", 91, "2026-01-10"),
                              t("G6.1", "end of course", 70, "2026-02-01")]) == 5


def test_year_mode_uses_prior_year_tests():
    tests = [t("G3.1", "placement", 95, "2025-09-01"), t("G4.3", "end of course", 92, "2026-03-01"),
             t("G5.1", "end of course", 93, "2026-09-01")]
    assert ym.compute_starting_hmg(tests, mode="year", year_start="2026-08-01") == (4, "prior_year_tests")


def test_year_mode_new_student_uses_placements_this_year():
    tests = [t("G3.1", "placement", 95, "2026-08-20"), t("G4.1", "placement", 96, "2026-08-21"),
             t("G5.1", "placement", 60, "2026-08-22"), t("G5.2", "end of course", 91, "2026-09-10")]
    assert ym.compute_starting_hmg(tests, mode="year", year_start="2026-08-01") == (4, "placement")


def test_year_mode_replacement_above_prior_hmg_counts_as_placement():
    tests = [t("G3.2", "end of course", 91, "2026-02-01"), t("G6.1", "placement", 94, "2026-08-20")]
    assert ym.compute_starting_hmg(tests, mode="year", year_start="2026-08-01") == (6, "placement")


def test_year_mode_default_when_nothing():
    assert ym.compute_starting_hmg([t("G3.1", "end of course", 50, "2026-09-01")], mode="year", year_start="2026-08-01") == (2, "default")


def test_placement_mode_is_contiguous_from_g3():
    tests = [t("G3.1", "placement", 95, "2025-09-01"), t("G4.1", "placement", 95, "2025-09-02"),
             t("G6.1", "placement", 95, "2025-09-03")]          # G5 missing -> stops at 4
    assert ym.compute_starting_hmg(tests, mode="placement", year_start="2025-08-01") == (4, "placement")
    assert ym.compute_starting_hmg([], mode="placement", year_start="2025-08-01") == (2, "default")


def test_is_s1_cohort_by_calendar():
    assert ym.is_s1_cohort("2026-08-20", "2026-27", "A") is True
    assert ym.is_s1_cohort("2026-08-20", "2026-27", "B") is False    # B starts Sep 8
    assert ym.is_s1_cohort("2026-10-20", "2026-27", "A") is False
    assert ym.is_s1_cohort(None, "2026-27", "A") is None
