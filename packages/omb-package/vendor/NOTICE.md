# Embedded assets

Source Serif 4, release 4.005R, Adobe, is redistributed under the SIL Open Font
License 1.1 in `fonts/OFL.txt`. PDF subsetting and DOCX embedding are permitted.
Regular, bold and italic font bytes are shipped and hashed; no system font is
required for the manuscript body. Font fallback is checked in PDF verification.

`csl/plos.csl` is from the Citation Style Language project (contributors and
CC BY-SA 3.0 declaration inside the file). It implements the PLOS numeric
Vancouver variant. bioRxiv/medRxiv do not impose one CSL style: the same style is
our pinned default there and for notes. The manifest pins exact vendored bytes;
updates are explicit reviewed source changes even where a retrieval URL used
`master`. These styles are not the PW4 bounded reference-audit format.

LaTeX outputs use Latin Modern 2.004. Its GUST Font License 1.0 is based on
LPPL 1.3c (`fonts/GUST-FONT-LICENSE.txt`, `tex/LPPL-1.3c.txt`), rather than SIL
OFL. Unmodified font programs are embedded/subset in PDFs and the regular face
is embedded in SVG derivatives. The font source distribution is available at
https://mirrors.ctan.org/fonts/lm.zip. The original PW3 SVG remains authenticated
before a font-only derivative is made. Tectonic 0.15.0 is MIT licensed; its TeX
runtime dependencies retain the copyright/licence notices in their source files.

`tex/pw9-bundle.zip` is a deterministic, minimal runtime subset of Tectonic's
immutable tlextras-2022.0r0 bundle. `tectonic.lock.json` lists every resource's
SHA-256, original bundle digest/URL and archive hash. It includes the unmodified
required LaTeX package runtime files (predominantly LPPL), hyphenation resources
and font programs with their original embedded notices. Full upstream sources
remain available at that URL and the corresponding CTAN package distributions.
A clean-cache, offline compilation is checked; normal builds never download TeX
resources. Engine dependencies and hashes for macOS arm64/Linux x86_64 are pinned
in pixi.lock. The source tarball uses standard packages and font filenames on
arXiv's TeX Live; it does not require Tectonic or this minimal runtime bundle.

Chromium emits Type 3 fonts for the original CFF OTF. For vector figure PDFs,
`scripts/figure-font.py` uses pinned FontTools 4.60.1 to convert its outlines to
TrueType (maximum curve error 0.00025 em), preserving metrics and Unicode mapping.
The derivative is renamed PW9 Latin Modern Roman under GUST/LPPL. Its timestamps,
source, conversion recipe and output hash are pinned. This avoids Type 3 fonts
while preserving selectable figure labels; it does not rasterise the figure.

The PW8 adapter additionally embeds PW9 Latin Modern Roman Bold, derived from the pinned bundle's lmroman10-bold.otf with the same pinned FontTools conversion and GUST/LPPL terms. The original and derivative bytes are in manifest.json; scripts/figure-font-bold.py reproduces the derivative.

## Journal article font pair

The reading article now uses **Amani Journal Serif**, a reproducible derivative of the pinned Source Serif 4 4.005R regular/bold/italic files, under OFL 1.1 (`fonts/OFL.txt`). `scripts/journal-fonts.py` clones Unicode-alias glyphs with unchanged outlines and advances so XeTeX preserves ASCII hyphens in PDF ToUnicode maps. The derivative removes the reserved family name “Source”; its bytes are separately pinned in `manifest.json`. Latin Modern Sans regular/bold, from the unchanged Tectonic bundle, supplies headings and furniture under the existing GUST Font License. All five font programs and both licence texts ship in the hash-bound source archive. No installed system fonts or new TeX bundle downloads are required.
