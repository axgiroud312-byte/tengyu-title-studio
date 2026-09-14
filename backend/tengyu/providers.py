from __future__ import annotations

import asyncio
import json
import time
from typing import Protocol
from urllib.parse import urlsplit

import httpx
import keyring

from .models import GenerationResult, ModelInfo, Settings, TitleOptions


class ProviderError(Exception):
    def __init__(self, message: str, *, global_error=False, raw="", uncertain=False):
        super().__init__(message)
        self.global_error = global_error
        self.raw = raw
        self.uncertain = uncertain


class Credentials:
    service = "com.tengyu.title-studio"

    def get(self, provider: str) -> str | None:
        try:
            return keyring.get_password(self.service, provider)
        except Exception as exc:
            raise ValueError("无法读取系统凭据，请检查 Windows 凭据管理器后重新保存 API Key。") from exc

    def set(self, provider: str, key: str):
        try:
            if not key.strip():
                raise ValueError("API Key 不能为空")
            keyring.set_password(self.service, provider, key.strip())
        except Exception as exc:
            raise ValueError("系统无法安全保存 API Key，请检查系统凭据服务。") from exc


class TextProvider(Protocol):
    async def list_models(self, settings: Settings, key: str) -> list[ModelInfo]: ...
    async def generate_title(self, settings: Settings, key: str, options: TitleOptions,
                             skill: str, image: str) -> GenerationResult: ...


PRESETS = [ModelInfo(id=name, name=name, thinking="switchable", source="preset") for name in (
    "qwen3.8-flash", "qwen3.7-plus", "qwen3.8-max", "qwen3-vl-plus", "qwen3-vl-flash")]


def thinking_mode(model: str):
    if model in {m.id for m in PRESETS}:
        return "switchable"
    if model.endswith("-thinking") or model in {"qvq-max", "qvq-plus"}:
        return "on"
    if model.endswith("-instruct") or model in {"qwen-vl-plus", "qwen-vl-max"}:
        return "off"
    return "unknown"


def validate_model(model: ModelInfo, options: TitleOptions):
    if not model.vision or not model.text:
        raise ValueError("此模型不支持图片输入和文字输出，请选择视觉模型。")
    if model.thinking == "on" and options.thinking is not True:
        raise ValueError("此模型固定开启思考，请开启思考或更换模型。")
    if model.thinking == "off" and options.thinking is not False:
        raise ValueError("此模型不支持思考，请关闭思考或更换模型。")
    if model.thinking == "unknown" and options.thinking is not None:
        raise ValueError("此模型思考能力未知，请使用跟随模型默认模式。")


def http_error(status: int, body: bytes = b"") -> ProviderError:
    # Only map documented error categories; never expose the remote response body.
    code = ""
    try:
        parsed = json.loads(body)
        code = str(parsed.get("code") or parsed.get("error", {}).get("code", "")).lower()
    except (ValueError, AttributeError, TypeError):
        pass
    billing = any(x in code for x in ("arrearage", "insufficient_quota", "insufficient_balance"))
    messages = {
        400: "请求参数不兼容，请检查模型和思考设置。",
        401: "API Key 无效或地域不匹配，请在设置中检查密钥和服务地址。",
        402: "账户余额不足，请充值后手动继续。",
        403: "模型访问被拒绝，请检查模型开通状态和账号权限。",
        404: "服务地址或模型不存在，请检查完整模型 ID 和服务地址。",
        429: "请求受到限流，请降低并发数，稍后手动重试。",
    }
    message = "账户额度或余额不足，请检查阿里云控制台。" if billing else messages.get(
        status, "模型服务暂时不可用，请稍后手动重试。")
    return ProviderError(message, global_error=billing or status in {401, 402, 403, 404})


class Aliyun:
    def __init__(self, transport=None):
        self.transport = transport

    async def list_models(self, settings: Settings, key: str) -> list[ModelInfo]:
        url = settings.models_url
        if not url and settings.workspace_id:
            host = urlsplit(settings.base_url).hostname
            if host == "dashscope.aliyuncs.com":
                url = f"https://{settings.workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/models"
        if not url:
            parsed = urlsplit(settings.base_url)
            url = f"{parsed.scheme}://{parsed.netloc}/api/v1/models"
        models, seen = [], set()
        async with httpx.AsyncClient(timeout=30, transport=self.transport) as client:
            for page in range(1, 101):
                response = await client.get(url, params={"page_no": page, "page_size": 100, "language": "zh-CN"},
                                            headers={"Authorization": f"Bearer {key}"})
                if not response.is_success:
                    if response.status_code == 404:
                        raise ProviderError("模型目录地址不可用。北京地域请填写业务空间 ID，或填写官方模型目录地址；原列表已保留。")
                    raise http_error(response.status_code, response.content)
                try:
                    body = response.json()
                    output = body["output"]
                    rows, total = output["models"], output["total"]
                    if body.get("success") is False or not isinstance(rows, list) or type(total) is not int:
                        raise ValueError()
                    if not rows and (page - 1) * 100 < total:
                        raise ValueError()
                except (KeyError, ValueError, TypeError) as exc:
                    raise ProviderError("模型目录响应格式异常，原列表已保留。") from exc
                for row in rows:
                    name = row.get("model")
                    if not isinstance(name, str) or not name or name in seen:
                        continue
                    seen.add(name)
                    meta, caps = row.get("inference_metadata") or {}, row.get("capabilities") or []
                    if meta:
                        vision = "Image" in (meta.get("request_modality") or [])
                        text = "Text" in (meta.get("response_modality") or [])
                    else:
                        vision, text = "VU" in caps, "TG" in caps
                    if vision and text:
                        models.append(ModelInfo(id=name, name=row.get("name") or name,
                                                thinking=thinking_mode(name)))
                if page * 100 >= total:
                    return models
            raise ProviderError("模型目录分页超出预期，原列表已保留。")

    async def generate_title(self, settings: Settings, key: str, options: TitleOptions,
                             skill: str, image: str) -> GenerationResult:
        constraints = {"目标语言": options.language, "最少字符": options.min_chars,
                       "最多字符": options.max_chars, "用户补充要求": options.requirements}
        payload = {"model": options.model, "stream": True, "stream_options": {"include_usage": True},
                   "max_completion_tokens": 8192,
                   "messages": [{"role": "system", "content": skill}, {"role": "user", "content": [
                       {"type": "text", "text": "根据此商品图片生成一条标题。要求：\n" + json.dumps(constraints, ensure_ascii=False)},
                       {"type": "image_url", "image_url": {"url": image}},
                   ]}]}
        if options.thinking is not None:
            payload["enable_thinking"] = options.thinking
        start, parts, finish, usage, request_id = time.monotonic(), [], None, {}, None
        try:
            async with asyncio.timeout(180):
                async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=15), transport=self.transport) as client:
                    async with client.stream("POST", settings.base_url + "/chat/completions", json=payload,
                                             headers={"Authorization": f"Bearer {key}"}) as response:
                        if not response.is_success:
                            raise http_error(response.status_code, await response.aread())
                        request_id = response.headers.get("x-request-id")
                        size = 0
                        async for line in response.aiter_lines():
                            if not line.startswith("data:"):
                                continue
                            data = line[5:].strip()
                            if data == "[DONE]":
                                break
                            if not data:
                                continue
                            size += len(data)
                            if size > 4_000_000:
                                raise ProviderError("模型回复超出大小限制，已停止接收。", raw="".join(parts))
                            chunk = json.loads(data)
                            if chunk.get("error"):
                                raise ProviderError("模型在生成过程中返回错误，未自动重试。", raw="".join(parts))
                            usage = chunk.get("usage") or usage
                            choices = chunk.get("choices") or []
                            if choices:
                                choice = choices[0]
                                body = choice.get("delta", {}).get("content")
                                if isinstance(body, str):
                                    parts.append(body)
                                finish = choice.get("finish_reason") or finish
        except ProviderError:
            raise
        except (httpx.HTTPError, TimeoutError) as exc:
            raise ProviderError("连接中断或请求超时，结果未知且可能已计费；没有自动重试。",
                                raw="".join(parts), uncertain=True) from exc
        except (ValueError, KeyError, TypeError) as exc:
            raise ProviderError("模型回复格式异常，原始正文已保留。", raw="".join(parts)) from exc
        return GenerationResult(raw="".join(parts), finish=finish, usage=usage,
                                request_id=request_id, elapsed=round(time.monotonic() - start, 2))


PROVIDERS: dict[str, TextProvider] = {"aliyun": Aliyun()}
