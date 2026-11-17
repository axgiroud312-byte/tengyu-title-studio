from __future__ import annotations

import re
from typing import Literal
from urllib.parse import urlsplit

import regex
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic_core import PydanticCustomError

Thinking = Literal["switchable", "on", "off", "unknown"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TitleOptions(StrictModel):
    provider: str = "aliyun"
    model: str = "qwen3.8-flash"
    thinking: bool | None = False
    language: str = Field(default="英语", min_length=1, max_length=80)
    prefix: str = Field(default="", max_length=1000)
    suffix: str = Field(default="", max_length=1000)
    prefix_separator: str = ""
    suffix_separator: str = ""
    min_chars: int | None = Field(default=None, ge=1, le=32767)
    max_chars: int | None = Field(default=None, ge=1, le=32767)
    requirements: str = Field(default="", max_length=20000)
    concurrency: int = Field(default=3, ge=1, le=10)

    @field_validator("language", "model", "provider")
    @classmethod
    def clean_text(cls, value: str) -> str:
        if not value.strip():
            raise PydanticCustomError("empty_text", "不能为空。")
        return value.strip()

    @field_validator("prefix", "suffix", "prefix_separator", "suffix_separator")
    @classmethod
    def single_line(cls, value: str) -> str:
        if re.search(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]", value):
            raise PydanticCustomError("title_affix", "请填写单行文字或符号，不含换行、制表符和控制字符。")
        # Spaces (including repeated or leading/trailing spaces) are intentional.
        return value

    def title_affixes(self) -> tuple[str, str]:
        return (self.prefix + self.prefix_separator if self.prefix else "",
                self.suffix_separator + self.suffix if self.suffix else "")

    def affix_char_count(self) -> int:
        return sum(len(regex.findall(r"\X", part)) for part in self.title_affixes())

    def for_generation(self) -> TitleOptions:
        """Reserve room for the local affixes; the provider generates only the body."""
        extra = self.affix_char_count()
        return self.model_copy(update={
            "prefix": "", "suffix": "",
            "min_chars": max(1, self.min_chars - extra) if self.min_chars else None,
            "max_chars": self.max_chars - extra if self.max_chars else None,
        })

    @model_validator(mode="after")
    def valid_range(self):
        if self.min_chars and self.max_chars and self.min_chars > self.max_chars:
            raise PydanticCustomError("character_range", "最少字符数不能大于最多字符数。")
        if self.max_chars and self.affix_char_count() >= self.max_chars:
            raise PydanticCustomError("character_range", "前后缀和连接符已占满最多字符数，请缩短拼接内容或增加最多字符数。")
        return self


class Settings(StrictModel):
    base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    models_url: str = ""
    workspace_id: str = ""
    defaults: TitleOptions = Field(default_factory=TitleOptions)

    @field_validator("base_url", "models_url")
    @classmethod
    def valid_url(cls, value: str, info):
        value = value.strip().rstrip("/")
        if not value and info.field_name == "models_url":
            return value
        try:
            url = urlsplit(value)
        except ValueError as exc:
            raise PydanticCustomError("service_url", "请输入有效的 HTTPS 地址。") from exc
        if (url.scheme != "https" or not url.hostname or url.username or url.password
                or url.query or url.fragment):
            raise PydanticCustomError("service_url", "请输入不含密钥或查询参数的 HTTPS 地址。")
        if info.field_name == "models_url" and url.path != "/api/v1/models":
            raise PydanticCustomError("models_url", "地址必须以 /api/v1/models 结尾。")
        return value

    @field_validator("workspace_id")
    @classmethod
    def valid_workspace(cls, value):
        value = value.strip()
        if value and not re.fullmatch(r"[A-Za-z0-9-]+", value):
            raise PydanticCustomError("workspace_id", "只能包含字母、数字和连字符。")
        return value


class SettingsUpdate(Settings):
    api_key: str | None = Field(default=None, max_length=4096, repr=False)


class ScanRequest(StrictModel):
    mode: Literal["sku", "images"]
    directory: str = Field(min_length=1, max_length=4096)


class BatchCreate(StrictModel):
    scan_id: str
    options: TitleOptions


class RetryRequest(StrictModel):
    item_ids: list[str] = Field(min_length=1, max_length=10000)


class ModelInfo(StrictModel):
    id: str
    name: str
    vision: bool = True
    text: bool = True
    thinking: Thinking = "unknown"
    source: str = "catalog"


class GenerationResult(StrictModel):
    raw: str = ""
    finish: str | None = None
    elapsed: float = 0
    usage: dict = Field(default_factory=dict)
    request_id: str | None = None
