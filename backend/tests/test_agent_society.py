from __future__ import annotations

from collections.abc import Iterator

import pytest

from app.agents import EnvironmentProposal, PedagogyProposal
from app.feedback import generate_feedback
from app.orchestrator import create_lesson
from app.providers import ProviderError, StructuredCompletion
from app.schemas import InteractionEvent


def pedagogy_proposal(*, supported: bool = True) -> PedagogyProposal:
    return PedagogyProposal.model_validate(
        {
            "supported": supported,
            "intent": "compare_standard_dh_joint_variables",
            "confidence": 0.94,
            "learningGoal": "Distinguish prismatic and revolute standard-DH variables.",
            "misconceptions": ["theta and d describe the same motion"],
            "requiredObservations": ["d translates while theta rotates"],
            "successEvidence": ["compares motion type and axis"],
            "recommendedTemplate": "canadarm_d1_vs_theta2",
            "supportReason": "The question is an introductory standard-DH comparison.",
        }
    )


def environment_proposal(*, valid: bool = True) -> EnvironmentProposal:
    return EnvironmentProposal.model_validate(
        {
            "templateId": "canadarm_d1_vs_theta2",
            "editableParameterIds": (
                ["joint_1.d", "joint_2.theta"] if valid else ["invented.parameter"]
            ),
            "visibleFrames": [0, 1, 2],
            "overlays": [
                "joint_labels",
                "dh_frames",
                "joint_axes",
                "dh_table",
                "transform_matrix",
                "end_effector_pose",
            ],
            "rationale": "Expose the two variables while retaining deterministic geometry.",
        }
    )


def custom_environment_proposal(
    sequence: list[str] | None = None,
) -> EnvironmentProposal:
    return EnvironmentProposal.model_validate(
        {
            "templateId": "custom_1r3p",
            "editableParameterIds": [],
            "visibleFrames": [],
            "overlays": [
                "joint_labels",
                "dh_frames",
                "joint_axes",
                "dh_table",
                "transform_matrix",
                "end_effector_pose",
            ],
            "jointSequence": sequence
            if sequence is not None
            else ["revolute", "prismatic", "prismatic", "prismatic"],
            "robotName": "Generated 1R3P arm",
            "rationale": "The requested topology is not a registered template.",
        }
    )


class FakeProvider:
    def __init__(self, values: list[object]) -> None:
        self._values: Iterator[object] = iter(values)

    def complete(self, **_: object) -> StructuredCompletion:
        value = next(self._values)
        if isinstance(value, ProviderError):
            raise value
        assert isinstance(value, (PedagogyProposal, EnvironmentProposal))
        return StructuredCompletion(
            value=value,
            provider="qwen-cloud",
            model="test-qwen",
            latency_ms=12,
            request_id="test-request",
            prompt_tokens=20,
            completion_tokens=10,
        )


def install_provider(monkeypatch: pytest.MonkeyPatch, values: list[object]) -> None:
    monkeypatch.setattr(
        "app.orchestrator.build_provider", lambda _: FakeProvider(values)
    )


def test_live_agent_society_approves_first_proposal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install_provider(monkeypatch, [pedagogy_proposal(), environment_proposal()])
    lesson = create_lesson("Explain d and theta in standard DH", "qwen")

    assert lesson.source == "generated"
    assert lesson.agent_trace.final_outcome == "approved"
    assert [call.agent for call in lesson.agent_trace.calls] == [
        "pedagogy",
        "environment",
        "verification",
    ]
    assert lesson.agent_trace.calls[0].prompt_tokens == 20


def test_environment_is_revised_once_after_deterministic_rejection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install_provider(
        monkeypatch,
        [pedagogy_proposal(), environment_proposal(valid=False), environment_proposal()],
    )
    lesson = create_lesson("Explain d and theta in standard DH", "qwen")

    assert lesson.source == "generated_revised"
    assert lesson.agent_trace.final_outcome == "approved_after_revision"
    assert [call.status for call in lesson.agent_trace.calls] == [
        "schema_valid",
        "schema_valid",
        "rejected",
        "revision_schema_valid",
        "approved",
    ]
    assert "UNKNOWN_PARAMETER" in lesson.agent_trace.calls[2].issue_codes


def test_second_rejection_uses_human_verified_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install_provider(
        monkeypatch,
        [
            pedagogy_proposal(),
            environment_proposal(valid=False),
            environment_proposal(valid=False),
        ],
    )
    lesson = create_lesson("Explain d and theta in standard DH", "qwen")

    assert lesson.source == "validated_fallback"
    assert lesson.fallback_reason == "verification_failed_after_revision"
    assert lesson.verification.approved is True
    assert lesson.verification.used_fallback is True
    assert sum(call.status == "rejected" for call in lesson.agent_trace.calls) == 2


def test_provider_failure_never_blocks_the_learning_activity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install_provider(
        monkeypatch,
        [ProviderError("timeout", "the model timed out")],
    )
    lesson = create_lesson("Explain d and theta in standard DH", "qwen")

    assert lesson.source == "validated_fallback"
    assert lesson.verification.approved is True
    assert lesson.agent_trace.calls[0].status == "provider_error"
    assert lesson.agent_trace.calls[0].issue_codes == ["timeout"]


def test_agent_can_compile_a_custom_1r3p_standard_dh_chain(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pedagogy = pedagogy_proposal()
    pedagogy.recommended_template = "custom_dh"
    install_provider(monkeypatch, [pedagogy, custom_environment_proposal()])

    lesson = create_lesson(
        "Generate a serial robot with one revolute joint followed by three prismatic joints",
        "qwen",
    )

    assert lesson.source == "generated"
    assert lesson.verification.approved is True
    assert [joint.type for joint in lesson.robot_spec.joints] == [
        "revolute",
        "prismatic",
        "prismatic",
        "prismatic",
    ]
    assert lesson.scene_spec.visual_preset == "dh_chain"
    assert lesson.activity_spec.editable_parameter_ids == [
        "joint_1.theta",
        "joint_2.d",
        "joint_3.d",
        "joint_4.d",
    ]

    events: list[InteractionEvent] = []
    sequence = 0
    for step in lesson.activity_spec.steps:
        sequence += 1
        if step.type == "prediction":
            joint = next(
                joint
                for joint in lesson.robot_spec.joints
                if step.parameter_id in {
                    getattr(joint.theta, "parameter_id", None),
                    getattr(joint.d, "parameter_id", None),
                }
            )
            events.append(
                InteractionEvent(
                    eventId=f"event-{sequence}",
                    sequence=sequence,
                    type="prediction_submitted",
                    stepId=step.id,
                    parameterId=step.parameter_id,
                    answer="rotate" if joint.type == "revolute" else "translate",
                    clientTimestamp="2026-07-20T12:00:00Z",
                )
            )
        elif step.type == "interaction":
            events.append(
                InteractionEvent(
                    eventId=f"event-{sequence}",
                    sequence=sequence,
                    type="parameter_changed",
                    stepId=step.id,
                    parameterId=step.parameter_id,
                    from_value=0.5,
                    to_value=0.8,
                    clientTimestamp="2026-07-20T12:00:00Z",
                )
            )
        else:
            events.append(
                InteractionEvent(
                    eventId=f"event-{sequence}",
                    sequence=sequence,
                    type="explanation_submitted",
                    stepId=step.id,
                    answer="The revolute joint creates rotation and each prismatic joint creates translation along its axis.",
                    clientTimestamp="2026-07-20T12:00:00Z",
                )
            )

    feedback = generate_feedback(events, lesson.robot_spec, lesson.activity_spec)
    assert feedback.mastery == "demonstrated"
    assert feedback.score == 100
    assert "1R3P" in feedback.summary
    assert "Canadarm" not in feedback.summary


def test_invalid_custom_topology_gets_one_environment_revision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install_provider(
        monkeypatch,
        [
            pedagogy_proposal(),
            custom_environment_proposal(["revolute"]),
            custom_environment_proposal(),
        ],
    )

    lesson = create_lesson("Generate a custom mixed joint robot", "qwen")

    assert lesson.source == "generated_revised"
    assert "CUSTOM_JOINT_COUNT" in lesson.agent_trace.calls[2].issue_codes
    assert lesson.agent_trace.calls[-1].status == "approved"
