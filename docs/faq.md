# FAQ

### What is Amani?

An autonomous computational biomedical research agent built as an untrusted AI generator inside a
trusted, deterministic checker. AI models propose plans, code and prose; fixed software locks the plan,
runs the frozen code once, recomputes every number and assigns every label. See the
[README](../README.md).

### Does it give medical advice?

No. It uses public data only, makes no claim about any individual patient and is not for clinical use. A
label is an internal evidence statement about one claim, one method and one dataset.

### What does "Confirmed" mean?

Computationally confirmed within the stated data and method: every check required for that kind of claim
passed. It is not a biological truth and not clinical evidence.
[Details.](labels-and-certification.md)

### Can the AI give itself a label?

No. Labels are assigned by code, and a missing, skipped or failed required check can only lower a label,
never raise one. The analyst's code runs sandboxed and offline as one OS user; the checker's records
belong to another.

### Why not just make the model more careful?

Because carefulness is not checkable. A plain frontier model passes most single-trap tasks, so the value
of a harness has to show where models fail and in never certifying a wrong result. Amani moves the
decision from the model to code that can be tested.

### Is it better than other research agents?

Unknown. No head-to-head has been run. One is planned and will be pre-registered. Until then this
project makes no comparative claim.

### How well has it been tested?

Developer-run only: known-answer tests, simulation-calibrated methods, and one round of five sealed
one-shot investigations (59 of 66 criteria, 89%). An independent evaluation and a trap-card race are
planned. [Details and limits.](validation.md)

### Which models does it use?

Today, OpenAI's Codex CLI and Anthropic's Claude Code, through their own CLIs. Multi-provider support
(OpenRouter, OpenCode, Anthropic and OpenAI API keys) is in development. [Providers.](providers.md)

### Why do I need `sudo` for the launcher?

Confirmed requires the checker's records and the analyst's code to belong to different OS accounts.
Creating those accounts and the narrow `sudo` delegation is a one-time, owner-run install. Without it,
runs work but every claim is capped at Tentative.
[Install steps.](getting-started.md#certification-launcher-os-account-separation)

### Does it run on Linux or Windows?

Not yet. The sandbox is macOS Seatbelt and the analysis environment is pinned to Apple silicon.

### Why are some tests failing on a fresh clone?

Some tests need private, host-side benchmark material that is not in the repository. They fail as "not
verified" rather than skipping, on purpose. See
[validation.md](validation.md#what-a-clean-clone-can-and-cannot-run).

### Why do package names say `omb-` and `bio-`?

They are from the project's earlier name. The product is now called Amani. Package names and code
identifiers will be renamed in a later pass.

### Can it write a paper?

The core is built: AI prose in a closed format with slots, software-filled numbers, figures and tables
from certified records, and verified citations. The full manuscript, review and packaging pipeline is
still being finished. A human author reviews and signs off; Amani never submits or takes authorship.

### Can I use it, copy it or contribute?

The engine is available under [AGPL-3.0-only](../LICENSE), and the independent verifier and certificate
format use Apache-2.0. A separate commercial license is available by agreement; use GitHub issues or
discussions for enquiries. See [licensing-plan.md](licensing-plan.md). Contributions require acceptance
of the [contributor license agreement](../CONTRIBUTING.md).

### How do I cite it?

Use [`CITATION.cff`](../CITATION.cff). AI systems are credited in acknowledgements, not as authors.

### How do I report a security issue?

Privately. See [`SECURITY.md`](../SECURITY.md).
