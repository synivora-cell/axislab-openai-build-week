from __future__ import annotations

import math

from .schemas import Matrix4, RobotSpec, VariableSpec


IDENTITY_4: Matrix4 = [
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
    [0.0, 0.0, 0.0, 1.0],
]


def standard_dh_matrix(a: float, alpha: float, d: float, theta: float) -> Matrix4:
    """Return the standard-DH transform Rz(theta) Tz(d) Tx(a) Rx(alpha)."""
    ct, st = math.cos(theta), math.sin(theta)
    ca, sa = math.cos(alpha), math.sin(alpha)
    return [
        [ct, -st * ca, st * sa, a * ct],
        [st, ct * ca, -ct * sa, a * st],
        [0.0, sa, ca, d],
        [0.0, 0.0, 0.0, 1.0],
    ]


def matrix_multiply(left: Matrix4, right: Matrix4) -> Matrix4:
    return [
        [sum(left[row][k] * right[k][column] for k in range(4)) for column in range(4)]
        for row in range(4)
    ]


def _resolve(variable: float | VariableSpec, values: dict[str, float]) -> float:
    if isinstance(variable, float):
        return variable
    value = values.get(variable.parameter_id, variable.default)
    if not math.isfinite(value):
        raise ValueError(f"{variable.parameter_id} must be finite")
    if not variable.minimum <= value <= variable.maximum:
        raise ValueError(
            f"{variable.parameter_id}={value} is outside "
            f"[{variable.minimum}, {variable.maximum}]"
        )
    return value


def forward_kinematics(
    robot: RobotSpec, joint_values: dict[str, float]
) -> tuple[list[Matrix4], Matrix4]:
    transforms: list[Matrix4] = []
    total = [row[:] for row in IDENTITY_4]
    for joint in robot.joints:
        d = _resolve(joint.d, joint_values)
        theta = _resolve(joint.theta, joint_values)
        local = standard_dh_matrix(joint.a, joint.alpha, d, theta)
        total = matrix_multiply(total, local)
        transforms.append(total)
    return transforms, total


def _is_matrix4(matrix: Matrix4) -> bool:
    return len(matrix) == 4 and all(len(row) == 4 for row in matrix)


def position_error(expected: Matrix4, actual: Matrix4) -> float:
    return math.sqrt(sum((expected[row][3] - actual[row][3]) ** 2 for row in range(3)))


def rotation_error(expected: Matrix4, actual: Matrix4) -> float:
    return math.sqrt(
        sum(
            (expected[row][column] - actual[row][column]) ** 2
            for row in range(3)
            for column in range(3)
        )
    )


def validate_homogeneous(matrix: Matrix4, tolerance: float = 1e-8) -> list[str]:
    issues: list[str] = []
    if not _is_matrix4(matrix):
        return ["transform must be 4x4"]
    if any(not math.isfinite(value) for row in matrix for value in row):
        issues.append("transform contains a non-finite value")
    expected_last_row = [0.0, 0.0, 0.0, 1.0]
    if any(abs(matrix[3][i] - expected_last_row[i]) > tolerance for i in range(4)):
        issues.append("last row must be [0, 0, 0, 1]")

    rotation = [[matrix[r][c] for c in range(3)] for r in range(3)]
    for row in range(3):
        for column in range(3):
            dot = sum(rotation[k][row] * rotation[k][column] for k in range(3))
            target = 1.0 if row == column else 0.0
            if abs(dot - target) > tolerance:
                issues.append("rotation block is not orthogonal")
                return issues
    return issues
