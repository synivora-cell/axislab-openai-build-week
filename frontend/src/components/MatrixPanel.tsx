import { BlockMath } from 'react-katex'
import type { JointSpec, Matrix4 } from '../types'
import { formatNumber, matrixToKatex } from '../kinematics'

interface MatrixPanelProps {
  local: Matrix4[]
  total: Matrix4
  joints: JointSpec[]
  activeParameterId?: string
}

const thetaCells = new Set(['0:0', '0:1', '0:3', '1:0', '1:1', '1:3'])
const dCells = new Set(['2:3'])

function NumericMatrix({ matrix, mode }: { matrix: Matrix4; mode: 'theta' | 'd' | 'propagated' | 'none' }) {
  const activeCells = mode === 'theta' ? thetaCells : mode === 'd' ? dCells : new Set<string>()
  return (
    <div className="numeric-matrix" role="table" aria-label="4 by 4 transformation matrix">
      {matrix.flatMap((row, rowIndex) =>
        row.map((value, columnIndex) => {
          const key = `${rowIndex}:${columnIndex}`
          const direct = activeCells.has(key)
          const propagated = mode === 'propagated' && (thetaCells.has(key) || dCells.has(key))
          return (
            <span
              role="cell"
              className={`${direct ? 'direct-highlight' : ''} ${propagated ? 'propagated-highlight' : ''}`}
              key={key}
            >
              {formatNumber(value)}
            </span>
          )
        }),
      )}
    </div>
  )
}

function jointParameterId(joint: JointSpec): string | undefined {
  const value = joint.type === 'prismatic' ? joint.d : joint.theta
  return typeof value === 'number' ? undefined : value.parameterId
}

export function MatrixPanel({ local, total, joints, activeParameterId }: MatrixPanelProps) {
  const activeIndex = activeParameterId
    ? joints.findIndex((joint) => jointParameterId(joint) === activeParameterId)
    : -1
  return (
    <section className="matrix-section">
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">LIVE KINEMATICS</span>
          <h2>Transformation matrices</h2>
        </div>
        <div className="matrix-key">
          <span><i className="key direct" />Direct dependency</span>
          <span><i className="key propagated" />Propagated effect</span>
        </div>
      </div>
      <div className="formula-card">
        <BlockMath math={'{}^{i-1}T_i=R_z(\\theta_i)T_z(d_i)T_x(a_i)R_x(\\alpha_i)'} />
      </div>
      <div className="matrix-tabs" aria-label="Local matrices">
        {local.map((matrix, index) => (
          <article className={`matrix-card ${activeIndex === index ? 'active' : ''}`} key={index}>
            <header>
              <strong>A{index + 1}</strong>
              <span>{joints[index]?.type === 'prismatic' ? `P · d${index + 1}` : `R · θ${index + 1}`}</span>
            </header>
            <NumericMatrix
              matrix={matrix}
              mode={activeIndex === index ? (joints[index]?.type === 'prismatic' ? 'd' : 'theta') : 'none'}
            />
          </article>
        ))}
      </div>
      <article className="matrix-card total">
        <header>
          <strong>{`T₀${local.length}`}</strong>
          <span>Total end-effector transform</span>
        </header>
        <NumericMatrix matrix={total} mode={activeIndex >= 0 ? 'propagated' : 'none'} />
      </article>
      <details className="exact-matrix">
        <summary>KaTeX numeric matrix</summary>
        <BlockMath math={matrixToKatex(total)} />
      </details>
    </section>
  )
}
