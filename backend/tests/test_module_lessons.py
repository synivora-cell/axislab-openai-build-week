from fastapi.testclient import TestClient

from app.main import app
from app.module_lessons import template_spec, verify_spec


client = TestClient(app)


def test_template_module_lesson_is_customized_and_verified() -> None:
    response = client.post(
        "/api/module-lessons",
        json={"question": "Why does an RPY wrist become singular at pitch 90 degrees?", "provider": "template"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["lessonSpec"]["topic"] == "orientation"
    assert body["lessonSpec"]["mode"] == "rpy"
    assert body["verification"]["approved"] is True
    assert len(body["lessonSpec"]["tasks"]) == 3


def test_each_advanced_topic_routes_to_its_contract() -> None:
    cases = {
        "Show Jacobian differential motion": "jacobian",
        "Compare cubic trajectory duration": "trajectory",
        "Compute torque and gravity compensation": "dynamics",
    }
    for question, expected in cases.items():
        body = client.post("/api/module-lessons", json={"question": question, "provider": "template"}).json()
        assert body["lessonSpec"]["topic"] == expected
        assert body["verification"]["approved"] is True


def test_verifier_rejects_out_of_range_parameter() -> None:
    spec = template_spec("Explain the Jacobian")
    spec.parameters["q1Deg"] = 999
    result = verify_spec(spec, "jacobian")
    assert result.approved is False
    assert "PARAMETER_OUT_OF_RANGE:q1Deg" in result.issues
