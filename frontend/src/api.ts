import type { InteractionEvent, LearnerFeedback, LessonResponse, Matrix4, ModuleLessonResponse } from './types'

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`${response.status}: ${detail}`)
  }
  return response.json() as Promise<T>
}

export function createLesson(question: string): Promise<LessonResponse> {
  const provider = import.meta.env.VITE_AGENT_PROVIDER === 'template' ? 'template' : 'qwen'
  return jsonRequest('/api/lessons', {
    method: 'POST',
    body: JSON.stringify({ question, provider }),
  })
}

export function createModuleLesson(question: string): Promise<ModuleLessonResponse> {
  const provider = import.meta.env.VITE_AGENT_PROVIDER === 'template' ? 'template' : 'qwen'
  return jsonRequest('/api/module-lessons', {
    method: 'POST',
    body: JSON.stringify({ question, provider }),
  })
}

export function createScene(scene: unknown): Promise<LessonResponse> {
  return jsonRequest('/api/scenes', { method: 'POST', body: JSON.stringify(scene) })
}

export function validateState(
  lessonId: string,
  requestSequence: number,
  jointValues: Record<string, number>,
  clientEndEffectorTransform: Matrix4,
) {
  return jsonRequest<{
    requestSequence: number
    valid: boolean
    errors: { position: number | null; rotation: number | null }
  }>(`/api/lessons/${lessonId}/validate-state`, {
    method: 'POST',
    body: JSON.stringify({ requestSequence, jointValues, clientEndEffectorTransform }),
  })
}

export function submitEvents(
  lessonId: string,
  sessionId: string,
  events: InteractionEvent[],
) {
  return jsonRequest<{ accepted: number; duplicates: number }>(
    `/api/lessons/${lessonId}/events`,
    {
      method: 'POST',
      body: JSON.stringify({ sessionId, events }),
    },
  )
}

export function requestFeedback(lessonId: string, sessionId: string) {
  return jsonRequest<LearnerFeedback>(`/api/lessons/${lessonId}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  })
}
