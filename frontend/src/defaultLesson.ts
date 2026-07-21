import type { LessonResponse } from './types'

export const DEFAULT_LESSON: LessonResponse = {
  lessonId: 'local-demo',
  status: 'ready',
  source: 'validated_fallback',
  fallbackReason: 'backend_not_connected',
  lessonSpec: {
    version: '1.0',
    intent: 'compare_canadarm_d1_and_theta2',
    confidence: 1,
    learningGoal: 'Distinguish Canadarm d₁ and θ₂ in standard DH notation',
    misconceptions: [
      'Learner treats both values as equivalent displacement',
      'Learner thinks θ only affects the rotation block',
    ],
    requiredObservations: ['d₁ translates along z₀', 'θ₂ rotates about z₁'],
    activityTemplateId: 'canadarm_d1_vs_theta2',
    difficulty: 'introductory',
    successEvidence: [
      'Submit both predictions',
      'Change both target parameters',
      'Explain joint type, motion and axis',
    ],
  },
  robotSpec: {
    version: '1.0',
    convention: 'standard_dh',
    templateId: 'canadarm_d1_vs_theta2',
    name: 'Canadarm d₁ / θ₂ Comparison',
    lengthUnit: 'm',
    angleUnit: 'rad',
    joints: [
      {
        id: 'joint_1',
        type: 'prismatic',
        a: 0,
        alpha: Math.PI / 2,
        d: {
          parameterId: 'joint_1.d',
          variable: 'q1',
          default: 1.8,
          min: 0.8,
          max: 3,
          unit: 'm',
        },
        theta: 0,
      },
      {
        id: 'joint_2',
        type: 'revolute',
        a: 3.85,
        alpha: 0,
        d: 0,
        theta: {
          parameterId: 'joint_2.theta',
          variable: 'q2',
          default: 0.6,
          min: -1.5708,
          max: 1.5708,
          unit: 'rad',
        },
      },
    ],
  },
  activitySpec: {
    version: '1.0',
    templateId: 'canadarm_d1_vs_theta2',
    editableParameterIds: ['joint_1.d', 'joint_2.theta'],
    visibleFrames: [0, 1, 2, 3, 4, 5],
    matrixHighlightMode: 'direct_and_propagated',
    steps: [
      {
        id: 'predict_d',
        type: 'prediction',
        parameterId: 'joint_1.d',
        answerType: 'multiple_choice',
        instruction: 'Predict what will happen when Canadarm d₁ increases.',
      },
      {
        id: 'interact_d',
        type: 'interaction',
        parameterId: 'joint_1.d',
        completionRule: 'parameter_changed',
      },
      {
        id: 'predict_theta',
        type: 'prediction',
        parameterId: 'joint_2.theta',
        answerType: 'multiple_choice',
        instruction: 'Predict what will happen when Canadarm θ₂ increases.',
      },
      {
        id: 'interact_theta',
        type: 'interaction',
        parameterId: 'joint_2.theta',
        completionRule: 'parameter_changed',
      },
      {
        id: 'explain_difference',
        type: 'explanation',
        answerType: 'free_text',
        prompt: 'Explain the difference between Canadarm d₁ and θ₂.',
      },
    ],
  },
  sceneSpec: {
    version: '1.0',
    visualPreset: 'canadarm_q5',
    topic: 'forward_kinematics',
    modelSource: 'teaching_template',
    robot: {
      representation: 'standard_dh',
      templateId: 'canadarm_d1_vs_theta2',
    },
    lesson: {
      activityTemplate: 'canadarm_d1_vs_theta2',
      controls: ['joint_1.d', 'joint_2.theta'],
      overlays: [
        'joint_labels',
        'dh_frames',
        'joint_axes',
        'symbolic_dimensions',
        'dh_table',
        'transform_matrix',
        'end_effector_pose',
      ],
    },
  },
  verification: {
    approved: true,
    usedFallback: true,
    checks: {
      schema: 'passed',
      rules: 'passed',
      kinematics: 'passed',
      renderability: 'passed',
      pedagogy: 'passed',
    },
    issues: [],
  },
  agentTrace: {
    traceId: 'local-trace',
    lessonId: 'local-demo',
    calls: [
      {
        agent: 'pedagogy',
        provider: 'local-template',
        model: 'deterministic-v1',
        attempt: 1,
        status: 'supported_intent',
        latencyMs: 0,
      },
      {
        agent: 'environment',
        provider: 'local-template',
        model: 'deterministic-v1',
        attempt: 1,
        status: 'template_composed',
        latencyMs: 0,
      },
      {
        agent: 'verification',
        provider: 'deterministic',
        model: 'rules-v1',
        attempt: 1,
        status: 'approved',
        latencyMs: 0,
      },
    ],
    finalOutcome: 'validated_fallback',
  },
}

export const TWO_R_ONE_P_LESSON: LessonResponse = {
  ...DEFAULT_LESSON,
  lessonId: 'local-2r1p-demo',
  lessonSpec: {
    ...DEFAULT_LESSON.lessonSpec,
    intent: 'explore_serial_2r1p',
    confidence: 0.98,
    learningGoal: 'Explore a serial 2R+1P arm with standard DH parameters.',
    activityTemplateId: 'serial_2r1p',
  },
  robotSpec: {
    ...DEFAULT_LESSON.robotSpec,
    templateId: 'serial_2r1p',
    name: 'Serial 2R + 1P Arm',
    joints: [
      { id: 'joint_1', type: 'prismatic', a: 0, alpha: 0, d: { parameterId: 'joint_1.d', variable: 'q1', default: 1.5, min: 0.4, max: 3.2, unit: 'm' }, theta: 0 },
      { id: 'joint_2', type: 'revolute', a: 3.2, alpha: 0, d: 0, theta: { parameterId: 'joint_2.theta', variable: 'q2', default: 0.65, min: -Math.PI, max: Math.PI, unit: 'rad' } },
      { id: 'joint_3', type: 'revolute', a: 2.4, alpha: 0, d: 0, theta: { parameterId: 'joint_3.theta', variable: 'q3', default: -0.85, min: -Math.PI, max: Math.PI, unit: 'rad' } },
    ],
  },
  activitySpec: {
    ...DEFAULT_LESSON.activitySpec,
    templateId: 'serial_2r1p',
    editableParameterIds: ['joint_1.d', 'joint_2.theta', 'joint_3.theta'],
    visibleFrames: [0, 1, 2, 3],
  },
  sceneSpec: {
    ...DEFAULT_LESSON.sceneSpec,
    visualPreset: 'dh_chain',
    robot: { representation: 'standard_dh', templateId: 'serial_2r1p' },
    lesson: {
      activityTemplate: 'serial_2r1p',
      controls: ['joint_1.d', 'joint_2.theta', 'joint_3.theta'],
      overlays: ['joint_labels', 'dh_frames', 'joint_axes', 'dh_table', 'transform_matrix', 'end_effector_pose'],
    },
  },
}

export const THREE_R_ONE_P_LESSON: LessonResponse = {
  ...TWO_R_ONE_P_LESSON,
  lessonId: 'local-3r1p-json-demo',
  lessonSpec: {
    ...TWO_R_ONE_P_LESSON.lessonSpec,
    intent: 'explore_serial_3r1p',
    learningGoal: 'Visualize a JSON-defined 3R+1P serial arm with standard DH parameters.',
    activityTemplateId: 'serial_3r1p',
  },
  robotSpec: {
    ...TWO_R_ONE_P_LESSON.robotSpec,
    templateId: 'serial_3r1p',
    name: 'JSON-defined Serial 3R + 1P Arm',
    joints: [
      { id: 'joint_1', type: 'prismatic', a: 0, alpha: 0, d: { parameterId: 'joint_1.d', variable: 'q1', default: 1.2, min: 0.3, max: 3, unit: 'm' }, theta: 0 },
      { id: 'joint_2', type: 'revolute', a: 2.8, alpha: 0, d: 0, theta: { parameterId: 'joint_2.theta', variable: 'q2', default: 0.55, min: -Math.PI, max: Math.PI, unit: 'rad' } },
      { id: 'joint_3', type: 'revolute', a: 2.2, alpha: 0, d: 0, theta: { parameterId: 'joint_3.theta', variable: 'q3', default: -0.9, min: -Math.PI, max: Math.PI, unit: 'rad' } },
      { id: 'joint_4', type: 'revolute', a: 1.5, alpha: 0, d: 0, theta: { parameterId: 'joint_4.theta', variable: 'q4', default: 0.7, min: -Math.PI, max: Math.PI, unit: 'rad' } },
    ],
  },
  activitySpec: {
    ...TWO_R_ONE_P_LESSON.activitySpec,
    templateId: 'serial_3r1p',
    editableParameterIds: ['joint_1.d', 'joint_2.theta', 'joint_3.theta', 'joint_4.theta'],
    visibleFrames: [0, 1, 2, 3, 4],
  },
  sceneSpec: {
    ...TWO_R_ONE_P_LESSON.sceneSpec,
    visualPreset: 'dh_chain',
    robot: { representation: 'standard_dh', templateId: 'serial_3r1p' },
    lesson: {
      activityTemplate: 'serial_3r1p',
      controls: ['joint_1.d', 'joint_2.theta', 'joint_3.theta', 'joint_4.theta'],
      overlays: ['joint_labels', 'dh_frames', 'joint_axes', 'dh_table', 'transform_matrix', 'end_effector_pose'],
    },
  },
}

export const ONE_R_ONE_P_SCENE_JSON = JSON.stringify({
  robotSpec: {
    version: '1.0', convention: 'standard_dh', templateId: 'my_1r1p_arm', name: 'JSON 1R + 1P Arm', lengthUnit: 'm', angleUnit: 'rad',
    joints: [
      { id: 'joint_1', type: 'revolute', a: 2.4, alpha: 0, d: 0, theta: { parameterId: 'joint_1.theta', variable: 'q1', default: 0.6, min: -3.1416, max: 3.1416, unit: 'rad' } },
      { id: 'joint_2', type: 'prismatic', a: 0, alpha: 0, theta: 0, d: { parameterId: 'joint_2.d', variable: 'q2', default: 1.1, min: 0.2, max: 2.5, unit: 'm' } },
    ],
  },
  sceneSpec: {
    version: '1.0', visualPreset: 'dh_chain', topic: 'forward_kinematics', modelSource: 'problem_extracted',
    robot: { representation: 'standard_dh', templateId: 'my_1r1p_arm' },
    lesson: { activityTemplate: 'json_standard_dh', controls: ['joint_1.theta', 'joint_2.d'], overlays: ['joint_labels', 'dh_frames', 'joint_axes', 'dh_table', 'transform_matrix', 'end_effector_pose'] },
  },
}, null, 2)
