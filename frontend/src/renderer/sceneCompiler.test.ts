import { describe, expect, it } from 'vitest'
import { DEFAULT_LESSON, THREE_R_ONE_P_LESSON } from '../defaultLesson'
import { compileScene } from './sceneCompiler'

describe('scene compiler', () => {
  it('compiles the allow-listed Canadarm preset', () => {
    const scene = compileScene(DEFAULT_LESSON)
    expect(scene.kind).toBe('canadarm')
    expect(scene.controls.map((control) => control.parameterId)).toEqual([
      'joint_1.d',
      'joint_2.theta',
    ])
  })

  it('compiles every approved control in a generic 3R+1P chain', () => {
    const scene = compileScene(THREE_R_ONE_P_LESSON)
    expect(scene.kind).toBe('dh_chain')
    expect(scene.controls).toHaveLength(4)
    expect(scene.controls.map((control) => control.jointType)).toEqual([
      'prismatic',
      'revolute',
      'revolute',
      'revolute',
    ])
  })
})
