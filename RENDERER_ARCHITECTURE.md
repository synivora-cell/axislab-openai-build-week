# Robotics Scene Renderer Architecture

## Purpose

The renderer converts a verified teaching-scene JSON document into an
interactive robotics visualization. It supports two input paths:

1. **Problem-driven:** Agents extract joints, symbols, and constraints from a
   question, DH table, or problem figure.
2. **Concept-driven:** Agents select the smallest clear example robot from an
   allow-listed teaching-template catalog.

The renderer never executes Agent-generated code and never accepts unverified
arbitrary 3D assets.

## Data flow

```text
Learner question
  → Pedagogy Agent (goal, misconceptions, topic)
  → Environment Agent (preset and scene configuration)
  → Verification (schema, rules, kinematics, renderability)
  → RoboticsSceneSpec
  → Scene Compiler
  → preset + kinematic model + overlays
  → React Three Fiber Renderer
```

## Unified contract

The final API response contains `lessonSpec`, `robotSpec`, `activitySpec`, and
`sceneSpec`. The first three define pedagogy, kinematics, and activity steps.
`sceneSpec` is the renderer's only entry point.

```json
{
  "version": "1.0",
  "visualPreset": "canadarm_q5",
  "topic": "forward_kinematics",
  "modelSource": "teaching_template",
  "robot": { "representation": "standard_dh", "templateId": "canadarm_d1_vs_theta2" },
  "lesson": {
    "activityTemplate": "canadarm_d1_vs_theta2",
    "controls": ["joint_1.d", "joint_2.theta"],
    "overlays": ["joint_labels", "dh_frames", "joint_axes", "symbolic_dimensions"]
  }
}
```

## Responsibility boundaries

| Layer | Responsibility | Must not do |
|---|---|---|
| `visualPreset` | Materials, camera, lighting, module dimensions, labels, and end effector | Affect mathematical computation |
| `robot` | Joint types, DH parameters, limits, and state | Inject rendering code |
| `lesson` | Topic, editable variables, overlays, and activity template | Expose unverified variables |
| Compiler | Convert the DH joint chain into renderer state | Guess missing axes or dimensions |
| Renderer | Render allow-listed presets and react to state changes | Evaluate string expressions or arbitrary scripts |

## Internal representation

`standard_dh` is an input adapter for serial manipulators, not the renderer's
only possible internal model. Compilation produces:

```text
Kinematic Tree + Frame Graph + Runtime State
```

Future adapters may include:

- `joint_chain`: explicit joint axes and relative poses;
- `mobile_base`: differential-drive and Ackermann platforms;
- `sensors`: cameras, LiDAR, and force sensors;
- `environment`: objects, target poses, and obstacles.

## Presets and reusable modules

Presets are allow-listed registry entries. `canadarm_q5` provides a fixed
bulkhead, a 1P+4R visual structure, gripper, engineering-diagram labels,
isometric camera, and always-visible DH arrows. `dh_chain` is the generic
standard-DH serial-arm preset. It iterates over the JSON joint table and forward
kinematics results to create joints, links, DH frames, labels, and variable
controls. Both presets consume joint state and verified overlays, never code.

Reusable modules include:

- `PrismaticJoint` and `RevoluteJoint`;
- `LinkSegment`;
- `EndEffector`;
- `FrameAxes` with red x and blue z arrows;
- `DimensionLabel`;
- future `Trajectory`, `VectorArrow`, and `TargetPose` modules.

### Cylindrical connection rules for `dh_chain`

The generic preset uses fixed cylindrical joints. It does not imply spherical
joints, universal joints, or arbitrary adapters. Every straight link must have
one of two orientations relative to each cylinder axis it touches:

- **End-face connection:** link direction parallel to the cylinder axis.
- **Side connection:** link direction perpendicular to the cylinder axis.

Every other angle is unrenderable. For one standard-DH segment, nonzero `a` and
nonzero `d` create a center-to-center line with both radial and axial components.
That oblique link must be rejected; stretching or tilting a cylinder would
misrepresent the mechanism. For a pure `d` segment, `alpha` must also make the
next cylinder axis parallel or perpendicular to the link (`alpha = k·π/2`).

The backend returns `OBLIQUE_CYLINDRICAL_LINK` or
`UNSUPPORTED_CAP_ALIGNMENT` during JSON scene creation. As a second defense,
the frontend does not draw an invalid link and marks it `INVALID LINK`. A scene
with arbitrary `alpha`, simultaneous `a` and `d` offsets, or a complex wrist
must explicitly select a future `adapter` or `universal_joint` module instead
of misusing the pure-cylinder `dh_chain` preset.

## Symbolic problems

Symbols such as `A`, `B`, and `theta_1` must remain symbolic. A visual preset may
use a fixed teaching scale, but that scale must never be presented as a physical
value supplied by the problem. When a problem figure, axis direction, or DH
table is missing, the scene must be marked `unresolved` or fall back to a
concept template instead of guessing the original mechanism.

## Current implementation

The current implementation changed the Canadarm P0 path from passing raw
`d1/theta2` values to consuming a complete `RoboticsSceneSpec`. The API now
returns `sceneSpec`. Two presets are registered: `canadarm_q5` and the generic
`dh_chain`. Ordinary 2R+1P, 3R+1P, and other mixed serial manipulators share the
same `dh_chain` rendering path.
