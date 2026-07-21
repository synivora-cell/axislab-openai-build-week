import type { Matrix4, RobotSpec, VariableSpec } from './types'

const identity = (): Matrix4 => [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
]

export function standardDh(a: number, alpha: number, d: number, theta: number): Matrix4 {
  const ct = Math.cos(theta)
  const st = Math.sin(theta)
  const ca = Math.cos(alpha)
  const sa = Math.sin(alpha)
  return [
    [ct, -st * ca, st * sa, a * ct],
    [st, ct * ca, -ct * sa, a * st],
    [0, sa, ca, d],
    [0, 0, 0, 1],
  ]
}

export function multiply(left: Matrix4, right: Matrix4): Matrix4 {
  return Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) =>
      Array.from({ length: 4 }, (_, k) => left[row][k] * right[k][column]).reduce(
        (sum, value) => sum + value,
        0,
      ),
    ),
  )
}

function valueOf(value: number | VariableSpec, values: Record<string, number>): number {
  return typeof value === 'number' ? value : (values[value.parameterId] ?? value.default)
}

export function forwardKinematics(robot: RobotSpec, values: Record<string, number>) {
  const local: Matrix4[] = []
  const cumulative: Matrix4[] = []
  let total = identity()
  for (const joint of robot.joints) {
    const matrix = standardDh(
      joint.a,
      joint.alpha,
      valueOf(joint.d, values),
      valueOf(joint.theta, values),
    )
    local.push(matrix)
    total = multiply(total, matrix)
    cumulative.push(total)
  }
  return { local, cumulative, endEffector: total }
}

export function matrixToKatex(matrix: Matrix4): string {
  const rows = matrix
    .map((row) => row.map((value) => formatNumber(value)).join(' & '))
    .join(' \\\\ ')
  return `\\begin{bmatrix}${rows}\\end{bmatrix}`
}

export function formatNumber(value: number): string {
  const normalized = Math.abs(value) < 5e-7 ? 0 : value
  return normalized.toFixed(3)
}

export function defaultJointValues(robot: RobotSpec): Record<string, number> {
  const values: Record<string, number> = {}
  for (const joint of robot.joints) {
    for (const candidate of [joint.theta, joint.d]) {
      if (typeof candidate !== 'number') values[candidate.parameterId] = candidate.default
    }
  }
  return values
}
