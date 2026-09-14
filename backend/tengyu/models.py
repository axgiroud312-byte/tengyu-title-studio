from __future__ import annotations

import re
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Thinking = Literal["switchable", "on", "off", "unknown"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TitleOptions(StrictModel):
    provider: str = "aliyun"
    model: str = "qwen3.8-flash"
    thinking: bool | None = False
    language: str = Field(default="英语", min_length=1, max_length=80)
    min_chars: int | None = Field(default=None, ge=1, le=32767)
    max_chars: int | None = Field(default=None, ge=1, le=32767)
    requirements: str = Field(default="", max_length=20000)
    concurrency: int = Field(default=3, ge=1, le=10)

    @field_validator("language", "model", "provider")
    @classmethod
    def clean_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("不能为空")
        return value.strip()

    @model_validator(mode="after")
    def valid_range(self):
        if self.min_chars and self.max_chars and self.min_chars > self.max_chars:
            raise ValueError("最少字符不能大于最多字符")
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
        url = urlsplit(value)
        if (url.scheme != "https" or not url.hostname or url.username or url.password
                or url.query or url.fragment):
            raise ValueError("请输入不含密钥或查询参数的 HTTPS 服务地址")
        if info.field_name == "models_url" and url.path != "/api/v1/models":
            raise ValueError("模型目录地址必须以 /api/v1/models 结尾")
        return value

    @field_validator("workspace_id")
    @classmethod
    def valid_workspace(cls, value):
        value = value.strip()
        if value and not re.fullmatch(r"[A-Za-z0-9-]+", value):
            raise ValueError("业务空间 ID 只能包含字母、数字和连字符")
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
