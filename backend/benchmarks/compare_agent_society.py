from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path
from typing import Literal

from pydantic import Field

from app.orchestrator import create_lesson
from app.providers import ProviderError, build_provider
from app.schemas import (
    APIModel,
    ActivitySpec,
    LessonSpec,
    RobotSpec,
    RoboticsSceneSpec,
)
from app.validation import validate_lesson_package


JointType = Literal["revolute", "prismatic"]


class DirectLessonPackage(APIModel):
    """Output contract for the single-agent baseline."""

    lesson_spec: LessonSpec = Field(alias="lessonSpec")
    robot_spec: RobotSpec = Field(alias="robotSpec")
    activity_spec: ActivitySpec = Field(alias="activitySpec")
    scene_spec: RoboticsSceneSpec = Field(alias="sceneSpec")


CASES: list[tuple[str, list[JointType]]] = [
    (
        "Create a standard-DH serial robot with one revolute joint followed by "
        "three prismatic joints.",
        ["revolute", "prismatic", "prismatic", "prismatic"],
    ),
    (
        "Create a standard-DH serial robot with two prismatic joints followed by "
        "two revolute joints.",
        ["prismatic", "prismatic", "revolute", "revolute"],
    ),
    (
        "Create a five-joint standard-DH chain in this exact order: revolute, "
        "prismatic, revolute, prismatic, revolute.",
        ["revolute", "prismatic", "revolute", "prismatic", "revolute"],
    ),
    (
        "Create a six-joint standard-DH chain in this exact order: prismatic, "
        "revolute, revolute, prismatic, revolute, prismatic.",
        [
            "prismatic",
            "revolute",
            "revolute",
            "prismatic",
            "revolute",
            "prismatic",
        ],
    ),
]


SINGLE_AGENT_PROMPT = """
You are the only agent responsible for creating a complete AxisLab introductory
standard-DH learning package. Return lessonSpec, robotSpec, activitySpec, and sceneSpec.
The robot must contain exactly the requested ordered revolute/prismatic topology.
Every revolute joint must expose variable theta in radians with fixed d. Every prismatic
joint must expose variable d in metres with fixed theta. Use unique parameter IDs, wire
every parameter into prediction and interaction steps, include one final explanation
step, and keep scene controls, template IDs, and visible frames consistent. Use the
dh_chain visual preset and never generate executable code. The package will be rejected
unless it passes strict schema, rule, renderability, and forward-kinematics validation.
""".strip()


def _joint_types(robot: RobotSpec) -> list[str]:
    return [joint.type for joint in robot.joints]


def _run_single(question: str, expected: list[JointType]) -> dict[str, object]:
    provider = build_provider("qwen")
    started = time.perf_counter()
    try:
        completion = provider.complete(
            system_prompt=SINGLE_AGENT_PROMPT,
            input_payload={"question": question},
            output_type=DirectLessonPackage,
        )
        package = completion.value
        assert isinstance(package, DirectLessonPackage)
        verification = validate_lesson_package(
            package.lesson_spec,
            package.robot_spec,
            package.activity_spec,
            package.scene_spec,
        )
        actual = _joint_types(package.robot_spec)
        success = verification.approved and actual == expected
        return {
            "success": success,
            "actualJointSequence": actual,
            "approved": verification.approved,
            "issueCodes": [issue.code for issue in verification.issues],
            "latencyMs": completion.latency_ms,
            "promptTokens": completion.prompt_tokens or 0,
            "completionTokens": completion.completion_tokens or 0,
            "error": None,
        }
    except ProviderError as exc:
        return {
            "success": False,
            "actualJointSequence": [],
            "approved": False,
            "issueCodes": [exc.code],
            "latencyMs": round((time.perf_counter() - started) * 1000),
            "promptTokens": 0,
            "completionTokens": 0,
            "error": str(exc),
        }


def _run_society(question: str, expected: list[JointType]) -> dict[str, object]:
    started = time.perf_counter()
    response = create_lesson(question, "qwen")
    qwen_calls = [
        call for call in response.agent_trace.calls if call.provider != "deterministic"
    ]
    actual = _joint_types(response.robot_spec)
    success = (
        response.verification.approved
        and not response.verification.used_fallback
        and actual == expected
    )
    return {
        "success": success,
        "actualJointSequence": actual,
        "approved": response.verification.approved,
        "source": response.source,
        "issueCodes": [
            code for call in response.agent_trace.calls for code in call.issue_codes
        ],
        "latencyMs": round((time.perf_counter() - started) * 1000),
        "promptTokens": sum(call.prompt_tokens or 0 for call in qwen_calls),
        "completionTokens": sum(call.completion_tokens or 0 for call in qwen_calls),
        "agentCalls": len(response.agent_trace.calls),
        "error": response.fallback_reason,
    }


def _summary(rows: list[dict[str, object]], system: str) -> dict[str, object]:
    results = [row[system] for row in rows]
    successes = sum(bool(result["success"]) for result in results)
    latencies = [int(result["latencyMs"]) for result in results]
    token_accounting_complete = all(
        result["error"] is None
        or int(result["promptTokens"]) + int(result["completionTokens"]) > 0
        for result in results
    )
    tokens = sum(
        int(result["promptTokens"]) + int(result["completionTokens"])
        for result in results
    )
    return {
        "cases": len(results),
        "successfulCases": successes,
        "validatedTopologySuccessRate": successes / len(results),
        "medianLatencyMs": round(statistics.median(latencies)),
        "totalTokens": tokens if token_accounting_complete else None,
        "tokenAccounting": (
            "complete"
            if token_accounting_complete
            else "unavailable when the provider response fails JSON/schema parsing"
        ),
        "successfulCasesPer1000Tokens": round(successes / tokens * 1000, 3)
        if tokens and token_accounting_complete
        else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare a direct single Qwen agent with the AxisLab Agent Society."
    )
    parser.add_argument("--output", type=Path, help="Optional JSON output path")
    args = parser.parse_args()

    rows: list[dict[str, object]] = []
    for question, expected in CASES:
        rows.append(
            {
                "question": question,
                "expectedJointSequence": expected,
                "singleAgent": _run_single(question, expected),
                "agentSociety": _run_society(question, expected),
            }
        )

    result = {
        "method": {
            "model": "the Qwen model configured by backend environment variables",
            "cases": "four fixed, ordered mixed R/P topology requests",
            "successDefinition": (
                "The returned joint sequence exactly matches the request and the common "
                "deterministic package verifier approves it without fallback."
            ),
            "singleAgent": "one Qwen call generates the complete lesson package",
            "agentSociety": (
                "Pedagogy and Environment Qwen agents use task-specific contracts; "
                "deterministic Verification may request one structured revision"
            ),
            "limitations": (
                "This is a small one-run engineering benchmark, not a statistical study. "
                "Cloud latency and model output can vary between runs."
            ),
        },
        "summary": {
            "singleAgent": _summary(rows, "singleAgent"),
            "agentSociety": _summary(rows, "agentSociety"),
        },
        "cases": rows,
    }
    rendered = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
