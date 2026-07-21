from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any, TypeVar

from openai import OpenAI
from pydantic import BaseModel, ValidationError

from .qwen_client import load_qwen_settings


OutputT = TypeVar("OutputT", bound=BaseModel)


class ProviderError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class StructuredCompletion:
    value: BaseModel
    provider: str
    model: str
    latency_ms: int
    request_id: str | None
    prompt_tokens: int | None
    completion_tokens: int | None


def _json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", cleaned, re.DOTALL)
    if fenced:
        cleaned = fenced.group(1)
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start < 0 or end <= start:
            raise ProviderError("invalid_json", "model output did not contain a JSON object") from exc
        try:
            value = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as nested:
            raise ProviderError("invalid_json", f"model output was not valid JSON: {nested.msg}") from nested
    if not isinstance(value, dict):
        raise ProviderError("invalid_json_shape", "model output must be a JSON object")
    return value


class QwenStructuredProvider:
    def __init__(self) -> None:
        settings = load_qwen_settings()
        self.provider_name = settings.provider
        self.model = settings.model
        self._client = OpenAI(
            api_key=settings.api_key,
            base_url=settings.base_url,
            timeout=30.0,
            max_retries=1,
        )

    def complete(
        self,
        *,
        system_prompt: str,
        input_payload: dict[str, Any],
        output_type: type[OutputT],
    ) -> StructuredCompletion:
        schema = output_type.model_json_schema()
        user_prompt = json.dumps(
            {
                "taskInput": input_payload,
                "requiredOutputSchema": schema,
                "instruction": "Return only one JSON object matching requiredOutputSchema. Do not use markdown.",
            },
            ensure_ascii=False,
        )
        started = time.perf_counter()
        try:
            response = self._client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,
                max_tokens=1400,
            )
        except Exception as exc:
            code = getattr(exc, "code", None) or type(exc).__name__
            raise ProviderError(str(code), str(exc)[:500]) from exc
        latency_ms = round((time.perf_counter() - started) * 1000)
        content = response.choices[0].message.content or ""
        try:
            value = output_type.model_validate(_json_object(content))
        except ValidationError as exc:
            codes = ", ".join(
                ".".join(str(part) for part in error["loc"])
                for error in exc.errors()[:5]
            )
            raise ProviderError("schema_invalid", f"structured output failed validation at: {codes}") from exc
        usage = response.usage
        return StructuredCompletion(
            value=value,
            provider=self.provider_name,
            model=response.model,
            latency_ms=latency_ms,
            request_id=getattr(response, "id", None),
            prompt_tokens=usage.prompt_tokens if usage else None,
            completion_tokens=usage.completion_tokens if usage else None,
        )


def build_provider(provider: str) -> QwenStructuredProvider:
    if provider != "qwen":
        raise ProviderError("unsupported_provider", f"no live provider configured for {provider}")
    return QwenStructuredProvider()
