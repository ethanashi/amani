# verifier

Apache-2.0; copyright 2026 Ethan Ashihundu.

Independent signed bundle verifier extracted from omb-package. Takes a bundle path and an independently trusted public key; verifies the signature, manifest digest and signed file bytes. Depends only on Node built-ins and the Apache-2.0 certificate package. It does not rerun scientific gates, execute bundle code or grant evidence labels.

The root lint checks this package boundary; tests use synthetic data.

Ships native JavaScript and TypeScript declarations; no build step or engine is required.
