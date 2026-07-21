import { describe, expect, it } from 'vitest'
import { forwardKinematics, multiply, standardDh } from './kinematics'
import { DEFAULT_LESSON } from './defaultLesson'

describe('standard DH kinematics', () => {
  it('returns identity for a zero-length zero-angle transform', () => {
    const result = standardDh(0, 0, 0, 0)
    const identity = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]
    result.flat().forEach((value, index) => {
      expect(value).toBeCloseTo(identity.flat()[index])
    })
  })

  it('multiplies transforms without mutating the inputs', () => {
    const left = standardDh(1, 0, 0, Math.PI / 2)
    const right = standardDh(2, 0, 0, 0)
    const result = multiply(left, right)
    expect(result[0][3]).toBeCloseTo(0)
    expect(result[1][3]).toBeCloseTo(3)
    expect(left[1][3]).toBeCloseTo(1)
  })

  it('computes a homogeneous end-effector transform for the default lesson', () => {
    const result = forwardKinematics(DEFAULT_LESSON.robotSpec, {})
    expect(result.local).toHaveLength(DEFAULT_LESSON.robotSpec.joints.length)
    expect(result.endEffector[3]).toEqual([0, 0, 0, 1])
  })
})
