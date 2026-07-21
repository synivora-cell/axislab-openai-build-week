import type { LessonResponse, RoboticsSceneSpec, RobotSpec, VariableSpec } from '../types'

export interface SceneControl {
  parameterId: string
  variable: string
  defaultValue: number
  min: number
  max: number
  unit: 'rad' | 'm'
  jointIndex: number
  jointType: 'revolute' | 'prismatic'
}

export interface CompiledScene {
  spec: RoboticsSceneSpec
  robot: RobotSpec
  kind: 'canadarm' | 'dh_chain'
  controls: SceneControl[]
  dParameterId: string
  thetaParameterId: string
  defaultD: number
  defaultTheta: number
}

function variableOf(value: number | VariableSpec): VariableSpec | null {
  return typeof value === 'number' ? null : value
}

/**
 * Converts a validated RobotSpec into an allow-listed render description.
 * `dh_chain` is generic: its geometry is derived solely from these joints.
 */
export function compileScene(lesson: LessonResponse): CompiledScene {
  const controls = lesson.robotSpec.joints.flatMap((joint, jointIndex) => {
    const variable = variableOf(joint.type === 'prismatic' ? joint.d : joint.theta)
    if (!variable) return []
    if (!lesson.sceneSpec.lesson.controls.includes(variable.parameterId)) {
      throw new Error(`scene controls must reference approved RobotSpec parameters: ${variable.parameterId}`)
    }
    return [{
      parameterId: variable.parameterId,
      variable: variable.variable,
      defaultValue: variable.default,
      min: variable.min,
      max: variable.max,
      unit: variable.unit,
      jointIndex,
      jointType: joint.type,
    }]
  })
  const d = controls.find((control) => control.jointType === 'prismatic')
  const theta = controls.find((control) => control.jointType === 'revolute')
  if (!d || !theta) throw new Error('the current learning UI requires at least one prismatic and one revolute joint')
  return {
    spec: lesson.sceneSpec,
    robot: lesson.robotSpec,
    kind: lesson.sceneSpec.visualPreset === 'canadarm_q5' ? 'canadarm' : 'dh_chain',
    controls,
    dParameterId: d.parameterId,
    thetaParameterId: theta.parameterId,
    defaultD: d.defaultValue,
    defaultTheta: theta.defaultValue,
  }
}
