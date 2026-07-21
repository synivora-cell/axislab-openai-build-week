from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from .providers import QwenStructuredProvider, StructuredCompletion
from .schemas import APIModel, LessonSpec
from .templates import SUPPORTED_TEMPLATE_IDS


class PedagogyProposal(APIModel):
    supported: bool
    intent: str = Field(min_length=1, max_length=300)
    confidence: float = Field(ge=0.0, le=1.0)
    learning_goal: str = Field(alias="learningGoal", min_length=1, max_length=600)
    misconceptions: list[str] = Field(min_length=1, max_length=4)
    required_observations: list[str] = Field(
        alias="requiredObservations", min_length=1, max_length=4
    )
    success_evidence: list[str] = Field(
        alias="successEvidence", min_length=1, max_length=4
    )
    recommended_template: str = Field(alias="recommendedTemplate")
    support_reason: str = Field(alias="supportReason", min_length=1, max_length=600)


class EnvironmentProposal(APIModel):
    template_id: str = Field(alias="templateId", min_length=1, max_length=80)
    editable_parameter_ids: list[str] = Field(alias="editableParameterIds")
    visible_frames: list[int] = Field(alias="visibleFrames")
    overlays: list[
        Literal[
            "joint_labels",
            "dh_frames",
            "joint_axes",
            "symbolic_dimensions",
            "dh_table",
            "transform_matrix",
            "end_effector_pose",
        ]
    ]
    joint_sequence: list[Literal["revolute", "prismatic"]] = Field(
        default_factory=list,
        alias="jointSequence",
        max_length=8,
        description=(
            "Ordered joint types for a custom standard-DH chain. Leave empty when "
            "selecting a registered template. Custom chains require 2-8 joints."
        ),
    )
    robot_name: str = Field(
        default="Generated standard-DH robot",
        alias="robotName",
        min_length=1,
        max_length=120,
    )
    rationale: str = Field(min_length=1, max_length=2000)


PEDAGOGY_SYSTEM_PROMPT = """
You are AxisLab's Pedagogy Agent. Analyze only introductory standard-DH forward-kinematics
questions. Identify the learning goal, likely misconceptions, observable success evidence,
and recommend one allow-listed activity template. Unsupported topics such as dynamics,
inverse kinematics, collision simulation, or unrelated subjects must set supported=false.
Never generate code or claim that an unsupported topic is supported.

IMPORTANT: A request for any ordered mixed serial topology containing 2-8 revolute and
prismatic joints IS supported when it asks for standard-DH or forward kinematics. Set
supported=true and recommendedTemplate=custom_dh when it does not exactly match a registered
template. For example, "one revolute followed by three prismatic joints" and
"第一个旋转关节，后面三个移动关节" are supported custom_dh requests.

Allow-listed templates:
- canadarm_d1_vs_theta2: compare prismatic d_1 with revolute theta_2
- serial_2r1p: explore a standard-DH chain containing 2 revolute and 1 prismatic joint
- serial_3r1p: explore a standard-DH chain containing 3 revolute and 1 prismatic joint
- custom_dh: use when the requested ordered R/P topology is not one of the exact
  templates above; supports a mixed serial chain of 2-8 joints
""".strip()


ENVIRONMENT_SYSTEM_PROMPT = """
You are AxisLab's Environment Agent. Select and configure exactly one allow-listed,
human-reviewed robotics activity. You may choose controls, visible frames, and overlays,
but may not invent robot geometry, execute code, or reference parameters outside the
selected template. A deterministic verifier will reject invalid proposals.

Template catalog:
- canadarm_d1_vs_theta2: controls [joint_1.d, joint_2.theta], frames [0,1,2]
- serial_2r1p: controls [joint_1.d, joint_2.theta, joint_3.theta], frames [0,1,2,3]
- serial_3r1p: controls [joint_1.d, joint_2.theta, joint_3.theta, joint_4.theta], frames [0,1,2,3,4]

For any other requested mixed R/P topology, set templateId to a descriptive ID beginning
with custom_ and put the exact ordered joint types in jointSequence. A custom sequence must
contain 2-8 items and at least one revolute and one prismatic joint. For custom chains,
editableParameterIds and visibleFrames are advisory because deterministic code derives all
joint variables and frames. Never invent executable code or arbitrary geometry. If only
joint counts are supplied and order is ambiguous, preserve the order in which joint types
are mentioned by the learner.
""".strip()


def run_pedagogy_agent(
    provider: QwenStructuredProvider, question: str
) -> tuple[PedagogyProposal, StructuredCompletion]:
    completion = provider.complete(
        system_prompt=PEDAGOGY_SYSTEM_PROMPT,
        input_payload={"question": question, "supportedTemplates": list(SUPPORTED_TEMPLATE_IDS)},
        output_type=PedagogyProposal,
    )
    assert isinstance(completion.value, PedagogyProposal)
    return completion.value, completion


def run_environment_agent(
    provider: QwenStructuredProvider,
    pedagogy: PedagogyProposal,
    *,
    attempt: int,
    verification_issues: list[dict[str, Any]] | None = None,
) -> tuple[EnvironmentProposal, StructuredCompletion]:
    payload: dict[str, Any] = {
        "pedagogyProposal": pedagogy.model_dump(by_alias=True),
        "attempt": attempt,
        "supportedTemplates": list(SUPPORTED_TEMPLATE_IDS),
    }
    if verification_issues:
        payload["verificationIssues"] = verification_issues
        payload["revisionInstruction"] = (
            "Correct every verification issue. This is the only permitted revision attempt."
        )
    completion = provider.complete(
        system_prompt=ENVIRONMENT_SYSTEM_PROMPT,
        input_payload=payload,
        output_type=EnvironmentProposal,
    )
    assert isinstance(completion.value, EnvironmentProposal)
    return completion.value, completion


def lesson_from_pedagogy(
    proposal: PedagogyProposal, template_id: str
) -> LessonSpec:
    return LessonSpec(
        intent=proposal.intent,
        confidence=proposal.confidence,
        learningGoal=proposal.learning_goal,
        misconceptions=proposal.misconceptions,
        requiredObservations=proposal.required_observations,
        activityTemplateId=template_id,
        difficulty="introductory",
        successEvidence=proposal.success_evidence,
    )
