from __future__ import annotations

import re
import time
from typing import Any
from uuid import uuid4

from .agents import (
    EnvironmentProposal,
    PedagogyProposal,
    lesson_from_pedagogy,
    run_environment_agent,
    run_pedagogy_agent,
)
from .providers import ProviderError, StructuredCompletion, build_provider
from .schemas import (
    ActivitySpec,
    AgentCall,
    AgentTrace,
    LessonResponse,
    RoboticsSceneSpec,
    RobotSpec,
    VerificationChecks,
    VerificationIssue,
    VerificationResult,
)
from .templates import (
    SUPPORTED_TEMPLATE_IDS,
    default_activity,
    default_lesson,
    default_robot,
    default_scene,
    template_bundle,
)
from .validation import validate_activity, validate_lesson_package


SUPPORTED_PATTERNS = (
    r"\btheta\b",
    r"\\theta",
    r"\bdh\b",
    r"canadarm",
    r"revolute",
    r"prismatic",
    r"旋转关节",
    r"移动关节",
    r"平移关节",
)


def _supports(question: str) -> bool:
    return any(re.search(pattern, question, re.IGNORECASE) for pattern in SUPPORTED_PATTERNS)


def _template_for_question(question: str) -> str:
    compact = question.lower().replace(" ", "")
    if any(marker in compact for marker in ("3r+1p", "3r1p", "3r＋1p", "三个r一个p", "3个r1个p")):
        return "serial_3r1p"
    if any(marker in compact for marker in ("2r+1p", "2r1p", "2r＋1p", "两个r一个p", "2个r1个p")):
        return "serial_2r1p"
    return "canadarm_d1_vs_theta2"


def _agent_call(
    agent: str,
    attempt: int,
    status: str,
    input_payload: dict[str, Any],
    completion: StructuredCompletion,
) -> AgentCall:
    return AgentCall(
        agent=agent,
        provider=completion.provider,
        model=completion.model,
        attempt=attempt,
        status=status,
        latencyMs=completion.latency_ms,
        requestId=completion.request_id,
        promptTokens=completion.prompt_tokens,
        completionTokens=completion.completion_tokens,
        inputPayload=input_payload,
        outputPayload=completion.value.model_dump(by_alias=True),
    )


def _error_call(
    agent: str,
    attempt: int,
    input_payload: dict[str, Any],
    error: ProviderError,
) -> AgentCall:
    return AgentCall(
        agent=agent,
        provider="qwen",
        model="configured-model",
        attempt=attempt,
        status="provider_error",
        latencyMs=0,
        inputPayload=input_payload,
        issueCodes=[error.code],
        error=str(error),
    )


def _verification_call(
    attempt: int,
    template_id: str,
    result: VerificationResult,
    latency_ms: int,
) -> AgentCall:
    return AgentCall(
        agent="verification",
        provider="deterministic",
        model="schema-rules-kinematics-v2",
        attempt=attempt,
        status="approved" if result.approved else "rejected",
        latencyMs=latency_ms,
        inputPayload={"templateId": template_id},
        outputPayload=result.model_dump(by_alias=True),
        issueCodes=[issue.code for issue in result.issues],
    )


def _compilation_rejection(error: ValueError) -> VerificationResult:
    detail = str(error)
    code = detail.split(":", 1)[0] if ":" in detail else "ENVIRONMENT_COMPILE_ERROR"
    return VerificationResult(
        approved=False,
        usedFallback=False,
        checks=VerificationChecks(
            schema="failed",
            rules="failed",
            kinematics="not_run",
            renderability="not_run",
            pedagogy="passed",
        ),
        issues=[
            VerificationIssue(
                source="rules",
                code=code,
                path="jointSequence",
                message=detail,
                suggestedFix=(
                    "Return an ordered mixed sequence containing 2-8 revolute/prismatic joints."
                ),
            )
        ],
    )


def _compile_environment(
    pedagogy: PedagogyProposal,
    proposal: EnvironmentProposal,
):
    if proposal.joint_sequence:
        return _compile_custom_environment(pedagogy, proposal)

    template_id = proposal.template_id
    if template_id in SUPPORTED_TEMPLATE_IDS:
        _, robot, activity, scene = template_bundle(template_id)
    else:
        _, robot, activity, scene = template_bundle("canadarm_d1_vs_theta2")

    lesson = lesson_from_pedagogy(pedagogy, template_id)
    activity = activity.model_copy(
        update={
            "template_id": template_id,
            "editable_parameter_ids": list(proposal.editable_parameter_ids),
            "visible_frames": list(proposal.visible_frames),
        }
    )
    scene_lesson = scene.lesson.model_copy(
        update={
            "activity_template": template_id,
            "controls": list(proposal.editable_parameter_ids),
            "overlays": list(proposal.overlays),
        }
    )
    scene = scene.model_copy(update={"lesson": scene_lesson})
    return lesson, robot, activity, scene


def _compile_custom_environment(
    pedagogy: PedagogyProposal,
    proposal: EnvironmentProposal,
):
    """Compile an Agent-selected topology into safe, deterministic standard-DH data.

    The model selects only the ordered R/P topology. Geometry, variable identifiers,
    units, limits and activity wiring remain owned by trusted application code.
    """
    sequence = list(proposal.joint_sequence)
    if not 2 <= len(sequence) <= 8:
        raise ValueError("CUSTOM_JOINT_COUNT: custom chains require 2-8 joints")
    revolute_count = sequence.count("revolute")
    prismatic_count = sequence.count("prismatic")
    if revolute_count == 0 or prismatic_count == 0:
        raise ValueError(
            "CUSTOM_MIXED_TOPOLOGY_REQUIRED: the current learning UI requires at least one revolute and one prismatic joint"
        )
    template_id = proposal.template_id
    if not template_id.startswith("custom_"):
        template_id = f"custom_{revolute_count}r{prismatic_count}p"

    joints: list[dict[str, Any]] = []
    controls: list[str] = []
    for index, joint_type in enumerate(sequence, start=1):
        joint_id = f"joint_{index}"
        if joint_type == "revolute":
            parameter_id = f"{joint_id}.theta"
            joints.append(
                {
                    "id": joint_id,
                    "type": "revolute",
                    "a": 1.5,
                    "alpha": 0.0,
                    "d": 0.0,
                    "theta": {
                        "parameterId": parameter_id,
                        "variable": f"q{index}",
                        "default": 0.25 if index % 2 else -0.25,
                        "min": -3.1416,
                        "max": 3.1416,
                        "unit": "rad",
                    },
                }
            )
        else:
            parameter_id = f"{joint_id}.d"
            joints.append(
                {
                    "id": joint_id,
                    "type": "prismatic",
                    "a": 0.0,
                    "alpha": 0.0,
                    "d": {
                        "parameterId": parameter_id,
                        "variable": f"q{index}",
                        "default": 0.8,
                        "min": 0.2,
                        "max": 2.0,
                        "unit": "m",
                    },
                    "theta": 0.0,
                }
            )
        controls.append(parameter_id)

    robot = RobotSpec.model_validate(
        {
            "version": "1.0",
            "convention": "standard_dh",
            "templateId": template_id,
            "name": proposal.robot_name,
            "lengthUnit": "m",
            "angleUnit": "rad",
            "joints": joints,
        }
    )
    steps: list[dict[str, Any]] = []
    for index, parameter_id in enumerate(controls, start=1):
        steps.extend(
            [
                {
                    "id": f"predict_joint_{index}",
                    "type": "prediction",
                    "parameterId": parameter_id,
                    "answerType": "multiple_choice",
                    "instruction": f"Predict the motion caused by {parameter_id}.",
                },
                {
                    "id": f"interact_joint_{index}",
                    "type": "interaction",
                    "parameterId": parameter_id,
                    "completionRule": "parameter_changed",
                },
            ]
        )
    steps.append(
        {
            "id": "explain_chain",
            "type": "explanation",
            "answerType": "free_text",
            "prompt": "Explain how the ordered revolute and prismatic joints move the serial chain.",
        }
    )
    activity = ActivitySpec.model_validate(
        {
            "version": "1.0",
            "templateId": template_id,
            "editableParameterIds": controls,
            "visibleFrames": list(range(len(sequence) + 1)),
            "matrixHighlightMode": "direct_and_propagated",
            "steps": steps,
        }
    )
    overlays = list(proposal.overlays) or [
        "joint_labels",
        "dh_frames",
        "joint_axes",
        "dh_table",
        "transform_matrix",
        "end_effector_pose",
    ]
    scene = RoboticsSceneSpec.model_validate(
        {
            "version": "1.0",
            "visualPreset": "dh_chain",
            "topic": "forward_kinematics",
            "modelSource": "problem_extracted",
            "robot": {"representation": "standard_dh", "templateId": template_id},
            "lesson": {
                "activityTemplate": template_id,
                "controls": controls,
                "overlays": overlays,
            },
        }
    )
    lesson = lesson_from_pedagogy(pedagogy, template_id)
    return lesson, robot, activity, scene


def _fallback_response(
    *,
    lesson_id: str,
    trace_id: str,
    calls: list[AgentCall],
    reason: str,
) -> LessonResponse:
    lesson = default_lesson(confidence=0.35)
    robot = default_robot()
    activity = default_activity()
    scene = default_scene("teaching_template")
    verification = validate_activity(robot, activity)
    verification.used_fallback = True
    return LessonResponse(
        lessonId=lesson_id,
        source="validated_fallback",
        fallbackReason=reason,
        lessonSpec=lesson,
        robotSpec=robot,
        activitySpec=activity,
        sceneSpec=scene,
        verification=verification,
        agentTrace=AgentTrace(
            traceId=trace_id,
            lessonId=lesson_id,
            calls=calls,
            finalOutcome="validated_fallback",
        ),
    )


def _create_template_lesson(question: str, lesson_id: str, trace_id: str) -> LessonResponse:
    supported = _supports(question) or any(
        marker in question.lower().replace(" ", "")
        for marker in ("2r+1p", "2r1p", "3r+1p", "3r1p", "2r＋1p", "3r＋1p")
    )
    template_id = _template_for_question(question)
    lesson, robot, activity, scene = template_bundle(template_id)
    if not supported:
        lesson = default_lesson(confidence=0.35)
        robot, activity, scene = default_robot(), default_activity(), default_scene()
    calls: list[AgentCall] = [
        AgentCall(
            agent="pedagogy",
            provider="local-template",
            model="deterministic-v1",
            attempt=1,
            status="supported_intent" if supported else "fallback_intent",
            latencyMs=0,
            inputPayload={"question": question},
            outputPayload=lesson.model_dump(by_alias=True),
        ),
        AgentCall(
            agent="environment",
            provider="local-template",
            model="template-registry-v1",
            attempt=1,
            status="template_composed",
            latencyMs=0,
            inputPayload={"templateId": template_id},
            outputPayload={"templateId": robot.template_id},
        ),
    ]
    started = time.perf_counter()
    verification = validate_activity(robot, activity)
    calls.append(
        _verification_call(
            1,
            robot.template_id,
            verification,
            round((time.perf_counter() - started) * 1000),
        )
    )
    verification.used_fallback = not supported
    return LessonResponse(
        lessonId=lesson_id,
        source="validated_template" if supported else "validated_fallback",
        fallbackReason=None if supported else "unsupported_or_low_confidence_intent",
        lessonSpec=lesson,
        robotSpec=robot,
        activitySpec=activity,
        sceneSpec=scene,
        verification=verification,
        agentTrace=AgentTrace(
            traceId=trace_id,
            lessonId=lesson_id,
            calls=calls,
            finalOutcome="approved" if supported else "validated_fallback",
        ),
    )


def create_lesson(question: str, provider: str) -> LessonResponse:
    lesson_id = f"lesson_{uuid4().hex[:10]}"
    trace_id = f"trace_{uuid4().hex[:10]}"
    if provider == "template":
        return _create_template_lesson(question, lesson_id, trace_id)

    calls: list[AgentCall] = []
    try:
        live_provider = build_provider(provider)
    except ProviderError as exc:
        calls.append(_error_call("pedagogy", 1, {"question": question}, exc))
        return _fallback_response(
            lesson_id=lesson_id,
            trace_id=trace_id,
            calls=calls,
            reason=f"provider_initialization:{exc.code}",
        )

    pedagogy_input = {"question": question}
    try:
        pedagogy, pedagogy_completion = run_pedagogy_agent(live_provider, question)
        calls.append(
            _agent_call(
                "pedagogy", 1, "schema_valid", pedagogy_input, pedagogy_completion
            )
        )
    except ProviderError as exc:
        calls.append(_error_call("pedagogy", 1, pedagogy_input, exc))
        return _fallback_response(
            lesson_id=lesson_id,
            trace_id=trace_id,
            calls=calls,
            reason=f"pedagogy_provider_error:{exc.code}",
        )

    if not pedagogy.supported:
        return _fallback_response(
            lesson_id=lesson_id,
            trace_id=trace_id,
            calls=calls,
            reason="unsupported_or_low_confidence_intent",
        )

    verification: VerificationResult | None = None
    package = None
    for attempt in (1, 2):
        issue_payload = (
            [issue.model_dump(by_alias=True) for issue in verification.issues]
            if verification is not None
            else None
        )
        environment_input = {
            "pedagogyProposal": pedagogy.model_dump(by_alias=True),
            "verificationIssues": issue_payload or [],
        }
        try:
            environment, completion = run_environment_agent(
                live_provider,
                pedagogy,
                attempt=attempt,
                verification_issues=issue_payload,
            )
            calls.append(
                _agent_call(
                    "environment",
                    attempt,
                    "schema_valid" if attempt == 1 else "revision_schema_valid",
                    environment_input,
                    completion,
                )
            )
        except ProviderError as exc:
            calls.append(_error_call("environment", attempt, environment_input, exc))
            return _fallback_response(
                lesson_id=lesson_id,
                trace_id=trace_id,
                calls=calls,
                reason=f"environment_provider_error:{exc.code}",
            )

        try:
            package = _compile_environment(pedagogy, environment)
        except ValueError as exc:
            verification = _compilation_rejection(exc)
            calls.append(
                _verification_call(attempt, environment.template_id, verification, 0)
            )
            continue
        lesson, robot, activity, scene = package
        started = time.perf_counter()
        verification = validate_lesson_package(lesson, robot, activity, scene)
        calls.append(
            _verification_call(
                attempt,
                environment.template_id,
                verification,
                round((time.perf_counter() - started) * 1000),
            )
        )
        if verification.approved:
            return LessonResponse(
                lessonId=lesson_id,
                source="generated" if attempt == 1 else "generated_revised",
                lessonSpec=lesson,
                robotSpec=robot,
                activitySpec=activity,
                sceneSpec=scene,
                verification=verification,
                agentTrace=AgentTrace(
                    traceId=trace_id,
                    lessonId=lesson_id,
                    calls=calls,
                    finalOutcome="approved" if attempt == 1 else "approved_after_revision",
                ),
            )

    assert verification is not None
    return _fallback_response(
        lesson_id=lesson_id,
        trace_id=trace_id,
        calls=calls,
        reason="verification_failed_after_revision",
    )
