"""Runs real offline Lingua in CI. Does not download anything during tests."""
import importlib.util
import os

import pytest

from tengyu.language import LANGUAGES, check_language


@pytest.fixture(scope="module", autouse=True)
def require_lingua():
    if importlib.util.find_spec("lingua") is None:
        if os.environ.get("TENGYU_REQUIRE_LINGUA") == "1":
            pytest.fail("Lingua must be installed in the CI environment")
        pytest.skip("Lingua is not installed locally; real detection runs in CI")


def test_language_catalog_matches_installed_lingua():
    from lingua import Language
    assert set(LANGUAGES) == {lang.iso_code_639_1.name.lower() for lang in Language.all()}


@pytest.mark.parametrize("text,target,expected", [
    ("Women's floral print scarf with a blue background and decorative border", "英语", "passed"),
    ("Camiseta para mujer con estampado de flores y mangas cortas para llevar todos los días", "西班牙语", "passed"),
    ("女士蓝色花卉印花围巾，搭配装饰边框，适合日常穿搭", "中文", "passed"),
    ("Women's floral print scarf with a blue background and decorative border", "西班牙语", "mismatch"),
    ("女士蓝色花卉印花围巾，搭配装饰边框，适合日常穿搭", "英语", "mismatch"),
])
def test_real_title_identification(text, target, expected):
    result = check_language(text, target)
    assert result.status == expected, result.model_dump()
