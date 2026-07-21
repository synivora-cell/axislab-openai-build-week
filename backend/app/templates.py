from .schemas import ActivitySpec, LessonSpec, RoboticsSceneSpec, RobotSpec


SUPPORTED_TEMPLATE_IDS = (
    "canadarm_d1_vs_theta2",
    "serial_2r1p",
    "serial_3r1p",
)


def default_scene(model_source: str = "teaching_template") -> RoboticsSceneSpec:
    return RoboticsSceneSpec.model_validate(
        {
            "version": "1.0",
            "visualPreset": "canadarm_q5",
            "topic": "forward_kinematics",
            "modelSource": model_source,
            "robot": {
                "representation": "standard_dh",
                "templateId": "canadarm_d1_vs_theta2",
            },
            "lesson": {
                "activityTemplate": "canadarm_d1_vs_theta2",
                "controls": ["joint_1.d", "joint_2.theta"],
                "overlays": [
                    "joint_labels",
                    "dh_frames",
                    "joint_axes",
                    "symbolic_dimensions",
                    "dh_table",
                    "transform_matrix",
                    "end_effector_pose",
                ],
            },
        }
    )


def default_lesson(confidence: float = 1.0) -> LessonSpec:
    return LessonSpec.model_validate(
        {
            "version": "1.0",
            "intent": "compare_canadarm_d1_and_theta2",
            "confidence": confidence,
            "learningGoal": "distinguish Canadarm prismatic d_1 and revolute theta_2 in standard DH notation",
            "misconceptions": [
                "learner treats both values as equivalent displacement",
                "learner thinks theta only affects the rotation block",
            ],
            "requiredObservations": [
                "d_1 translates along Canadarm's first joint axis z_0",
                "theta_2 rotates the Canadarm boom about z_1",
            ],
            "activityTemplateId": "canadarm_d1_vs_theta2",
            "difficulty": "introductory",
            "successEvidence": [
                "submits both predictions",
                "changes both target parameters",
                "explains joint type, motion and axis",
            ],
        }
    )


def default_robot() -> RobotSpec:
    return RobotSpec.model_validate(
        {
            "version": "1.0",
            "convention": "standard_dh",
            "templateId": "canadarm_d1_vs_theta2",
            "name": "Canadarm d1 / theta2 Comparison",
            "lengthUnit": "m",
            "angleUnit": "rad",
            "joints": [
                {
                    "id": "joint_1",
                    "type": "prismatic",
                    "a": 0.0,
                    "alpha": 1.5707963267948966,
                    "d": {
                        "parameterId": "joint_1.d",
                        "variable": "q1",
                        "default": 1.8,
                        "min": 0.8,
                        "max": 3.0,
                        "unit": "m",
                    },
                    "theta": 0.0,
                },
                {
                    "id": "joint_2",
                    "type": "revolute",
                    "a": 3.85,
                    "alpha": 0.0,
                    "d": 0.0,
                    "theta": {
                        "parameterId": "joint_2.theta",
                        "variable": "q2",
                        "default": 0.6,
                        "min": -1.5708,
                        "max": 1.5708,
                        "unit": "rad",
                    },
                },
            ],
        }
    )


def default_activity() -> ActivitySpec:
    return ActivitySpec.model_validate(
        {
            "version": "1.0",
            "templateId": "canadarm_d1_vs_theta2",
            "editableParameterIds": ["joint_1.d", "joint_2.theta"],
            "visibleFrames": [0, 1, 2, 3, 4, 5],
            "matrixHighlightMode": "direct_and_propagated",
            "steps": [
                {
                    "id": "predict_d",
                    "type": "prediction",
                    "parameterId": "joint_1.d",
                    "answerType": "multiple_choice",
                    "instruction": "Predict what will happen when Canadarm d_1 increases.",
                },
                {
                    "id": "interact_d",
                    "type": "interaction",
                    "parameterId": "joint_1.d",
                    "completionRule": "parameter_changed",
                },
                {
                    "id": "predict_theta",
                    "type": "prediction",
                    "parameterId": "joint_2.theta",
                    "answerType": "multiple_choice",
                    "instruction": "Predict what will happen when Canadarm theta_2 increases.",
                },
                {
                    "id": "interact_theta",
                    "type": "interaction",
                    "parameterId": "joint_2.theta",
                    "completionRule": "parameter_changed",
                },
                {
                    "id": "explain_difference",
                    "type": "explanation",
                    "answerType": "free_text",
                    "prompt": "Explain the difference between Canadarm d_1 and theta_2.",
                },
            ],
        }
    )


def serial_2r1p_scene() -> RoboticsSceneSpec:
    return RoboticsSceneSpec.model_validate(
        {
            "version": "1.0",
            "visualPreset": "dh_chain",
            "topic": "forward_kinematics",
            "modelSource": "teaching_template",
            "robot": {"representation": "standard_dh", "templateId": "serial_2r1p"},
            "lesson": {
                "activityTemplate": "serial_2r1p",
                "controls": ["joint_1.d", "joint_2.theta", "joint_3.theta"],
                "overlays": ["joint_labels", "dh_frames", "joint_axes", "dh_table", "transform_matrix", "end_effector_pose"],
            },
        }
    )


def serial_2r1p_lesson() -> LessonSpec:
    return LessonSpec.model_validate(
        {
            "version": "1.0",
            "intent": "explore_serial_2r1p",
            "confidence": 0.98,
            "learningGoal": "explore a serial 2R+1P arm with standard DH parameters",
            "misconceptions": ["a prismatic joint changes theta", "a revolute joint only changes orientation"],
            "requiredObservations": ["d_1 lifts the two-link arm", "theta_2 and theta_3 bend the planar chain"],
            "activityTemplateId": "serial_2r1p",
            "difficulty": "introductory",
            "successEvidence": ["changes d_1", "changes theta_2", "identifies the third revolute joint"],
        }
    )


def serial_2r1p_robot() -> RobotSpec:
    return RobotSpec.model_validate(
        {
            "version": "1.0",
            "convention": "standard_dh",
            "templateId": "serial_2r1p",
            "name": "Serial 2R + 1P Arm",
            "lengthUnit": "m",
            "angleUnit": "rad",
            "joints": [
                {"id": "joint_1", "type": "prismatic", "a": 0.0, "alpha": 0.0, "d": {"parameterId": "joint_1.d", "variable": "q1", "default": 1.5, "min": 0.4, "max": 3.2, "unit": "m"}, "theta": 0.0},
                {"id": "joint_2", "type": "revolute", "a": 3.2, "alpha": 0.0, "d": 0.0, "theta": {"parameterId": "joint_2.theta", "variable": "q2", "default": 0.65, "min": -3.1416, "max": 3.1416, "unit": "rad"}},
                {"id": "joint_3", "type": "revolute", "a": 2.4, "alpha": 0.0, "d": 0.0, "theta": {"parameterId": "joint_3.theta", "variable": "q3", "default": -0.85, "min": -3.1416, "max": 3.1416, "unit": "rad"}},
            ],
        }
    )


def serial_2r1p_activity() -> ActivitySpec:
    return ActivitySpec.model_validate(
        {
            "version": "1.0",
            "templateId": "serial_2r1p",
            "editableParameterIds": ["joint_1.d", "joint_2.theta", "joint_3.theta"],
            "visibleFrames": [0, 1, 2, 3],
            "matrixHighlightMode": "direct_and_propagated",
            "steps": [
                {"id": "predict_d", "type": "prediction", "parameterId": "joint_1.d", "answerType": "multiple_choice", "instruction": "Predict what happens when d_1 extends."},
                {"id": "interact_d", "type": "interaction", "parameterId": "joint_1.d", "completionRule": "parameter_changed"},
                {"id": "predict_theta", "type": "prediction", "parameterId": "joint_2.theta", "answerType": "multiple_choice", "instruction": "Predict what happens when theta_2 rotates."},
                {"id": "interact_theta", "type": "interaction", "parameterId": "joint_2.theta", "completionRule": "parameter_changed"},
                {"id": "explain_difference", "type": "explanation", "answerType": "free_text", "prompt": "Explain how the P, R and R joints move this arm."},
            ],
        }
    )


def serial_3r1p_scene() -> RoboticsSceneSpec:
    return RoboticsSceneSpec.model_validate(
        {
            "version": "1.0",
            "visualPreset": "dh_chain",
            "topic": "forward_kinematics",
            "modelSource": "teaching_template",
            "robot": {"representation": "standard_dh", "templateId": "serial_3r1p"},
            "lesson": {
                "activityTemplate": "serial_3r1p",
                "controls": ["joint_1.d", "joint_2.theta", "joint_3.theta", "joint_4.theta"],
                "overlays": ["joint_labels", "dh_frames", "joint_axes", "dh_table", "transform_matrix", "end_effector_pose"],
            },
        }
    )


def serial_3r1p_lesson() -> LessonSpec:
    return LessonSpec.model_validate(
        {
            "version": "1.0",
            "intent": "explore_serial_3r1p",
            "confidence": 0.98,
            "learningGoal": "visualize a JSON-defined 3R+1P serial arm with standard DH parameters",
            "misconceptions": ["joint count determines geometry without DH", "a prismatic joint rotates its link"],
            "requiredObservations": ["d_1 translates the full R-R-R chain", "each theta bends its downstream links"],
            "activityTemplateId": "serial_3r1p",
            "difficulty": "introductory",
            "successEvidence": ["changes all four joint variables", "identifies three R joints and one P joint"],
        }
    )


def serial_3r1p_robot() -> RobotSpec:
    return RobotSpec.model_validate(
        {
            "version": "1.0", "convention": "standard_dh", "templateId": "serial_3r1p",
            "name": "JSON-defined Serial 3R + 1P Arm", "lengthUnit": "m", "angleUnit": "rad",
            "joints": [
                {"id": "joint_1", "type": "prismatic", "a": 0.0, "alpha": 0.0, "d": {"parameterId": "joint_1.d", "variable": "q1", "default": 1.2, "min": 0.3, "max": 3.0, "unit": "m"}, "theta": 0.0},
                {"id": "joint_2", "type": "revolute", "a": 2.8, "alpha": 0.0, "d": 0.0, "theta": {"parameterId": "joint_2.theta", "variable": "q2", "default": 0.55, "min": -3.1416, "max": 3.1416, "unit": "rad"}},
                {"id": "joint_3", "type": "revolute", "a": 2.2, "alpha": 0.0, "d": 0.0, "theta": {"parameterId": "joint_3.theta", "variable": "q3", "default": -0.9, "min": -3.1416, "max": 3.1416, "unit": "rad"}},
                {"id": "joint_4", "type": "revolute", "a": 1.5, "alpha": 0.0, "d": 0.0, "theta": {"parameterId": "joint_4.theta", "variable": "q4", "default": 0.7, "min": -3.1416, "max": 3.1416, "unit": "rad"}},
            ],
        }
    )


def serial_3r1p_activity() -> ActivitySpec:
    return ActivitySpec.model_validate(
        {
            "version": "1.0", "templateId": "serial_3r1p",
            "editableParameterIds": ["joint_1.d", "joint_2.theta", "joint_3.theta", "joint_4.theta"],
            "visibleFrames": [0, 1, 2, 3, 4], "matrixHighlightMode": "direct_and_propagated",
            "steps": [
                {"id": "predict_d", "type": "prediction", "parameterId": "joint_1.d", "answerType": "multiple_choice", "instruction": "Predict what happens when d_1 extends."},
                {"id": "interact_d", "type": "interaction", "parameterId": "joint_1.d", "completionRule": "parameter_changed"},
                {"id": "predict_theta", "type": "prediction", "parameterId": "joint_2.theta", "answerType": "multiple_choice", "instruction": "Predict what happens when theta_2 rotates."},
                {"id": "interact_theta", "type": "interaction", "parameterId": "joint_2.theta", "completionRule": "parameter_changed"},
                {"id": "explain_chain", "type": "explanation", "answerType": "free_text", "prompt": "Explain how the 3R+1P chain moves."},
            ],
        }
    )


def template_bundle(
    template_id: str,
) -> tuple[LessonSpec, RobotSpec, ActivitySpec, RoboticsSceneSpec]:
    factories = {
        "canadarm_d1_vs_theta2": (
            default_lesson,
            default_robot,
            default_activity,
            default_scene,
        ),
        "serial_2r1p": (
            serial_2r1p_lesson,
            serial_2r1p_robot,
            serial_2r1p_activity,
            serial_2r1p_scene,
        ),
        "serial_3r1p": (
            serial_3r1p_lesson,
            serial_3r1p_robot,
            serial_3r1p_activity,
            serial_3r1p_scene,
        ),
    }
    try:
        lesson_factory, robot_factory, activity_factory, scene_factory = factories[
            template_id
        ]
    except KeyError as exc:
        raise ValueError(f"unsupported activity template: {template_id}") from exc
    return (
        lesson_factory(),
        robot_factory(),
        activity_factory(),
        scene_factory(),
    )
