# Table verification port

See [the complete integration port](integration/PW9-PORT.md).

Tables: call `verifyTable(submitted, spec, trustedStore)` before packaging. It regenerates
Markdown, CSV and dictionary, compares every byte and provenance, and reads CSV cells back.
`table.provenance` supplies `csvSha256` and `specSha256` for `checkDisplayReferences`.
Never treat submitted hashes or a self-consistent submitted provenance object as authority.
