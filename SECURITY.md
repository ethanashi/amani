# Security policy

Amani is research software whose purpose is to make it hard for a model's output to become a claim.
Vulnerabilities in the sandbox, the trust boundary, the sealing and look ledger, the launcher or the
checker are taken seriously.

## Reporting a vulnerability

**Please report privately. Do not open a public issue, pull request or discussion.**

Use GitHub's private vulnerability reporting: on the repository page, open the **Security** tab and choose
**Report a vulnerability**. If that is unavailable to you, send a private message to the maintainer through
their GitHub profile (`@ethanashi`) asking for a private channel, without including details in the first
message.

Please include:

- what you found and why it matters (for example "a worker can read the sealed partition" or "a label
  can be raised without the required gate");
- the affected package and version or commit;
- steps to reproduce, ideally a failing test;
- whether you have shared it with anyone else.

Do not include real secrets, benchmark keys or patient-level data in a report.

## What to expect

Reports are acknowledged within a few days. This is a one-person preview project, so please be patient,
and there is no bounty. You will be told whether the report is accepted, and credited in the advisory
if you wish. Please allow time to fix a problem before disclosing it publicly.

## Scope

In scope, because they break the design's guarantees:

- a way for worker code to read or write a trusted path (store, seal key, data contract, graders);
- a way to see sealed or held-out material, or the answer-key canary, from the analyst side;
- a sandbox or network-egress escape;
- a way to obtain a label (especially Confirmed) without the required checks, to take a second look, or
  to change a locked plan;
- weaknesses in the launcher's `sudo` delegation or its installer;
- leaks of secrets, API keys or personal data through logs, the ledger or reports.

Out of scope: a compromised operating system or root account (the launcher's threat model trusts both),
an owner who installs a malicious release, denial of service by an owner withholding resources, and
findings that need physical access.

## Safe use

Amani is research software. It does not provide medical advice and must not be used for clinical
decisions. It uses public data only; do not point it at individual-level controlled-access data.
