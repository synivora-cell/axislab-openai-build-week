import { Html, Line, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo, useState } from 'react'
import { Matrix4 } from 'three'
import {
  degrees,
  eulerZyzMatrix,
  endEffectorVelocity,
  gravityTorques,
  matrixError,
  matrixToEulerZyz,
  matrixToRpy,
  planar2R,
  radians,
  rpyMatrix,
  staticJointTorques,
  trajectoryState,
  type AdvancedTopic,
  type Matrix3,
  type TrajectoryKind,
} from '../advancedRobotics'
import type { AdvancedConcept, AdvancedLessonSpec } from '../types'

interface AdvancedRoboticsLessonProps {
  initialTopic: AdvancedTopic
  lessonSpec?: AdvancedLessonSpec
  onClose: () => void
}

interface RangeControlProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
}

const TOPICS: { id: AdvancedTopic; label: string }[] = [
  { id: 'orientation', label: 'Wrist orientation' },
  { id: 'jacobian', label: 'Jacobian' },
  { id: 'trajectory', label: 'Trajectory' },
  { id: 'dynamics', label: 'Forces & dynamics' },
]

const TOPIC_COPY: Record<AdvancedTopic, { title: string; goal: string; questions: string[] }> = {
  orientation: {
    title: 'RPY and Euler wrist orientation',
    goal: 'Connect ordered wrist rotations, orientation matrices, inverse solutions, equivalent angles, and singularities.',
    questions: ['Why does rotation order matter?', 'How can two angle triples produce one matrix?', 'What information is lost at a wrist singularity?'],
  },
  jacobian: {
    title: 'Jacobian and differential motion',
    goal: 'See how instantaneous joint rates map to end-effector velocity and how singularity changes controllability.',
    questions: ['What does each Jacobian column represent?', 'When does det(J) approach zero?', 'How does joint velocity combine at the tool?'],
  },
  trajectory: {
    title: 'Joint-space trajectory planning',
    goal: 'Compare cubic and quintic time scaling while verifying endpoint position, velocity, and acceleration constraints.',
    questions: ['Why must velocity be continuous?', 'What extra constraints does a quintic satisfy?', 'How does duration change peak velocity?'],
  },
  dynamics: {
    title: 'Forces, torques, and gravity',
    goal: 'Map an end-effector force to joint torque with Jᵀ and compare it with gravity-compensation torque.',
    questions: ['Why is force mapped by Jᵀ?', 'Which posture creates the largest torque?', 'How does gravity compensation depend on configuration?'],
  },
}

const DEFAULT_CONCEPTS: Record<AdvancedTopic, AdvancedConcept[]> = {
  orientation: ['rotation_order', 'equivalent_angles', 'wrist_singularity'],
  jacobian: ['jacobian_columns', 'velocity_mapping', 'jacobian_singularity'],
  trajectory: ['endpoint_constraints', 'duration_effect', 'profile_choice'],
  dynamics: ['jacobian_transpose', 'posture_torque', 'gravity_compensation'],
}

const TASK_ANSWERS: Record<AdvancedConcept, { options: readonly string[]; answer: number; explanation: string }> = {
  rotation_order: { options: ['Finite rotations generally do not commute', 'Every rotation uses the same fixed axis', 'Only angle magnitude affects orientation'], answer: 0, explanation: 'Changing multiplication order changes which already-rotated axis the next rotation uses.' },
  equivalent_angles: { options: ['They reconstruct the same orientation matrix', 'They produce the same joint velocity only', 'They are equal component by component'], answer: 0, explanation: 'Angle parameterizations are not unique; matrix reconstruction verifies physical equivalence.' },
  wrist_singularity: { options: ['Two wrist rotation axes become aligned', 'The rotation matrix stops being orthogonal', 'All joint angles become zero'], answer: 0, explanation: 'At the singular middle angle, two rotations become coupled and one independent angle cannot be recovered.' },
  jacobian_columns: { options: ['One column is the tool velocity caused by one unit joint rate', 'Each column is a link mass', 'Each column is an absolute tool position'], answer: 0, explanation: 'A Jacobian column is an instantaneous motion contribution from its corresponding joint.' },
  velocity_mapping: { options: ['A linear combination of Jacobian columns', 'The determinant alone', 'The transpose multiplied by position'], answer: 0, explanation: 'The mapping x-dot = J q-dot sums every column scaled by its joint rate.' },
  jacobian_singularity: { options: ['The Jacobian loses rank and a Cartesian direction', 'Every joint must stop moving', 'The end effector position becomes undefined'], answer: 0, explanation: 'Rank loss removes at least one independently achievable instantaneous tool-motion direction.' },
  endpoint_constraints: { options: ['Position and velocity at both endpoints', 'Only the midpoint position', 'Only peak acceleration'], answer: 0, explanation: 'Both profiles shown enforce endpoint position and zero endpoint velocity.' },
  duration_effect: { options: ['Peak velocity and acceleration decrease', 'The geometric endpoints change', 'Joint displacement increases'], answer: 0, explanation: 'Stretching the same normalized path over more time reduces its derivatives.' },
  profile_choice: { options: ['Quintic, because it can constrain endpoint acceleration', 'Cubic, because it has fewer coefficients', 'Both always impose identical acceleration'], answer: 0, explanation: 'A quintic has enough coefficients for position, velocity, and acceleration at both endpoints.' },
  jacobian_transpose: { options: ['It follows from virtual work and power consistency', 'It is the inverse kinematics solution', 'It removes gravity automatically'], answer: 0, explanation: 'Equating Cartesian and joint power gives tau = J transpose F.' },
  posture_torque: { options: ['The Jacobian moment arms change with configuration', 'Force no longer has direction', 'Joint torque is constant for every pose'], answer: 0, explanation: 'The same Cartesian force produces different joint moments when posture changes.' },
  gravity_compensation: { options: ['Configuration-dependent torque that balances link weight', 'A constant Cartesian velocity', 'The determinant of the rotation matrix'], answer: 0, explanation: 'Gravity compensation supplies joint torque equal and opposite to the gravity load.' },
}

function RangeControl({ label, value, min, max, step = 1, unit = '', onChange }: RangeControlProps) {
  return <label className="advanced-range">
    <span><strong>{label}</strong><output>{value.toFixed(step < 1 ? 2 : 0)}{unit}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} />
  </label>
}

function MatrixGrid({ matrix }: { matrix: Matrix3 }) {
  return <div className="advanced-matrix" aria-label="Three by three rotation matrix">
    {matrix.flat().map((value, index) => <span key={`${index}-${value.toFixed(6)}`}>{value.toFixed(3)}</span>)}
  </div>
}

function OrientationGraphic({ matrix }: { matrix: Matrix3 }) {
  const transform = useMemo(() => new Matrix4().set(
    matrix[0][0], matrix[0][1], matrix[0][2], 0,
    matrix[1][0], matrix[1][1], matrix[1][2], 0,
    matrix[2][0], matrix[2][1], matrix[2][2], 0,
    0, 0, 0, 1,
  ), [matrix])
  return <div className="orientation-3d" aria-label="Draggable three-dimensional wrist orientation model">
    <Canvas camera={{ position: [5.4, 4.3, 6.2], fov: 42 }}>
      <color attach="background" args={['#f8fafc']} />
      <ambientLight intensity={1.1} /><directionalLight position={[5, 7, 6]} intensity={1.7} />
      <gridHelper args={[9, 18, '#cbd5e1', '#e2e8f0']} position={[0, -2.05, 0]} />
      <Line points={[[0, 0, 0], [2.7, 0, 0]]} color="#fca5a5" lineWidth={2} />
      <Line points={[[0, 0, 0], [0, 2.7, 0]]} color="#86efac" lineWidth={2} />
      <Line points={[[0, 0, 0], [0, 0, 2.7]]} color="#93c5fd" lineWidth={2} />
      <Html position={[2.9, 0, 0]} center><span className="wrist-axis-label fixed x">X</span></Html>
      <Html position={[0, 2.9, 0]} center><span className="wrist-axis-label fixed y">Y</span></Html>
      <Html position={[0, 0, 2.9]} center><span className="wrist-axis-label fixed z">Z</span></Html>
      <group matrix={transform} matrixAutoUpdate={false}>
        <mesh><sphereGeometry args={[.28, 32, 24]} /><meshStandardMaterial color="#273449" metalness={.25} roughness={.35} /></mesh>
        <mesh rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[1.55, .055, 12, 96]} /><meshStandardMaterial color="#ef4444" transparent opacity={.78} /></mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[1.32, .055, 12, 96]} /><meshStandardMaterial color="#22a06b" transparent opacity={.78} /></mesh>
        <mesh><torusGeometry args={[1.08, .055, 12, 96]} /><meshStandardMaterial color="#3159d9" transparent opacity={.78} /></mesh>
        <Line points={[[0, 0, 0], [2.5, 0, 0]]} color="#ef4444" lineWidth={5} />
        <Line points={[[0, 0, 0], [0, 2.5, 0]]} color="#22a06b" lineWidth={5} />
        <Line points={[[0, 0, 0], [0, 0, 2.5]]} color="#3159d9" lineWidth={5} />
        <Html position={[2.7, 0, 0]} center><span className="wrist-axis-label x">x′</span></Html>
        <Html position={[0, 2.7, 0]} center><span className="wrist-axis-label y">y′</span></Html>
        <Html position={[0, 0, 2.7]} center><span className="wrist-axis-label z">z′</span></Html>
      </group>
      <OrbitControls makeDefault enableDamping dampingFactor={.08} minDistance={4} maxDistance={12} target={[0, .25, 0]} />
    </Canvas>
    <span className="orientation-view-hint">Drag to orbit · Scroll to zoom · Sliders change wrist angles</span>
  </div>
}

function PlanarArmGraphic({ elbow, point, vector, vectorLabel }: { elbow: [number, number]; point: [number, number]; vector: [number, number]; vectorLabel: string }) {
  const map = ([x, y]: [number, number]) => [160 + x * 52, 205 - y * 52] as const
  const base = map([0, 0]); const e = map(elbow); const p = map(point)
  const scale = Math.max(1, Math.hypot(...vector))
  const tip: [number, number] = [p[0] + vector[0] * 55 / scale, p[1] - vector[1] * 55 / scale]
  return <svg className="advanced-svg" viewBox="0 0 360 280" role="img" aria-label="Interactive planar two-joint robot">
    <defs><marker id="vector-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#f08a32" /></marker></defs>
    <path d="M25 205 H335 M160 255 V25" stroke="#e1e6ee" />
    <line x1={base[0]} y1={base[1]} x2={e[0]} y2={e[1]} stroke="#5c6675" strokeWidth="18" strokeLinecap="round" />
    <line x1={e[0]} y1={e[1]} x2={p[0]} y2={p[1]} stroke="#8d98a8" strokeWidth="14" strokeLinecap="round" />
    {[base, e, p].map(([x, y], index) => <circle key={`${x}-${y}`} cx={x} cy={y} r={index === 2 ? 8 : 12} fill={index === 2 ? '#3159d9' : '#172033'} />)}
    <line x1={p[0]} y1={p[1]} x2={tip[0]} y2={tip[1]} stroke="#f08a32" strokeWidth="5" markerEnd="url(#vector-arrow)" />
    <text x={tip[0] + 7} y={tip[1] - 6} fill="#b55f1d" fontSize="12" fontWeight="700">{vectorLabel}</text>
  </svg>
}

function TrajectoryGraphic({ kind, start, end, duration, time }: { kind: TrajectoryKind; start: number; end: number; duration: number; time: number }) {
  const samples = Array.from({ length: 61 }, (_, index) => {
    const t = duration * index / 60
    return { t, ...trajectoryState(kind, start, end, duration, t) }
  })
  const range = Math.max(1, Math.abs(end - start))
  const path = samples.map((sample, index) => `${index ? 'L' : 'M'} ${35 + sample.t / duration * 290} ${220 - (sample.position - Math.min(start, end)) / range * 150}`).join(' ')
  const current = trajectoryState(kind, start, end, duration, time)
  const cx = 35 + time / duration * 290
  const cy = 220 - (current.position - Math.min(start, end)) / range * 150
  return <svg className="advanced-svg" viewBox="0 0 360 280" role="img" aria-label={`${kind} joint trajectory plot`}>
    <path d="M35 25 V220 H335" stroke="#9aa5b5" fill="none" />
    <path d={path} stroke="#3159d9" strokeWidth="5" fill="none" />
    <line x1={cx} y1="25" x2={cx} y2="220" stroke="#f08a32" strokeDasharray="5 5" />
    <circle cx={cx} cy={cy} r="8" fill="#f08a32" />
    <text x="180" y="258" textAnchor="middle">time (s)</text><text x="18" y="130" textAnchor="middle" transform="rotate(-90 18 130)">q (rad)</text>
  </svg>
}

export function AdvancedRoboticsLesson({ initialTopic, lessonSpec, onClose }: AdvancedRoboticsLessonProps) {
  const [topic, setTopic] = useState(initialTopic)
  const customParameters = lessonSpec?.parameters ?? {}
  const [orientationType, setOrientationType] = useState<'rpy' | 'zyz'>(lessonSpec?.mode === 'zyz' ? 'zyz' : 'rpy')
  const [a, setA] = useState(customParameters.angle1Deg ?? 25); const [b, setB] = useState(customParameters.angle2Deg ?? 35); const [c, setC] = useState(customParameters.angle3Deg ?? -20)
  const [jq1, setJq1] = useState(customParameters.q1Deg ?? 35); const [jq2, setJq2] = useState(customParameters.q2Deg ?? -55); const [qd1, setQd1] = useState(customParameters.qdot1 ?? .6); const [qd2, setQd2] = useState(customParameters.qdot2 ?? -.3)
  const [trajectoryKind, setTrajectoryKind] = useState<TrajectoryKind>(lessonSpec?.mode === 'cubic' ? 'cubic' : 'quintic')
  const [start, setStart] = useState(customParameters.start ?? -.5); const [end, setEnd] = useState(customParameters.end ?? 1.2); const [duration, setDuration] = useState(customParameters.duration ?? 4); const [time, setTime] = useState(customParameters.time ?? 2)
  const [dq1, setDq1] = useState(customParameters.q1Deg ?? 25); const [dq2, setDq2] = useState(customParameters.q2Deg ?? 40); const [forceX, setForceX] = useState(customParameters.forceX ?? 8); const [forceY, setForceY] = useState(customParameters.forceY ?? -4)
  const [taskAnswers, setTaskAnswers] = useState<Record<string, number>>({})
  const [checkedTasks, setCheckedTasks] = useState<Set<string>>(new Set())
  const [taskStage, setTaskStage] = useState(0)
  const tailored = lessonSpec?.topic === topic ? lessonSpec : null
  const copy = tailored ? { title: tailored.scenarioTitle, goal: tailored.learningGoal, questions: tailored.tasks.map((task) => task.prompt) } : TOPIC_COPY[topic]
  const activeTasks = tailored?.tasks ?? copy.questions.map((prompt, index) => ({ id: `local_${topic}_${index}`, concept: DEFAULT_CONCEPTS[topic][index], prompt }))
  const correctTaskCount = activeTasks.filter((task) => taskAnswers[task.id] === TASK_ANSWERS[task.concept].answer).length
  const taskScore = Math.round(100 * correctTaskCount / activeTasks.length)
  const currentTask = activeTasks[taskStage]
  const currentAnswer = currentTask ? TASK_ANSWERS[currentTask.concept] : null
  const currentSelection = currentTask ? taskAnswers[currentTask.id] : undefined
  const currentChecked = currentTask ? checkedTasks.has(currentTask.id) : false
  const selectTopic = (nextTopic: AdvancedTopic) => {
    setTopic(nextTopic)
    setTaskAnswers({})
    setCheckedTasks(new Set())
    setTaskStage(0)
  }
  const checkCurrentTask = () => {
    if (!currentTask || currentSelection === undefined) return
    setCheckedTasks((current) => new Set(current).add(currentTask.id))
  }
  const continueTasks = () => setTaskStage((current) => Math.min(current + 1, activeTasks.length))
  const restartTasks = () => { setTaskAnswers({}); setCheckedTasks(new Set()); setTaskStage(0) }

  const orientation = useMemo(() => {
    const angles = [radians(a), radians(b), radians(c)] as [number, number, number]
    const matrix = orientationType === 'rpy' ? rpyMatrix(...angles) : eulerZyzMatrix(...angles)
    const solution = orientationType === 'rpy' ? matrixToRpy(matrix) : matrixToEulerZyz(matrix)
    const rebuilt = orientationType === 'rpy' ? rpyMatrix(...solution.primary) : eulerZyzMatrix(...solution.primary)
    return { matrix, solution, error: matrixError(matrix, rebuilt) }
  }, [a, b, c, orientationType])
  const jacobian = planar2R(radians(jq1), radians(jq2))
  const velocity = endEffectorVelocity(jacobian.jacobian, [qd1, qd2])
  const trajectory = trajectoryState(trajectoryKind, start, end, duration, time)
  const dynamics = planar2R(radians(dq1), radians(dq2))
  const force: [number, number] = [forceX, forceY]
  const forceTorques = staticJointTorques(dynamics.jacobian, force)
  const gravity = gravityTorques(radians(dq1), radians(dq2))

  return <section className="workspace-grid advanced-workspace" aria-label={`${copy.title} interactive lesson`}>
    <aside className="learning-panel panel advanced-learning-panel">
      <div className="question-box">
        <label>Verified robotics module library</label>
        <nav className="advanced-topic-tabs" aria-label="Advanced robotics topic">
          {TOPICS.map((item) => <button type="button" key={item.id} className={topic === item.id ? 'active' : ''} onClick={() => selectTopic(item.id)}>{item.label}</button>)}
        </nav>
        <button type="button" className="secondary-button coordinate-return" onClick={onClose}>Ask another robotics question</button>
      </div>
      <div className="step-nav advanced-step-nav" aria-label="Customized learning steps">
        {activeTasks.map((task, index) => <div className={`step-dot ${index === taskStage ? 'active' : ''} ${index < taskStage ? 'done' : ''}`} key={task.id}>{index < taskStage ? '✓' : index + 1}</div>)}
        <div className={`step-dot ${taskStage === activeTasks.length ? 'active' : ''}`}>{activeTasks.length + 1}</div>
      </div>
      <div className="task-card advanced-concept-card">
        {currentTask && currentAnswer ? <>
          <span className="task-number">STEP {taskStage + 1} · {tailored ? `AI-CUSTOMIZED ${tailored.difficulty.toUpperCase()}` : 'VERIFIED QUESTION'}</span>
          <h2>{currentTask.concept.replace(/_/g, ' ')}</h2>
          <p className="advanced-goal">{currentTask.prompt}</p>
          <div className="answer-options">
            {currentAnswer.options.map((_, index) => (index + taskStage) % currentAnswer.options.length).map((optionIndex) => {
              const option = currentAnswer.options[optionIndex]
              return <label key={option} className={currentSelection === optionIndex ? 'selected' : ''}><input type="radio" name={currentTask.id} checked={currentSelection === optionIndex} disabled={currentChecked} onChange={() => setTaskAnswers((current) => ({ ...current, [currentTask.id]: optionIndex }))} /><span>{option}</span></label>
            })}
          </div>
          {currentChecked && <div className={`answer-result ${currentSelection === currentAnswer.answer ? 'correct' : 'incorrect'}`} role="status"><span><strong>{currentSelection === currentAnswer.answer ? 'Correct.' : 'Not quite.'}</strong> {currentAnswer.explanation}</span></div>}
          <button type="button" className="task-button" disabled={currentSelection === undefined} onClick={currentChecked ? continueTasks : checkCurrentTask}>{currentChecked ? 'Continue' : 'Check answer'} <span aria-hidden="true">›</span></button>
        </> : <div className="advanced-score-card" role="status">
          <span className="task-number">LEARNING FEEDBACK</span><h2>{taskScore}/100</h2><p>{correctTaskCount} of {activeTasks.length} customized questions were correct.</p>
          <div className={`advanced-status ${taskScore === 100 ? 'valid' : 'warning'}`}>{taskScore === 100 ? 'Understanding demonstrated. Now vary the model and explain what remains invariant.' : 'Understanding developing. Retry the questions while using the live model as evidence.'}</div>
          <button type="button" className="secondary-button" onClick={restartTasks}>Restart questions</button>
        </div>}
      </div>
      <section className="advanced-controls" aria-label={`${copy.title} controls`}>
        {topic === 'orientation' && <>
          <div className="segmented-control"><button type="button" className={orientationType === 'rpy' ? 'active' : ''} onClick={() => { setOrientationType('rpy'); setB((value) => Math.max(-90, Math.min(90, value))) }}>RPY · ZYX</button><button type="button" className={orientationType === 'zyz' ? 'active' : ''} onClick={() => { setOrientationType('zyz'); setB((value) => Math.max(0, Math.min(180, value))) }}>Euler · ZYZ</button></div>
          <RangeControl label={orientationType === 'rpy' ? 'Roll' : 'α'} value={a} min={-180} max={180} unit="°" onChange={setA} />
          <RangeControl label={orientationType === 'rpy' ? 'Pitch' : 'β'} value={b} min={orientationType === 'rpy' ? -90 : 0} max={orientationType === 'rpy' ? 90 : 180} unit="°" onChange={setB} />
          <RangeControl label={orientationType === 'rpy' ? 'Yaw' : 'γ'} value={c} min={-180} max={180} unit="°" onChange={setC} />
        </>}
        {topic === 'jacobian' && <><RangeControl label="q₁" value={jq1} min={-170} max={170} unit="°" onChange={setJq1} /><RangeControl label="q₂" value={jq2} min={-170} max={170} unit="°" onChange={setJq2} /><RangeControl label="q̇₁" value={qd1} min={-2} max={2} step={.05} unit=" rad/s" onChange={setQd1} /><RangeControl label="q̇₂" value={qd2} min={-2} max={2} step={.05} unit=" rad/s" onChange={setQd2} /></>}
        {topic === 'trajectory' && <><div className="segmented-control"><button type="button" className={trajectoryKind === 'cubic' ? 'active' : ''} onClick={() => setTrajectoryKind('cubic')}>Cubic</button><button type="button" className={trajectoryKind === 'quintic' ? 'active' : ''} onClick={() => setTrajectoryKind('quintic')}>Quintic</button></div><RangeControl label="Start q₀" value={start} min={-2} max={2} step={.05} unit=" rad" onChange={setStart} /><RangeControl label="Goal qf" value={end} min={-2} max={2} step={.05} unit=" rad" onChange={setEnd} /><RangeControl label="Duration T" value={duration} min={1} max={8} step={.25} unit=" s" onChange={(value) => { setDuration(value); setTime((current) => Math.min(current, value)) }} /><RangeControl label="Playback time" value={time} min={0} max={duration} step={.02} unit=" s" onChange={setTime} /></>}
        {topic === 'dynamics' && <><RangeControl label="q₁" value={dq1} min={-170} max={170} unit="°" onChange={setDq1} /><RangeControl label="q₂" value={dq2} min={-170} max={170} unit="°" onChange={setDq2} /><RangeControl label="Fx" value={forceX} min={-20} max={20} step={.5} unit=" N" onChange={setForceX} /><RangeControl label="Fy" value={forceY} min={-20} max={20} step={.5} unit=" N" onChange={setForceY} /></>}
      </section>
      <div className="system-notice">Local deterministic math · No AI or network request is required.</div>
    </aside>

    <section className="visual-panel panel advanced-visual-panel">
      <div className="section-heading"><div><span className="eyebrow">INTERACTIVE VERIFIED MODEL</span><h2>{copy.title}</h2></div><span className="focus-chip">LIVE</span></div>
      <div className="advanced-viewer">
        {topic === 'orientation' && <OrientationGraphic matrix={orientation.matrix} />}
        {topic === 'jacobian' && <PlanarArmGraphic elbow={jacobian.elbow} point={jacobian.point} vector={velocity} vectorLabel="v" />}
        {topic === 'trajectory' && <TrajectoryGraphic kind={trajectoryKind} start={start} end={end} duration={duration} time={time} />}
        {topic === 'dynamics' && <PlanarArmGraphic elbow={dynamics.elbow} point={dynamics.point} vector={force} vectorLabel="F" />}
      </div>
      <div className="advanced-readouts">
        {topic === 'orientation' && <><span><small>Convention</small><strong>{orientationType === 'rpy' ? 'Rz Ry Rx' : 'Rz Ry Rz'}</strong></span><span><small>Reconstruction error</small><strong>{orientation.error.toExponential(1)}</strong></span><span><small>Singularity</small><strong>{orientation.solution.singular ? 'Detected' : 'Clear'}</strong></span></>}
        {topic === 'jacobian' && <><span><small>vx</small><strong>{velocity[0].toFixed(3)} m/s</strong></span><span><small>vy</small><strong>{velocity[1].toFixed(3)} m/s</strong></span><span><small>det(J)</small><strong>{jacobian.determinant.toFixed(3)}</strong></span></>}
        {topic === 'trajectory' && <><span><small>q(t)</small><strong>{trajectory.position.toFixed(3)} rad</strong></span><span><small>q̇(t)</small><strong>{trajectory.velocity.toFixed(3)} rad/s</strong></span><span><small>q̈(t)</small><strong>{trajectory.acceleration.toFixed(3)} rad/s²</strong></span></>}
        {topic === 'dynamics' && <><span><small>τ₁ from force</small><strong>{forceTorques[0].toFixed(2)} Nm</strong></span><span><small>τ₂ from force</small><strong>{forceTorques[1].toFixed(2)} Nm</strong></span><span><small>|F|</small><strong>{Math.hypot(...force).toFixed(2)} N</strong></span></>}
      </div>
    </section>

    <aside className="math-panel panel advanced-math-panel">
      <section className="dh-section"><div className="section-heading compact"><div><span className="eyebrow">LIVE MATHEMATICS</span><h2>{topic === 'orientation' ? 'Orientation matrix' : topic === 'jacobian' ? 'Geometric Jacobian' : topic === 'trajectory' ? 'Boundary state' : 'Joint torques'}</h2></div></div>
        {topic === 'orientation' && <MatrixGrid matrix={orientation.matrix} />}
        {topic === 'jacobian' && <div className="advanced-matrix two-by-two">{jacobian.jacobian.flat().map((value, index) => <span key={index}>{value.toFixed(3)}</span>)}</div>}
        {topic === 'trajectory' && <div className="formula-stack"><code>q(0) = {start.toFixed(2)}</code><code>q(T) = {end.toFixed(2)}</code><code>q̇(0) = q̇(T) = 0</code><code>{trajectoryKind === 'quintic' ? 'q̈(0) = q̈(T) = 0' : 'Cubic: endpoint acceleration is unconstrained'}</code></div>}
        {topic === 'dynamics' && <div className="formula-stack"><code>τforce = JᵀF = [{forceTorques.map((value) => value.toFixed(2)).join(', ')}]ᵀ</code><code>τgravity = [{gravity.map((value) => value.toFixed(2)).join(', ')}]ᵀ Nm</code><code>τhold = τforce + τgravity</code></div>}
      </section>
      <section className="matrix-section"><div className="section-heading compact"><div><span className="eyebrow">VERIFIED INTERPRETATION</span><h2>{topic === 'orientation' ? 'Inverse and equivalent angles' : topic === 'jacobian' ? 'Differential motion' : topic === 'trajectory' ? 'Time-scaling check' : 'Statics and compensation'}</h2></div></div>
        {topic === 'orientation' && <><article className={`advanced-status ${orientation.solution.singular ? 'warning' : 'valid'}`}>{orientation.solution.singular ? 'Wrist singularity: one rotational degree of freedom is coupled.' : 'Inverse solution reconstructs the target matrix.'}</article><div className="angle-solutions"><span><small>Primary</small>{orientation.solution.primary.map((value) => `${degrees(value).toFixed(1)}°`).join(' · ')}</span><span><small>Equivalent</small>{orientation.solution.equivalent.map((value) => `${degrees(value).toFixed(1)}°`).join(' · ')}</span></div></>}
        {topic === 'jacobian' && <><article className={`advanced-status ${Math.abs(jacobian.determinant) < .12 ? 'warning' : 'valid'}`}>{Math.abs(jacobian.determinant) < .12 ? 'Near singular: Cartesian motion is losing a controllable direction.' : 'Full rank: two independent planar velocity directions are available.'}</article><div className="formula-stack"><code>ẋ = J(q) q̇</code><code>v = [{velocity.map((value) => value.toFixed(3)).join(', ')}]ᵀ m/s</code></div></>}
        {topic === 'trajectory' && <><article className="advanced-status valid">Endpoint position and zero endpoint velocity are satisfied deterministically.</article><p className="advanced-explanation">Increasing T lowers velocity and acceleration without changing the geometric path. Quintic scaling also makes endpoint acceleration zero.</p></>}
        {topic === 'dynamics' && <><article className="advanced-status valid">Virtual-work consistency: joint torque is computed from the transpose of the live Jacobian.</article><div className="torque-list"><span>Joint 1 hold torque <strong>{(forceTorques[0] + gravity[0]).toFixed(2)} Nm</strong></span><span>Joint 2 hold torque <strong>{(forceTorques[1] + gravity[1]).toFixed(2)} Nm</strong></span></div></>}
      </section>
    </aside>
  </section>
}
