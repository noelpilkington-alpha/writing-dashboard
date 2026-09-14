import json

import identity


def row(first, last, dob, email, status="Enrolled"):
    return {"First Name": first, "Last Name": last, "Date of Birth": dob,
            "Student Alpha Email": email, "Admission Status": status}


def test_build_links_same_person_new_email_distinct_api_ids():
    old = [row("Anra", "Armilio", "2014-02-03", "anra.armilio@2hourlearning.com")]
    new = [row("Anra", "Armilio", "2014-02-03", "anra.armilio@alpha.school")]
    users = [{"sourcedId": "old-1", "email": "anra.armilio@2hourlearning.com"},
             {"sourcedId": "new-1", "email": "anra.armilio@alpha.school"}]
    links = identity.build_links(old, new, users)
    assert links == [{"old_sourced_id": "old-1", "new_sourced_id": "new-1",
                      "old_email": "anra.armilio@2hourlearning.com", "new_email": "anra.armilio@alpha.school",
                      "name": "Anra Armilio"}]


def test_build_links_handles_person_listed_twice_in_old_roster():
    # Old roster has both the old and the new email for the same person; only the old one is a link.
    old = [row("Anra", "Armilio", "02/17/2016", "anra.armilio@2hourlearning.com"),
           row("Anra", "Armilio", "02/17/2016", "anra.armilio@alpha.school")]
    new = [row("Anra", "Armilio", "02/17/2016", "anra.armilio@alpha.school")]
    users = [{"sourcedId": "old-1", "email": "anra.armilio@2hourlearning.com"},
             {"sourcedId": "new-1", "email": "anra.armilio@alpha.school"}]
    links = identity.build_links(old, new, users)
    assert [(l["old_sourced_id"], l["new_sourced_id"]) for l in links] == [("old-1", "new-1")]


def test_build_links_ignores_same_email_and_unknown_api_users():
    old = [row("A", "B", "2010-01-01", "a.b@x.com"), row("C", "D", "2010-01-01", "c.d@old.com")]
    new = [row("A", "B", "2010-01-01", "a.b@x.com"), row("C", "D", "2010-01-01", "c.d@new.com")]
    users = [{"sourcedId": "s1", "email": "a.b@x.com"}, {"sourcedId": "s2", "email": "c.d@new.com"}]  # no old c.d
    assert identity.build_links(old, new, users) == []


def test_build_links_is_case_insensitive_and_skips_non_enrolled_new_rows():
    old = [row("Eli", "Dickinson", "2012-05-05", "ELI.DICKINSON@2hourlearning.com")]
    new = [row("eli", "dickinson", "2012-05-05", "eli.dickinson@alpha.school", status="Pending Review")]
    users = [{"sourcedId": "o", "email": "eli.dickinson@2hourlearning.com"},
             {"sourcedId": "n", "email": "eli.dickinson@alpha.school"}]
    assert identity.build_links(old, new, users) == []


def test_load_links_indexes_by_new_id(tmp_path):
    p = tmp_path / "identity_links.json"
    p.write_text(json.dumps({"generated_at": "x", "links": [
        {"old_sourced_id": "o1", "new_sourced_id": "n1"}, {"old_sourced_id": "o2", "new_sourced_id": "n1"}]}))
    assert identity.load_links(p) == {"n1": ["o1", "o2"]}
    assert identity.load_links(tmp_path / "missing.json") == {}


def test_merge_tests_dedups_on_name_and_date_and_sorts():
    a = [{"name": "G3.1", "date": "2026-09-01", "score": 91}]
    b = [{"name": "G3.1", "date": "2026-09-01", "score": 91}, {"name": "G2.9", "date": "2025-09-01", "score": 95}]
    merged = identity.merge_tests(a, [b])
    assert [t["date"] for t in merged] == ["2025-09-01", "2026-09-01"]
    assert len(merged) == 2


def test_merge_activities_dedups_on_sourced_id():
    a = [{"sourcedId": "r1"}]
    b = [{"sourcedId": "r1"}, {"sourcedId": "r2"}]
    assert [r["sourcedId"] for r in identity.merge_activities(a, [b])] == ["r1", "r2"]
