from __future__ import annotations

from functools import lru_cache

import regex

from .models import LanguageCheck

# Language names accepted by the existing free-text language field. Regional
# aliases select a language, not a dialect/spelling/translation-quality check.
LANGUAGES = {
    "af": ("Afrikaans", "南非荷兰语"), "sq": ("Albanian", "阿尔巴尼亚语"),
    "ar": ("Arabic", "阿拉伯语"), "hy": ("Armenian", "亚美尼亚语"),
    "az": ("Azerbaijani", "阿塞拜疆语"), "eu": ("Basque", "巴斯克语"),
    "be": ("Belarusian", "白俄罗斯语"), "bn": ("Bengali", "孟加拉语"),
    "nb": ("Bokmal", "挪威博克马尔语"), "bs": ("Bosnian", "波斯尼亚语"),
    "bg": ("Bulgarian", "保加利亚语"), "ca": ("Catalan", "加泰罗尼亚语"),
    "zh": ("Chinese", "中文"), "hr": ("Croatian", "克罗地亚语"),
    "cs": ("Czech", "捷克语"), "da": ("Danish", "丹麦语"),
    "nl": ("Dutch", "荷兰语"), "en": ("English", "英语"),
    "eo": ("Esperanto", "世界语"), "et": ("Estonian", "爱沙尼亚语"),
    "fi": ("Finnish", "芬兰语"), "fr": ("French", "法语"),
    "lg": ("Ganda", "卢干达语"), "ka": ("Georgian", "格鲁吉亚语"),
    "de": ("German", "德语"), "el": ("Greek", "希腊语"),
    "gu": ("Gujarati", "古吉拉特语"), "he": ("Hebrew", "希伯来语"),
    "hi": ("Hindi", "印地语"), "hu": ("Hungarian", "匈牙利语"),
    "is": ("Icelandic", "冰岛语"), "id": ("Indonesian", "印度尼西亚语"),
    "ga": ("Irish", "爱尔兰语"), "it": ("Italian", "意大利语"),
    "ja": ("Japanese", "日语"), "kk": ("Kazakh", "哈萨克语"),
    "ko": ("Korean", "韩语"), "la": ("Latin", "拉丁语"),
    "lv": ("Latvian", "拉脱维亚语"), "lt": ("Lithuanian", "立陶宛语"),
    "mk": ("Macedonian", "马其顿语"), "ms": ("Malay", "马来语"),
    "mi": ("Maori", "毛利语"), "mr": ("Marathi", "马拉地语"),
    "mn": ("Mongolian", "蒙古语"), "nn": ("Nynorsk", "新挪威语"),
    "fa": ("Persian", "波斯语"), "pl": ("Polish", "波兰语"),
    "pt": ("Portuguese", "葡萄牙语"), "pa": ("Punjabi", "旁遮普语"),
    "ro": ("Romanian", "罗马尼亚语"), "ru": ("Russian", "俄语"),
    "sr": ("Serbian", "塞尔维亚语"), "sn": ("Shona", "绍纳语"),
    "sk": ("Slovak", "斯洛伐克语"), "sl": ("Slovene", "斯洛文尼亚语"),
    "so": ("Somali", "索马里语"), "st": ("Sotho", "南索托语"),
    "es": ("Spanish", "西班牙语"), "sw": ("Swahili", "斯瓦希里语"),
    "sv": ("Swedish", "瑞典语"), "tl": ("Tagalog", "他加禄语"),
    "ta": ("Tamil", "泰米尔语"), "te": ("Telugu", "泰卢固语"),
    "th": ("Thai", "泰语"), "ts": ("Tsonga", "聪加语"),
    "tn": ("Tswana", "茨瓦纳语"), "tr": ("Turkish", "土耳其语"),
    "uk": ("Ukrainian", "乌克兰语"), "ur": ("Urdu", "乌尔都语"),
    "vi": ("Vietnamese", "越南语"), "cy": ("Welsh", "威尔士语"),
    "xh": ("Xhosa", "科萨语"), "yo": ("Yoruba", "约鲁巴语"),
    "zu": ("Zulu", "祖鲁语"),
}
ALIASES = {name.casefold(): code for code, names in LANGUAGES.items() for name in (code, *names)}
ALIASES.update({
    "英文": "en", "美式英语": "en", "英式英语": "en", "简体中文": "zh", "繁体中文": "zh",
    "汉语": "zh", "日文": "ja", "韩文": "ko", "印尼语": "id", "巴西葡萄牙语": "pt",
    "挪威语": "nb", "菲律宾语": "tl", "norwegian bokmal": "nb", "norwegian nynorsk": "nn",
})

# This is a conservative review threshold, not a measured accuracy percentage.
MIN_CONFIDENCE = 0.70


def resolve_language(value: str) -> str | None:
    value = value.strip().casefold()
    if value in ALIASES:
        return ALIASES[value]
    if regex.fullmatch(r"[a-z]{2}(?:[-_][a-z0-9]{2,8})+", value):
        return ALIASES.get(value[:2])
    return None


@lru_cache(maxsize=1)
def _detector():
    # Native models are loaded lazily and shared. No network access at runtime.
    from lingua import LanguageDetectorBuilder
    return LanguageDetectorBuilder.from_all_languages().build()


def _scores(text: str) -> list[tuple[str, float]]:
    return [(c.language.iso_code_639_1.name.lower(), c.value)
            for c in _detector().compute_language_confidence_values(text)]


def _segments(text: str) -> list[tuple[str, str]]:
    return [(part.language.iso_code_639_1.name.lower(), text[part.start_index:part.end_index])
            for part in _detector().detect_multiple_languages_of(text)]


def check_language(title: str, requested: str) -> LanguageCheck:
    target = resolve_language(requested)
    if not target:
        return LanguageCheck(status="unsupported", requested=requested,
                             message=f"语言待确认：无法识别或暂不支持目标语言“{requested}”。")
    # Ignore numerical measurements for identification only; never alter export.
    text = regex.sub(r"(?i)\b\d+(?:[.,]\d+)?\s*(?:mm|cm|km|kg|mg|ml|oz|lbs?|inch|inches|gb|tb|g|m|l)\b", " ", title)
    if len(regex.findall(r"\p{L}", text)) < 4:
        return LanguageCheck(status="uncertain", requested=requested,
                             message="语言待确认：可识别文字太少，请人工检查。")
    try:
        scores = _scores(text)
        if not scores:
            return LanguageCheck(status="uncertain", requested=requested,
                                 message="语言待确认：未能识别标题语言。")
        code, confidence = scores[0]
        detected = LANGUAGES.get(code, (code, code))[1]
        details = {"requested": requested, "detected": detected, "confidence": round(confidence, 4)}
        if confidence < MIN_CONFIDENCE:
            return LanguageCheck(status="uncertain", **details,
                                 message=f"语言待确认：疑似{detected}，识别把握不足，请人工检查。")
        if code != target:
            return LanguageCheck(status="mismatch", **details,
                                 message=f"语言不符：要求{requested}，识别为{detected}。")
        for foreign, fragment in _segments(text):
            if foreign != target and len(regex.findall(r"\p{L}", fragment)) >= 4:
                name = LANGUAGES.get(foreign, (foreign, foreign))[1]
                return LanguageCheck(status="mixed", **details,
                                     message=f"语言待确认：疑似夹杂{name}“{fragment.strip()[:40]}”；如为品牌或型号，请人工确认。")
        return LanguageCheck(status="passed", **details, message=f"语言初检通过：{detected}。")
    except Exception:
        # Keep the title and fail closed if the native module cannot load/run.
        # Do not expose library exceptions or cause another provider request.
        return LanguageCheck(status="unavailable", requested=requested,
                             message="语言检查不可用，标题已保留并标记风险；请检查安装是否完整。")
