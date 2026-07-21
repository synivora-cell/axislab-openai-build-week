# AxisLab Product Specification

## Product goal

AxisLab is an interactive learning environment for university-level robotics. Its goal
is to help learners connect mathematical notation to visible motion and demonstrate
understanding through prediction, manipulation, and scored assessment.

## Primary users

- students learning coordinate transforms, kinematics, motion, and forces;
- instructors who need interactive demonstrations that remain mathematically reliable;
- independent learners who do not have access to a physical robot.

## Core learning loop

1. Select a module or ask a robotics question.
2. Predict the result before moving the model.
3. Manipulate bounded parameters or the 3D camera.
4. Observe synchronized geometry, formulas, and numerical state.
5. Answer one or more scored questions.
6. Receive feedback based on recorded evidence.

## Current modules

1. Standard-DH robot motion and mixed R/P joints.
2. Cartesian, cylindrical, and spherical coordinates.
3. RPY and Euler wrist orientation.
4. Jacobian differential motion.
5. Cubic and quintic trajectory planning.
6. Forces, Jacobian transpose, and gravity compensation.

## Functional requirements

- The public demonstration must work without an account.
- A deterministic direct mode must remain available without a model provider.
- Model-generated values must pass strict schemas and mathematical verification.
- The application must never execute model-generated code.
- All modules must expose a visible path from parameter change to mathematical result.
- Assessment must compare submitted answers against module-specific expected answers.
- Desktop layouts must use the available viewport and remain usable on smaller screens.
- Secrets must remain server-side.

## Non-goals

- controlling a physical or safety-critical robot;
- arbitrary generated 3D code or uploaded executable assets;
- high-fidelity contact, collision, or rigid-body simulation;
- replacing a complete robotics course or instructor.

## Success criteria

- A new visitor can reach every module from the main navigation.
- The direct robot and coordinate demonstrations work without external AI access.
- Customized lesson parameters are rejected when they violate a mathematical contract.
- Backend tests, frontend tests, lint, and the production build pass.
- The deployed `/health` endpoint and main learning interface are publicly reachable.
