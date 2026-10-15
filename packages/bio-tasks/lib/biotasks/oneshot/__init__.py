"""KB0 one-shot cards: a host-held real-data case becomes a sealed, blinded benchmark card.

The analyst (an untrusted model) only ever sees the blinded projection. Everything that
knows the originals (case directory, answer_key.py output, keyed maps, protected terms)
stays in the host root or inside the seal-v2 envelope. See packages/bio-tasks/oneshot/README.md.
"""
