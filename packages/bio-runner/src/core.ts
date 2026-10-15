// The one seam to bio-core. Until the integrator links `@omerta-bio/core` as a workspace dependency (Block 7), this
// imports its public entry point by relative path, so no lockfile outside this package changes. Swap this line only.
export * from "../../bio-core/src/index.ts";
