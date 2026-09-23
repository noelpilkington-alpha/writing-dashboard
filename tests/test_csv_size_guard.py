import pytest

import collect_data as cd


def test_small_csv_is_rejected_by_default():
    with pytest.raises(RuntimeError, match="filtered export"):
        cd.check_csv_size(14)


def test_small_csv_allowed_with_override():
    cd.check_csv_size(14, allow_small=True)


def test_full_csv_passes():
    cd.check_csv_size(7654)
    assert cd.MIN_CSV_ROWS <= 5000   # a normal daily export is well above the floor
