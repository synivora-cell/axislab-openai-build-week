export type Matrix4 = number[][]

export interface VariableSpec {
  parameterId: string
  variable: string
  default: number
  min: number
  max: number
  unit: 'rad' | 'm'
}

export interface JointSpec {
  id: string
  type: 'revolute' | 'prismatic'
  a: number
  alpha: number
  d: number | VariableSpec
  theta: number | VariableSpec
}

export interface RobotSpec {
  version: '1.0'
  convention: 'standard_dh'
  templateId: string
  name: string
  lengthUnit: 'm'
  angleUnit: 'rad'
  joints: JointSpec[]
}

export interface LessonSpec {
  version: '1.0'
  intent: string
  confidence: number
  learningGoal: string
  misconceptions: string[]
  requiredObservations: string[]
  activityTemplateId: string
  difficulty: 'introductory'
  successEvidence: string[]
}

export interface ActivityStep {
  id: string
  type: 'prediction' | 'interaction' | 'explanation'
  parameterId?: string
  answerType?: 'multiple_choice' | 'free_text'
  instruction?: string
  prompt?: string
  completionRule?: 'parameter_changed'
}

export interface ActivitySpec {
  version: '1.0'
  templateId: string
  editableParameterIds: string[]
  visibleFrames: number[]
  matrixHighlightMode: 'direct_and_propagated'
  steps: ActivityStep[]
}

export type SceneOverlay =
  | 'joint_labels'
  | 'dh_frames'
  | 'joint_axes'
  | 'symbolic_dimensions'
  | 'dh_table'
  | 'transform_matrix'
  | 'end_effector_pose'

/** The renderer's validated entry point. Visual dimensions stay inside the preset. */
export interface RoboticsSceneSpec {
  version: '1.0'
  visualPreset: 'canadarm_q5' | 'dh_chain'
  topic: 'forward_kinematics'
  modelSource: 'teaching_template' | 'problem_extracted'
  robot: {
    representation: 'standard_dh'
    templateId: string
  }
  lesson: {
    activityTemplate: string
    controls: string[]
    overlays: SceneOverlay[]
  }
}

export interface VerificationResult {
  approved: boolean
  usedFallback: boolean
  checks: Record<'schema' | 'rules' | 'kinematics' | 'renderability' | 'pedagogy', 'passed' | 'failed' | 'not_run'>
  issues: Array<{
    source: string
    code: string
    path?: string
    message: string
    suggestedFix?: string
  }>
}

export interface AgentCall {
  agent: 'pedagogy' | 'environment' | 'verification'
  provider: string
  model: string
  attempt: number
  status: string
  latencyMs: number
  requestId?: string
  promptTokens?: number
  completionTokens?: number
  inputPayload?: Record<string, unknown>
  outputPayload?: Record<string, unknown>
  issueCodes?: string[]
  error?: string
}

export interface LessonResponse {
  lessonId: string
  status: 'ready'
  source: 'validated_template' | 'validated_fallback' | 'validated_json' | 'generated' | 'generated_revised'
  fallbackReason?: string
  lessonSpec: LessonSpec
  robotSpec: RobotSpec
  activitySpec: ActivitySpec
  sceneSpec: RoboticsSceneSpec
  verification: VerificationResult
  agentTrace: {
    traceId: string
    lessonId: string
    calls: AgentCall[]
    finalOutcome: string
  }
}

export interface InteractionEvent {
  eventId: string
  sequence: number
  type: 'prediction_submitted' | 'parameter_changed' | 'explanation_submitted'
  stepId: string
  parameterId?: string
  answer?: string
  from?: number
  to?: number
  clientTimestamp: string
}

export interface LearnerFeedback {
  summary: string
  evidence: string[]
  nextStep: string
  mastery: 'developing' | 'demonstrated'
  score: number
}

export type AdvancedConcept =
  | 'rotation_order' | 'equivalent_angles' | 'wrist_singularity'
  | 'jacobian_columns' | 'jacobian_singularity' | 'velocity_mapping'
  | 'endpoint_constraints' | 'duration_effect' | 'profile_choice'
  | 'jacobian_transpose' | 'posture_torque' | 'gravity_compensation'

export interface AdvancedLessonSpec {
  version: '1.0'
  topic: 'orientation' | 'jacobian' | 'trajectory' | 'dynamics'
  mode: 'rpy' | 'zyz' | 'standard' | 'cubic' | 'quintic'
  difficulty: 'introductory' | 'intermediate' | 'advanced'
  scenarioTitle: string
  learningGoal: string
  misconceptions: string[]
  parameters: Record<string, number>
  tasks: { id: string; concept: AdvancedConcept; prompt: string }[]
}

export interface ModuleLessonResponse {
  lessonId: string
  status: 'ready'
  source: 'validated_template' | 'validated_fallback' | 'generated'
  fallbackReason?: string | null
  lessonSpec: AdvancedLessonSpec
  verification: {
    approved: boolean
    usedFallback: boolean
    checks: Record<string, 'passed' | 'failed'>
    issues: string[]
  }
  agentTrace: {
    traceId: string
    lessonId: string
    calls: AgentCall[]
    finalOutcome: string
  }
}
