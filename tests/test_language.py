import pytest

from tengyu import language
from tengyu.files import evaluate_title


@pytest.mark.parametrize("name,code", [
    ("英语", "en"), (" English ", "en"), ("en-US", "en"), ("pt_BR", "pt"),
    ("简体中文", "zh"), ("繁体中文", "zh"), ("日本語", None), ("日语", "ja"),
    ("韩语", "ko"), ("泰语", "th"), ("印尼语", "id"), ("Vietnamese", "vi"),
    ("西班牙语", "es"), ("不存在的语言", None),
])
def test_target_language_aliases(name, code):
    assert language.resolve_language(name) == code


def detector(monkeypatch, scores, segments=None):
    monkeypatch.setattr(language, "_scores", lambda text: scores)
    monkeypatch.setattr(language, "_segments", lambda text: segments or [("en", text)])


def test_matching_language_and_exact_length(monkeypatch):
    detector(monkeypatch, [("en", .96), ("de", .02)])
    result = evaluate_title("  Blue   floral scarf  ", "stop", 17, 17, "英语")
    assert result["title"] == "Blue floral scarf"
    assert result["char_count"] == 17
    assert result["status"] == "completed"
    assert result["language_check"]["status"] == "passed"


def test_length_and_language_risks_accumulate_without_rewriting(monkeypatch):
    detector(monkeypatch, [("en", .96), ("es", .02)])
    result = evaluate_title("Blue floral scarf", "stop", 200, 220, "西班牙语")
    assert result["status"] == "review"
    assert result["title"] == "Blue floral scarf"
    assert "少于要求的 200" in result["error"]
    assert "要求西班牙语，识别为英语" in result["error"]
    assert result["language_check"]["status"] == "mismatch"


@pytest.mark.parametrize("scores", [[], [("en", .6), ("de", .3)], [("en", .51), ("es", .49)]])
def test_low_confidence_is_risk_even_if_target_is_first(monkeypatch, scores):
    detector(monkeypatch, scores)
    result = evaluate_title("Blue floral scarf", "stop", None, None, "英语")
    assert result["status"] == "review"
    assert result["language_check"]["status"] == "uncertain"


def test_foreign_fragment_is_review_not_language_purity_claim(monkeypatch):
    detector(monkeypatch, [("es", .96), ("en", .02)], [
        ("es", "Camiseta de mujer"), ("en", "summer casual top")])
    monkeypatch.setattr(language, "_scores", lambda text: [("en", .96), ("es", .02)]
                        if text == "summer casual top" else [("es", .96), ("en", .02)])
    result = evaluate_title("Camiseta de mujer summer casual top", "stop", None, None, "西班牙语")
    assert result["status"] == "review"
    assert result["language_check"]["status"] == "mixed"
    assert "summer casual top" in result["error"]


def test_unconfirmed_segmentation_does_not_override_full_title(monkeypatch):
    detector(monkeypatch, [("es", .96), ("pt", .02)], [("pt", "Camiseta para mujer")])
    # The segmenter guessed Portuguese; the independent classifier disagrees.
    result = language.check_language("Camiseta para mujer con estampado de flores", "西班牙语")
    assert result.status == "passed"


def test_numbers_units_and_emoji_do_not_prove_language(monkeypatch):
    def must_not_run(text):
        pytest.fail("Too little language evidence must be checked before loading models")
    monkeypatch.setattr(language, "_scores", must_not_run)
    for text in ["12345 👕", "20 cm 50 kg 2 oz", "ABC", "围巾"]:
        assert language.check_language(text, "英语").status == "uncertain"


def test_unsupported_language_does_not_load_detector(monkeypatch):
    def must_not_run(text):
        pytest.fail("An unknown target cannot be silently guessed")
    monkeypatch.setattr(language, "_scores", must_not_run)
    result = evaluate_title("Blue floral scarf", "stop", None, None, "克林贡语")
    assert result["status"] == "review"
    assert result["language_check"]["status"] == "unsupported"


@pytest.mark.parametrize("stage", ["_scores", "_segments"])
def test_missing_or_broken_lingua_preserves_title_as_risk(monkeypatch, stage):
    detector(monkeypatch, [("en", .96), ("de", .02)])
    def fail(text):
        raise ImportError("a private filesystem path must not reach UI")
    monkeypatch.setattr(language, stage, fail)
    result = evaluate_title("Blue floral scarf", "stop", None, None, "英语")
    assert result["status"] == "review" and result["title"] == "Blue floral scarf"
    assert result["language_check"]["status"] == "unavailable"
    assert "private" not in result["error"]


def test_bad_format_does_not_run_language_identification(monkeypatch):
    def fail(text):
        pytest.fail("Malformed output should not reach language detector")
    monkeypatch.setattr(language, "_scores", fail)
    assert evaluate_title('"Blue scarf"', "stop", None, None, "英语")["status"] == "failed"


def test_overlength_is_risk_with_passing_language(monkeypatch):
    detector(monkeypatch, [("en", .96), ("de", .02)])
    result = evaluate_title("Blue floral scarf", "stop", None, 10, "英语")
    assert result["status"] == "review"
    assert "超过要求的 10" in result["error"]
    assert result["language_check"]["status"] == "passed"
