# AxisLab Three-Minute Demo Script

The final video must be public on YouTube, no longer than three minutes, and include
voiceover. The model statement below is supported by the primary local Codex task
record, which identifies the session model as `gpt-5.6-sol`.

## 0:00–0:20 — Problem and solution

Show the public home screen and module navigation.

> Robotics students often memorize transformations without seeing what the symbols do.
> AxisLab turns those equations into verified interactive lessons where students
> predict, manipulate, observe, and check their understanding.

## 0:20–0:55 — Direct robot lesson

Open **Canadarm**. Move the no-AI `d1` and `theta2` sliders. Show the synchronized robot,
DH table, transformation matrices, and end-effector position.

> Direct mode is deterministic and requires no model call, so the core demonstration is
> always reproducible. The same mathematics drives the geometry, matrices, and scoring.

## 0:55–1:30 — Interactive advanced concept

Open **RPY / Euler wrist**. Drag the 3D view, change all three angles, switch conventions,
and point out the inverse-angle and singularity explanation.

> The same learning pattern extends from coordinate systems to orientation, Jacobians,
> trajectories, and forces. Each module combines controls, visible geometry, equations,
> and scored questions.

## 1:30–2:00 — Customized and verified AI lesson

Ask for a Jacobian, trajectory, or dynamics lesson. Show the customized investigation
prompt and answer one question.

> The model customizes teaching intent and bounded starting parameters. Deterministic
> code validates the result and retains ownership of numerical answers and scoring.
> Generated code is never executed, and invalid output falls back safely.

## 2:00–2:35 — Codex and GPT-5.6

Briefly show the README Build Week section, a relevant commit, or the primary Codex
task. Use a specific explanation instead of saying only that AI wrote the code.

> Codex helped me inspect the existing system, plan the learning architecture, implement
> the React and FastAPI changes, review robotics mathematics, write tests, debug the
> responsive interface, and migrate deployment.

> The primary build session used GPT-5.6 Sol inside Codex. It supported the advanced
> lesson architecture, robotics-math review, real scoring, responsive interface,
> Railway migration, testing, and final release audit.

## 2:35–2:55 — Reliability and impact

Show the passing test summary or `/health`, then return to the live lesson.

> AxisLab has 21 backend tests, 20 frontend tests, reviewed local fallbacks, and a public
> no-login deployment. It makes difficult robotics mathematics visible, interactive,
> and verifiable.

## 2:55–3:00 — Closing

> AxisLab is a safer foundation for active, AI-assisted robotics education.

Use only original visuals, permitted marks, and licensed audio. Do not display secrets,
private task content, or third-party course materials.
