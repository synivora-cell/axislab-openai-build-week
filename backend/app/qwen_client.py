from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI


ENV_FILE = Path(__file__).resolve().parents[1] / ".env"

PROVIDER_ENDPOINTS = {
    "bailian-cn": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "qwen-cloud": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
}


@dataclass(frozen=True)
class QwenSettings:
    api_key: str
    provider: str
    base_url: str
    model: str


def load_qwen_settings() -> QwenSettings:
    """Load Qwen Cloud credentials without overriding deployment environment variables."""
    load_dotenv(ENV_FILE, override=False)
    api_key = os.getenv("QWEN_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            f"QWEN_API_KEY is missing. Add it to {ENV_FILE} or the process environment."
        )
    configured_base_url = os.getenv("QWEN_BASE_URL", "").strip().rstrip("/")
    provider = os.getenv("QWEN_PROVIDER", "").strip().lower()
    if not provider:
        provider = (
            "qwen-cloud"
            if "dashscope-intl.aliyuncs.com" in configured_base_url
            else "bailian-cn"
            if configured_base_url
            else "qwen-cloud"
        )
    if provider not in PROVIDER_ENDPOINTS:
        allowed = ", ".join(sorted(PROVIDER_ENDPOINTS))
        raise RuntimeError(f"Unsupported QWEN_PROVIDER={provider!r}. Use one of: {allowed}.")
    return QwenSettings(
        api_key=api_key,
        provider=provider,
        base_url=configured_base_url or PROVIDER_ENDPOINTS[provider],
        model=os.getenv("QWEN_MODEL", "qwen3.7-plus"),
    )


def run_connectivity_test(prompt: str = "Reply with exactly: AxisLab Qwen connection OK") -> dict[str, object]:
    settings = load_qwen_settings()
    client = OpenAI(
        api_key=settings.api_key,
        base_url=settings.base_url,
        timeout=30.0,
        max_retries=1,
    )
    response = client.chat.completions.create(
        model=settings.model,
        messages=[
            {
                "role": "system",
                "content": "You are a concise connectivity-test assistant.",
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0,
        max_tokens=40,
    )
    usage = response.usage
    return {
        "ok": True,
        "provider": settings.provider,
        "model": response.model,
        "baseUrl": settings.base_url,
        "response": response.choices[0].message.content,
        "usage": {
            "promptTokens": usage.prompt_tokens if usage else None,
            "completionTokens": usage.completion_tokens if usage else None,
            "totalTokens": usage.total_tokens if usage else None,
        },
    }


if __name__ == "__main__":
    try:
        print(json.dumps(run_connectivity_test(), ensure_ascii=False, indent=2))
    except Exception as exc:
        print(
            json.dumps(
                {"ok": False, "errorType": type(exc).__name__, "error": str(exc)},
                ensure_ascii=False,
                indent=2,
            )
        )
        raise SystemExit(1) from exc
