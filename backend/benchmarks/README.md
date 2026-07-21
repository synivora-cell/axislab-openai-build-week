# Structured lesson-generation baseline

This benchmark compares two Qwen-based designs on four fixed requests for exact,
ordered mixed revolute/prismatic standard-DH topologies:

- **Single-call baseline:** one model call generates the complete lesson, robot,
  activity, and scene package.
- **AxisLab verified workflow:** a Pedagogy role defines the teaching intent, an
  Environment Agent proposes a constrained topology, and deterministic Verification
  checks the compiled package and can request one structured revision.

A case succeeds only when the returned joint sequence exactly matches the request and
the same deterministic package verifier approves it without fallback. The script records
success rate, latency, and token use. It is intentionally small enough for judges to
reproduce and should be treated as an engineering check rather than a statistical study.

Run it from `backend/` with an authorized Qwen Cloud API key configured:

```bash
uv run python -m benchmarks.compare_agent_society \
  --output ../docs/AGENT_BASELINE_RESULTS.json
```

Cloud latency and model output can vary between runs. Do not commit credentials or raw
provider headers.
