import json

import httpx
import pytest

from tengyu.models import ModelInfo, Settings, TitleOptions
from tengyu.providers import Aliyun, ProviderError, http_error, validate_model


@pytest.mark.parametrize("thinking", [True, False])
async def test_stream_ignores_reasoning_and_uses_one_request(thinking):
    requests = []
    def handle(request):
        requests.append(request)
        payload = json.loads(request.content)
        assert payload["enable_thinking"] is thinking
        assert payload["messages"][1]["content"][1]["image_url"]["url"].startswith("data:image/")
        chunks = [
            {"choices": [{"delta": {"reasoning_content": "SECRET REASONING"}}]},
            {"choices": [{"delta": {"content": "商品"}}]},
            {"choices": [{"delta": {"content": "标题"}, "finish_reason": "stop"}]},
            {"choices": [], "usage": {"total_tokens": 10}},
        ]
        text = "\n\n".join("data: " + json.dumps(c) for c in chunks) + "\n\ndata: [DONE]\n\n"
        return httpx.Response(200, text=text)
    result = await Aliyun(httpx.MockTransport(handle)).generate_title(
        Settings(), "test", TitleOptions(thinking=thinking), "skill", "data:image/jpeg;base64,AAAA")
    assert result.raw == "商品标题" and result.finish == "stop"
    assert result.usage == {"total_tokens": 10} and len(requests) == 1


async def test_no_network_retries_and_safe_error():
    calls = []
    def handle(request):
        calls.append(request)
        return httpx.Response(401, json={"error": {"message": "secret_key_value"}})
    with pytest.raises(ProviderError) as result:
        await Aliyun(httpx.MockTransport(handle)).generate_title(Settings(), "test", TitleOptions(), "skill", "image")
    assert len(calls) == 1 and result.value.global_error
    assert "secret_key_value" not in str(result.value)


async def test_timeout_is_unknown_without_retry():
    calls = []
    def handle(request):
        calls.append(request)
        raise httpx.ReadTimeout("sensitive content")
    with pytest.raises(ProviderError) as result:
        await Aliyun(httpx.MockTransport(handle)).generate_title(Settings(), "test", TitleOptions(), "skill", "image")
    assert result.value.uncertain and len(calls) == 1
    assert "sensitive" not in str(result.value)


async def test_catalog_pagination_modality_and_workspace():
    pages = []
    def handle(request):
        assert request.url.host == "demo.cn-beijing.maas.aliyuncs.com"
        page = int(request.url.params["page_no"])
        pages.append(page)
        rows = [{"model": "text", "inference_metadata": {"request_modality": ["Text"], "response_modality": ["Text"]}}] * 100 if page == 1 else [
            {"model": "new-vision", "name": "新视觉", "inference_metadata": {"request_modality": ["Image", "Text"], "response_modality": ["Text"]}},
            {"model": "picture-generator", "inference_metadata": {"request_modality": ["Image"], "response_modality": ["Image"]}},
        ]
        return httpx.Response(200, json={"output": {"total": 102, "models": rows}})
    models = await Aliyun(httpx.MockTransport(handle)).list_models(Settings(workspace_id="demo"), "test")
    assert pages == [1, 2]
    assert [m.id for m in models] == ["new-vision"]
    assert models[0].thinking == "unknown"


def test_fixed_thinking_and_global_billing():
    with pytest.raises(ValueError):
        validate_model(ModelInfo(id="fixed", name="fixed", thinking="on"), TitleOptions(thinking=False))
    with pytest.raises(ValueError):
        validate_model(ModelInfo(id="unknown", name="unknown"), TitleOptions(thinking=True))
    validate_model(ModelInfo(id="unknown", name="unknown"), TitleOptions(thinking=None))
    assert http_error(400, b'{"code":"Arrearage"}').global_error
