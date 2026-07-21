import { Edges, Html, Line, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo, useState } from 'react'
import { Quaternion, Vector3 } from 'three'
import type { CompiledScene } from '../renderer/sceneCompiler'
import { forwardKinematics } from '../kinematics'

interface RobotSceneProps {
  scene: CompiledScene
  jointValues: Record<string, number>
  activeParameterId?: string
  onJointChange: (parameterId: string, value: number) => void
}

interface CanadarmModelProps {
  d1: number
  theta2: number
  activeParameterId?: string
  showAxes: boolean
  showLabels: boolean
}

type Point = [number, number, number]

const AXIS_Z = new Vector3(0, 0, 1)
const toPoint = (vector: Vector3): Point => [vector.x, vector.y, vector.z]

function MetalMaterial({ wall = false, highlighted = false }: { wall?: boolean; highlighted?: boolean }) {
  return <meshStandardMaterial color={highlighted ? '#d0d6dc' : wall ? '#8a929c' : '#d5dae1'} metalness={wall ? 0.12 : 0.42} roughness={wall ? 0.72 : 0.38} />
}

function Rod({ start, end, radius = 0.24, highlighted = false }: { start: Vector3; end: Vector3; radius?: number; highlighted?: boolean }) {
  const { midpoint, length, quaternion } = useMemo(() => {
    const direction = end.clone().sub(start)
    return {
      midpoint: start.clone().add(end).multiplyScalar(0.5),
      length: direction.length(),
      quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()),
    }
  }, [start, end])
  return (
    <mesh position={midpoint} quaternion={quaternion} castShadow receiveShadow>
      <cylinderGeometry args={[radius, radius, length, 36]} />
      <MetalMaterial highlighted={highlighted} />
      <Edges color="#2a3038" threshold={22} />
    </mesh>
  )
}

function Joint({ center, axis, radius, height, emphasized = false }: { center: Vector3; axis: Vector3; radius: number; height: number; emphasized?: boolean }) {
  const quaternion = useMemo(() => new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis.clone().normalize()), [axis])
  return (
    <mesh position={center} quaternion={quaternion} castShadow receiveShadow>
      <cylinderGeometry args={[radius, radius, height, 36]} />
      <MetalMaterial highlighted={emphasized} />
      <Edges color={emphasized ? '#2f7fd6' : '#2a3038'} threshold={22} />
    </mesh>
  )
}

type CylinderConnection = 'cap' | 'side' | 'invalid'

/** Visual modules are preset-owned: DH values move them but never resize them. */
const CYLINDRICAL_MODULE = {
  revolute: { radius: 0.32, height: 0.42 },
  prismatic: { radius: 0.26, height: 0.5 },
  linkRadius: 0.16,
} as const

/**
 * A cylinder accepts a straight link only at a cap (parallel to its axis) or
 * at its side (perpendicular to its axis). Oblique rays are intentionally
 * invalid: drawing them would imply a connector that this preset does not own.
 */
function cylinderConnection(axis: Vector3, direction: Vector3): CylinderConnection {
  const alignment = Math.abs(axis.clone().normalize().dot(direction.clone().normalize()))
  if (alignment > 1 - 1e-4) return 'cap'
  if (alignment < 1e-4) return 'side'
  return 'invalid'
}

function connectionOffset(connection: CylinderConnection, radius: number, height: number): number | null {
  if (connection === 'cap') return height / 2
  if (connection === 'side') return radius
  return null
}

function Label({ position, children, kind = 'dimension' }: { position: Vector3; children: string; kind?: 'dimension' | 'joint' | 'axis' }) {
  return <Html position={position} center className={`canadarm-label ${kind}`}>{children}</Html>
}

function AxisArrow({ origin, direction, color, length = 1.65 }: { origin: Vector3; direction: Vector3; color: string; length?: number }) {
  const { end, shaftEnd, quaternion } = useMemo(() => {
    const unit = direction.clone().normalize()
    return {
      end: origin.clone().addScaledVector(unit, length - 0.17),
      shaftEnd: origin.clone().addScaledVector(unit, length - 0.3),
      quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), unit),
    }
  }, [origin, direction, length])
  return (
    <group renderOrder={10}>
      <Line points={[toPoint(origin), toPoint(shaftEnd)]} color={color} lineWidth={2.5} depthTest={false} depthWrite={false} />
      <mesh position={end} quaternion={quaternion} renderOrder={10}>
        <coneGeometry args={[0.16, 0.34, 18]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} transparent opacity={0.94} />
      </mesh>
    </group>
  )
}

function Frame({ origin, xDirection, zDirection, index }: { origin: Vector3; xDirection: Vector3; zDirection: Vector3; index: number }) {
  const xEnd = origin.clone().addScaledVector(xDirection.clone().normalize(), 1.65)
  const zEnd = origin.clone().addScaledVector(zDirection.clone().normalize(), 1.65)
  return (
    <group>
      <AxisArrow origin={origin} direction={xDirection} color="#d4534a" />
      <AxisArrow origin={origin} direction={zDirection} color="#3d7fd0" />
      <Label position={xEnd} kind="axis">{`x${index}`}</Label>
      <Label position={zEnd} kind="axis">{`z${index}`}</Label>
    </group>
  )
}

/**
 * Port of the supplied Q5 Canadarm's visual coordinate system and proportions.
 * The P0 lesson drives J1 translation (d1) and J2 bend (theta2); remaining
 * figure joints preserve the supplied exam pose.
 */
function CanadarmModel({ d1, theta2, activeParameterId, showAxes, showLabels }: CanadarmModelProps) {
  const model = useMemo(() => {
    const slide = (d1 - 1.8) * 1.2
    const j1 = new Vector3(-3.35 + slide, 0.05, 0)
    const j2 = new Vector3(-1.55 + slide, 0.05, 0)
    const axis1 = new Vector3(1, 0, 0)
    const axis2 = AXIS_Z.clone()
    const figureB = new Vector3(0.72, 0.694, 0)
    const bDirection = figureB.clone().applyAxisAngle(AXIS_Z, theta2 - 0.6).normalize()
    const bLength = 3.85
    const j3 = j2.clone().addScaledVector(bDirection, bLength)
    const axis3 = new Vector3().crossVectors(AXIS_Z, bDirection).normalize().negate()
    const cDirection = new Vector3(1, 0.08, 0.42).addScaledVector(axis3, -new Vector3(1, 0.08, 0.42).dot(axis3)).normalize()
    const cLength = 3.7
    const j4 = j3.clone().addScaledVector(cDirection, cLength)
    const axis4 = new Vector3().crossVectors(axis3, cDirection).normalize()
    if (axis4.y < 0) axis4.negate()
    const outer = j4.clone().addScaledVector(axis4, 0.85)
    const wristDirection = new Vector3(0.78, -0.62, 0.05).addScaledVector(axis4, -new Vector3(0.78, -0.62, 0.05).dot(axis4)).normalize()
    const axis5 = wristDirection.clone()
    const j5 = outer.clone().addScaledVector(axis5, 0.775)
    const wristEnd = outer.clone().addScaledVector(axis5, 1.55)
    const gripBase = wristEnd.clone().addScaledVector(wristDirection, 0.35)
    const gripTip = gripBase.clone().addScaledVector(wristDirection, 1.05)
    const p0 = new Vector3(-4.35, 0.05, 0)
    const aEnd = j1.clone().addScaledVector(axis1, 0.675)
    const aStart = j1.clone().addScaledVector(axis1, -0.675)
    // The original Canadarm connects to J2's cylindrical surface facing J1,
    // rather than to its centre or its top face.
    const j2Connection = j2.clone().addScaledVector(
      j1.clone().sub(j2).projectOnPlane(axis2).normalize(),
      0.62,
    )
    const sideAxis = new Vector3(-wristDirection.y, wristDirection.x, 0).normalize()
    return { j1, j2, j3, j4, j5, outer, wristEnd, gripBase, gripTip, p0, aStart, aEnd, j2Connection, axis1, axis2, axis3, axis4, axis5, bDirection, cDirection, wristDirection, sideAxis }
  }, [d1, theta2])

  const { j1, j2, j3, j4, j5, outer, wristEnd, gripBase, gripTip, p0, aStart, aEnd, j2Connection, axis1, axis2, axis3, axis4, axis5, bDirection, cDirection, wristDirection, sideAxis } = model
  const gripperFingers = [-1, 1].map((side) => {
    const root = gripBase.clone().addScaledVector(wristDirection, 0.12).addScaledVector(sideAxis, side * 0.18)
    const mid = root.clone().addScaledVector(wristDirection, 0.58).addScaledVector(sideAxis, side * 0.2)
    const tip = mid.clone().addScaledVector(wristDirection, 0.42).addScaledVector(sideAxis, -side * 0.22)
    return { root, mid, tip }
  })

  return (
    <group>
      <mesh position={[-4.55, 0.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.42, 3.4, 3.6]} />
        <MetalMaterial wall />
        <Edges color="#2a3038" threshold={22} />
      </mesh>
      <Joint center={j1} axis={axis1} radius={0.58} height={1.35} emphasized={activeParameterId === 'joint_1.d'} />
      <Rod start={p0} end={aStart} radius={0.34} />
      <Rod start={aEnd} end={j2Connection} radius={0.26} />
      <Joint center={j2} axis={axis2} radius={0.62} height={1.05} emphasized={activeParameterId === 'joint_2.theta'} />
      <Rod start={j2.clone().addScaledVector(bDirection, 0.48)} end={j3.clone().addScaledVector(bDirection, -0.42)} radius={0.25} highlighted={activeParameterId === 'joint_2.theta'} />
      <Joint center={j3} axis={axis3} radius={0.6} height={1.05} />
      <Rod start={j3.clone().addScaledVector(cDirection, 0.42)} end={j4.clone().addScaledVector(cDirection, -0.48)} radius={0.24} />
      <Joint center={j4} axis={axis4} radius={0.55} height={1.7} />
      <Joint center={j5} axis={axis5} radius={0.48} height={1.55} />
      <Rod start={wristEnd} end={gripBase} radius={0.2} />
      <mesh position={gripBase} quaternion={new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), wristDirection)} castShadow>
        <boxGeometry args={[0.55, 0.36, 0.72]} />
        <MetalMaterial />
        <Edges color="#2a3038" threshold={22} />
      </mesh>
      {gripperFingers.map((finger, index) => <group key={index}><Rod start={finger.root} end={finger.mid} radius={0.085} /><Rod start={finger.mid} end={finger.tip} radius={0.075} /></group>)}

      {showAxes && <group>
        <Frame origin={p0} xDirection={new Vector3(0, -1, 0)} zDirection={axis1} index={0} />
        <Frame origin={j2} xDirection={new Vector3(0, -1, 0)} zDirection={axis2} index={1} />
        <Frame origin={j3} xDirection={bDirection} zDirection={axis3} index={2} />
        <Frame origin={j4} xDirection={cDirection} zDirection={axis4} index={3} />
        <Frame origin={outer} xDirection={cDirection} zDirection={axis5} index={4} />
      </group>}
      {showLabels && <group>
        <Label position={j1.clone().add(new Vector3(0, 0.95, 0))} kind="joint">1</Label>
        <Label position={j2.clone().add(new Vector3(0, 0.98, 0))} kind="joint">2</Label>
        <Label position={j3.clone().add(new Vector3(0, 1, 0))} kind="joint">3</Label>
        <Label position={j4.clone().add(new Vector3(0, 0.98, 0))} kind="joint">4</Label>
        <Label position={j5.clone().add(new Vector3(0, 0.85, 0))} kind="joint">5</Label>
        <Label position={new Vector3(-4.55, -1.85, 0)}>BULKHEAD</Label>
        <Label position={j1.clone().lerp(j2, 0.42).add(new Vector3(0, 0.58, 0))}>A</Label>
        <Label position={j2.clone().lerp(j3, 0.48).add(new Vector3(-0.3, 0.55, 0))}>B</Label>
        <Label position={j3.clone().lerp(j4, 0.5).add(new Vector3(0, 0.58, 0))}>C</Label>
        <Label position={j4.clone().lerp(outer, 0.52).addScaledVector(wristDirection, -0.48)}>D</Label>
        <Label position={outer.clone().lerp(gripTip, 0.58).add(new Vector3(0.15, 0.48, 0))}>E</Label>
        <Label position={j2.clone().add(new Vector3(0.95, 0.55, 0))}>α</Label>
        <Label position={j3.clone().add(new Vector3(1.05, 0.45, 0))}>β</Label>
        <Label position={outer.clone().add(new Vector3(0.35, -0.25, 0.1))}>γ</Label>
        <Label position={gripBase.clone().add(new Vector3(0.35, 0.55, 0.2))}>δ</Label>
        <Label position={gripTip.clone().add(new Vector3(0.1, -0.85, 0))} kind="joint">GRIPPER</Label>
      </group>}
    </group>
  )
}

function GenericDhChain({ scene, jointValues, activeParameterId, showAxes, showLabels }: Pick<RobotSceneProps, 'scene' | 'jointValues' | 'activeParameterId'> & { showAxes: boolean; showLabels: boolean }) {
  const model = useMemo(() => {
    const { cumulative } = forwardKinematics(scene.robot, jointValues)
    const frames = [[[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], ...cumulative]
    const rawFrames = frames.map((matrix) => ({
      origin: new Vector3(matrix[0][3], matrix[1][3], matrix[2][3]),
      x: new Vector3(matrix[0][0], matrix[1][0], matrix[2][0]),
      z: new Vector3(matrix[0][2], matrix[1][2], matrix[2][2]),
    }))
    const joints = scene.robot.joints.map((joint) => CYLINDRICAL_MODULE[joint.type])
    return { frames: rawFrames, joints }
  }, [scene.robot, jointValues])
  const { frames, joints } = model
  return (
    <group>
      <mesh position={frames[0].origin.clone().add(new Vector3(0, 0, -0.18))} receiveShadow>
        <cylinderGeometry args={[1.15, 1.35, 0.36, 48]} />
        <MetalMaterial wall />
        <Edges color="#2a3038" threshold={22} />
      </mesh>
      {scene.robot.joints.map((joint, index) => {
        const frame = frames[index]
        const next = frames[index + 1]
        const distance = frame.origin.distanceTo(next.origin)
        const direction = distance > 1e-5 ? next.origin.clone().sub(frame.origin).normalize() : frame.z.clone().normalize()
        const jointGeometry = joints[index]
        const nextGeometry = joints[index + 1]
        const startConnection = cylinderConnection(frame.z, direction)
        const endConnection = nextGeometry ? cylinderConnection(next.z, direction.clone().negate()) : 'cap'
        const startOffset = connectionOffset(startConnection, jointGeometry.radius, jointGeometry.height)
        const endOffset = nextGeometry ? connectionOffset(endConnection, nextGeometry.radius, nextGeometry.height) : 0.12
        const rodStart = startOffset === null ? null : frame.origin.clone().addScaledVector(direction, startOffset)
        const rodEnd = endOffset === null ? null : next.origin.clone().addScaledVector(direction, -endOffset)
        const variable = joint.type === 'prismatic' ? joint.d : joint.theta
        const isActive = typeof variable !== 'number' && variable.parameterId === activeParameterId
        return <group key={joint.id}>
          <Joint center={frame.origin} axis={frame.z} radius={jointGeometry.radius} height={jointGeometry.height} emphasized={isActive} />
          {rodStart && rodEnd && distance > startOffset! + endOffset! + 0.02 && <Rod start={rodStart} end={rodEnd} radius={CYLINDRICAL_MODULE.linkRadius} highlighted={isActive} />}
          {showLabels && (startConnection === 'invalid' || endConnection === 'invalid') && <Label position={frame.origin.clone().lerp(next.origin, 0.5)} kind="joint">INVALID LINK</Label>}
        </group>
      })}
      <Joint center={frames[frames.length - 1].origin} axis={frames[frames.length - 1].z} radius={0.2} height={0.14} />
      {showAxes && <group>
        {frames.map((frame, index) => <Frame key={index} origin={frame.origin} xDirection={frame.x} zDirection={frame.z} index={index} />)}
      </group>}
      {showLabels && <group>
        <Label position={frames[0].origin.clone().add(new Vector3(0, -0.8, 0))}>BASE</Label>
        {scene.robot.joints.map((joint, index) => <Label key={joint.id} position={frames[index].origin.clone().add(new Vector3(0, 0, 0.62))} kind="joint">{`${joint.type === 'prismatic' ? 'P' : 'R'}${index + 1}`}</Label>)}
        <Label position={frames[frames.length - 1].origin.clone().add(new Vector3(0, 0, 0.55))}>TOOL</Label>
      </group>}
    </group>
  )
}

export function RobotScene(props: RobotSceneProps) {
  const [showAxes, setShowAxes] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [viewKey, setViewKey] = useState(0)
  const d1 = props.jointValues[props.scene.dParameterId] ?? props.scene.defaultD
  const theta2 = props.jointValues[props.scene.thetaParameterId] ?? props.scene.defaultTheta
  const showFrames = props.scene.spec.lesson.overlays.includes('dh_frames')
  const showDimensions = props.scene.spec.lesson.overlays.includes('symbolic_dimensions')
  return (
    <div className="canadarm-viewer" aria-label={props.scene.kind === 'canadarm' ? '2026 Q5 Canadarm three-dimensional robot model' : 'JSON-defined standard DH serial robot model'}>
      <div className="canadarm-toolbar">
        <div className="canadarm-toolbar-actions">
          <button type="button" onClick={() => setViewKey((key) => key + 1)}>Reset view</button>
          <button type="button" aria-pressed={showAxes} onClick={() => setShowAxes((visible) => !visible)}>DH frames</button>
          <button type="button" aria-pressed={showLabels} onClick={() => setShowLabels((visible) => !visible)}>Labels</button>
        </div>
        <span>Drag to rotate · Scroll to zoom</span>
      </div>
      <div className="scene-shell canadarm-stage">
        <Canvas key={viewKey} shadows camera={{ position: [9.5, 7.2, 14.5], fov: 38, near: 0.1, far: 100 }} gl={{ antialias: true }}>
          <color attach="background" args={['#f8fafc']} />
          <hemisphereLight args={['#ffffff', '#4a5568', 1.85]} />
          <directionalLight position={[6, 11, 9]} intensity={2.8} castShadow />
          <ambientLight intensity={0.35} />
          <gridHelper args={[18, 18, '#7b8490', '#7b8490']} position={[0, -1.35, 0]} />
          {props.scene.kind === 'canadarm' ? (
            <CanadarmModel d1={d1} theta2={theta2} activeParameterId={props.activeParameterId} showAxes={showAxes && showFrames} showLabels={showLabels && showDimensions} />
          ) : (
            <GenericDhChain scene={props.scene} jointValues={props.jointValues} activeParameterId={props.activeParameterId} showAxes={showAxes && showFrames} showLabels={showLabels} />
          )}
          <OrbitControls makeDefault enableDamping minDistance={props.scene.kind === 'canadarm' ? 8 : 5} maxDistance={28} target={props.scene.kind === 'canadarm' ? [1.6, 1.35, 0] : [1.5, 0, 1.1]} />
        </Canvas>
      </div>
      <section className={`joint-control-panel ${props.scene.kind === 'canadarm' ? 'canadarm-direct-controls' : ''}`} aria-label={props.scene.kind === 'canadarm' ? 'Canadarm direct joint controls' : 'JSON joint controls'}>
        <header>
          <span>{props.scene.kind === 'canadarm' ? 'LOCAL DIRECT CONTROLS · NO AI REQUIRED' : 'DIRECT JOINT CONTROLS'}</span>
          <button type="button" onClick={() => props.scene.controls.forEach((control) => props.onJointChange(control.parameterId, control.defaultValue))}>Reset joints</button>
        </header>
        <div className="dh-chain-controls">
          {props.scene.controls.map((control) => {
            const value = props.jointValues[control.parameterId] ?? control.defaultValue
            const symbol = control.jointType === 'prismatic' ? `d${control.jointIndex + 1}` : `θ${control.jointIndex + 1}`
            return <label key={control.parameterId}>
              <span>{symbol} <small>{control.unit}</small></span>
              <input aria-label={`Set ${symbol} in ${control.unit}`} type="range" min={control.min} max={control.max} step={control.unit === 'rad' ? 0.01 : 0.02} value={value} onChange={(event) => props.onJointChange(control.parameterId, Number(event.target.value))} />
              <output>{value.toFixed(2)}</output>
            </label>
          })}
        </div>
      </section>
      <div className="canadarm-legend"><span><b>Gray</b> links / joints</span><span><b className="x">Red</b> x axes</span><span><b className="z">Blue</b> z / joint axes</span><span>{props.scene.kind === 'canadarm' ? 'Dimensions A–E and angles α–δ correspond to the original Figure Q5' : 'Geometry, frames, and controls are generated from standard-DH joint definitions in JSON'}</span></div>
    </div>
  )
}
