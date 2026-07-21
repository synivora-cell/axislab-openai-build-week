from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_lesson_trace_can_be_retrieved_for_audit() -> None:
    lesson = client.post(
        "/api/lessons",
        json={"question": "Explain theta and d in DH", "provider": "template"},
    ).json()
    response = client.get(f"/api/lessons/{lesson['lessonId']}/trace")
    assert response.status_code == 200
    assert response.json()["traceId"] == lesson["agentTrace"]["traceId"]
    assert "QWEN_API_KEY" not in response.text


def test_lesson_state_events_and_feedback_flow() -> None:
    lesson_response = client.post(
        "/api/lessons",
        json={
            "question": "What is the difference between theta and d in DH?",
            "provider": "template",
        },
    )
    assert lesson_response.status_code == 200
    lesson = lesson_response.json()
    lesson_id = lesson["lessonId"]
    assert lesson["verification"]["approved"] is True
    assert lesson["source"] == "validated_template"
    assert lesson["sceneSpec"] == {
        "version": "1.0",
        "visualPreset": "canadarm_q5",
        "topic": "forward_kinematics",
        "modelSource": "teaching_template",
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

    state_response = client.post(
        f"/api/lessons/{lesson_id}/validate-state",
        json={
            "requestSequence": 1,
            "jointValues": {"joint_1.d": 2.0, "joint_2.theta": 0.8},
        },
    )
    assert state_response.status_code == 200
    assert state_response.json()["valid"] is True

    events = [
        {
            "eventId": "event-1",
            "sequence": 1,
            "type": "prediction_submitted",
            "stepId": "predict_d",
            "parameterId": "joint_1.d",
            "answer": "translate",
            "clientTimestamp": "2026-07-19T18:00:00.000Z",
        },
        {
            "eventId": "event-2",
            "sequence": 2,
            "type": "parameter_changed",
            "stepId": "interact_d",
            "parameterId": "joint_1.d",
            "from": 1.8,
            "to": 2.0,
            "clientTimestamp": "2026-07-19T18:00:01.000Z",
        },
    ]
    submitted = client.post(
        f"/api/lessons/{lesson_id}/events",
        json={"sessionId": "test-session", "events": events},
    )
    assert submitted.status_code == 200
    assert submitted.json() == {"accepted": 2, "duplicates": 0}

    duplicate = client.post(
        f"/api/lessons/{lesson_id}/events",
        json={"sessionId": "test-session", "events": events},
    )
    assert duplicate.json() == {"accepted": 0, "duplicates": 2}

    feedback = client.post(
        f"/api/lessons/{lesson_id}/feedback",
        json={"sessionId": "test-session"},
    )
    assert feedback.status_code == 200
    assert feedback.json()["mastery"] == "developing"
    assert feedback.json()["score"] == 40


def test_unsupported_question_uses_validated_fallback() -> None:
    response = client.post(
        "/api/lessons",
        json={"question": "Teach me fluid dynamics", "provider": "template"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "validated_fallback"
    assert body["verification"]["usedFallback"] is True


def test_2r1p_question_selects_serial_renderer_preset() -> None:
    response = client.post(
        "/api/lessons",
        json={"question": "请生成一个 2R+1P 的机械臂", "provider": "template"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "validated_template"
    assert body["robotSpec"]["templateId"] == "serial_2r1p"
    assert [joint["type"] for joint in body["robotSpec"]["joints"]] == ["prismatic", "revolute", "revolute"]
    assert body["sceneSpec"]["visualPreset"] == "dh_chain"


def test_3r1p_question_returns_four_joint_generic_dh_scene() -> None:
    response = client.post(
        "/api/lessons",
        json={"question": "请根据 JSON 生成一个 3R+1P 的机械臂", "provider": "template"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["sceneSpec"]["visualPreset"] == "dh_chain"
    assert body["sceneSpec"]["lesson"]["controls"] == ["joint_1.d", "joint_2.theta", "joint_3.theta", "joint_4.theta"]
    assert [joint["type"] for joint in body["robotSpec"]["joints"]] == ["prismatic", "revolute", "revolute", "revolute"]


def test_direct_json_1r1p_scene_needs_no_registered_template() -> None:
    response = client.post(
        "/api/scenes",
        json={
            "robotSpec": {
                "version": "1.0", "convention": "standard_dh", "templateId": "custom_1r1p", "name": "Custom 1R1P", "lengthUnit": "m", "angleUnit": "rad",
                "joints": [
                    {"id": "J1", "type": "revolute", "a": 2.0, "alpha": 0.0, "d": 0.0, "theta": {"parameterId": "J1.theta", "variable": "q1", "default": 0.3, "min": -3.14, "max": 3.14, "unit": "rad"}},
                    {"id": "J2", "type": "prismatic", "a": 0.0, "alpha": 0.0, "theta": 0.0, "d": {"parameterId": "J2.d", "variable": "q2", "default": 1.0, "min": 0.1, "max": 2.0, "unit": "m"}},
                ],
            },
            "sceneSpec": {"version": "1.0", "visualPreset": "dh_chain", "topic": "forward_kinematics", "modelSource": "problem_extracted", "robot": {"representation": "standard_dh", "templateId": "custom_1r1p"}, "lesson": {"activityTemplate": "freeform_dh", "controls": ["J1.theta", "J2.d"], "overlays": ["joint_labels", "dh_frames", "joint_axes"]}},
        },
    )
    assert response.status_code == 200
    assert response.json()["source"] == "validated_json"


def test_direct_json_rejects_an_oblique_cylindrical_link() -> None:
    response = client.post(
        "/api/scenes",
        json={
            "robotSpec": {
                "version": "1.0", "convention": "standard_dh", "templateId": "invalid_oblique", "name": "Invalid oblique link", "lengthUnit": "m", "angleUnit": "rad",
                "joints": [
                    {"id": "J1", "type": "revolute", "a": 1.0, "alpha": 0.0, "d": 0.5, "theta": {"parameterId": "J1.theta", "variable": "q1", "default": 0.0, "min": -3.14, "max": 3.14, "unit": "rad"}},
                    {"id": "J2", "type": "revolute", "a": 1.0, "alpha": 0.0, "d": 0.0, "theta": {"parameterId": "J2.theta", "variable": "q2", "default": 0.0, "min": -3.14, "max": 3.14, "unit": "rad"}},
                ],
            },
            "sceneSpec": {"version": "1.0", "visualPreset": "dh_chain", "topic": "forward_kinematics", "modelSource": "problem_extracted", "robot": {"representation": "standard_dh", "templateId": "invalid_oblique"}, "lesson": {"activityTemplate": "freeform_dh", "controls": ["J1.theta", "J2.theta"], "overlays": ["joint_labels", "dh_frames", "joint_axes"]}},
        },
    )
    assert response.status_code == 422
    assert "OBLIQUE_CYLINDRICAL_LINK" in response.json()["detail"]
