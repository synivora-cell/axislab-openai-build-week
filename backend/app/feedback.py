from .schemas import ActivitySpec, InteractionEvent, LearnerFeedback, RobotSpec, VariableSpec


def _joint_variables(robot: RobotSpec) -> dict[str, tuple[str, int]]:
    variables: dict[str, tuple[str, int]] = {}
    for index, joint in enumerate(robot.joints, start=1):
        variable = joint.d if joint.type == "prismatic" else joint.theta
        assert isinstance(variable, VariableSpec)
        variables[variable.parameter_id] = (joint.type, index)
    return variables


def generate_feedback(
    events: list[InteractionEvent],
    robot: RobotSpec,
    activity: ActivitySpec,
) -> LearnerFeedback:
    variables = _joint_variables(robot)
    changed = {
        event.parameter_id
        for event in events
        if event.type == "parameter_changed" and event.parameter_id
    }
    predictions = {
        event.parameter_id: (event.answer or "").lower()
        for event in events
        if event.type == "prediction_submitted" and event.parameter_id
    }
    explanations = [
        (event.answer or "").lower()
        for event in events
        if event.type == "explanation_submitted"
    ]
    prediction_targets = [
        step.parameter_id
        for step in activity.steps
        if step.type == "prediction" and step.parameter_id
    ]
    interaction_targets = [
        step.parameter_id
        for step in activity.steps
        if step.type == "interaction" and step.parameter_id
    ]

    evidence: list[str] = []
    correct_predictions = 0
    for parameter_id in prediction_targets:
        joint_type, joint_index = variables[parameter_id]
        expected = "translate" if joint_type == "prismatic" else "rotate"
        answer = predictions.get(parameter_id)
        symbol = f"d_{joint_index}" if joint_type == "prismatic" else f"theta_{joint_index}"
        if answer == expected:
            correct_predictions += 1
            motion = "translation" if joint_type == "prismatic" else "rotation"
            evidence.append(f"You correctly predicted {symbol} produces {motion}.")
        elif answer is not None:
            motion = "translate along" if joint_type == "prismatic" else "rotate about"
            evidence.append(
                f"Revisit {symbol}: it should {motion} z_{joint_index - 1}."
            )

    completed_interactions = sum(
        parameter_id in changed for parameter_id in interaction_targets
    )
    evidence.append(
        f"You manipulated {completed_interactions} of {len(interaction_targets)} target joint variables."
    )

    explanation = explanations[-1] if explanations else ""
    has_revolute = any(joint.type == "revolute" for joint in robot.joints)
    has_prismatic = any(joint.type == "prismatic" for joint in robot.joints)
    mentions_rotation = any(
        token in explanation for token in ("rotate", "rotation", "旋转")
    )
    mentions_translation = any(
        token in explanation for token in ("translate", "translation", "平移")
    )
    explanation_signals = (
        (not has_revolute or mentions_rotation)
        and (not has_prismatic or mentions_translation)
        and any(token in explanation for token in ("axis", "z_", "z-", "轴"))
    )
    if explanation_signals and explanations:
        evidence.append("Your explanation matches the motion types in this robot.")
    elif explanations:
        evidence.append("Your explanation needs a clearer link between joint type, variable and axis.")

    all_predictions_correct = bool(prediction_targets) and (
        correct_predictions == len(prediction_targets)
    )
    all_interactions_completed = all(
        parameter_id in changed for parameter_id in interaction_targets
    )
    demonstrated = (
        all_predictions_correct
        and all_interactions_completed
        and bool(explanations)
        and explanation_signals
    )

    prediction_score = round(
        60 * correct_predictions / len(prediction_targets)
    ) if prediction_targets else 0
    interaction_score = round(
        20 * completed_interactions / len(interaction_targets)
    ) if interaction_targets else 20
    explanation_score = 20 if explanation_signals and explanations else 0
    score = prediction_score + interaction_score + explanation_score

    ordered_topology = "".join(
        "R" if joint.type == "revolute" else "P" for joint in robot.joints
    )
    topology = (
        f"{sum(joint.type == 'revolute' for joint in robot.joints)}R"
        f"{sum(joint.type == 'prismatic' for joint in robot.joints)}P"
    )
    if demonstrated:
        return LearnerFeedback(
            summary=(
                f"You connected the {ordered_topology} ({topology}) robot's joint types to their standard-DH "
                "variables and observed how each change propagates to the end effector."
            ),
            evidence=evidence,
            nextStep="Explain which upstream joint has the widest downstream effect and why.",
            mastery="demonstrated",
            score=score,
        )
    return LearnerFeedback(
        summary=(
            "You are building the right connection. Remember: theta_i rotates about "
            "z_(i-1), while d_i translates along z_(i-1)."
        ),
        evidence=evidence,
        nextStep="Replay the incomplete joint steps, then connect each motion to its DH variable and axis.",
        mastery="developing",
        score=score,
    )
