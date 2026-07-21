import math

import pytest

from app.kinematics import forward_kinematics, standard_dh_matrix, validate_homogeneous
from app.templates import default_robot


def test_standard_dh_identity() -> None:
    matrix = standard_dh_matrix(0.0, 0.0, 0.0, 0.0)
    assert matrix == [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


def test_rp_forward_kinematics_known_pose() -> None:
    robot = default_robot()
    _, end_effector = forward_kinematics(
        robot, {"joint_1.d": 2.0, "joint_2.theta": math.pi / 2}
    )
    assert end_effector[0][3] == pytest.approx(0.0, abs=1e-9)
    assert end_effector[1][3] == pytest.approx(0.0, abs=1e-9)
    assert end_effector[2][3] == pytest.approx(5.85, abs=1e-9)
    assert validate_homogeneous(end_effector) == []


def test_joint_limit_is_enforced() -> None:
    robot = default_robot()
    with pytest.raises(ValueError, match="outside"):
        forward_kinematics(robot, {"joint_1.d": 4.0, "joint_2.theta": 0.6})
