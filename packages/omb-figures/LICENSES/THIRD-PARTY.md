# PW3b third-party inventory

Only MIT, BSD, ISC, Apache, CC0 and OFL additions are admitted. The explicitly requested
Matplotlib PSF-based licence is a named exception inherited from the survey. No generic
unknown/custom-licence exception exists. CC-BY assets are excluded except for the digest-bound
official PRISMA template explicitly requested in the polish round (details below). GPL, LGPL,
EPL, MPL, CPAL, RAIL and unlicensed dependencies fail the gate, including transitive ones.

| Component | Licence | Use |
|---|---|---|
| @dagrejs/dagre 3.1.1; @dagrejs/graphlib 4.0.5 | MIT | Deterministic schematic layout |
| adjustText 1.4.0 | MIT | Fixed-iteration label placement in pinned matplotlib utility |
| marsilea 0.8.1 | MIT | Certified-order heatmap utility; no clustering |
| matplotlib 3.11.2 | PSF-based Matplotlib | Explicitly requested pinned renderer |
| K-Dense publisher_profiles.json | MIT | Dated venue planning data, not a compliance certification |
| nature-skills geometry audits | Apache-2.0 | Reference source; SVG port avoids upstream AGPL PyMuPDF |
| PRISMA2020 field schema | MIT | Typed count fields and conservation rules |
| Official PRISMA 2020 all-sources flow template | CC-BY-4.0 | Attributed wording/colours; exact-asset exception for the polish request |
| bioicons CC0 subset | CC0-1.0 | Whitelisted schematic icon only |
| Health Icons | MIT | Database icon |
| Liberation Sans and Serif 2.1.5 | OFL-1.1 | Embedded fonts; Arial/Times metric-compatible stand-ins |
| forestploter, TwoSampleMR, ggsurvfit/KMunicate, locuszoom.js | MIT | Layout conventions only, no R/JS source/runtime copied |

`dependencies.json` inventories every installed figure-package Node dependency.
`python-dependencies.json` inventories the pinned Python environment, including transitives.
`assets.json` pins each vendored asset's SHA-256 and licence. Adjacent licence files preserve
notices. The existing colorspacious notice remains in ../THIRD_PARTY_NOTICES.md.

No GPL/EPL tool is called by the product. Browser rasterization is test-only via a separately
installed Chrome executable. resvg-js was inspected, found MPL-2.0, and removed before adoption.

## Validation environment exclusion

The installed Python wheels are **not approved for the product**. NumPy 2.5.4 includes
Zlib-licensed libdivide; SciPy 1.18.1 bundles libgfortran, libgcc and LGPL libquadmath.
The strict Python gate exits 1 and records these findings in
`reports/python-license-audit.json`. The survey's package-level BSD classification was
insufficient to identify these native transitives. `python/` and `test/matplotlib-reference.ts`
are external validation utilities only. No product source imports or executes them.
No Python wheels or native runtimes are vendored into git. `requirements.lock` reproduces
that external environment for one-off cross-checks; it is not a product requirements file.

## Official PRISMA template (polish-round exception)

The owner explicitly requested an exact reproduction of the official **new reviews, databases/registers and other sources** template. That request is treated as a narrow exception to the original asset whitelist: `vendor/specs/prisma-official-new-reviews.json` contains attributed wording and colour data from Page MJ, et al. BMJ 2021;372:n71 (https://doi.org/10.1136/bmj.n71), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Source: https://www.prisma-statement.org/prisma-2020-flow-diagram. The source DOCX digest is recorded in the asset.

Changes: SVG transcription, certified counts substituted, exclusion reasons supplied by the study, line wrapping and box heights adjusted for minimum printed font size. Attribution is retained visibly and in the SVG description. The licence gate permits only this path and exact digest; arbitrary CC BY assets remain forbidden. This is template data, not a new code dependency.
