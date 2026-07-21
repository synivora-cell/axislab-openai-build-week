import { describe, expect, it } from 'vitest'
import { detectCoordinateSystem } from './coordinateRouting'

describe('coordinate-system prompt routing', () => {
  it.each([
    ['Explain Cartesian coordinates', 'cartesian'],
    ['Show a cylindrical coordinate visualization', 'cylindrical'],
    ['How do spherical coordinates locate a point?', 'spherical'],
    ['请讲解球坐标', 'spherical'],
  ])('routes %s to %s', (question, expected) => {
    expect(detectCoordinateSystem(question)).toBe(expected)
  })

  it('leaves robot questions on the Agent path', () => {
    expect(detectCoordinateSystem('Create a 1R + 3P standard-DH robot')).toBeNull()
  })
})
