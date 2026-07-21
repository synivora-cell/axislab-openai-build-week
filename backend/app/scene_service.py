from __future__ import annotations

from uuid import uuid4

from .schemas import (
    ActivitySpec,
    AgentCall,
    AgentTrace,
    LessonResponse,
    LessonSpec,
    RoboticsSceneSpec,
    RobotSpec,
    SceneCreateRequest,
    VariableSpec,
)
from .validation import validate_activity


def _variables(robot: RobotSpec) -> list[VariableSpec]:
    values: list[VariableSpec] = []
    for joint in robot.joints:
        value = joint.d if joint.type == "prismatic" else joint.theta
        assert isinstance(value, VariableSpec)
        values.append(value)
    return values


def create_json_scene(payload: SceneCreateRequest) -> LessonResponse:
    robot, scene = payload.robot_spec, payload.scene_spec
    variables = _variables(robot)
    variable_ids = [item.parameter_id for item in variables]
    if scene.robot.template_id != robot.template_id:
        raise ValueError("sceneSpec.robot.templateId must match robotSpec.templateId")
    if set(scene.lesson.controls) != set(variable_ids):
        raise ValueError("sceneSpec.lesson.controls must include every and only robot variable")
    if scene.visual_preset != "dh_chain":
        raise ValueError("direct JSON scenes currently use visualPreset=dh_chain")

    template_id = scene.lesson.activity_template
    first_variable = variables[0]
    activity = ActivitySpec.model_validate(
        {
            "version": "1.0",
            "templateId": template_id,
            "editableParameterIds": variable_ids,
            "visibleFrames": list(range(len(robot.joints) + 1)),
            "matrixHighlightMode": "direct_and_propagated",
            "steps": [
                {"id": "predict_first", "type": "prediction", "parameterId": first_variable.parameter_id, "answerType": "multiple_choice", "instruction": "Predict the motion caused by the first joint variable."},
                {"id": "interact_first", "type": "interaction", "parameterId": first_variable.parameter_id, "completionRule": "parameter_changed"},
                {"id": "explain_chain", "type": "explanation", "answerType": "free_text", "prompt": "Explain how the R and P joints move the serial chain."},
            ],
        }
    )
    verification = validate_activity(robot, activity)
    if not verification.approved:
        renderability_issues = [issue for issue in verification.issues if issue.source == "renderability"]
        if renderability_issues:
            detail = "; ".join(f"{issue.code}: {issue.message}" for issue in renderability_issues)
            raise ValueError(f"JSON scene is not renderable by the cylindrical-joint preset. {detail}")
        raise ValueError("JSON scene failed activity or kinematics validation")
    lesson_id = f"scene_{uuid4().hex[:10]}"
    return LessonResponse(
        lessonId=lesson_id,
        source="validated_json",
        lessonSpec=LessonSpec(
            intent="json_defined_standard_dh_chain",
            confidence=1.0,
            learningGoal=f"Explore the JSON-defined {robot.name} using standard DH.",
            misconceptions=["joint type and its DH variable are interchangeable"],
            requiredObservations=["each variable changes its downstream chain"],
            activityTemplateId=template_id,
            difficulty="introductory",
            successEvidence=["changes a joint variable", "explains the chain motion"],
        ),
        robotSpec=robot,
        activitySpec=activity,
        sceneSpec=scene,
        verification=verification,
        agentTrace=AgentTrace(
            traceId=f"trace_{uuid4().hex[:10]}", lessonId=lesson_id,
            calls=[AgentCall(agent="environment", provider="json", model="schema-v1", attempt=1, status="json_validated", latencyMs=0)],
            finalOutcome="validated_json",
        ),
    )
