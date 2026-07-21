import { Html, Line, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo, useState } from 'react'
import type { CoordinateSystemKind } from '../coordinateRouting'

interface CoordinateSystemLessonProps {
  initialKind: CoordinateSystemKind
  onClose: () => void
}

type Point = [number, number, number]

interface CoordinateQuestion {
  id: string
  prompt: string
  options: readonly string[]
  answer: number
  explanation: string
}

const DEG = Math.PI / 180

const COPY: Record<CoordinateSystemKind, {
  title: string
  subtitle: string
  formula: string
  inverse: string
  insight: string
}> = {
  cartesian: {
    title: 'Cartesian coordinates',
    subtitle: 'Three independent signed distances along mutually perpendicular axes.',
    formula: 'P = (x, y, z)',
    inverse: 'x = Pₓ,  y = Pᵧ,  z = P_z',
    insight: 'Changing one coordinate moves P parallel to exactly one fixed axis.',
  },
  cylindrical: {
    title: 'Cylindrical coordinates',
    subtitle: 'A radial distance and azimuth locate the projection; height then lifts P.',
    formula: 'x = ρ cos θ,  y = ρ sin θ,  z = z',
    inverse: 'ρ = √(x²+y²),  θ = atan2(y,x)',
    insight: 'At ρ = 0 the azimuth θ is undefined: every angle describes the same axis point.',
  },
  spherical: {
    title: 'Spherical coordinates',
    subtitle: 'Radius r, inclination β from +z, and azimuth γ around +z locate P.',
    formula: 'x = r sin β cos γ,  y = r sin β sin γ,  z = r cos β',
    inverse: 'r = √(x²+y²+z²),  β = acos(z/r),  γ = atan2(y,x)',
    insight: 'At the poles (sin β = 0), azimuth γ is undefined. This is a coordinate singularity.',
  },
}

const QUESTIONS: Record<CoordinateSystemKind, readonly CoordinateQuestion[]> = {
  cartesian: [
    { id: 'cartesian-path', prompt: 'If only x changes, what path does P follow?', options: ['A line parallel to the x-axis', 'A circle around the z-axis', 'A sphere'], answer: 0, explanation: 'Only the signed distance along x changes; y and z remain fixed.' },
    { id: 'cartesian-independent', prompt: 'Why can x, y, and z be adjusted independently?', options: ['They are all angles', 'They use mutually perpendicular basis axes', 'They share one radial axis'], answer: 1, explanation: 'Each Cartesian component measures displacement along a different orthogonal basis axis.' },
    { id: 'cartesian-octant', prompt: 'What determines the octant containing P?', options: ['Only the distance from the origin', 'The order in which coordinates change', 'The signs of x, y, and z'], answer: 2, explanation: 'The sign combination of the three coordinates identifies the octant.' },
  ],
  cylindrical: [
    { id: 'cylindrical-path', prompt: 'With ρ and z fixed, what does changing θ trace?', options: ['A vertical line', 'A circle about the z-axis', 'A sphere'], answer: 1, explanation: 'Fixed radius and height constrain P to a horizontal circle.' },
    { id: 'cylindrical-height', prompt: 'What does changing z do?', options: ['Rotates the xy projection', 'Changes the radial distance', 'Moves P parallel to the z-axis'], answer: 2, explanation: 'The xy projection stays fixed while height changes along z.' },
    { id: 'cylindrical-singularity', prompt: 'Why is θ undefined at ρ = 0?', options: ['All azimuths identify the same axis point', 'The point is infinitely far away', 'z must also equal zero'], answer: 0, explanation: 'At the axis, there is no unique direction for the radial projection.' },
  ],
  spherical: [
    { id: 'spherical-surface', prompt: 'With r fixed, on which surface must P remain?', options: ['A plane', 'A cylinder', 'A sphere'], answer: 2, explanation: 'Every point at a fixed distance r from the origin lies on a sphere.' },
    { id: 'spherical-angles', prompt: 'Which angle rotates P around the z-axis?', options: ['β, the inclination', 'γ, the azimuth', 'r, the radius'], answer: 1, explanation: 'γ is the azimuth; β changes inclination from the positive z-axis.' },
    { id: 'spherical-singularity', prompt: 'Why is γ undefined at the poles?', options: ['r becomes negative', 'Every azimuth reaches the same pole', 'β must equal 90°'], answer: 1, explanation: 'At β = 0° or 180°, changing azimuth does not change the point.' },
  ],
}

function arcPoints(radius: number, start: number, end: number, plane: 'xy' | 'inclination', azimuth = 0): Point[] {
  const count = 40
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = start + (end - start) * index / count
    if (plane === 'xy') return [radius * Math.cos(angle), radius * Math.sin(angle), 0]
    return [
      radius * Math.sin(angle) * Math.cos(azimuth),
      radius * Math.sin(angle) * Math.sin(azimuth),
      radius * Math.cos(angle),
    ]
  })
}

function CoordinateScene({ kind, values }: { kind: CoordinateSystemKind; values: Record<string, number> }) {
  const geometry = useMemo(() => {
    if (kind === 'cartesian') {
      const point: Point = [values.x, values.y, values.z]
      return { point, projection: [values.x, values.y, 0] as Point, radial: [values.x, 0, 0] as Point }
    }
    if (kind === 'cylindrical') {
      const theta = values.theta * DEG
      const projection: Point = [values.rho * Math.cos(theta), values.rho * Math.sin(theta), 0]
      return { point: [projection[0], projection[1], values.z] as Point, projection, radial: projection }
    }
    const beta = values.beta * DEG
    const gamma = values.gamma * DEG
    const point: Point = [
      values.r * Math.sin(beta) * Math.cos(gamma),
      values.r * Math.sin(beta) * Math.sin(gamma),
      values.r * Math.cos(beta),
    ]
    return {
      point,
      projection: [point[0], point[1], 0] as Point,
      radial: [point[0], point[1], 0] as Point,
    }
  }, [kind, values])

  const theta = (kind === 'cylindrical' ? values.theta : values.gamma) * DEG
  const beta = values.beta * DEG
  const radius = kind === 'cylindrical' ? values.rho : kind === 'spherical' ? values.r : 0

  return (
    <>
      <ambientLight intensity={1.2} />
      <directionalLight position={[5, 7, 8]} intensity={1.5} />
      <gridHelper args={[10, 20, '#d6deeb', '#e8edf5']} rotation={[Math.PI / 2, 0, 0]} />
      <axesHelper args={[4.5]} />
      <Line points={[[0, 0, 0], geometry.point]} color="#f97316" lineWidth={4} />

      {kind === 'cartesian' && <>
        <Line points={[[0, 0, 0], geometry.radial]} color="#ef4444" lineWidth={5} />
        <Line points={[geometry.radial, geometry.projection]} color="#22c55e" lineWidth={5} />
        <Line points={[geometry.projection, geometry.point]} color="#3b82f6" lineWidth={5} />
      </>}

      {kind === 'cylindrical' && <>
        <Line points={arcPoints(Math.max(.45, radius), 0, Math.PI * 2, 'xy')} color="#94a3b8" lineWidth={1} />
        <Line points={[[0, 0, 0], geometry.projection]} color="#16a34a" lineWidth={5} />
        <Line points={[geometry.projection, geometry.point]} color="#2563eb" lineWidth={5} />
        <Line points={arcPoints(Math.min(.75, radius), 0, theta, 'xy')} color="#f97316" lineWidth={3} />
      </>}

      {kind === 'spherical' && <>
        <mesh>
          <sphereGeometry args={[values.r, 24, 16]} />
          <meshBasicMaterial color="#93c5fd" wireframe transparent opacity={0.22} />
        </mesh>
        <Line points={[[0, 0, 0], geometry.projection]} color="#64748b" lineWidth={2} dashed />
        <Line points={[geometry.projection, geometry.point]} color="#2563eb" lineWidth={2} dashed />
        <Line points={arcPoints(Math.min(.75, radius), 0, theta, 'xy')} color="#f97316" lineWidth={3} />
        <Line points={arcPoints(Math.min(1.05, radius), 0, beta, 'inclination', theta)} color="#16a34a" lineWidth={3} />
      </>}

      <mesh position={geometry.point}>
        <sphereGeometry args={[0.11, 24, 24]} />
        <meshStandardMaterial color="#7c3aed" />
      </mesh>
      <Html position={geometry.point} center distanceFactor={9}>
        <span className="coordinate-point-label">P</span>
      </Html>
      <Html position={[4.7, 0, 0]} center><span className="coordinate-axis x">x</span></Html>
      <Html position={[0, 4.7, 0]} center><span className="coordinate-axis y">y</span></Html>
      <Html position={[0, 0, 4.7]} center><span className="coordinate-axis z">z</span></Html>
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={5} maxDistance={15} />
    </>
  )
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
}

function Slider({ label, value, min, max, step = .05, unit = '', onChange }: SliderProps) {
  return <label className="coordinate-control">
    <span><strong>{label}</strong><output>{value.toFixed(step < 1 ? 2 : 0)}{unit}</output></span>
    <input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
  </label>
}

export function CoordinateSystemLesson({ initialKind, onClose }: CoordinateSystemLessonProps) {
  const [kind, setKind] = useState(initialKind)
  const [values, setValues] = useState<Record<string, number>>({ x: 2.2, y: 1.5, z: 2, rho: 2.5, theta: 40, r: 3, beta: 48, gamma: 38 })
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [checkedQuestions, setCheckedQuestions] = useState<Set<string>>(new Set())
  const [quizStage, setQuizStage] = useState(0)
  const copy = COPY[kind]
  const questions = QUESTIONS[kind]
  const correctAnswers = questions.filter((question) => answers[question.id] === question.answer).length
  const quizScore = Math.round(100 * correctAnswers / questions.length)
  const currentQuestion = questions[quizStage]
  const currentSelection = currentQuestion ? answers[currentQuestion.id] : undefined
  const currentChecked = currentQuestion ? checkedQuestions.has(currentQuestion.id) : false
  const update = (key: string, value: number) => setValues((current) => ({ ...current, [key]: value }))
  const selectKind = (nextKind: CoordinateSystemKind) => {
    setKind(nextKind)
    setAnswers({})
    setCheckedQuestions(new Set())
    setQuizStage(0)
  }
  const resetQuiz = () => {
    setAnswers({})
    setCheckedQuestions(new Set())
    setQuizStage(0)
  }
  const checkCurrentQuestion = () => {
    if (!currentQuestion || currentSelection === undefined) return
    setCheckedQuestions((current) => new Set(current).add(currentQuestion.id))
  }
  const continueQuiz = () => setQuizStage((current) => Math.min(current + 1, questions.length))

  return <section className="workspace-grid coordinate-workspace" aria-label={`${copy.title} interactive lesson`}>
    <aside className="learning-panel panel coordinate-learning-panel">
      <div className="question-box">
        <label>Coordinate-system library</label>
        <nav className="coordinate-tabs" aria-label="Coordinate system">
          {(['cartesian', 'cylindrical', 'spherical'] as CoordinateSystemKind[]).map((item) =>
            <button type="button" key={item} className={kind === item ? 'active' : ''} onClick={() => selectKind(item)}>{item}</button>,
          )}
        </nav>
        <button type="button" className="secondary-button coordinate-return" onClick={onClose}>Ask another robotics question</button>
      </div>

      <div className="step-nav coordinate-step-nav" aria-label="Coordinate knowledge-check steps">
        {questions.map((question, index) => <div className={`step-dot ${index === quizStage ? 'active' : ''} ${index < quizStage ? 'done' : ''}`} key={question.id}>{index < quizStage ? '✓' : index + 1}</div>)}
        <div className={`step-dot ${quizStage === questions.length ? 'active' : ''}`}>{questions.length + 1}</div>
      </div>

      <div className="task-card coordinate-question-card">
        {currentQuestion ? <>
          <span className="task-number">STEP {quizStage + 1}</span>
          <h2>Coordinate prediction</h2>
          <p>{currentQuestion.prompt}</p>
          <div className="answer-options">
            {currentQuestion.options.map((option, optionIndex) => <label key={option} className={currentSelection === optionIndex ? 'selected' : ''}>
              <input type="radio" name={currentQuestion.id} checked={currentSelection === optionIndex} disabled={currentChecked} onChange={() => setAnswers((current) => ({ ...current, [currentQuestion.id]: optionIndex }))} />
              <span>{option}</span>
            </label>)}
          </div>
          {currentChecked && <div className={`answer-result ${currentSelection === currentQuestion.answer ? 'correct' : 'incorrect'}`} role="status"><span><strong>{currentSelection === currentQuestion.answer ? 'Correct.' : 'Not quite.'}</strong> {currentQuestion.explanation}</span></div>}
          <button type="button" className="task-button" disabled={currentSelection === undefined} onClick={currentChecked ? continueQuiz : checkCurrentQuestion}>{currentChecked ? 'Continue' : 'Check answer'} <span aria-hidden="true">›</span></button>
        </> : <div className="coordinate-score-card" role="status">
          <span className="task-number">LEARNING FEEDBACK</span>
          <h2>{quizScore}/100</h2>
          <p>{correctAnswers} of {questions.length} coordinate questions were correct.</p>
          <div className={`advanced-status ${quizScore === 100 ? 'valid' : 'warning'}`}>{quizScore === 100 ? 'Understanding demonstrated. Use the sliders to test the same ideas in another octant or orientation.' : 'Understanding developing. Retry while using the live point decomposition as evidence.'}</div>
          <button type="button" className="secondary-button" onClick={resetQuiz}>Restart questions</button>
        </div>}
      </div>

      <div className="coordinate-controls">
        {kind === 'cartesian' && <>
          <Slider label="x" value={values.x} min={-3.5} max={3.5} onChange={(value) => update('x', value)} />
          <Slider label="y" value={values.y} min={-3.5} max={3.5} onChange={(value) => update('y', value)} />
          <Slider label="z" value={values.z} min={-3.5} max={3.5} onChange={(value) => update('z', value)} />
        </>}
        {kind === 'cylindrical' && <>
          <Slider label="ρ · radial distance" value={values.rho} min={0} max={3.5} onChange={(value) => update('rho', value)} />
          <Slider label="θ · azimuth" value={values.theta} min={-180} max={180} step={1} unit="°" onChange={(value) => update('theta', value)} />
          <Slider label="z · height" value={values.z} min={-3.5} max={3.5} onChange={(value) => update('z', value)} />
        </>}
        {kind === 'spherical' && <>
          <Slider label="r · radius" value={values.r} min={.3} max={3.5} onChange={(value) => update('r', value)} />
          <Slider label="β · inclination" value={values.beta} min={0} max={180} step={1} unit="°" onChange={(value) => update('beta', value)} />
          <Slider label="γ · azimuth" value={values.gamma} min={-180} max={180} step={1} unit="°" onChange={(value) => update('gamma', value)} />
        </>}
      </div>
      <div className="system-notice">Each preset is allow-listed and uses deterministic coordinate transforms.</div>
    </aside>

    <section className="visual-panel panel coordinate-visual-panel">
      <div className="section-heading">
        <div><span className="eyebrow">INTERACTIVE COORDINATE MODEL</span><h2>{copy.title}</h2></div>
        <span className="focus-chip">LIVE</span>
      </div>
      <div className="coordinate-viewer">
        <Canvas camera={{ position: [6.5, 6.5, 5.5], fov: 42 }}>
          <CoordinateScene kind={kind} values={values} />
        </Canvas>
        <span className="coordinate-view-hint">Drag to rotate · Scroll to zoom</span>
      </div>
      <div className="observation-card"><span>OBSERVATION</span><p>{copy.subtitle}</p></div>
    </section>

    <aside className="math-panel panel coordinate-math-panel">
      <section className="dh-section">
        <div className="section-heading compact"><div><span className="eyebrow">COORDINATE TRANSFORM</span><h2>Forward and inverse maps</h2></div></div>
        <article className="coordinate-formula"><span>FORWARD MAP</span><strong>{copy.formula}</strong></article>
        <article className="coordinate-formula"><span>INVERSE MAP</span><strong>{copy.inverse}</strong></article>
      </section>
      <section className="matrix-section coordinate-explanation">
        <div className="section-heading compact"><div><span className="eyebrow">GEOMETRIC MEANING</span><h2>How to read the model</h2></div></div>
        <article className="coordinate-insight"><span>KEY OBSERVATION</span><p>{copy.insight}</p></article>
        <ol className="coordinate-steps">
          <li>Change one slider and predict the path of P.</li>
          <li>Use the colored decomposition to identify each parameter's geometric role.</li>
          <li>Rotate the view and verify that coordinates stay tied to the fixed x, y, z frame.</li>
        </ol>
      </section>
    </aside>
  </section>
}
