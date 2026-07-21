export type CoordinateSystemKind = 'cartesian' | 'cylindrical' | 'spherical'

export function detectCoordinateSystem(question: string): CoordinateSystemKind | null {
  const normalized = question.toLowerCase()
  if (/spherical|sphere coordinate|球坐标/.test(normalized)) return 'spherical'
  if (/cylindrical|cylinder coordinate|柱坐标/.test(normalized)) return 'cylindrical'
  if (/cartesian|rectangular coordinate|直角坐标|笛卡尔/.test(normalized)) return 'cartesian'
  return null
}
