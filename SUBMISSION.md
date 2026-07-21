# AxisLab — OpenAI Build Week Submission Draft

## Category

**Education**

## Elevator pitch

AxisLab turns robotics equations into verified, interactive 3D lessons where students
predict motion, manipulate models, inspect synchronized mathematics, and receive
evidence-based feedback.

## Inspiration

Robotics students often learn coordinate transforms, DH tables, Jacobians, and wrist
angles as disconnected formulas. We wanted the equation, physical motion, and learning
assessment to live in the same interface so that understanding becomes observable.

## What it does

A learner can ask a robotics question or open one of six guided modules. AxisLab creates
a constrained lesson, validates its mathematical parameters, and presents an
interactive model alongside formulas and scored questions. It covers standard-DH robot
motion, Cartesian/cylindrical/spherical coordinates, RPY and Euler wrists, Jacobian
differential motion, cubic/quintic trajectories, and force/dynamics concepts.

For customized lessons, generative roles propose teaching intent and bounded parameters.
Deterministic code checks schemas, limits, renderability, forward kinematics, numerical
answers, and scoring before the result reaches the learner. Invalid output is revised
once or replaced by a reviewed fallback.

## How we built it

- React, TypeScript, Vite, Three.js, and React Three Fiber for the learning interface.
- FastAPI and Pydantic for strict lesson-generation and validation contracts.
- Independent client/server robotics calculations for consistency checks.
- SQLite for lesson traces and learner evidence.
- Docker and Railway for a single public HTTPS deployment.
- Codex for architecture exploration, implementation, mathematical review, testing,
  responsive UI iteration, deployment migration, and submission preparation.

The current live model adapter uses Qwen through an OpenAI-compatible client. Generated
content never owns the numerical truth and no model-generated code is executed.

## Challenges we ran into

The hardest problem was preserving mathematical correctness while still allowing a
model to customize lessons. A visually plausible robot can still have inconsistent
frames, impossible cylindrical connections, or questions whose answers do not match the
scene. We addressed this with narrow schemas, allow-listed renderers, bounded lesson
parameters, deterministic verification, structured revision, and safe fallback.

A second challenge was making advanced robotics concepts understandable within one
consistent interface. We reused the same predict–manipulate–observe–check loop across
coordinate systems, orientation, velocity, trajectories, and forces.

## Accomplishments that we are proud of

- Six directly accessible robotics learning modules in one coherent interface.
- Real answer evaluation rather than always-correct template feedback.
- A draggable 3D RPY/Euler wrist with inverse and singularity explanations.
- Deterministically verified AI-customized advanced lessons.
- A fully local no-AI robot demonstration for reliable judging.
- 21 passing backend tests, 20 passing frontend tests, and a production build.
- A free public demo with no account or proprietary hardware required.

## What we learned

Generative AI is strongest in this setting when it chooses teaching strategy and
variation while deterministic software retains mathematical authority. We also learned
that interaction alone is not education: prediction, explicit questions, meaningful
scoring, and evidence-grounded feedback are what turn a visualization into a lesson.

## What is next for AxisLab

Next steps include instructor-authored lesson packs, accessibility improvements,
learning-progress analytics, more rigorous inverse kinematics and dynamics modules, and
a controlled study comparing learning outcomes against static textbook diagrams.

## Live demo and testing

- **Demo:** <https://axislab-openai-production.up.railway.app>
- **Health:** <https://axislab-openai-production.up.railway.app/health>
- **API docs:** <https://axislab-openai-production.up.railway.app/docs>
- No login is required.

Suggested path for judges:

1. Open **Canadarm** and move the direct demonstration sliders.
2. Open **RPY / Euler wrist**, drag the 3D view, and change the angle sliders.
3. Ask for a Jacobian or trajectory lesson and complete one scored question.
4. Disconnecting the model provider still leaves reviewed local lessons available.

## Work completed during the submission period

The Build Week extension added real scoring, direct robot controls, advanced robotics
modules, AI-customized lesson generation, deterministic advanced-math verification,
responsive global navigation, Railway deployment, and expanded automated tests.

The primary local Codex build task records `gpt-5.6-sol` as its model and has task ID
`019f80ac-f636-7fb3-a5e0-c60d5680d9e2`. GPT-5.6 Sol supported the advanced module
architecture, robotics-math review, real scoring, responsive interface, Railway
migration, testing, and release audit. The final Devpost form should use the Session ID
returned by the required `/feedback` workflow for this task.

## Demonstration video

Upload a public YouTube video no longer than three minutes. It must contain voiceover,
show the working product, and specifically explain how Codex and GPT-5.6 contributed.
Use [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) as the recording plan.

## Built with

Codex, React, TypeScript, Vite, Three.js, React Three Fiber, FastAPI, Pydantic,
OpenAI-compatible SDK, SQLite, Docker, Railway, Vitest, and Pytest.

## License

MIT — see [LICENSE](LICENSE).
