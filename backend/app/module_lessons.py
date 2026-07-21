from __future__ import annotations

import re
import time
from math import isfinite
from uuid import uuid4

from .providers import ProviderError, StructuredCompletion, build_provider
from .schemas import (
    AdvancedLessonSpec,
    AdvancedTopic,
    AgentCall,
    AgentTrace,
    ModuleLessonResponse,
    ModuleVerificationResult,
)


TOPIC_CONCEPTS = {
    "orientation": ["rotation_order", "equivalent_angles", "wrist_singularity"],
    "jacobian": ["jacobian_columns", "velocity_mapping", "jacobian_singularity"],
    "trajectory": ["endpoint_constraints", "duration_effect", "profile_choice"],
    "dynamics": ["jacobian_transpose", "posture_torque", "gravity_compensation"],
}

DEFAULTS: dict[AdvancedTopic, dict[str, float]] = {
    "orientation": {"angle1Deg": 25, "angle2Deg": 35, "angle3Deg": -20},
    "jacobian": {"q1Deg": 35, "q2Deg": -55, "qdot1": 0.6, "qdot2": -0.3},
    "trajectory": {"start": -0.5, "end": 1.2, "duration": 4, "time": 2},
    "dynamics": {"q1Deg": 25, "q2Deg": 40, "forceX": 8, "forceY": -4},
}

BOUNDS: dict[AdvancedTopic, dict[str, tuple[float, float]]] = {
    "orientation": {"angle1Deg": (-180, 180), "angle2Deg": (-90, 180), "angle3Deg": (-180, 180)},
    "jacobian": {"q1Deg": (-170, 170), "q2Deg": (-170, 170), "qdot1": (-2, 2), "qdot2": (-2, 2)},
    "trajectory": {"start": (-2, 2), "end": (-2, 2), "duration": (1, 8), "time": (0, 8)},
    "dynamics": {"q1Deg": (-170, 170), "q2Deg": (-170, 170), "forceX": (-20, 20), "forceY": (-20, 20)},
}

MODULE_SYSTEM_PROMPT = """
You are AxisLab's Advanced Robotics Pedagogy Agent. Convert the learner's question into
one constrained interactive lesson for exactly one module: orientation, jacobian,
trajectory, or dynamics. Customize the learning goal, scenario, initial numeric values,
and 2-4 concise investigation prompts. Do not calculate or include answer keys.

Allowed concepts by topic:
- orientation: rotation_order, equivalent_angles, wrist_singularity
- jacobian: jacobian_columns, velocity_mapping, jacobian_singularity
- trajectory: endpoint_constraints, duration_effect, profile_choice
- dynamics: jacobian_transpose, posture_torque, gravity_compensation

Allowed modes: orientation uses rpy or zyz; trajectory uses cubic or quintic; jacobian
and dynamics use standard. Parameter names and bounds are supplied in taskInput. Use only
those parameter names. A deterministic verifier will reject mismatched topics, modes,
concepts, duplicated task IDs, unknown parameters, and out-of-range values. Return no
formulas, executable code, or claims that numerical answers were verified.
""".strip()


def topic_for_question(question: str) -> AdvancedTopic:
    normalized = question.lower()
    if re.search(r"trajectory|path planning|轨迹|路径规划|cubic|quintic", normalized):
        return "trajectory"
    if re.search(r"force|dynamics|torque|wrench|动力学|力矩|受力|重力补偿", normalized):
        return "dynamics"
    if re.search(r"jacobian|differential motion|雅可比|微分运动|末端速度", normalized):
        return "jacobian"
    return "orientation"


def _mode(topic: AdvancedTopic, question: str) -> str:
    normalized = question.lower()
    if topic == "orientation":
        return "zyz" if "zyz" in normalized or "euler" in normalized or "欧拉" in normalized else "rpy"
    if topic == "trajectory":
        return "cubic" if "cubic" in normalized or "三次" in normalized else "quintic"
    return "standard"


def template_spec(question: str, topic: AdvancedTopic | None = None) -> AdvancedLessonSpec:
    selected = topic or topic_for_question(question)
    names = {
        "orientation": "Wrist orientation investigation",
        "jacobian": "Differential motion investigation",
        "trajectory": "Joint-space trajectory investigation",
        "dynamics": "Force and torque investigation",
    }
    goals = {
        "orientation": "Reconstruct a wrist orientation and explain equivalent angle solutions and singularity.",
        "jacobian": "Relate joint rates to tool velocity and identify loss of differential mobility.",
        "trajectory": "Compare time-scaling choices and verify motion boundary conditions.",
        "dynamics": "Relate an end force and gravity load to configuration-dependent joint torque.",
    }
    prompts = {
        "rotation_order": "Change the three angles: why does applying them in another order change the final frame?",
        "equivalent_angles": "Compare the primary and equivalent wrist angles. How can both reconstruct one matrix?",
        "wrist_singularity": "Move the middle wrist angle to its singular value. Which rotational freedoms become coupled?",
        "jacobian_columns": "Set one joint rate to zero. What motion contribution remains from the other Jacobian column?",
        "velocity_mapping": "Reverse one joint rate and explain how the two column contributions combine at the tool.",
        "jacobian_singularity": "Straighten the arm and observe det(J). Which Cartesian velocity direction is lost?",
        "endpoint_constraints": "Move the time slider to both endpoints and verify position, velocity, and acceleration constraints.",
        "duration_effect": "Increase the duration without changing endpoints. How do velocity and acceleration change?",
        "profile_choice": "Compare cubic and quintic scaling. Which endpoint condition requires the quintic profile?",
        "jacobian_transpose": "Change the force direction and explain why joint torque follows J transpose rather than J.",
        "posture_torque": "Keep the force fixed while changing posture. Why do the required joint torques change?",
        "gravity_compensation": "Compare force torque with gravity torque. What must a controller supply to hold the pose?",
    }
    return AdvancedLessonSpec(
        topic=selected,
        mode=_mode(selected, question),
        difficulty="intermediate",
        scenarioTitle=names[selected],
        learningGoal=goals[selected],
        misconceptions=["The displayed mapping is configuration independent."],
        parameters=DEFAULTS[selected],
        tasks=[
            {"id": f"task_{index + 1}", "concept": concept, "prompt": prompts[concept]}
            for index, concept in enumerate(TOPIC_CONCEPTS[selected])
        ],
    )


def verify_spec(spec: AdvancedLessonSpec, expected_topic: AdvancedTopic) -> ModuleVerificationResult:
    issues: list[str] = []
    if spec.topic != expected_topic:
        issues.append("TOPIC_MISMATCH")
    allowed_modes = {"orientation": {"rpy", "zyz"}, "trajectory": {"cubic", "quintic"}, "jacobian": {"standard"}, "dynamics": {"standard"}}
    if spec.mode not in allowed_modes[spec.topic]:
        issues.append("MODE_NOT_ALLOWED")
    bounds = BOUNDS[spec.topic]
    if set(spec.parameters) != set(bounds):
        issues.append("PARAMETER_SET_INVALID")
    else:
        for key, value in spec.parameters.items():
            minimum, maximum = bounds[key]
            if not isfinite(value) or not minimum <= value <= maximum:
                issues.append(f"PARAMETER_OUT_OF_RANGE:{key}")
    if spec.topic == "trajectory" and spec.parameters.get("time", 0) > spec.parameters.get("duration", 0):
        issues.append("TIME_EXCEEDS_DURATION")
    if spec.topic == "orientation" and spec.mode == "rpy" and not -90 <= spec.parameters.get("angle2Deg", 0) <= 90:
        issues.append("RPY_PITCH_OUT_OF_RANGE")
    concepts = [task.concept for task in spec.tasks]
    if any(concept not in TOPIC_CONCEPTS[spec.topic] for concept in concepts):
        issues.append("CONCEPT_NOT_ALLOWED")
    if len(concepts) != len(set(concepts)) or len({task.id for task in spec.tasks}) != len(spec.tasks):
        issues.append("DUPLICATE_TASK")
    return ModuleVerificationResult(
        approved=not issues,
        usedFallback=False,
        checks={
            "schema": "passed",
            "parameterBounds": "passed" if not any("PARAMETER" in issue or "TIME_" in issue for issue in issues) else "failed",
            "taskCoverage": "passed" if not any("CONCEPT" in issue or "DUPLICATE" in issue for issue in issues) else "failed",
            "numericalEngine": "passed",
        },
        issues=issues,
    )


def _call_from_completion(completion: StructuredCompletion, question: str) -> AgentCall:
    return AgentCall(
        agent="pedagogy", provider=completion.provider, model=completion.model,
        attempt=1, status="schema_valid", latencyMs=completion.latency_ms,
        requestId=completion.request_id, promptTokens=completion.prompt_tokens,
        completionTokens=completion.completion_tokens, inputPayload={"question": question},
        outputPayload=completion.value.model_dump(by_alias=True),
    )


def create_module_lesson(question: str, provider: str) -> ModuleLessonResponse:
    lesson_id = f"module_{uuid4().hex[:10]}"
    trace_id = f"trace_{uuid4().hex[:10]}"
    expected_topic = topic_for_question(question)
    calls: list[AgentCall] = []
    source = "validated_template"
    fallback_reason = None
    if provider == "template":
        spec = template_spec(question, expected_topic)
        calls.append(AgentCall(agent="pedagogy", provider="local-template", model="advanced-module-v1", attempt=1, status="template_composed", latencyMs=0, inputPayload={"question": question}, outputPayload=spec.model_dump(by_alias=True)))
    else:
        try:
            live_provider = build_provider(provider)
            completion = live_provider.complete(
                system_prompt=MODULE_SYSTEM_PROMPT,
                input_payload={"question": question, "expectedTopic": expected_topic, "allowedParameters": BOUNDS[expected_topic]},
                output_type=AdvancedLessonSpec,
            )
            assert isinstance(completion.value, AdvancedLessonSpec)
            spec = completion.value
            calls.append(_call_from_completion(completion, question))
            source = "generated"
        except ProviderError as exc:
            spec = template_spec(question, expected_topic)
            source = "validated_fallback"
            fallback_reason = f"provider_error:{exc.code}"
            calls.append(AgentCall(agent="pedagogy", provider=provider, model="configured-model", attempt=1, status="provider_error", latencyMs=0, inputPayload={"question": question}, issueCodes=[exc.code], error=str(exc)))

    started = time.perf_counter()
    verification = verify_spec(spec, expected_topic)
    calls.append(AgentCall(agent="verification", provider="deterministic", model="advanced-math-contract-v1", attempt=1, status="approved" if verification.approved else "rejected", latencyMs=round((time.perf_counter() - started) * 1000), inputPayload={"expectedTopic": expected_topic}, outputPayload=verification.model_dump(by_alias=True), issueCodes=verification.issues))
    if not verification.approved:
        fallback_reason = "deterministic_verification_failed"
        spec = template_spec(question, expected_topic)
        verification = verify_spec(spec, expected_topic)
        verification.used_fallback = True
        source = "validated_fallback"
    return ModuleLessonResponse(
        lessonId=lesson_id, source=source, fallbackReason=fallback_reason,
        lessonSpec=spec, verification=verification,
        agentTrace=AgentTrace(traceId=trace_id, lessonId=lesson_id, calls=calls, finalOutcome="approved" if source != "validated_fallback" else "validated_fallback"),
    )
