import math

from .kinematics import forward_kinematics, validate_homogeneous
from .schemas import (
    ActivitySpec,
    RobotSpec,
    RoboticsSceneSpec,
    LessonSpec,
    VerificationChecks,
    VerificationIssue,
    VerificationResult,
    VariableSpec,
)


CYLINDER_ALIGNMENT_TOLERANCE = 1e-6


def _has_nonzero_travel(value: float | VariableSpec) -> bool:
    """Whether a DH d value can create an axial offset in any allowed pose."""
    if isinstance(value, float):
        return abs(value) > CYLINDER_ALIGNMENT_TOLERANCE
    return value.minimum < -CYLINDER_ALIGNMENT_TOLERANCE or value.maximum > CYLINDER_ALIGNMENT_TOLERANCE


def _is_axial_or_radial(alpha: float) -> bool:
    """A cap-to-cap link is only valid when adjacent cylinder axes are parallel or orthogonal."""
    sine = abs(math.sin(alpha))
    cosine = abs(math.cos(alpha))
    return sine < CYLINDER_ALIGNMENT_TOLERANCE or cosine < CYLINDER_ALIGNMENT_TOLERANCE


def validate_cylindrical_renderability(robot: RobotSpec) -> list[VerificationIssue]:
    """Validate the strict connector grammar used by the cylindrical DH renderer.

    A straight link may leave a cylinder only through a cap (parallel to the
    cylinder axis) or through its side (perpendicular to the axis).  In a
    standard-DH transform, simultaneous non-zero ``a`` and ``d`` produces an
    oblique centre-to-centre vector, which cannot be represented by this
    renderer without an adapter or a spherical joint.
    """
    issues: list[VerificationIssue] = []
    for index, joint in enumerate(robot.joints):
        has_radial_offset = abs(joint.a) > CYLINDER_ALIGNMENT_TOLERANCE
        has_axial_offset = _has_nonzero_travel(joint.d)
        path = f"joints[{index}]"

        if has_radial_offset and has_axial_offset:
            issues.append(
                VerificationIssue(
                    source="renderability",
                    code="OBLIQUE_CYLINDRICAL_LINK",
                    path=path,
                    message=(
                        f"{joint.id} combines non-zero a and d. Its straight DH link is oblique to "
                        "the cylinder axis and cannot attach through a cap or side surface."
                    ),
                    suggestedFix="Set either a or d to zero, or model an explicit adapter module instead of a single straight link.",
                )
            )
            continue

        if has_axial_offset and not has_radial_offset and not _is_axial_or_radial(joint.alpha):
            issues.append(
                VerificationIssue(
                    source="renderability",
                    code="UNSUPPORTED_CAP_ALIGNMENT",
                    path=f"{path}.alpha",
                    message=(
                        f"{joint.id} uses an axial (d) link but alpha={joint.alpha:.6g} makes the next "
                        "cylinder face neither parallel nor perpendicular to that link."
                    ),
                    suggestedFix="Use alpha = k·π/2, set d to zero, or introduce an adapter module.",
                )
            )
    return issues


def validate_activity(robot: RobotSpec, activity: ActivitySpec) -> VerificationResult:
    issues: list[VerificationIssue] = []
    issues.extend(validate_cylindrical_renderability(robot))
    variables: dict[str, VariableSpec] = {}
    for joint in robot.joints:
        variable = joint.theta if joint.type == "revolute" else joint.d
        assert isinstance(variable, VariableSpec)
        variables[variable.parameter_id] = variable

    if len(activity.editable_parameter_ids) != len(set(activity.editable_parameter_ids)):
        issues.append(
            VerificationIssue(
                source="rules",
                code="DUPLICATE_EDITABLE_PARAMETER",
                path="editableParameterIds",
                message="Editable parameters must be unique.",
            )
        )
    for parameter_id in activity.editable_parameter_ids:
        if parameter_id not in variables:
            issues.append(
                VerificationIssue(
                    source="rules",
                    code="UNKNOWN_PARAMETER",
                    path="editableParameterIds",
                    message=f"Unknown parameter: {parameter_id}",
                )
            )

    prediction_seen: set[str] = set()
    has_explanation = False
    for index, step in enumerate(activity.steps):
        if step.parameter_id and step.parameter_id not in variables:
            issues.append(
                VerificationIssue(
                    source="rules",
                    code="STEP_UNKNOWN_PARAMETER",
                    path=f"steps[{index}].parameterId",
                    message=f"Unknown parameter: {step.parameter_id}",
                )
            )
        if step.type == "prediction" and step.parameter_id:
            prediction_seen.add(step.parameter_id)
        if (
            step.type == "interaction"
            and step.parameter_id
            and step.parameter_id not in prediction_seen
        ):
            issues.append(
                VerificationIssue(
                    source="rules",
                    code="PREDICTION_REQUIRED",
                    path=f"steps[{index}]",
                    message="An interaction must follow a prediction for the same parameter.",
                )
            )
        has_explanation = has_explanation or step.type == "explanation"
    if not has_explanation:
        issues.append(
            VerificationIssue(
                source="rules",
                code="EXPLANATION_REQUIRED",
                path="steps",
                message="The activity must end with an explanation step.",
            )
        )

    kinematics_ok = True
    try:
        transforms, _ = forward_kinematics(robot, {})
        for transform in transforms:
            for message in validate_homogeneous(transform):
                kinematics_ok = False
                issues.append(
                    VerificationIssue(
                        source="kinematics",
                        code="INVALID_TRANSFORM",
                        message=message,
                    )
                )
    except ValueError as exc:
        kinematics_ok = False
        issues.append(
            VerificationIssue(
                source="kinematics",
                code="KINEMATICS_ERROR",
                message=str(exc),
            )
        )

    rules_ok = not any(issue.source == "rules" for issue in issues)
    renderability_ok = not any(issue.source == "renderability" for issue in issues)
    approved = rules_ok and kinematics_ok and renderability_ok
    return VerificationResult(
        approved=approved,
        usedFallback=False,
        checks=VerificationChecks(
            schema="passed",
            rules="passed" if rules_ok else "failed",
            kinematics="passed" if kinematics_ok else "failed",
            renderability="passed" if renderability_ok else "failed",
            pedagogy="passed",
        ),
        issues=issues,
    )


def validate_lesson_package(
    lesson: LessonSpec,
    robot: RobotSpec,
    activity: ActivitySpec,
    scene: RoboticsSceneSpec,
) -> VerificationResult:
    """Validate cross-spec invariants after an Environment Agent proposal is compiled."""
    result = validate_activity(robot, activity)
    issues = list(result.issues)

    def add(code: str, path: str, message: str) -> None:
        issues.append(
            VerificationIssue(
                source="rules",
                code=code,
                path=path,
                message=message,
            )
        )

    if lesson.activity_template_id != activity.template_id:
        add(
            "LESSON_ACTIVITY_TEMPLATE_MISMATCH",
            "lessonSpec.activityTemplateId",
            "LessonSpec and ActivitySpec must reference the same approved template.",
        )
    if robot.template_id != activity.template_id:
        add(
            "ROBOT_ACTIVITY_TEMPLATE_MISMATCH",
            "robotSpec.templateId",
            "RobotSpec and ActivitySpec must reference the same approved template.",
        )
    if scene.robot.template_id != robot.template_id:
        add(
            "SCENE_ROBOT_TEMPLATE_MISMATCH",
            "sceneSpec.robot.templateId",
            "SceneSpec and RobotSpec must reference the same approved template.",
        )
    if scene.lesson.activity_template != activity.template_id:
        add(
            "SCENE_ACTIVITY_TEMPLATE_MISMATCH",
            "sceneSpec.lesson.activityTemplate",
            "SceneSpec and ActivitySpec must reference the same approved template.",
        )
    if set(scene.lesson.controls) != set(activity.editable_parameter_ids):
        add(
            "SCENE_CONTROL_MISMATCH",
            "sceneSpec.lesson.controls",
            "Scene controls must exactly match ActivitySpec editable parameters.",
        )
    maximum_frame = 5 if scene.visual_preset == "canadarm_q5" else len(robot.joints)
    if any(frame < 0 or frame > maximum_frame for frame in activity.visible_frames):
        add(
            "VISIBLE_FRAME_OUT_OF_RANGE",
            "activitySpec.visibleFrames",
            f"Visible frames must be between 0 and {maximum_frame}.",
        )
    approved_parameters = {
        (
            joint.d.parameter_id
            if joint.type == "prismatic"
            else joint.theta.parameter_id
        )
        for joint in robot.joints
    }
    if set(activity.editable_parameter_ids) != approved_parameters:
        add(
            "APPROVED_CONTROL_SET_MISMATCH",
            "activitySpec.editableParameterIds",
            "The activity must expose every and only the approved variable parameters.",
        )

    rules_ok = not any(issue.source == "rules" for issue in issues)
    result.issues = issues
    result.approved = result.approved and rules_ok
    result.checks.rules = "passed" if rules_ok else "failed"
    return result
