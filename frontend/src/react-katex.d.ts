declare module 'react-katex' {
  import type { ComponentType, ReactNode } from 'react'

  interface MathProps {
    math: string
    errorColor?: string
    renderError?: (error: Error) => ReactNode
  }

  export const BlockMath: ComponentType<MathProps>
  export const InlineMath: ComponentType<MathProps>
}
