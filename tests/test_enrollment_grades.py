import pytest

import enrollment_grades as eg


@pytest.mark.parametrize("title,expected", [
    ("[AlphaWrite] Writing G4 hole-filling Class", 4),
    ("Alphawrite Sentences I Class", 3), ("Alphawrite Sentences II Class", 4), ("Alphawrite Sentences III Class", 5),
    ("Alphawrite Paragraphs I Class", 4), ("Alphawrite Paragraphs II Class", 5), ("Alphawrite Paragraphs III Class", 6),
    ("Sentences G6 2025-26", 6), ("Paragraphs G7 2025-26", 7),
    ("Sentences G9 Class", None),        # SY26-27 age-grade title: no content grade
    ("Essays G8 Class", None),
    ("Standardized Writing Fundamentals G3 Class", 3),
    ("Scribble Class", None), ("Manual XP - Writing Class", None),
])
def test_content_grade_for_title(title, expected):
    assert eg.content_grade_for_title(title) == expected


def test_is_excluded_enrollment():
    assert eg.is_excluded_enrollment("Manual XP - Writing Class")
    assert eg.is_excluded_enrollment("Scribble Class")
    assert eg.is_excluded_enrollment("AP English Language and Composition - Hole-Filler Class")
    assert not eg.is_excluded_enrollment("Sentences G5 Class")


def test_enrollment_mismatch_only_when_a_content_grade_exists():
    assert eg.enrollment_mismatch(3, ["Sentences G9 Class"]) is None
    assert eg.enrollment_mismatch(3, ["[AlphaWrite] Writing G4 hole-filling Class"]) is None
    assert eg.enrollment_mismatch(3, ["[AlphaWrite] Writing G6 hole-filling Class"]) == "Expected G4, enrolled in G6"
    assert eg.enrollment_mismatch(4, ["Alphawrite Paragraphs II Class", "Sentences G9 Class"]) is None  # G5 == hmg+1
    assert eg.enrollment_mismatch(4, ["Alphawrite Sentences I Class", "Sentences G4 2025-26"]) == "Expected G5, enrolled in G3, G4"


def test_stale_enrollments_only_in_2026_27():
    titles = ["Sentences G6 2025-26", "Sentences G7 Class"]
    assert eg.stale_enrollments(titles, "2026-27") == ["Sentences G6 2025-26"]
    assert eg.stale_enrollments(titles, "2025-26") == []
