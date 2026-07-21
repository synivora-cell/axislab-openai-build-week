import { describe, expect, it } from 'vitest'
import {
  detectAdvancedTopic,
  endEffectorVelocity,
  eulerZyzMatrix,
  matrixError,
  matrixToEulerZyz,
  matrixToRpy,
  planar2R,
  rpyMatrix,
  staticJointTorques,
  trajectoryState,
} from './advancedRobotics'

describe('advanced robotics prompt routing', () => {
  it.each([
    ['Explain an RPY wrist', 'orientation'],
    ['Show the Jacobian and differential motion', 'jacobian'],
    ['Create a quintic trajectory', 'trajectory'],
    ['Compute joint torque from an end force', 'dynamics'],
    ['讲解姿态矩阵逆解', 'orientation'],
  ])('routes %s', (question, expected) => expect(detectAdvancedTopic(question)).toBe(expected))
})

describe('orientation transformations', () => {
  it('recovers an RPY matrix from inverse angles', () => {
    const matrix = rpyMatrix(.4, -.3, 1.1)
    const solution = matrixToRpy(matrix)
    expect(matrixError(matrix, rpyMatrix(...solution.primary))).toBeLessThan(1e-10)
    expect(matrixError(matrix, rpyMatrix(...solution.equivalent))).toBeLessThan(1e-10)
  })

  it('recovers a ZYZ Euler matrix and its equivalent solution', () => {
    const matrix = eulerZyzMatrix(.6, .8, -.4)
    const solution = matrixToEulerZyz(matrix)
    expect(matrixError(matrix, eulerZyzMatrix(...solution.primary))).toBeLessThan(1e-10)
    expect(matrixError(matrix, eulerZyzMatrix(...solution.equivalent))).toBeLessThan(1e-10)
  })
})

describe('differential motion, trajectory and statics', () => {
  it('maps joint velocity and force through J and J transpose', () => {
    const state = planar2R(.4, -.7)
    expect(endEffectorVelocity(state.jacobian, [1, 0])).toEqual([state.jacobian[0][0], state.jacobian[1][0]])
    expect(staticJointTorques(state.jacobian, [1, 0])).toEqual([state.jacobian[0][0], state.jacobian[0][1]])
  })

  it.each(['cubic', 'quintic'] as const)('%s trajectory satisfies zero endpoint velocity', (kind) => {
    expect(trajectoryState(kind, -1, 2, 4, 0)).toMatchObject({ position: -1, velocity: 0 })
    const end = trajectoryState(kind, -1, 2, 4, 4)
    expect(end.position).toBeCloseTo(2)
    expect(end.velocity).toBeCloseTo(0)
  })
})
