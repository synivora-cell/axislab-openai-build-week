export type AdvancedTopic = 'orientation' | 'jacobian' | 'trajectory' | 'dynamics'
export type Matrix3 = [[number, number, number], [number, number, number], [number, number, number]]

export function detectAdvancedTopic(question: string): AdvancedTopic | null {
  const normalized = question.toLowerCase()
  if (/trajectory|path planning|轨迹|路径规划|cubic|quintic/.test(normalized)) return 'trajectory'
  if (/force|dynamics|torque|wrench|动力学|力矩|受力|重力补偿/.test(normalized)) return 'dynamics'
  if (/jacobian|differential motion|differential kinematic|雅可比|微分运动|末端速度/.test(normalized)) return 'jacobian'
  if (/rpy|euler|wrist|orientation|rotation matrix|欧拉|腕部|姿态矩阵|旋转矩阵/.test(normalized)) return 'orientation'
  return null
}

export const degrees = (radians: number) => radians * 180 / Math.PI
export const radians = (value: number) => value * Math.PI / 180

function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  return a.map((row) => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0))) as Matrix3
}

const rx = (a: number): Matrix3 => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]]
const ry = (a: number): Matrix3 => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]]
const rz = (a: number): Matrix3 => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]]

export function rpyMatrix(roll: number, pitch: number, yaw: number): Matrix3 {
  return multiply(multiply(rz(yaw), ry(pitch)), rx(roll))
}

export function eulerZyzMatrix(alpha: number, beta: number, gamma: number): Matrix3 {
  return multiply(multiply(rz(alpha), ry(beta)), rz(gamma))
}

function wrapPi(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value))
}

export interface OrientationSolution {
  primary: [number, number, number]
  equivalent: [number, number, number]
  singular: boolean
}

export function matrixToRpy(matrix: Matrix3): OrientationSolution {
  const pitch = Math.asin(Math.max(-1, Math.min(1, -matrix[2][0])))
  const singular = Math.abs(Math.cos(pitch)) < 1e-7
  const roll = singular ? 0 : Math.atan2(matrix[2][1], matrix[2][2])
  const yaw = singular ? Math.atan2(-matrix[0][1], matrix[1][1]) : Math.atan2(matrix[1][0], matrix[0][0])
  return {
    primary: [roll, pitch, yaw],
    equivalent: [wrapPi(roll + Math.PI), wrapPi(Math.PI - pitch), wrapPi(yaw + Math.PI)],
    singular,
  }
}

export function matrixToEulerZyz(matrix: Matrix3): OrientationSolution {
  const beta = Math.acos(Math.max(-1, Math.min(1, matrix[2][2])))
  const singular = Math.abs(Math.sin(beta)) < 1e-7
  const alpha = singular ? Math.atan2(matrix[1][0], matrix[0][0]) : Math.atan2(matrix[1][2], matrix[0][2])
  const gamma = singular ? 0 : Math.atan2(matrix[2][1], -matrix[2][0])
  return {
    primary: [alpha, beta, gamma],
    equivalent: [wrapPi(alpha + Math.PI), wrapPi(-beta), wrapPi(gamma + Math.PI)],
    singular,
  }
}

export function matrixError(a: Matrix3, b: Matrix3): number {
  return Math.sqrt(a.flat().reduce((sum, value, index) => sum + (value - b.flat()[index]) ** 2, 0))
}

export interface PlanarState {
  point: [number, number]
  elbow: [number, number]
  jacobian: [[number, number], [number, number]]
  determinant: number
}

export function planar2R(q1: number, q2: number, l1 = 2, l2 = 1.5): PlanarState {
  const q12 = q1 + q2
  const elbow: [number, number] = [l1 * Math.cos(q1), l1 * Math.sin(q1)]
  const point: [number, number] = [elbow[0] + l2 * Math.cos(q12), elbow[1] + l2 * Math.sin(q12)]
  const jacobian: [[number, number], [number, number]] = [
    [-l1 * Math.sin(q1) - l2 * Math.sin(q12), -l2 * Math.sin(q12)],
    [l1 * Math.cos(q1) + l2 * Math.cos(q12), l2 * Math.cos(q12)],
  ]
  return { point, elbow, jacobian, determinant: jacobian[0][0] * jacobian[1][1] - jacobian[0][1] * jacobian[1][0] }
}

export function endEffectorVelocity(jacobian: PlanarState['jacobian'], qdot: [number, number]): [number, number] {
  return [
    jacobian[0][0] * qdot[0] + jacobian[0][1] * qdot[1],
    jacobian[1][0] * qdot[0] + jacobian[1][1] * qdot[1],
  ]
}

export function staticJointTorques(jacobian: PlanarState['jacobian'], force: [number, number]): [number, number] {
  return [
    jacobian[0][0] * force[0] + jacobian[1][0] * force[1],
    jacobian[0][1] * force[0] + jacobian[1][1] * force[1],
  ]
}

export function gravityTorques(q1: number, q2: number, l1 = 2, l2 = 1.5, m1 = 1.2, m2 = 0.8, gravity = 9.81): [number, number] {
  const q12 = q1 + q2
  return [
    gravity * (m1 * l1 * .5 * Math.cos(q1) + m2 * (l1 * Math.cos(q1) + l2 * .5 * Math.cos(q12))),
    gravity * m2 * l2 * .5 * Math.cos(q12),
  ]
}

export type TrajectoryKind = 'cubic' | 'quintic'

export function trajectoryState(kind: TrajectoryKind, start: number, end: number, duration: number, time: number) {
  const safeDuration = Math.max(.001, duration)
  const u = Math.max(0, Math.min(1, time / safeDuration))
  const delta = end - start
  if (kind === 'cubic') {
    const blend = 3 * u ** 2 - 2 * u ** 3
    return {
      position: start + delta * blend,
      velocity: delta * (6 * u - 6 * u ** 2) / safeDuration,
      acceleration: delta * (6 - 12 * u) / safeDuration ** 2,
    }
  }
  const blend = 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5
  return {
    position: start + delta * blend,
    velocity: delta * (30 * u ** 2 - 60 * u ** 3 + 30 * u ** 4) / safeDuration,
    acceleration: delta * (60 * u - 180 * u ** 2 + 120 * u ** 3) / safeDuration ** 2,
  }
}
