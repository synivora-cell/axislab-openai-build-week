import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import {
  BadgeCheck,
  Boxes,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleAlert,
  CloudOff,
  Cpu,
  LoaderCircle,
  Play,
  RotateCcw,
  Send,
  Sparkles,
} from 'lucide-react'
import { BlockMath, InlineMath } from 'react-katex'
import { createLesson, createModuleLesson, createScene, requestFeedback, submitEvents, validateState } from './api'
import { detectAdvancedTopic, type AdvancedTopic } from './advancedRobotics'
import { MatrixPanel } from './components/MatrixPanel'
import { detectCoordinateSystem, type CoordinateSystemKind } from './coordinateRouting'
import { DEFAULT_LESSON, ONE_R_ONE_P_SCENE_JSON, THREE_R_ONE_P_LESSON, TWO_R_ONE_P_LESSON } from './defaultLesson'
import { defaultJointValues, formatNumber, forwardKinematics } from './kinematics'
import { compileScene } from './renderer/sceneCompiler'
import type {
  ActivityStep,
  InteractionEvent,
  LearnerFeedback,
  LessonResponse,
  ModuleLessonResponse,
  RobotSpec,
  VariableSpec,
} from './types'

type ConnectionState = 'local' | 'connected' | 'checking' | 'verified' | 'mismatch'

interface PredictionResult {
  correct: boolean
  expected: 'rotate' | 'translate'
}

const RobotScene = lazy(() =>
  import('./components/RobotScene').then((module) => ({ default: module.RobotScene })),
)
const CoordinateSystemLesson = lazy(() =>
  import('./components/CoordinateSystemLesson').then((module) => ({ default: module.CoordinateSystemLesson })),
)
const AdvancedRoboticsLesson = lazy(() =>
  import('./components/AdvancedRoboticsLesson').then((module) => ({ default: module.AdvancedRoboticsLesson })),
)

function variableOf(value: number | VariableSpec): VariableSpec | null {
  return typeof value === 'number' ? null : value
}

function nowId(prefix: string) {
  const suffix = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
  return `${prefix}-${suffix}`
}

interface ParameterMeta {
  jointIndex: number
  jointType: 'revolute' | 'prismatic'
  spec: VariableSpec
}

function parameterMeta(robot: RobotSpec, parameterId?: string): ParameterMeta | null {
  if (!parameterId) return null
  for (const [jointIndex, joint] of robot.joints.entries()) {
    const spec = variableOf(joint.type === 'prismatic' ? joint.d : joint.theta)
    if (spec?.parameterId === parameterId) return { jointIndex, jointType: joint.type, spec }
  }
  return null
}

function parameterSymbol(meta: ParameterMeta): string {
  return `${meta.jointType === 'prismatic' ? 'd' : 'θ'}${meta.jointIndex + 1}`
}

function stepTitle(step: ActivityStep | null, meta: ParameterMeta | null): string {
  if (!step) return 'Learning feedback'
  if (step.type === 'explanation') return 'Explain your observation'
  const action = step.type === 'prediction' ? 'Predict' : 'Manipulate'
  return `${action} ${meta ? parameterSymbol(meta) : 'joint variable'}`
}

function buildLocalFeedback(events: InteractionEvent[], lesson: LessonResponse): LearnerFeedback {
  const expectedByParameter = new Map(
    lesson.robotSpec.joints.map((joint) => {
      const spec = variableOf(joint.type === 'prismatic' ? joint.d : joint.theta)!
      return [spec.parameterId, joint.type === 'prismatic' ? 'translate' : 'rotate']
    }),
  )
  const predictionEvents = events.filter((event) => event.type === 'prediction_submitted' && event.parameterId)
  const correctPredictions = predictionEvents.filter(
    (event) => expectedByParameter.get(event.parameterId!) === event.answer,
  ).length
  const interactionTargets = lesson.activitySpec.steps
    .filter((step) => step.type === 'interaction' && step.parameterId)
    .map((step) => step.parameterId!)
  const changed = new Set(events.filter((event) => event.type === 'parameter_changed').map((event) => event.parameterId))
  const explanation = [...events].reverse().find((event) => event.type === 'explanation_submitted')?.answer ?? ''
  const lower = explanation.toLowerCase()
  const needsRotation = lesson.robotSpec.joints.some((joint) => joint.type === 'revolute')
  const needsTranslation = lesson.robotSpec.joints.some((joint) => joint.type === 'prismatic')
  const hasRotation = lower.includes('rotate') || lower.includes('rotation')
  const hasTranslation = lower.includes('translate') || lower.includes('translation')
  const explanationMatches = (!needsRotation || hasRotation) && (!needsTranslation || hasTranslation)
    && (lower.includes('axis') || lower.includes('z_') || lower.includes('z-') || lower.includes('轴'))
  const allPredictionsCorrect = predictionEvents.length > 0 && correctPredictions === predictionEvents.length
  const allInteractionsCompleted = interactionTargets.every((parameterId) => changed.has(parameterId))
  const mastery = allPredictionsCorrect && allInteractionsCompleted && explanationMatches ? 'demonstrated' : 'developing'
  const predictionScore = predictionEvents.length > 0 ? Math.round(60 * correctPredictions / predictionEvents.length) : 0
  const completedCount = interactionTargets.filter((parameterId) => changed.has(parameterId)).length
  const interactionScore = interactionTargets.length > 0 ? Math.round(20 * completedCount / interactionTargets.length) : 20
  const score = predictionScore + interactionScore + (explanationMatches ? 20 : 0)
  return {
    mastery,
    score,
    summary:
      mastery === 'demonstrated'
        ? `You connected the joint types, DH variables, and motion of ${lesson.robotSpec.name}.`
        : 'You are building the right connection: θᵢ rotates about zᵢ₋₁, while dᵢ translates along zᵢ₋₁.',
    evidence: [
      `${correctPredictions} of ${predictionEvents.length} predictions were correct.`,
      explanationMatches ? 'Your final explanation covered every joint motion type in this robot.' : 'Your final explanation still needs to connect each motion type to its joint axis.',
      `You manipulated ${completedCount} of ${interactionTargets.length} target variables.`,
    ],
    nextStep: `Change each joint variable in ${lesson.robotSpec.name} and observe how it affects downstream frames and the end-effector pose.`,
  }
}

export function App() {
  const [question, setQuestion] = useState('What is the difference between dᵢ and θᵢ in a DH table?')
  const [sceneJson, setSceneJson] = useState(ONE_R_ONE_P_SCENE_JSON)
  const [lesson, setLesson] = useState<LessonResponse>(DEFAULT_LESSON)
  const [jointValues, setJointValues] = useState<Record<string, number>>(
    defaultJointValues(DEFAULT_LESSON.robotSpec),
  )
  const [stage, setStage] = useState(0)
  const [prediction, setPrediction] = useState('')
  const [predictionResult, setPredictionResult] = useState<PredictionResult | null>(null)
  const [explanation, setExplanation] = useState('')
  const [events, setEvents] = useState<InteractionEvent[]>([])
  const [completedInteractions, setCompletedInteractions] = useState<Set<string>>(new Set())
  const [feedback, setFeedback] = useState<LearnerFeedback | null>(null)
  const [creating, setCreating] = useState(false)
  const [connection, setConnection] = useState<ConnectionState>('local')
  const [notice, setNotice] = useState('A verified local activity is loaded. Connect the API for client-server math verification.')
  const [recapPlaying, setRecapPlaying] = useState(false)
  const [coordinateSystem, setCoordinateSystem] = useState<CoordinateSystemKind | null>(null)
  const [advancedTopic, setAdvancedTopic] = useState<AdvancedTopic | null>(null)
  const [advancedLesson, setAdvancedLesson] = useState<ModuleLessonResponse | null>(null)

  const sessionId = useRef(nowId('session'))
  const eventSequence = useRef(0)
  const requestSequence = useRef(0)
  const committedValues = useRef<Record<string, number>>(jointValues)

  const learningSteps = lesson.activitySpec.steps
  const feedbackStage = learningSteps.length
  const activeStep = learningSteps[stage] ?? null
  const activeMeta = parameterMeta(lesson.robotSpec, activeStep?.parameterId)
  const activeParameterId = activeMeta?.spec.parameterId
  const activeParameter: 'theta' | 'd' = activeMeta?.jointType === 'revolute' ? 'theta' : 'd'
  const stageLabel = stepTitle(activeStep, activeMeta)
  const totalStages = feedbackStage + 1
  const stageItems = [
    ...learningSteps.map((step) => ({
      id: step.id,
      title: stepTitle(step, parameterMeta(lesson.robotSpec, step.parameterId)),
    })),
    { id: 'learning-feedback', title: 'Learning feedback' },
  ]
  const kinematics = useMemo(
    () => forwardKinematics(lesson.robotSpec, jointValues),
    [lesson.robotSpec, jointValues],
  )
  const compiledScene = useMemo(() => compileScene(lesson), [lesson])
  const genericTitle = `${lesson.robotSpec.joints.filter((joint) => joint.type === 'revolute').length}R + ${lesson.robotSpec.joints.filter((joint) => joint.type === 'prismatic').length}P`
  const traceProvider = lesson.agentTrace.calls.find((call) => call.provider !== 'deterministic')?.provider
  const dhRows = lesson.robotSpec.joints.map((joint, index) => {
    const thetaValue = variableOf(joint.theta)
    const dValue = variableOf(joint.d)
    const variable = joint.type === 'prismatic' ? dValue : thetaValue
    return {
      id: joint.id,
      label: `J${index + 1}`,
      type: joint.type === 'prismatic' ? 'P' : 'R',
      theta: thetaValue ? jointValues[thetaValue.parameterId] ?? thetaValue.default : typeof joint.theta === 'number' ? joint.theta : 0,
      d: dValue ? jointValues[dValue.parameterId] ?? dValue.default : typeof joint.d === 'number' ? joint.d : 0,
      a: joint.a,
      alpha: joint.alpha,
      active: variable?.parameterId === activeParameterId,
    }
  })

  function newEvent(
    event: Omit<InteractionEvent, 'eventId' | 'sequence' | 'clientTimestamp'>,
  ): InteractionEvent {
    eventSequence.current += 1
    return {
      ...event,
      eventId: nowId('evt'),
      sequence: eventSequence.current,
      clientTimestamp: new Date().toISOString(),
    }
  }

  function resetLearning(nextLesson: LessonResponse) {
    setCoordinateSystem(null)
    setAdvancedTopic(null)
    setAdvancedLesson(null)
    const values = defaultJointValues(nextLesson.robotSpec)
    setLesson(nextLesson)
    setJointValues(values)
    committedValues.current = values
    setStage(0)
    setPrediction('')
    setPredictionResult(null)
    setExplanation('')
    setEvents([])
    setCompletedInteractions(new Set())
    setFeedback(null)
    setRecapPlaying(false)
    eventSequence.current = 0
    requestSequence.current = 0
    sessionId.current = nowId('session')
  }

  async function handleCreateLesson() {
    if (question.trim().length < 3) return
    const coordinateKind = detectCoordinateSystem(question)
    if (coordinateKind) {
      setCoordinateSystem(coordinateKind)
      setConnection('connected')
      setNotice(`Loaded the verified ${coordinateKind} coordinate visualization preset.`)
      return
    }
    const localAdvancedTopic = detectAdvancedTopic(question)
    if (localAdvancedTopic) {
      setCreating(true)
      setNotice(`Customizing and verifying the ${localAdvancedTopic} learning activity…`)
      try {
        const response = await createModuleLesson(question.trim())
        setAdvancedLesson(response)
        setAdvancedTopic(response.lessonSpec.topic)
        setCoordinateSystem(null)
        setConnection('connected')
        setNotice(response.source === 'generated'
          ? 'The AI-customized module parameters and tasks passed deterministic verification.'
          : response.source === 'validated_fallback'
            ? 'The AI proposal was unavailable or invalid; a verified customized local fallback was loaded.'
            : 'A verified local customized module was loaded.')
      } catch {
        setAdvancedLesson(null)
        setAdvancedTopic(localAdvancedTopic)
        setCoordinateSystem(null)
        setConnection('local')
        setNotice('The customization API is unavailable; the verified local module remains usable.')
      } finally {
        setCreating(false)
      }
      return
    }
    setCreating(true)
    setNotice('Identifying the learning intent and verifying the activity…')
    try {
      const response = await createLesson(question.trim())
      resetLearning(response)
      setConnection('connected')
      setNotice(
        response.source === 'validated_fallback'
          ? 'The question was unsupported or an Agent call failed. AxisLab safely loaded the verified Canadarm d₁ / θ₂ activity.'
          : response.source === 'generated_revised'
            ? 'The first Environment proposal was rejected; its structured revision passed deterministic verification.'
            : 'The activity passed schema, rule, and kinematic verification.',
      )
    } catch {
      resetLearning(DEFAULT_LESSON)
      setConnection('local')
      setNotice('The API is unavailable. AxisLab switched to the verified local activity, so the core lesson remains usable.')
    } finally {
      setCreating(false)
    }
  }

  async function handleLoadSceneJson() {
    setCreating(true)
    try {
      resetLearning(await createScene(JSON.parse(sceneJson)))
      setConnection('connected')
      setNotice('The JSON scene passed schema, DH kinematic, and rendering-contract verification.')
    } catch (error) {
      setConnection('local')
      setNotice(`The JSON scene was not loaded: ${error instanceof Error ? error.message : 'invalid format or API error'}`)
    } finally {
      setCreating(false)
    }
  }

  function submitPrediction() {
    if (!prediction || !activeStep?.parameterId) return
    const event = newEvent({
      type: 'prediction_submitted',
      stepId: activeStep.id,
      parameterId: activeStep.parameterId,
      answer: prediction,
    })
    setEvents((current) => [...current, event])
    const expected = activeMeta?.jointType === 'prismatic' ? 'translate' : 'rotate'
    setPredictionResult({ correct: prediction === expected, expected })
  }

  function continuePrediction() {
    setStage((current) => Math.min(current + 1, feedbackStage))
    setPrediction('')
    setPredictionResult(null)
  }

  function updateJoint(parameterId: string, value: number) {
    setJointValues((current) => ({ ...current, [parameterId]: value }))
  }

  async function verifyCurrentState(values: Record<string, number>) {
    requestSequence.current += 1
    const sequence = requestSequence.current
    setConnection('checking')
    try {
      const clientKinematics = forwardKinematics(lesson.robotSpec, values)
      const result = await validateState(
        lesson.lessonId,
        sequence,
        values,
        clientKinematics.endEffector,
      )
      if (result.requestSequence !== requestSequence.current) return
      setConnection(result.valid ? 'verified' : 'mismatch')
      setNotice(
        result.valid
          ? 'Client and server end-effector poses match within 10⁻⁶.'
          : 'Client and server kinematics do not match. Check the implementation.',
      )
    } catch {
      setConnection('local')
      setNotice('Server verification is unavailable; the local deterministic engine remains active.')
    }
  }

  function commitInteraction(parameterId: string, stepId: string) {
    const previous = committedValues.current[parameterId]
    const current = jointValues[parameterId]
    if (previous === current) return false
    const event = newEvent({
      type: 'parameter_changed',
      stepId,
      parameterId,
      from: previous,
      to: current,
    })
    committedValues.current = { ...committedValues.current, [parameterId]: current }
    setEvents((existing) => [...existing, event])
    setCompletedInteractions((existing) => new Set(existing).add(parameterId))
    void verifyCurrentState(jointValues)
    return true
  }

  function continueInteraction() {
    if (!activeStep?.parameterId || !activeMeta) return
    const recorded = commitInteraction(activeStep.parameterId, activeStep.id)
    if (recorded || completedInteractions.has(activeStep.parameterId)) {
      setStage((current) => Math.min(current + 1, feedbackStage))
    }
  }

  async function submitExplanation() {
    if (explanation.trim().length < 12 || !activeStep) return
    const event = newEvent({
      type: 'explanation_submitted',
      stepId: activeStep.id,
      answer: explanation.trim(),
    })
    const finalEvents = [...events, event]
    setEvents(finalEvents)
    if (stage < learningSteps.length - 1) {
      setStage((current) => current + 1)
      setExplanation('')
      return
    }
    setStage(feedbackStage)
    setNotice('Generating feedback from your predictions, manipulations, and explanation…')
    try {
      await submitEvents(lesson.lessonId, sessionId.current, finalEvents)
      const response = await requestFeedback(lesson.lessonId, sessionId.current)
      setFeedback(response)
      setConnection('connected')
      setNotice('Feedback references only learning evidence recorded in this activity.')
    } catch {
      setFeedback(buildLocalFeedback(finalEvents, lesson))
      setConnection('local')
      setNotice('Feedback was generated with local rules. Connect the API to enable server feedback.')
    }
  }

  function restartActivity() {
    resetLearning(lesson)
    setNotice('The activity has been reset. Predict first, then manipulate the robot.')
  }

  function openCanadarmDemo() {
    resetLearning(DEFAULT_LESSON)
    setConnection('local')
    setNotice('Loaded the local Canadarm direct-control demo. Drag d₁ and θ₂ without calling an AI provider.')
  }

  function openCoordinateDemo() {
    setAdvancedTopic(null)
    setAdvancedLesson(null)
    setCoordinateSystem('cartesian')
    setConnection('connected')
  }

  function openAdvancedDemo(topic: AdvancedTopic) {
    setCoordinateSystem(null)
    setAdvancedLesson(null)
    setAdvancedTopic(topic)
    setConnection('connected')
  }

  const activeInteractionDone = activeMeta
    ? completedInteractions.has(activeMeta.spec.parameterId) ||
      jointValues[activeMeta.spec.parameterId] !== activeMeta.spec.default
    : false

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="AxisLab home">
          <span className="brand-mark"><Boxes size={21} /></span>
          <span>
            <strong>AxisLab</strong>
            <small>VERIFIED ROBOTICS LEARNING</small>
          </span>
        </a>
        <div className="top-status">
          <span className={`status-pill ${connection}`}>
            {coordinateSystem || advancedTopic ? <BadgeCheck size={14} /> : connection === 'checking' ? <LoaderCircle size={14} className="spin" /> : connection === 'verified' ? <BadgeCheck size={14} /> : connection === 'mismatch' ? <CircleAlert size={14} /> : connection === 'local' ? <CloudOff size={14} /> : <Check size={14} />}
            {coordinateSystem || advancedTopic ? 'Verified local module' : connection === 'verified' ? 'Math verified' : connection === 'checking' ? 'Checking' : connection === 'mismatch' ? 'Mismatch' : connection === 'local' ? 'Local fallback' : 'API connected'}
          </span>
          <span className="convention-pill">{coordinateSystem ? 'COORDINATE SYSTEMS' : advancedTopic ? 'ADVANCED ROBOTICS' : 'STANDARD DH'}</span>
        </div>
      </header>

      <main id="top">
        <section className="hero-strip">
          <div>
            <span className="eyebrow">LEARNING OBJECTIVE</span>
            <h1>{coordinateSystem ? `See how ${coordinateSystem} coordinates locate a point` : advancedTopic ? 'Connect advanced robotics equations to visible motion' : <>See how <InlineMath math="\theta" /> and <InlineMath math="d" /> drive real motion</>}</h1>
            <p>{coordinateSystem ? 'Manipulate each coordinate and connect its algebraic definition to visible geometry.' : advancedTopic ? 'Change every input and verify the resulting orientation, velocity, trajectory, force, and torque numerically.' : lesson.lessonSpec.learningGoal}</p>
          </div>
          {!coordinateSystem && !advancedTopic && <div className="progress-wrap">
            <span>Learning progress</span>
            <strong>{Math.min(stage + 1, totalStages)} / {totalStages}</strong>
            <div className="progress-track"><i style={{ width: `${(Math.min(stage + 1, totalStages) / totalStages) * 100}%` }} /></div>
          </div>}
        </section>

        <nav className="module-launcher" aria-label="Interactive module library">
          <span>Explore modules</span>
          <button type="button" className={!coordinateSystem && !advancedTopic ? 'active' : ''} onClick={openCanadarmDemo}>Canadarm</button>
          <button type="button" className={coordinateSystem ? 'active' : ''} onClick={openCoordinateDemo}>Coordinates</button>
          <button type="button" className={advancedTopic === 'orientation' ? 'active' : ''} onClick={() => openAdvancedDemo('orientation')}>RPY / Euler wrist</button>
          <button type="button" className={advancedTopic === 'jacobian' ? 'active' : ''} onClick={() => openAdvancedDemo('jacobian')}>Jacobian</button>
          <button type="button" className={advancedTopic === 'trajectory' ? 'active' : ''} onClick={() => openAdvancedDemo('trajectory')}>Trajectory</button>
          <button type="button" className={advancedTopic === 'dynamics' ? 'active' : ''} onClick={() => openAdvancedDemo('dynamics')}>Forces & dynamics</button>
        </nav>

        {!coordinateSystem && !advancedTopic && <details className="agent-trace-details">
          <summary><BrainCircuit size={15} />View lesson generation and verification trace</summary>
          <section className="agent-rail" aria-label="Agent trace">
            {lesson.agentTrace.calls.map((call, index) => {
              const Icon = call.agent === 'pedagogy' ? BrainCircuit : call.agent === 'environment' ? Boxes : BadgeCheck
              const failed = call.status === 'rejected' || call.status === 'provider_error'
              return (
                <div className="agent-item" key={`${call.agent}-${index}`} title={`${call.provider} · ${call.model}`}>
                  <span className="agent-icon"><Icon size={17} /></span>
                  <span>
                    <strong>{call.agent === 'pedagogy' ? 'Pedagogy' : call.agent === 'environment' ? 'Environment' : 'Verification'}</strong>
                    <small>{call.status.replace(/_/g, ' ')} · a{call.attempt} · {call.latencyMs}ms</small>
                  </span>
                  {failed ? <CircleAlert size={14} /> : <Check size={14} className="agent-check" />}
                </div>
              )
            })}
            <div className="trace-label">
              {lesson.source === 'validated_fallback'
                ? 'VALIDATED FALLBACK'
                : lesson.source === 'generated_revised'
                  ? `${traceProvider ?? 'QWEN'} · REVISED TRACE`
                  : lesson.source === 'generated'
                    ? `${traceProvider ?? 'QWEN'} · LIVE TRACE`
                    : lesson.source === 'validated_json'
                      ? 'VALIDATED JSON TRACE'
                      : 'TEMPLATE TRACE'}
            </div>
          </section>
        </details>}

        {coordinateSystem ? (
          <Suspense fallback={<div className="coordinate-lesson panel scene-loading"><LoaderCircle className="spin" /><span>Loading coordinate visualizer…</span></div>}>
            <CoordinateSystemLesson initialKind={coordinateSystem} onClose={() => setCoordinateSystem(null)} />
          </Suspense>
        ) : advancedTopic ? (
          <Suspense fallback={<div className="coordinate-lesson panel scene-loading"><LoaderCircle className="spin" /><span>Loading advanced robotics module…</span></div>}>
            <AdvancedRoboticsLesson key={advancedLesson?.lessonId ?? advancedTopic} initialTopic={advancedTopic} lessonSpec={advancedLesson?.lessonSpec} onClose={() => { setAdvancedTopic(null); setAdvancedLesson(null) }} />
          </Suspense>
        ) : (
        <section className="workspace-grid">
          <aside className="learning-panel panel">
            <div className="question-box">
              <label htmlFor="question">Your robotics question</label>
              <textarea
                id="question"
                rows={3}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
              <button className="primary-button" onClick={handleCreateLesson} disabled={creating || question.trim().length < 3}>
                {creating ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
                {creating ? 'Verifying…' : 'Generate verified experiment'}
              </button>
              <div className="prompt-examples" aria-label="Example questions">
                <button type="button" onClick={openCanadarmDemo}>Canadarm demo</button>
                <button type="button" onClick={() => setQuestion('Create a serial robot with one revolute joint followed by three prismatic joints, and explain how each joint affects the end-effector pose.')}>1R + 3P</button>
                <button type="button" onClick={() => setQuestion('Compare the motion produced by revolute θ and prismatic d variables in standard DH notation.')}>Compare R / P</button>
                <button type="button" onClick={() => setQuestion('Explain spherical coordinates with an interactive visualization.')}>Spherical</button>
                <button type="button" onClick={() => setQuestion('Explain cylindrical coordinates with an interactive visualization.')}>Cylindrical</button>
                <button type="button" onClick={() => setQuestion('Explain Cartesian coordinates with an interactive visualization.')}>Cartesian</button>
                <button type="button" onClick={() => openAdvancedDemo('orientation')}>RPY / Euler wrist</button>
                <button type="button" onClick={() => openAdvancedDemo('jacobian')}>Jacobian</button>
                <button type="button" onClick={() => openAdvancedDemo('trajectory')}>Trajectory</button>
                <button type="button" onClick={() => openAdvancedDemo('dynamics')}>Forces</button>
              </div>
              <details className="advanced-tools">
                <summary>Advanced experiments and JSON tools</summary>
                <div className="advanced-actions">
                  <button className="secondary-button" type="button" onClick={() => {
                    resetLearning(TWO_R_ONE_P_LESSON)
                    setConnection('local')
                    setNotice('Loaded the locally verified 2R+1P serial robot example.')
                  }}>2R + 1P example</button>
                  <button className="secondary-button" type="button" onClick={() => {
                    resetLearning(THREE_R_ONE_P_LESSON)
                    setConnection('local')
                    setNotice('Loaded the 3R+1P serial robot generated entirely from JSON/DH parameters.')
                  }}>3R + 1P example</button>
                </div>
                <label htmlFor="scene-json">Load Scene JSON directly</label>
                <textarea id="scene-json" rows={8} value={sceneJson} onChange={(event) => setSceneJson(event.target.value)} />
                <button className="secondary-button" type="button" onClick={handleLoadSceneJson} disabled={creating}>Generate robot from JSON</button>
              </details>
            </div>

            <div className="step-nav" aria-label="Learning steps">
              {stageItems.map((item, index) => (
                <div className={`step-dot ${index === stage ? 'active' : ''} ${index < stage ? 'done' : ''}`} key={item.id} title={item.title}>
                  {index < stage ? <Check size={12} /> : index + 1}
                </div>
              ))}
            </div>

            <div className="task-card">
              <span className="task-number">STEP {stage + 1}</span>
              <h2>{stageLabel}</h2>

              {activeStep?.type === 'prediction' && activeMeta && (
                <div className="prediction-task">
                  <p>{activeStep.instruction ?? `What will happen when ${parameterSymbol(activeMeta)} changes?`}</p>
                  <div className="answer-options">
                    {[
                      ['rotate', 'Rotate about the joint axis'],
                      ['translate', 'Translate along the joint axis'],
                      ['no_change', 'No change'],
                    ].map(([value, label]) => (
                      <label className={prediction === value ? 'selected' : ''} key={value}>
                        <input type="radio" name="prediction" value={value} checked={prediction === value} disabled={predictionResult !== null} onChange={() => setPrediction(value)} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  {predictionResult && (
                    <div className={`answer-result ${predictionResult.correct ? 'correct' : 'incorrect'}`} role="status">
                      {predictionResult.correct ? <Check size={16} /> : <CircleAlert size={16} />}
                      <span><strong>{predictionResult.correct ? 'Correct.' : 'Not quite.'}</strong> A {activeMeta.jointType} joint produces {predictionResult.expected === 'rotate' ? 'rotation about' : 'translation along'} its axis.</span>
                    </div>
                  )}
                  <button className="task-button" disabled={!prediction} onClick={predictionResult ? continuePrediction : submitPrediction}>
                    {predictionResult ? 'Continue' : 'Check answer'} <ChevronRight size={16} />
                  </button>
                </div>
              )}

              {activeStep?.type === 'interaction' && activeMeta && (
                <ParameterTask
                  symbol={parameterSymbol(activeMeta)}
                  value={jointValues[activeMeta.spec.parameterId] ?? activeMeta.spec.default}
                  spec={activeMeta.spec}
                  hint={activeMeta.jointType === 'prismatic'
                    ? `Observe how ${parameterSymbol(activeMeta)} translates the downstream chain along z${activeMeta.jointIndex}.`
                    : `Observe how ${parameterSymbol(activeMeta)} rotates the downstream chain about z${activeMeta.jointIndex}.`}
                  done={activeInteractionDone}
                  onChange={(value) => updateJoint(activeMeta.spec.parameterId, value)}
                  onCommit={() => commitInteraction(activeMeta.spec.parameterId, activeStep.id)}
                  onContinue={continueInteraction}
                />
              )}

              {activeStep?.type === 'explanation' && (
                <div className="explanation-task">
                  <p>{activeStep.prompt ?? 'Explain the joint variable, motion type, and corresponding axis in your own words.'}</p>
                  <textarea
                    rows={6}
                    value={explanation}
                    onChange={(event) => setExplanation(event.target.value)}
                    placeholder="Use your predictions, manipulations, and observed end-effector changes as evidence."
                  />
                  <div className="text-count">{explanation.trim().length} / 12 minimum characters</div>
                  <button className="task-button" disabled={explanation.trim().length < 12} onClick={submitExplanation}>
                    Submit explanation <Send size={15} />
                  </button>
                </div>
              )}

              {stage === feedbackStage && (
                <div className="feedback-card">
                  {feedback ? (
                    <>
                      <span className={`mastery ${feedback.mastery}`}>{feedback.mastery === 'demonstrated' ? 'Understanding demonstrated' : 'Understanding developing'}</span>
                      <div className="feedback-score"><strong>{feedback.score}</strong><span>/ 100<br />activity score</span></div>
                      <p className="feedback-summary">{feedback.summary}</p>
                      <ul>{feedback.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
                      <div className="next-step"><Sparkles size={15} /><span><strong>Next step</strong>{feedback.nextStep}</span></div>
                      <button className="secondary-button" onClick={() => setRecapPlaying((playing) => !playing)}>
                        <Play size={15} />{recapPlaying ? 'Pause formula recap' : 'Play formula recap'}
                      </button>
                      {recapPlaying && (
                        <div className="formula-recap" aria-label="theta and d formula recap">
                          <strong>STANDARD DH · VISUAL RECAP</strong>
                          <div className="recap-lane theta"><i /><span><InlineMath math="\theta_i" /> rotates about <InlineMath math="z_{i-1}" /></span></div>
                          <div className="recap-lane distance"><i /><span><InlineMath math="d_i" /> translates along <InlineMath math="z_{i-1}" /></span></div>
                        </div>
                      )}
                      <button className="secondary-button" onClick={restartActivity}><RotateCcw size={15} />Restart activity</button>
                    </>
                  ) : (
                    <div className="feedback-loading"><LoaderCircle className="spin" /><p>Analyzing this activity's learning evidence…</p></div>
                  )}
                </div>
              )}
            </div>

            <div className="system-notice">
              <Cpu size={16} />
              <span>{notice}</span>
            </div>
          </aside>

          <section className="visual-panel panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">INTERACTIVE ROBOT</span>
                <h2>{lesson.robotSpec.name} · {genericTitle}</h2>
              </div>
              {activeMeta && <span className={`focus-chip ${activeParameter}`}>
                {parameterSymbol(activeMeta)} · {activeMeta.jointType.toUpperCase()}
              </span>}
            </div>
            <Suspense fallback={<div className="scene-shell scene-loading"><LoaderCircle className="spin" /><span>Loading 3D scene…</span></div>}>
              <RobotScene
                scene={compiledScene}
                jointValues={jointValues}
                activeParameterId={activeParameterId}
                onJointChange={updateJoint}
              />
            </Suspense>
            <div className="pose-strip">
              <span><small>x</small><strong>{formatNumber(kinematics.endEffector[0][3])} m</strong></span>
              <span><small>y</small><strong>{formatNumber(kinematics.endEffector[1][3])} m</strong></span>
              <span><small>z</small><strong>{formatNumber(kinematics.endEffector[2][3])} m</strong></span>
              <span className="pose-label">END-EFFECTOR POSITION</span>
            </div>
            <div className="observation-card">
              <span>Observation</span>
              <p>{activeMeta
                ? activeMeta.jointType === 'revolute'
                  ? `${parameterSymbol(activeMeta)} rotates about z${activeMeta.jointIndex} and affects every downstream link.`
                  : `${parameterSymbol(activeMeta)} translates along z${activeMeta.jointIndex}, carrying the downstream chain with it.`
                : 'Observe how each joint variable changes downstream frames and the end-effector pose.'}</p>
            </div>
          </section>

          <aside className="math-panel panel">
            <section className="dh-section">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">STANDARD DH</span>
                  <h2>Parameter table</h2>
                </div>
                <span className="unit-note">rad · m</span>
              </div>
              <div className="dh-table" role="table">
                <div className="dh-row header" role="row"><span>Joint</span><span>θ</span><span>d</span><span>a</span><span>α</span></div>
                {dhRows.map((row) => (
                  <div className={`dh-row ${row.active ? `active ${activeParameter}` : ''}`} role="row" key={row.id}>
                    <span><b>{row.label}</b><small>{row.type}</small></span><span className={row.type === 'R' ? 'variable' : ''}>{formatNumber(row.theta)}</span><span className={row.type === 'P' ? 'variable' : ''}>{formatNumber(row.d)}</span><span>{formatNumber(row.a)}</span><span>{formatNumber(row.alpha)}</span>
                  </div>
                ))}
              </div>
              <div className="axis-rule">
                <BlockMath math={'\\theta_i:\\;\\text{rotate about }z_{i-1}\\qquad d_i:\\;\\text{translate along }z_{i-1}'} />
              </div>
            </section>
              <MatrixPanel
                local={kinematics.local}
                total={kinematics.endEffector}
                joints={lesson.robotSpec.joints}
                activeParameterId={activeParameterId}
              />
          </aside>
        </section>
        )}
      </main>
    </div>
  )
}

interface ParameterTaskProps {
  symbol: string
  value: number
  spec: VariableSpec
  hint: string
  done: boolean
  onChange: (value: number) => void
  onCommit: () => void
  onContinue: () => void
}

function ParameterTask({ symbol, value, spec, hint, done, onChange, onCommit, onContinue }: ParameterTaskProps) {
  const step = spec.unit === 'rad' ? 0.01 : 0.005
  return (
    <div className="parameter-task">
      <p>{hint}</p>
      <div className="slider-readout">
        <span>{symbol}</span>
        <input
          aria-label={`${symbol} numeric value in ${spec.unit}`}
          className="parameter-number"
          type="number"
          min={spec.min}
          max={spec.max}
          step={step}
          value={value}
          onChange={(event) => {
            const nextValue = Number(event.currentTarget.value)
            if (Number.isFinite(nextValue)) onChange(Math.min(spec.max, Math.max(spec.min, nextValue)))
          }}
          onBlur={onCommit}
        />
        <small>{spec.unit}</small>
      </div>
      <input
        aria-label={`${symbol} value in ${spec.unit}`}
        className="parameter-slider"
        type="range"
        min={spec.min}
        max={spec.max}
        step={step}
        value={value}
        onInput={(event) => onChange(Number(event.currentTarget.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
      <div className="range-labels"><span>{spec.min.toFixed(2)}</span><span>{spec.max.toFixed(2)}</span></div>
      <button className="task-button" disabled={!done} onClick={onContinue}>
        Record observation <ChevronRight size={16} />
      </button>
    </div>
  )
}
