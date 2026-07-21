from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class APIModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class VariableSpec(APIModel):
    parameter_id: str = Field(alias="parameterId")
    variable: str
    default: float
    minimum: float = Field(alias="min")
    maximum: float = Field(alias="max")
    unit: Literal["rad", "m"]

    @model_validator(mode="after")
    def validate_range(self) -> "VariableSpec":
        if self.minimum >= self.maximum:
            raise ValueError("min must be lower than max")
        if not self.minimum <= self.default <= self.maximum:
            raise ValueError("default must be inside [min, max]")
        return self


class JointSpec(APIModel):
    id: str
    type: Literal["revolute", "prismatic"]
    a: float
    alpha: float
    d: float | VariableSpec
    theta: float | VariableSpec

    @model_validator(mode="after")
    def validate_joint_variable(self) -> "JointSpec":
        if self.type == "revolute":
            if not isinstance(self.theta, VariableSpec) or isinstance(self.d, VariableSpec):
                raise ValueError("revolute joints require variable theta and fixed d")
            if self.theta.unit != "rad":
                raise ValueError("revolute theta must use rad")
        else:
            if not isinstance(self.d, VariableSpec) or isinstance(self.theta, VariableSpec):
                raise ValueError("prismatic joints require variable d and fixed theta")
            if self.d.unit != "m":
                raise ValueError("prismatic d must use m")
        return self


class RobotSpec(APIModel):
    version: Literal["1.0"] = "1.0"
    convention: Literal["standard_dh"] = "standard_dh"
    template_id: str = Field(alias="templateId", min_length=1, max_length=80)
    name: str
    length_unit: Literal["m"] = Field(alias="lengthUnit")
    angle_unit: Literal["rad"] = Field(alias="angleUnit")
    joints: list[JointSpec]

    @model_validator(mode="after")
    def validate_robot(self) -> "RobotSpec":
        if not 2 <= len(self.joints) <= 8:
            raise ValueError("only 2-8 serial joints are supported")
        parameter_ids: list[str] = []
        for joint in self.joints:
            variable = joint.theta if joint.type == "revolute" else joint.d
            assert isinstance(variable, VariableSpec)
            parameter_ids.append(variable.parameter_id)
        if len(parameter_ids) != len(set(parameter_ids)):
            raise ValueError("parameterId values must be unique")
        return self


class LessonSpec(APIModel):
    version: Literal["1.0"] = "1.0"
    intent: str = Field(min_length=1, max_length=300)
    confidence: float = Field(ge=0.0, le=1.0)
    learning_goal: str = Field(alias="learningGoal")
    misconceptions: list[str]
    required_observations: list[str] = Field(alias="requiredObservations")
    activity_template_id: str = Field(alias="activityTemplateId", min_length=1, max_length=80)
    difficulty: Literal["introductory"]
    success_evidence: list[str] = Field(alias="successEvidence")


class ActivityStep(APIModel):
    id: str
    type: Literal["prediction", "interaction", "explanation"]
    parameter_id: str | None = Field(default=None, alias="parameterId")
    answer_type: Literal["multiple_choice", "free_text"] | None = Field(
        default=None, alias="answerType"
    )
    instruction: str | None = None
    prompt: str | None = None
    completion_rule: Literal["parameter_changed"] | None = Field(
        default=None, alias="completionRule"
    )

    @model_validator(mode="after")
    def validate_step_shape(self) -> "ActivityStep":
        if self.type in {"prediction", "interaction"} and not self.parameter_id:
            raise ValueError(f"{self.type} requires parameterId")
        if self.type == "prediction" and not self.instruction:
            raise ValueError("prediction requires instruction")
        if self.type == "interaction" and self.completion_rule != "parameter_changed":
            raise ValueError("interaction requires parameter_changed completionRule")
        if self.type == "explanation" and not self.prompt:
            raise ValueError("explanation requires prompt")
        return self


class ActivitySpec(APIModel):
    version: Literal["1.0"] = "1.0"
    template_id: str = Field(alias="templateId", min_length=1, max_length=80)
    editable_parameter_ids: list[str] = Field(alias="editableParameterIds")
    visible_frames: list[int] = Field(alias="visibleFrames")
    matrix_highlight_mode: Literal["direct_and_propagated"] = Field(
        alias="matrixHighlightMode"
    )
    steps: list[ActivityStep]


class SceneRobotSource(APIModel):
    representation: Literal["standard_dh"]
    template_id: str = Field(alias="templateId", min_length=1, max_length=80)


class SceneLessonSpec(APIModel):
    activity_template: str = Field(alias="activityTemplate", min_length=1, max_length=80)
    controls: list[str]
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


class RoboticsSceneSpec(APIModel):
    """Validated renderer entry point; visual modules remain preset-owned."""

    version: Literal["1.0"] = "1.0"
    visual_preset: Literal["canadarm_q5", "dh_chain"] = Field(alias="visualPreset")
    topic: Literal["forward_kinematics"]
    model_source: Literal["teaching_template", "problem_extracted"] = Field(
        alias="modelSource"
    )
    robot: SceneRobotSource
    lesson: SceneLessonSpec


class VerificationIssue(APIModel):
    source: Literal["schema", "rules", "kinematics", "pedagogy", "renderability"]
    code: str
    path: str | None = None
    message: str
    suggested_fix: str | None = Field(default=None, alias="suggestedFix")


CheckStatus = Literal["passed", "failed", "not_run"]


class VerificationChecks(APIModel):
    schema_status: CheckStatus = Field(alias="schema")
    rules: CheckStatus
    kinematics: CheckStatus
    renderability: CheckStatus
    pedagogy: CheckStatus


class VerificationResult(APIModel):
    approved: bool
    used_fallback: bool = Field(alias="usedFallback")
    checks: VerificationChecks
    issues: list[VerificationIssue]


class AgentCall(APIModel):
    agent: Literal["pedagogy", "environment", "verification"]
    provider: str
    model: str
    attempt: int
    status: str
    latency_ms: int = Field(alias="latencyMs")
    request_id: str | None = Field(default=None, alias="requestId")
    prompt_tokens: int | None = Field(default=None, alias="promptTokens")
    completion_tokens: int | None = Field(default=None, alias="completionTokens")
    input_payload: dict[str, Any] | None = Field(default=None, alias="inputPayload")
    output_payload: dict[str, Any] | None = Field(default=None, alias="outputPayload")
    issue_codes: list[str] = Field(default_factory=list, alias="issueCodes")
    error: str | None = None


class AgentTrace(APIModel):
    trace_id: str = Field(alias="traceId")
    lesson_id: str = Field(alias="lessonId")
    calls: list[AgentCall]
    final_outcome: str = Field(alias="finalOutcome")


class LessonCreateRequest(APIModel):
    question: str = Field(min_length=3, max_length=500)
    provider: Literal["template", "qwen", "openai"] = "template"


class SceneCreateRequest(APIModel):
    """Canonical direct input for a JSON-defined standard-DH scene."""

    robot_spec: RobotSpec = Field(alias="robotSpec")
    scene_spec: RoboticsSceneSpec = Field(alias="sceneSpec")


class LessonResponse(APIModel):
    lesson_id: str = Field(alias="lessonId")
    status: Literal["ready"] = "ready"
    source: Literal[
        "validated_template",
        "validated_fallback",
        "validated_json",
        "generated",
        "generated_revised",
    ]
    fallback_reason: str | None = Field(default=None, alias="fallbackReason")
    lesson_spec: LessonSpec = Field(alias="lessonSpec")
    robot_spec: RobotSpec = Field(alias="robotSpec")
    activity_spec: ActivitySpec = Field(alias="activitySpec")
    scene_spec: RoboticsSceneSpec = Field(alias="sceneSpec")
    verification: VerificationResult
    agent_trace: AgentTrace = Field(alias="agentTrace")


AdvancedTopic = Literal["orientation", "jacobian", "trajectory", "dynamics"]
AdvancedConcept = Literal[
    "rotation_order",
    "equivalent_angles",
    "wrist_singularity",
    "jacobian_columns",
    "jacobian_singularity",
    "velocity_mapping",
    "endpoint_constraints",
    "duration_effect",
    "profile_choice",
    "jacobian_transpose",
    "posture_torque",
    "gravity_compensation",
]


class ModuleLessonCreateRequest(APIModel):
    question: str = Field(min_length=3, max_length=500)
    provider: Literal["template", "qwen", "openai"] = "template"


class AdvancedLearningTask(APIModel):
    id: str = Field(min_length=1, max_length=80)
    concept: AdvancedConcept
    prompt: str = Field(min_length=8, max_length=400)


class AdvancedLessonSpec(APIModel):
    version: Literal["1.0"] = "1.0"
    topic: AdvancedTopic
    mode: Literal["rpy", "zyz", "standard", "cubic", "quintic"]
    difficulty: Literal["introductory", "intermediate", "advanced"]
    scenario_title: str = Field(alias="scenarioTitle", min_length=3, max_length=120)
    learning_goal: str = Field(alias="learningGoal", min_length=8, max_length=600)
    misconceptions: list[str] = Field(min_length=1, max_length=4)
    parameters: dict[str, float]
    tasks: list[AdvancedLearningTask] = Field(min_length=2, max_length=4)


class ModuleVerificationResult(APIModel):
    approved: bool
    used_fallback: bool = Field(alias="usedFallback")
    checks: dict[str, Literal["passed", "failed"]]
    issues: list[str]


class ModuleLessonResponse(APIModel):
    lesson_id: str = Field(alias="lessonId")
    status: Literal["ready"] = "ready"
    source: Literal["validated_template", "validated_fallback", "generated"]
    fallback_reason: str | None = Field(default=None, alias="fallbackReason")
    lesson_spec: AdvancedLessonSpec = Field(alias="lessonSpec")
    verification: ModuleVerificationResult
    agent_trace: AgentTrace = Field(alias="agentTrace")


Matrix4 = list[list[float]]


class ValidateStateRequest(APIModel):
    request_sequence: int = Field(alias="requestSequence", ge=0)
    joint_values: dict[str, float] = Field(alias="jointValues")
    client_end_effector_transform: Matrix4 | None = Field(
        default=None, alias="clientEndEffectorTransform"
    )


class StateErrors(APIModel):
    position: float | None
    rotation: float | None


class ValidateStateResponse(APIModel):
    request_sequence: int = Field(alias="requestSequence")
    valid: bool
    joint_transforms: list[Matrix4] = Field(alias="jointTransforms")
    end_effector_transform: Matrix4 = Field(alias="endEffectorTransform")
    errors: StateErrors


class InteractionEvent(APIModel):
    event_id: str = Field(alias="eventId")
    sequence: int = Field(ge=0)
    type: Literal[
        "prediction_submitted",
        "parameter_changed",
        "explanation_submitted",
    ]
    step_id: str = Field(alias="stepId")
    parameter_id: str | None = Field(default=None, alias="parameterId")
    answer: str | None = None
    from_value: float | None = Field(default=None, alias="from")
    to_value: float | None = Field(default=None, alias="to")
    client_timestamp: str = Field(alias="clientTimestamp")


class EventsBatch(APIModel):
    session_id: str = Field(alias="sessionId")
    events: list[InteractionEvent]


class EventsAccepted(APIModel):
    accepted: int
    duplicates: int


class FeedbackRequest(APIModel):
    session_id: str = Field(alias="sessionId")


class LearnerFeedback(APIModel):
    summary: str
    evidence: list[str]
    next_step: str = Field(alias="nextStep")
    mastery: Literal["developing", "demonstrated"]
    score: int = Field(ge=0, le=100)


class HealthResponse(APIModel):
    status: Literal["ok"]
    service: str
    version: str
