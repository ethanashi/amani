# PW8 directed mutation results

The first table records the pre-review campaign at head 018e2d9. For the current round, see
“Round 1 new-guard campaign” below; its separate runner uses in-memory mutations.

170/170 killed (100.0%), baseline 226 PW8 tests green. Invalid runs count against the denominator. Every source was restored after each run and verified by hash at the end.

| Mutant | File | Outcome | Failing tests (first three) |
| --- | --- | --- | --- |
| S-hex | reverify/sign.ts | killed | PW8 signer guards letters encoding round trip and refusals |
| S-letters | reverify/sign.ts | killed | PW8 signer guards letters encoding round trip and refusals |
| S-build-hash | reverify/sign.ts | killed | PW8 signer guards build IDs need the PaperInput hash and a bounded nonce |
| S-nonce-empty | reverify/sign.ts | killed | PW8 signer guards build IDs need the PaperInput hash and a bounded nonce |
| S-nonce-long | reverify/sign.ts | killed | PW8 signer guards build IDs need the PaperInput hash and a bounded nonce |
| S-key-length | reverify/sign.ts | killed | PW8 signed HTML: honest render signer keys are at least 32 bytes and build IDs are digit-free |
| S-build-format | reverify/sign.ts | killed | PW8 signed HTML: honest render signer keys are at least 32 bytes and build IDs are digit-free |
| S-domain | reverify/sign.ts | killed | PW8 signer guards signatures need a PW8 domain, a valid format and the right key |
| S-compare | reverify/sign.ts | killed | PW8 signer guards signatures need a PW8 domain, a valid format and the right key; PW8 signed HTML: honest render a different key or build cannot verify the render; PW8 signed spans: any byte change inside a signed span fails a rounded value inside a value span (+16) |
| M-decompose-cover | reverify/manuscript.ts | killed | PW8 assembly guards software blocks: no template digits, known keys only, never empty; PW8 software text decomposition every number must trace to one candidate occurrence; longest wins |
| M-decompose-longest | reverify/manuscript.ts | killed | PW8 software text decomposition every number must trace to one candidate occurrence; longest wins |
| M-decompose-token | reverify/manuscript.ts | killed | PW8 assembly guards units are closed: digits only in values, no control characters, no empty values |
| M-closed-control | reverify/manuscript.ts | killed | PW8 assembly guards units are closed: digits only in values, no control characters, no empty values |
| M-closed-digit | reverify/manuscript.ts | killed | PW8 assembly guards units are closed: digits only in values, no control characters, no empty values |
| M-closed-empty | reverify/manuscript.ts | killed | PW8 assembly guards units are closed: digits only in values, no control characters, no empty values |
| M-sentence-agree | reverify/manuscript.ts | killed | PW8 assembly guards rendered sentence markup must agree with its text and use only known spans |
| M-sentence-markup | reverify/manuscript.ts | killed | PW8 assembly guards rendered sentence markup must agree with its text and use only known spans |
| M-empty-unit | reverify/manuscript.ts | killed | PW8 assembly guards software blocks: no template digits, known keys only, never empty |
| M-template-digit | reverify/manuscript.ts | killed | PW8 assembly guards software blocks: no template digits, known keys only, never empty |
| M-unknown-key | reverify/manuscript.ts | killed | PW8 assembly guards software blocks: no template digits, known keys only, never empty |
| M-pipe | reverify/manuscript.ts | killed | PW8 assembly guards PW3 table markdown must be a pipe table with even rows |
| M-ragged | reverify/manuscript.ts | killed | PW8 assembly guards PW3 table markdown must be a pipe table with even rows |
| M-svg-strict | reverify/manuscript.ts | killed | PW8 assembly guards figures and tables: placed once, digit-free captions, strict SVG |
| M-dup-section | reverify/manuscript.ts | killed | PW8 assembly guards section and block identity |
| M-section-id | reverify/manuscript.ts | killed | PW8 assembly guards section and block identity |
| M-dup-block | reverify/manuscript.ts | killed | PW8 assembly guards section and block identity |
| M-heading-digit | reverify/manuscript.ts | killed | PW8 assembly guards section and block identity |
| M-empty-software | reverify/manuscript.ts | killed | PW8 assembly guards software blocks: no template digits, known keys only, never empty |
| M-empty-protected | reverify/manuscript.ts | killed | PW8 assembly guards protected regions: hashed, unique, never empty |
| M-protected-hash | reverify/manuscript.ts | killed | PW8 assembly guards protected regions: hashed, unique, never empty |
| M-dup-protected | reverify/manuscript.ts | killed | PW8 assembly guards protected regions: hashed, unique, never empty |
| M-figure-slug | reverify/manuscript.ts | killed | PW8 assembly guards figures and tables: placed once, digit-free captions, strict SVG |
| M-caption-digit | reverify/manuscript.ts | killed | PW8 assembly guards figures and tables: placed once, digit-free captions, strict SVG |
| M-empty-notes | reverify/manuscript.ts | killed | PW8 assembly guards software blocks: no template digits, known keys only, never empty |
| M-placed-twice | reverify/manuscript.ts | killed | PW8 assembly guards figures and tables: placed once, digit-free captions, strict SVG |
| M-template-origin | reverify/manuscript.ts | killed | PW8 fixtures are the render of the current verified HTML fixture HTML hash matches (regenerate with scripts/pw8-render-fixtures.ts if not); PW8 owner DOCX edit read-back a prose edit is applied to the paper source and re-verified; PW8 owner DOCX edit read-back a tracked insertion is read back as accepted text (+3) |
| M-skeleton-text | reverify/manuscript.ts | killed | PW8 fixtures are the render of the current verified HTML fixture HTML hash matches (regenerate with scripts/pw8-render-fixtures.ts if not); PW8 software text decomposition the skeleton records values per unit in order and hashes software text |
| M-template-core | reverify/manuscript.ts | killed | PW8 fixtures are the render of the current verified HTML fixture HTML hash matches (regenerate with scripts/pw8-render-fixtures.ts if not); PW8 planted-number suite honest controls pass in every format; PW8 edit gate a connective change in a claim request is prose, not a skeleton change |
| M-results-lock | reverify/manuscript.ts | killed | PW8 assembly guards Results blocks refuse outcomes without locked ancestry |
| M-figure-number | reverify/manuscript.ts | killed | PW8 fixtures are the render of the current verified HTML fixture HTML hash matches (regenerate with scripts/pw8-render-fixtures.ts if not); PW8 PDF text check (Chrome render, pinned pure-JS extractor) the honest Chrome PDF verifies: text, vector figure text, alt tag, metadata; PW8 PDF text check (Chrome render, pinned pure-JS extractor) ActualText that replaces a number is refused; ligature ActualText is allowed (+9) |
| K-context | reverify/skeleton.ts | killed | PW8 edit gate a context change (checklist, label set, PaperInput) is rejected |
| K-spine-same | reverify/skeleton.ts | killed | PW8 planted-number suite source: move in prose is blocked; PW8 planted-number suite source: move in software is blocked; PW8 swap fixture: two numbers swapped between sentences must fail two claim bundles swapped by reordering claim sentences (edit) (+7) |
| K-spine-values | reverify/skeleton.ts | killed | PW8 planted-number suite source: move in prose is blocked; PW8 swap fixture: two numbers swapped between sentences must fail two values swapped between drafted sentences in the same section (edit); PW8 swap fixture: two numbers swapped between sentences must fail two values swapped between drafted sentences in the same section (revision) (+2) |
| K-is-spine | reverify/skeleton.ts | killed | PW8 planted-number suite source: move in prose is blocked; PW8 swap fixture: two numbers swapped between sentences must fail two values swapped between drafted sentences in the same section (edit); PW8 swap fixture: two numbers swapped between sentences must fail two values swapped between drafted sentences in the same section (revision) (+2) |
| K-glue-added | reverify/skeleton.ts | killed | PW8 owner DOCX edit read-back an added sentence is glue: refused outside a revision round; PW8 edit gate a glue sentence may be added or removed only in a revision round; PW8 owner edit of the signed HTML an added sentence is glue: rejected outside a revision round, listed inside one |
| K-glue-removed | reverify/skeleton.ts | killed | PW8 edit gate a glue sentence may be added or removed only in a revision round |
| K-glue-moved | reverify/skeleton.ts | killed | PW8 must-appear and edit-gate details a glue sentence moved into another block is a glue move: refused in edit mode, listed in revision |
| K-prose-allowed | reverify/skeleton.ts | killed | PW8 owner DOCX edit read-back a prose edit is applied to the paper source and re-verified; PW8 owner DOCX edit read-back a tracked insertion is read back as accepted text; PW8 planted-number suite honest controls pass in every format (+7) |
| K-ok | reverify/skeleton.ts | killed | PW8 planted-number suite source: move in prose is blocked; PW8 planted-number suite source: move in software is blocked; PW8 swap fixture: two numbers swapped between sentences must fail two claim bundles swapped by reordering claim sentences (edit) (+5) |
| K-rule-results | reverify/skeleton.ts | killed | PW8 must-appear and edit-gate details the exact must-appear rule set |
| K-rule-label | reverify/skeleton.ts | killed | PW8 must-appear and edit-gate details the exact must-appear rule set; PW8 must-appear set the first draft holds every required fact, block and limitation; PW8 must-appear set the rule is per section: the primary bundle elsewhere does not satisfy the abstract |
| K-rule-count | reverify/skeleton.ts | killed | PW8 must-appear and edit-gate details the exact must-appear rule set; PW8 must-appear set the first draft holds every required fact, block and limitation; PW8 must-appear set missing claim-count sentence fails |
| K-rule-results-blocks | reverify/skeleton.ts | killed | PW8 must-appear and edit-gate details the exact must-appear rule set; PW8 edit gate software blocks cannot be removed: the spine and the must-appear set both fail; PW8 must-appear set the first draft holds every required fact, block and limitation (+1) |
| K-rule-aims | reverify/skeleton.ts | killed | PW8 must-appear and edit-gate details the exact must-appear rule set; PW8 must-appear and edit-gate details the must-appear set alone blocks an edit whose skeleton did not change; PW8 must-appear set the first draft holds every required fact, block and limitation (+1) |
| K-rule-part-a | reverify/skeleton.ts | killed | PW8 must-appear set the first draft holds every required fact, block and limitation; PW8 must-appear set missing a Limitations Part A line fails |
| K-rule-search | reverify/skeleton.ts | killed | PW8 must-appear and edit-gate details the exact must-appear rule set; PW8 must-appear set the first draft holds every required fact, block and limitation; PW8 must-appear set missing search sentence fails |
| K-per-section | reverify/skeleton.ts | killed | PW8 must-appear set missing primary bundle in Key Points fails; PW8 must-appear set the rule is per section: the primary bundle elsewhere does not satisfy the abstract |
| K-provides | reverify/skeleton.ts | killed | PW8 must-appear and edit-gate details a glue sentence moved into another block is a glue move: refused in edit mode, listed in revision; PW8 owner DOCX edit read-back a prose edit is applied to the paper source and re-verified; PW8 owner DOCX edit read-back a tracked insertion is read back as accepted text (+9) |
| E-must-appear | reverify/edit.ts | killed | PW8 must-appear and edit-gate details the must-appear set alone blocks an edit whose skeleton did not change |
| E-first-draft | reverify/edit.ts | killed | PW8 must-appear set missing aims paragraph fails; PW8 must-appear set missing search sentence fails; PW8 must-appear set missing claim-count sentence fails (+3) |
| E-html-gate | reverify/edit.ts | killed | PW8 owner edit of the signed HTML a typed number fails the HTML closed world before any re-render; PW8 owner edit of the signed HTML deleting a value span from a drafted sentence fails |
| E-prose-source | reverify/edit.ts | killed | PW8 planted-number suite html: unit in prose is blocked; PW8 owner edit of the signed HTML a prose edit is read back, re-rendered and passes; PW8 owner edit of the signed HTML a value edit keeps its placeholder and survives re-rendering (+3) |
| H-doctype | reverify/html.ts | killed | PW8 HTML grammar guards the doctype line must be exact |
| H-parse-issues | reverify/html.ts | killed | PW8 closed world over every text node and attribute number as a character reference; PW8 closed world over every text node and attribute a comment hiding a number; PW8 closed world over every text node and attribute a non-predefined entity (+1) |
| H-root-tag | reverify/html.ts | killed | PW8 HTML grammar guards unknown classes, unsigned metas, links and unknown units |
| H-element | reverify/html.ts | killed | PW8 HTML grammar guards unknown classes, unsigned metas, links and unknown units; PW8 closed world over every text node and attribute a style element |
| H-attribute | reverify/html.ts | killed | PW8 closed world over every text node and attribute number in a new attribute; PW8 closed world over every text node and attribute a style attribute hiding text |
| H-attr-control | reverify/html.ts | killed | PW8 HTML grammar guards a control character inside an attribute value |
| H-class | reverify/html.ts | killed | PW8 HTML grammar guards unknown classes, unsigned metas, links and unknown units |
| H-nested | reverify/html.ts | killed | PW8 HTML grammar guards a unit nested in another unit |
| H-unknown-unit | reverify/html.ts | killed | PW8 HTML grammar guards unknown classes, unsigned metas, links and unknown units |
| H-duplicate | reverify/html.ts | killed | PW8 unit structure a duplicated unit |
| H-placement | reverify/html.ts | killed | PW8 HTML grammar guards a unit outside its container element (a sentence lifted out of its paragraph) |
| H-section | reverify/html.ts | killed | PW8 unit structure a unit moved into another section |
| H-origin | reverify/html.ts | killed | PW8 unit structure a software unit downgraded to a drafted unit |
| H-unit-sig | reverify/html.ts | killed | PW8 signed spans: any byte change inside a signed span fails a non-numeric word change inside a software sentence; PW8 signed spans: any byte change inside a signed span fails a protected limitation line edited; PW8 closed world over every text node and attribute number in a figure caption (+5) |
| H-software-text | reverify/html.ts | killed | PW8 signed spans: any byte change inside a signed span fails a non-numeric word change inside a software sentence; PW8 signed spans: any byte change inside a signed span fails a protected limitation line edited; PW8 closed world over every text node and attribute number in alt text (+2) |
| H-drafted-attrs | reverify/html.ts | killed | PW8 HTML grammar guards a drafted unit carrying software attributes |
| H-value-outside | reverify/html.ts | killed | PW8 HTML grammar guards a value span outside any unit |
| H-value-markup | reverify/html.ts | killed | PW8 HTML grammar guards markup inside a value span and extra value-span attributes |
| H-value-sig | reverify/html.ts | killed | PW8 signed spans: any byte change inside a signed span fails a unit change inside a value span; PW8 signed spans: any byte change inside a signed span fails a hand-typed span with a forged signature; PW8 signed spans: any byte change inside a signed span fails a genuine span copied into another drafted sentence (+2) |
| H-value-attrs | reverify/html.ts | killed | PW8 HTML grammar guards markup inside a value span and extra value-span attributes |
| H-root-hash | reverify/html.ts | killed | PW8 signed spans: any byte change inside a signed span fails the article root signature and hashes are checked |
| H-root-sig | reverify/html.ts | killed | PW8 signed spans: any byte change inside a signed span fails the article root signature and hashes are checked |
| H-link | reverify/html.ts | killed | PW8 HTML grammar guards unknown classes, unsigned metas, links and unknown units |
| H-charset | reverify/html.ts | killed | PW8 HTML grammar guards unknown classes, unsigned metas, links and unknown units |
| H-unsigned-img | reverify/html.ts | killed | PW8 closed world over every text node and attribute an unsigned image |
| H-attr-digit | reverify/html.ts | killed | PW8 closed world over every text node and attribute number in alt text; PW8 closed world over every text node and attribute number in metadata description; PW8 closed world over every text node and attribute number in a new attribute (+1) |
| H-text-control | reverify/html.ts | killed | PW8 closed world over every text node and attribute bidi controls around a value |
| H-text-digit | reverify/html.ts | killed | PW8 closed world over every text node and attribute number typed in drafted prose; PW8 closed world over every text node and attribute number in a figure caption; PW8 closed world over every text node and attribute number moved into a table cell (+7) |
| H-outside-unit | reverify/html.ts | killed | PW8 closed world over every text node and attribute text outside every unit |
| H-order | reverify/html.ts | killed | PW8 unit structure two drafted sentences reordered |
| H-missing | reverify/html.ts | killed | PW8 HTML grammar guards unknown classes, unsigned metas, links and unknown units; PW8 unit structure a removed protected limitation |
| H-drafted-values | reverify/html.ts | killed | PW8 signed spans: any byte change inside a signed span fails a hand-typed span with a forged signature; PW8 signed spans: any byte change inside a signed span fails a genuine span copied into another drafted sentence; PW8 signed spans: any byte change inside a signed span fails two genuine spans swapped between sentences (the swap fixture, HTML form) (+2) |
| H-asset | reverify/html.ts | killed | PW8 unit structure a tampered figure asset |
| H-prose-capture | reverify/html.ts | killed | PW8 planted-number suite html: unit in prose is blocked; PW8 owner edit of the signed HTML a prose edit is read back, re-rendered and passes; PW8 owner edit of the signed HTML a value edit keeps its placeholder and survives re-rendering (+3) |
| H-source-placeholder | reverify/html.ts | killed | PW8 owner edit of the signed HTML a value edit keeps its placeholder and survives re-rendering |
| F-page-number | reverify/flow.ts | killed | PW8 extracted-text flow guards declared page numbers must be the page sequence; PW8 PDF text check (Chrome render, pinned pure-JS extractor) declared page numbers are furniture only when declared |
| F-control | reverify/flow.ts | killed | PW8 extracted-text flow guards missing units, trailing output and control characters |
| F-missing | reverify/flow.ts | killed | PW8 extracted-text flow guards missing units, trailing output and control characters; PW8 PDF text check (Chrome render, pinned pure-JS extractor) a number changed only in the PDF; PW8 PDF text check (Chrome render, pinned pure-JS extractor) a number rounded only in the PDF (+7) |
| F-unexpected | reverify/flow.ts | killed | PW8 extracted-text flow guards figure text must be exactly the SVG text, in SVG order, before its caption; PW8 DOCX archive and OOXML guards a run marked not-hidden is visible text, so a number there is caught as text; PW8 PDF text check (Chrome render, pinned pure-JS extractor) a figure value changed inside the printed figure (glyph by glyph SVG text) (+4) |
| F-figure-exact | reverify/flow.ts | killed | PW8 extracted-text flow guards figure text must be exactly the SVG text, in SVG order, before its caption; PW8 PDF text check (Chrome render, pinned pure-JS extractor) a figure value changed inside the printed figure (glyph by glyph SVG text) |
| F-trailing | reverify/flow.ts | killed | PW8 extracted-text flow guards missing units, trailing output and control characters |
| F-planted-number | reverify/flow.ts | killed | PW8 extracted-text flow guards missing units, trailing output and control characters; PW8 PDF text check (Chrome render, pinned pure-JS extractor) a number changed only in the PDF; PW8 DOCX read-back (pandoc render, direct OOXML scan) a number changed only in the DOCX (+2) |
| F-raster | reverify/flow.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) raster profile refuses printed figure text |
| O-invisible | reverify/outputs.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) invisible, off-page and tiny text are each hidden text |
| O-offpage | reverify/outputs.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) invisible, off-page and tiny text are each hidden text |
| O-tiny | reverify/outputs.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) invisible, off-page and tiny text are each hidden text |
| O-min-default | reverify/outputs.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) invisible, off-page and tiny text are each hidden text |
| O-title | reverify/outputs.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) metadata: an Info field not pinned, a changed title, and XMP; PW8 planted-number suite pdf: insert in metadata is blocked |
| O-pinned | reverify/outputs.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) metadata: an Info field not pinned, a changed title, and XMP; PW8 planted-number suite pdf: move in metadata is blocked |
| O-xmp | reverify/outputs.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) metadata: an Info field not pinned, a changed title, and XMP |
| O-alt-unexpected | reverify/outputs.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) alt text in the PDF tags: changed, and missing |
| O-alt-missing | reverify/outputs.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) alt text in the PDF tags: changed, and missing |
| O-require-alt | reverify/outputs.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) alt text in the PDF tags: changed, and missing |
| O-marked | reverify/outputs.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) ActualText that replaces a number is refused; ligature ActualText is allowed |
| O-ligatures | reverify/outputs.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) ActualText that replaces a number is refused; ligature ActualText is allowed |
| O-annotation | reverify/outputs.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) a link annotation and an outline entry are outside the verified manuscript |
| O-outline | reverify/outputs.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) a link annotation and an outline entry are outside the verified manuscript |
| P-invisible | reverify/pdf.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) invisible, off-page and tiny text are each hidden text |
| P-offpage | reverify/pdf.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) invisible, off-page and tiny text are each hidden text |
| P-encrypt | reverify/pdf.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) an undecodable or encrypted PDF is refused, not skipped |
| P-filter | reverify/pdf.ts | killed | PW8 pure-JS PDF extractor beyond Chrome composite fonts need ToUnicode; filters other than Flate and ASCIIHex are refused |
| P-tounicode-gap | reverify/pdf.ts | killed | PW8 pure-JS PDF extractor beyond Chrome a glyph code missing from ToUnicode is refused |
| P-simple-byte | reverify/pdf.ts | killed | PW8 pure-JS PDF extractor beyond Chrome Differences encodings map glyph names; unknown names and unmapped bytes are refused |
| P-type0 | reverify/pdf.ts | killed | PW8 pure-JS PDF extractor beyond Chrome composite fonts need ToUnicode; filters other than Flate and ASCIIHex are refused |
| P-encoding | reverify/pdf.ts | killed | PW8 pure-JS PDF extractor beyond Chrome Differences encodings map glyph names; unknown names and unmapped bytes are refused |
| P-glyph-name | reverify/pdf.ts | killed | PW8 pure-JS PDF extractor beyond Chrome Differences encodings map glyph names; unknown names and unmapped bytes are refused |
| P-form | reverify/pdf.ts | killed | PW8 pure-JS PDF extractor beyond Chrome Form XObjects are followed and inline images are skipped |
| P-marked | reverify/pdf.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) ActualText that replaces a number is refused; ligature ActualText is allowed |
| P-structure | reverify/pdf.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) the honest Chrome PDF verifies: text, vector figure text, alt tag, metadata; PW8 PDF text check (Chrome render, pinned pure-JS extractor) the extractor reads every page, the alt tag and the Info dictionary; PW8 PDF text check (Chrome render, pinned pure-JS extractor) ActualText that replaces a number is refused; ligature ActualText is allowed (+3) |
| P-annot-uri | reverify/pdf.ts | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) a link annotation and an outline entry are outside the verified manuscript |
| P-annot-contents | reverify/pdf.ts | killed | PW8 pure-JS PDF extractor beyond Chrome UTF-16 and PDFDocEncoding text strings, annotations and outlines are read |
| P-outline | reverify/pdf.ts | killed | PW8 pure-JS PDF extractor beyond Chrome UTF-16 and PDFDocEncoding text strings, annotations and outlines are read; PW8 PDF text check (Chrome render, pinned pure-JS extractor) a link annotation and an outline entry are outside the verified manuscript |
| P-later-wins | reverify/pdf.ts | killed | PW8 pure-JS PDF extractor beyond Chrome compressed object streams and incremental updates are read; later definitions win |
| P-objstm | reverify/pdf.ts | killed | PW8 pure-JS PDF extractor beyond Chrome compressed object streams and incremental updates are read; later definitions win |
| P-trailer-last | reverify/pdf.ts | killed | PW8 pure-JS PDF extractor beyond Chrome compressed object streams and incremental updates are read; later definitions win |
| P-inline-image | reverify/pdf.ts | killed | PW8 pure-JS PDF extractor beyond Chrome Form XObjects are followed and inline images are skipped |
| P-utf16 | reverify/pdf.ts | killed | PW8 pure-JS PDF extractor beyond Chrome UTF-16 and PDFDocEncoding text strings, annotations and outlines are read; PW8 PDF text check (Chrome render, pinned pure-JS extractor) the honest Chrome PDF verifies: text, vector figure text, alt tag, metadata; PW8 PDF text check (Chrome render, pinned pure-JS extractor) the extractor reads every page, the alt tag and the Info dictionary (+3) |
| D-crc | reverify/docx.ts | killed | PW8 DOCX archive and OOXML guards duplicate entries, encrypted entries, ZIP64 markers and bad CRCs are refused |
| D-duplicate | reverify/docx.ts | killed | PW8 DOCX archive and OOXML guards duplicate entries, encrypted entries, ZIP64 markers and bad CRCs are refused |
| D-encrypted | reverify/docx.ts | killed | PW8 DOCX archive and OOXML guards duplicate entries, encrypted entries, ZIP64 markers and bad CRCs are refused |
| D-zip64 | reverify/docx.ts | killed | PW8 DOCX archive and OOXML guards duplicate entries, encrypted entries, ZIP64 markers and bad CRCs are refused |
| D-method | reverify/docx.ts | killed | PW8 DOCX archive and OOXML guards duplicate entries, encrypted entries, ZIP64 markers and bad CRCs are refused |
| D-vanish | reverify/docx.ts | killed | PW8 DOCX archive and OOXML guards endnotes, comment anchors, moves, specVanish, webHidden and embedded parts; PW8 DOCX read-back (pandoc render, direct OOXML scan) hidden, tiny and white runs; PW8 owner DOCX edit read-back an added paragraph or a hidden run is refused |
| D-tiny | reverify/docx.ts | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) hidden, tiny and white runs |
| D-white | reverify/docx.ts | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) hidden, tiny and white runs |
| D-on | reverify/docx.ts | killed | PW8 DOCX archive and OOXML guards a run marked not-hidden is visible text, so a number there is caught as text |
| D-instr | reverify/docx.ts | killed | PW8 DOCX archive and OOXML guards endnotes, comment anchors, moves, specVanish, webHidden and embedded parts |
| D-fldsimple | reverify/docx.ts | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) comments, headers, footnotes, fields and text boxes |
| D-textbox | reverify/docx.ts | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) comments, headers, footnotes, fields and text boxes |
| D-hyperlink | reverify/docx.ts | killed | PW8 DOCX archive and OOXML guards a hyperlink element, a missing alt text and an unknown picture description |
| D-comment-anchor | reverify/docx.ts | killed | PW8 DOCX archive and OOXML guards endnotes, comment anchors, moves, specVanish, webHidden and embedded parts |
| D-header | reverify/docx.ts | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) comments, headers, footnotes, fields and text boxes |
| D-comments | reverify/docx.ts | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) comments, headers, footnotes, fields and text boxes |
| D-notes | reverify/docx.ts | killed | PW8 DOCX archive and OOXML guards endnotes, comment anchors, moves, specVanish, webHidden and embedded parts; PW8 DOCX read-back (pandoc render, direct OOXML scan) comments, headers, footnotes, fields and text boxes |
| D-rels | reverify/docx.ts | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) metadata, media and hyperlinks |
| D-embedded | reverify/docx.ts | killed | PW8 DOCX archive and OOXML guards endnotes, comment anchors, moves, specVanish, webHidden and embedded parts |
| D-ins | reverify/docx.ts | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) tracked changes are refused in a rendered DOCX |
| D-del | reverify/docx.ts | killed | PW8 DOCX archive and OOXML guards endnotes, comment anchors, moves, specVanish, webHidden and embedded parts |
| D-tracked-render | reverify/docx.ts | killed | PW8 DOCX archive and OOXML guards endnotes, comment anchors, moves, specVanish, webHidden and embedded parts; PW8 DOCX read-back (pandoc render, direct OOXML scan) tracked changes are refused in a rendered DOCX |
| D-alt-unexpected | reverify/docx.ts | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) a number moved into a table cell, alt text and a table caption attribute |
| D-alt-missing | reverify/docx.ts | killed | PW8 DOCX archive and OOXML guards a hyperlink element, a missing alt text and an unknown picture description |
| D-image-path | reverify/docx.ts | killed | PW8 DOCX archive and OOXML guards a hyperlink element, a missing alt text and an unknown picture description |
| D-table-caption | reverify/docx.ts | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) a number moved into a table cell, alt text and a table caption attribute |
| D-properties | reverify/docx.ts | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) metadata, media and hyperlinks; PW8 planted-number suite docx: round in metadata is blocked; PW8 planted-number suite docx: move in metadata is blocked |
| D-media | reverify/docx.ts | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) metadata, media and hyperlinks |
| D-readback-findings | reverify/docx.ts | killed | PW8 owner DOCX edit read-back an added paragraph or a hidden run is refused |
| D-readback-count | reverify/docx.ts | killed | PW8 owner DOCX edit read-back an added paragraph or a hidden run is refused |
| D-readback-anchor | reverify/docx.ts | killed | PW8 owner DOCX edit read-back an owner edit inside software text or a signed value is refused |

## Omitted sites

| Site | Reason |
| --- | --- |
| sign.ts verify(): letters-format pre-check | equivalent: a malformed signature also fails the constant-time comparison |
| sign.ts: per-build key derivation vs build ID in payload | equivalent one at a time: each alone separates builds; both kept as defence in depth |
| manuscript.ts contextUniverse key collision | unreachable: universe key prefixes are disjoint by construction |
| manuscript.ts draft re-parse count check | unreachable: renderDraft parses the same source with the same registry |
| manuscript.ts resultsBlockPlans missing Results claim | unreachable after createReportContext (missing claims refuse earlier) |
| manuscript.ts figure numbering as a plain text inline | refused at assembly by assertUnitClosed, so every suite fails at fixture load; the runner counts that as invalid, so the first-run mutant M-caption-number-value was replaced by M-figure-number |
| html.ts signedAncestor walks ancestors | equivalent on reachable markup: signed text sits directly inside its signed element |

## Round 1 new-guard campaign

54/54 killed; 85 baseline new-guard tests (review + release files). In-memory Vite transforms; source files never modified. The 170-mutant table above is historical, not a rerun claim.

| Mutant | Outcome | Killing tests (first two) |
| --- | --- | --- |
| R1-hex-space | killed | PW8 review ASCIIHex honest wrapped stream passes; PW8 review ASCIIHex whitespace, odd nibble, terminator and invalid bytes |
| R1-hex-pad | killed | PW8 review ASCIIHex whitespace, odd nibble, terminator and invalid bytes |
| R1-hex-invalid | killed | PW8 review ASCIIHex whitespace, odd nibble, terminator and invalid bytes |
| R1-hex-end | killed | PW8 review ASCIIHex whitespace, odd nibble, terminator and invalid bytes |
| R1-image-identity | killed | review relocated tampered image is refused; owner non-text channels reject a changed figure in the current honest DOCX |
| R1-image-resolution | killed | DOCX relocation checks actual bytes, not directory membership |
| R1-drawing-ref | killed | mandatory PW8 release gate trusted render issues source/profile/artifact record and releases private copies; mandatory PW8 release gate edited external paper.html cannot be released |
| R1-style-part | killed | review hidden inherited style is refused |
| R1-style-reference | killed | DOCX references and namespaces fail closed |
| R1-grammar | killed | review docx-alternate is rejected by the closed grammar; review docx-generated-number is rejected by the closed grammar |
| R1-owner-channels | killed | owner non-text channels reject a changed figure in the current honest DOCX |
| R1-font-hash | killed | font approval is mandatory; direct resource dictionaries cannot evade font inventory |
| R1-glyph-consistency | killed | standard-font glyph consistency is checked independently of profile membership |
| R1-visual-inventory | killed | review pdf-extra-image-number is refused |
| R1-annotation | killed | annotation refusal does not depend on text keys or appearance inventory |
| R1-white | killed | white decoy is invisible independently of its image |
| R1-opacity | killed | PDF opacity and unsupported graphics states fail closed |
| R1-graphics-state | killed | PDF opacity and unsupported graphics states fail closed |
| R1-text-rise | killed | PDF unknown operators and unsupported text transforms fail closed |
| R1-text-scale | killed | PDF unknown operators and unsupported text transforms fail closed |
| R1-tj-position | killed | PDF unknown operators and unsupported text transforms fail closed |
| R1-geometric-order | killed | review geometric value move fails; review identical layout with reversed paint order passes |
| R1-layout-position | killed | trusted layout detects value moves independently of flow |
| R1-numeric-gaps | killed | review PDF split decimal fails; numeric spelling 0.04 96 is distinct |
| R1-numeric-nfkc | killed | numeric spelling 0.04⁹⁶ is distinct; numeric spelling ０.０４９６ is distinct |
| R1-namespace | killed | namespace and placement refusals are independent guards |
| R1-placement | killed | namespace and placement refusals are independent guards |
| R1-css-hash | killed | CSS closure binds imports and URL bytes |
| R1-css-generated | killed | review linked and inline generated CSS fail |
| R1-css-import | killed | CSS closure binds imports and URL bytes |
| R1-css-url | killed | CSS closure binds imports and URL bytes |
| R1-ligature | killed | review honest StandardEncoding ligature passes; StandardEncoding high ranges and ASCII quote exceptions |
| R1-quantity | killed | narrow idiom: One possible explanation is selection bias.; narrow idiom: Selection bias is one of the possible explanations. |
| R1-idiom | killed | narrow idiom: One possible explanation is selection bias.; review honest narrative passes HTML readback and source revision |
| R1-external-hash | killed | mandatory PW8 release gate edited external paper.html cannot be released; mandatory PW8 release gate edited external paper.pdf cannot be released |
| R1-record-integrity | killed | mandatory PW8 release gate copied forged and modified records cannot authorize external files |
| R1-rerender | killed | mandatory PW8 release gate trusted render issues source/profile/artifact record and releases private copies; mandatory PW8 release gate declared deterministic PDF must regenerate byte identically |
| R1-byte-identity | killed | mandatory PW8 release gate declared deterministic PDF must regenerate byte identically |
| R1-docx-determinism | killed | mandatory PW8 release gate trusted render issues source/profile/artifact record and releases private copies |
| R1-attestation | killed | mandatory PW8 release gate renderer profile attestation is mandatory |
| R1-readback | killed | mandatory PW8 release gate trusted render must pass secondary verification |
| R1-source | killed | mandatory PW8 release gate invalid source and missing must-appear blocks never reach rendering |
| R1-resource-profile | killed | mandatory PW8 release gate resource and readback profiles cannot be omitted |
| R1-mandatory-files | killed | mandatory PW8 release gate undeclared renderer output and missing required formats fail |
| R1-output-inventory | killed | mandatory PW8 release gate undeclared renderer output and missing required formats fail |
| R1-layout-separators | killed | mandatory PW8 release gate trusted render issues source/profile/artifact record and releases private copies; mandatory PW8 release gate edited external paper.html cannot be released |
| R1-layout-source | killed | layout separator evidence aligns to source without erasing internal run whitespace |
| R1-layout-omission | killed | layout separator evidence aligns to source without erasing internal run whitespace |
| R1-direct-format | killed | unapproved direct DOCX formatting fails: <w:vertAlign w:val="superscript"/>; unapproved direct DOCX formatting fails: <w:rFonts w:ascii="Symbol"/> |
| R1-local-font | killed | CSS local fonts cannot bypass the pinned URL resource closure |
| R1-unknown-operator | killed | PDF unknown operators and unsupported text transforms fail closed |
| R1-direct-font | killed | direct resource dictionaries cannot evade font inventory |
| R1-xobject | killed | unresolved XObjects and rotated text fail the supported profile |
| R1-text-orientation | killed | unresolved XObjects and rotated text fail the supported profile |

## Paper layout integration campaign (2026-10-14)

Current rerun: **167/170 killed**, baseline 329 tests green. The three survivors are P-annot-uri, D-textbox and D-readback-findings. Nine separately rerun overlap probes show that either remaining guard refuses the attack; removing both admits it. These are documented overlaps, not counted as kills. The runner verifies source hashes at completion. An earlier run was discarded after its source-stability check detected concurrent layout edits. The final JSON is `pw8-merged-mutation-results.json`; new-guard rerun remains 54/54.

| Mutant | Outcome | Detecting tests (first three) |
| --- | --- | --- |
| S-hex | killed | PW8 signer guards letters encoding round trip and refusals |
| S-letters | killed | PW8 signer guards letters encoding round trip and refusals |
| S-build-hash | killed | PW8 signer guards build IDs need the PaperInput hash and a bounded nonce |
| S-nonce-empty | killed | PW8 signer guards build IDs need the PaperInput hash and a bounded nonce |
| S-nonce-long | killed | PW8 signer guards build IDs need the PaperInput hash and a bounded nonce |
| S-key-length | killed | PW8 signed HTML: honest render signer keys are at least 32 bytes and build IDs are digit-free |
| S-build-format | killed | PW8 signed HTML: honest render signer keys are at least 32 bytes and build IDs are digit-free |
| S-domain | killed | PW8 signer guards signatures need a PW8 domain, a valid format and the right key |
| S-compare | killed | PW8 signer guards signatures need a PW8 domain, a valid format and the right key; PW8 signed HTML: honest render a different key or build cannot verify the render; PW8 signed spans: any byte change inside a signed span fails a rounded value inside a value span |
| M-decompose-cover | killed | PW8 assembly guards software blocks: no template digits, known keys only, never empty; PW8 software text decomposition every number must trace to one candidate occurrence; longest wins |
| M-decompose-longest | killed | PW8 software text decomposition every number must trace to one candidate occurrence; longest wins |
| M-decompose-token | killed | PW8 assembly guards units are closed: digits only in values, no control characters, no empty values |
| M-closed-control | killed | PW8 assembly guards units are closed: digits only in values, no control characters, no empty values |
| M-closed-digit | killed | PW8 assembly guards units are closed: digits only in values, no control characters, no empty values |
| M-closed-empty | killed | PW8 assembly guards units are closed: digits only in values, no control characters, no empty values |
| M-sentence-agree | killed | PW8 assembly guards rendered sentence markup must agree with its text and use only known spans |
| M-sentence-markup | killed | PW8 assembly guards rendered sentence markup must agree with its text and use only known spans |
| M-empty-unit | killed | PW8 assembly guards software blocks: no template digits, known keys only, never empty |
| M-template-digit | killed | PW8 assembly guards software blocks: no template digits, known keys only, never empty |
| M-unknown-key | killed | PW8 assembly guards software blocks: no template digits, known keys only, never empty |
| M-pipe | killed | PW8 assembly guards PW3 table markdown must be a pipe table with even rows |
| M-ragged | killed | PW8 assembly guards PW3 table markdown must be a pipe table with even rows |
| M-svg-strict | killed | PW8 assembly guards figures and tables: placed once, digit-free captions, strict SVG |
| M-dup-section | killed | PW8 assembly guards section and block identity |
| M-section-id | killed | PW8 assembly guards section and block identity |
| M-dup-block | killed | PW8 assembly guards section and block identity |
| M-heading-digit | killed | PW8 assembly guards section and block identity |
| M-empty-software | killed | PW8 assembly guards software blocks: no template digits, known keys only, never empty |
| M-empty-protected | killed | PW8 assembly guards protected regions: hashed, unique, never empty |
| M-protected-hash | killed | PW8 assembly guards protected regions: hashed, unique, never empty |
| M-dup-protected | killed | PW8 assembly guards protected regions: hashed, unique, never empty |
| M-figure-slug | killed | PW8 assembly guards figures and tables: placed once, digit-free captions, strict SVG |
| M-caption-digit | killed | PW8 assembly guards figures and tables: placed once, digit-free captions, strict SVG |
| M-empty-notes | killed | PW8 assembly guards software blocks: no template digits, known keys only, never empty |
| M-placed-twice | killed | PW8 assembly guards figures and tables: placed once, digit-free captions, strict SVG |
| M-template-origin | killed | PW8 fixtures are the render of the current verified HTML fixture HTML hash matches (regenerate with scripts/pw8-render-fixtures.ts if not); PW8 owner DOCX edit read-back a prose edit is applied to the paper source and re-verified; PW8 owner DOCX edit read-back a tracked insertion is read back as accepted text |
| M-skeleton-text | killed | PW8 fixtures are the render of the current verified HTML fixture HTML hash matches (regenerate with scripts/pw8-render-fixtures.ts if not); PW8 software text decomposition the skeleton records values per unit in order and hashes software text |
| M-template-core | killed | PW8 fixtures are the render of the current verified HTML fixture HTML hash matches (regenerate with scripts/pw8-render-fixtures.ts if not); PW8 planted-number suite honest controls pass in every format; PW8 edit gate a connective change in a claim request is prose, not a skeleton change |
| M-results-lock | killed | PW8 assembly guards Results blocks refuse outcomes without locked ancestry |
| M-figure-number | killed | PW8 fixtures are the render of the current verified HTML fixture HTML hash matches (regenerate with scripts/pw8-render-fixtures.ts if not); PW8 PDF text check (Chrome render, pinned pure-JS extractor) the honest Chrome PDF verifies: text, vector figure text, alt tag, metadata; PW8 PDF text check (Chrome render, pinned pure-JS extractor) ActualText that replaces a number is refused; ligature ActualText is allowed |
| K-context | killed | PW8 edit gate a context change (checklist, label set, PaperInput) is rejected |
| K-spine-same | killed | PW8 planted-number suite source: move in prose is blocked; PW8 planted-number suite source: move in software is blocked; PW8 swap fixture: two numbers swapped between sentences must fail two claim bundles swapped by reordering claim sentences (edit) |
| K-spine-values | killed | PW8 planted-number suite source: move in prose is blocked; PW8 swap fixture: two numbers swapped between sentences must fail two values swapped between drafted sentences in the same section (edit); PW8 swap fixture: two numbers swapped between sentences must fail two values swapped between drafted sentences in the same section (revision) |
| K-is-spine | killed | PW8 planted-number suite source: move in prose is blocked; PW8 swap fixture: two numbers swapped between sentences must fail two values swapped between drafted sentences in the same section (edit); PW8 swap fixture: two numbers swapped between sentences must fail two values swapped between drafted sentences in the same section (revision) |
| K-glue-added | killed | PW8 owner DOCX edit read-back an added sentence is glue: refused outside a revision round; PW8 edit gate a glue sentence may be added or removed only in a revision round; PW8 owner edit of the signed HTML an added sentence is glue: rejected outside a revision round, listed inside one |
| K-glue-removed | killed | PW8 edit gate a glue sentence may be added or removed only in a revision round |
| K-glue-moved | killed | PW8 must-appear and edit-gate details a glue sentence moved into another block is a glue move: refused in edit mode, listed in revision |
| K-prose-allowed | killed | PW8 must-appear and edit-gate details a glue sentence moved into another block is a glue move: refused in edit mode, listed in revision; PW8 owner DOCX edit read-back a prose edit is applied to the paper source and re-verified; PW8 owner DOCX edit read-back a tracked insertion is read back as accepted text |
| K-ok | killed | PW8 planted-number suite source: move in prose is blocked; PW8 planted-number suite source: move in software is blocked; PW8 swap fixture: two numbers swapped between sentences must fail two claim bundles swapped by reordering claim sentences (edit) |
| K-rule-results | killed | PW8 must-appear and edit-gate details the exact must-appear rule set |
| K-rule-label | killed | PW8 must-appear and edit-gate details the exact must-appear rule set; PW8 must-appear set the first draft holds every required fact, block and limitation; PW8 must-appear set the rule is per section: the primary bundle elsewhere does not satisfy the abstract |
| K-rule-count | killed | PW8 must-appear and edit-gate details the exact must-appear rule set; PW8 must-appear set the first draft holds every required fact, block and limitation; PW8 must-appear set missing claim-count sentence fails |
| K-rule-results-blocks | killed | PW8 must-appear and edit-gate details the exact must-appear rule set; PW8 edit gate software blocks cannot be removed: the spine and the must-appear set both fail; PW8 must-appear set the first draft holds every required fact, block and limitation |
| K-rule-aims | killed | PW8 must-appear and edit-gate details the exact must-appear rule set; PW8 must-appear and edit-gate details the must-appear set alone blocks an edit whose skeleton did not change; PW8 must-appear set the first draft holds every required fact, block and limitation |
| K-rule-part-a | killed | PW8 must-appear set the first draft holds every required fact, block and limitation; PW8 must-appear set missing a Limitations Part A line fails |
| K-rule-search | killed | PW8 must-appear and edit-gate details the exact must-appear rule set; PW8 must-appear set the first draft holds every required fact, block and limitation; PW8 must-appear set missing search sentence fails |
| K-per-section | killed | PW8 must-appear set missing primary bundle in Key Points fails; PW8 must-appear set the rule is per section: the primary bundle elsewhere does not satisfy the abstract |
| K-provides | killed | PW8 must-appear and edit-gate details a glue sentence moved into another block is a glue move: refused in edit mode, listed in revision; PW8 owner DOCX edit read-back a prose edit is applied to the paper source and re-verified; PW8 owner DOCX edit read-back a tracked insertion is read back as accepted text |
| E-must-appear | killed | PW8 must-appear and edit-gate details the must-appear set alone blocks an edit whose skeleton did not change |
| E-first-draft | killed | mandatory PW8 release gate invalid source and missing must-appear blocks never reach rendering; PW8 must-appear set missing aims paragraph fails; PW8 must-appear set missing search sentence fails |
| E-html-gate | killed | PW8 owner edit of the signed HTML a typed number fails the HTML closed world before any re-render; PW8 owner edit of the signed HTML deleting a value span from a drafted sentence fails |
| E-prose-source | killed | PW8 planted-number suite html: unit in prose is blocked; PW8 owner edit of the signed HTML a prose edit is read back, re-rendered and passes; PW8 owner edit of the signed HTML a value edit keeps its placeholder and survives re-rendering |
| H-doctype | killed | PW8 HTML grammar guards the doctype line must be exact |
| H-parse-issues | killed | PW8 closed world over every text node and attribute number as a character reference; PW8 closed world over every text node and attribute a comment hiding a number; PW8 closed world over every text node and attribute a non-predefined entity |
| H-root-tag | killed | PW8 HTML grammar guards unknown classes, unsigned metas, links and unknown units |
| H-element | killed | PW8 HTML grammar guards unknown classes, unsigned metas, links and unknown units; PW8 closed world over every text node and attribute a style element |
| H-attribute | killed | PW8 closed world over every text node and attribute number in a new attribute; PW8 closed world over every text node and attribute a style attribute hiding text |
| H-attr-control | killed | PW8 HTML grammar guards a control character inside an attribute value |
| H-class | killed | PW8 HTML grammar guards unknown classes, unsigned metas, links and unknown units |
| H-nested | killed | PW8 HTML grammar guards a unit nested in another unit |
| H-unknown-unit | killed | PW8 HTML grammar guards unknown classes, unsigned metas, links and unknown units |
| H-duplicate | killed | PW8 unit structure a duplicated unit |
| H-placement | killed | PW8 HTML grammar guards a unit outside its container element (a sentence lifted out of its paragraph) |
| H-section | killed | PW8 unit structure a unit moved into another section |
| H-origin | killed | PW8 unit structure a software unit downgraded to a drafted unit |
| H-unit-sig | killed | PW8 signed spans: any byte change inside a signed span fails a non-numeric word change inside a software sentence; PW8 signed spans: any byte change inside a signed span fails a protected limitation line edited; PW8 closed world over every text node and attribute number in a figure caption |
| H-software-text | killed | PW8 signed spans: any byte change inside a signed span fails a non-numeric word change inside a software sentence; PW8 signed spans: any byte change inside a signed span fails a protected limitation line edited; PW8 closed world over every text node and attribute number in alt text |
| H-drafted-attrs | killed | PW8 HTML grammar guards a drafted unit carrying software attributes |
| H-value-outside | killed | PW8 HTML grammar guards a value span outside any unit |
| H-value-markup | killed | PW8 HTML grammar guards markup inside a value span and extra value-span attributes |
| H-value-sig | killed | PW8 signed spans: any byte change inside a signed span fails a unit change inside a value span; PW8 signed spans: any byte change inside a signed span fails a hand-typed span with a forged signature; PW8 signed spans: any byte change inside a signed span fails a genuine span copied into another drafted sentence |
| H-value-attrs | killed | PW8 HTML grammar guards markup inside a value span and extra value-span attributes |
| H-root-hash | killed | PW8 signed spans: any byte change inside a signed span fails the article root signature and hashes are checked |
| H-root-sig | killed | PW8 signed spans: any byte change inside a signed span fails the article root signature and hashes are checked |
| H-link | killed | PW8 HTML grammar guards unknown classes, unsigned metas, links and unknown units |
| H-charset | killed | PW8 HTML grammar guards unknown classes, unsigned metas, links and unknown units |
| H-unsigned-img | killed | PW8 closed world over every text node and attribute an unsigned image |
| H-attr-digit | killed | PW8 closed world over every text node and attribute number in alt text; PW8 closed world over every text node and attribute number in metadata description; PW8 closed world over every text node and attribute number in a new attribute |
| H-text-control | killed | PW8 closed world over every text node and attribute bidi controls around a value |
| H-text-digit | killed | PW8 closed world over every text node and attribute number typed in drafted prose; PW8 closed world over every text node and attribute number in a figure caption; PW8 closed world over every text node and attribute number moved into a table cell |
| H-outside-unit | killed | PW8 closed world over every text node and attribute text outside every unit |
| H-order | killed | PW8 unit structure two drafted sentences reordered |
| H-missing | killed | PW8 HTML grammar guards unknown classes, unsigned metas, links and unknown units; PW8 unit structure a removed protected limitation |
| H-drafted-values | killed | PW8 signed spans: any byte change inside a signed span fails a hand-typed span with a forged signature; PW8 signed spans: any byte change inside a signed span fails a genuine span copied into another drafted sentence; PW8 signed spans: any byte change inside a signed span fails two genuine spans swapped between sentences (the swap fixture, HTML form) |
| H-asset | killed | PW8 unit structure a tampered figure asset |
| H-prose-capture | killed | PW8 planted-number suite html: unit in prose is blocked; PW8 owner edit of the signed HTML a prose edit is read back, re-rendered and passes; PW8 owner edit of the signed HTML a value edit keeps its placeholder and survives re-rendering |
| H-source-placeholder | killed | PW8 owner edit of the signed HTML a value edit keeps its placeholder and survives re-rendering |
| F-page-number | killed | PW8 extracted-text flow guards declared page numbers must be the page sequence; PW8 PDF text check (Chrome render, pinned pure-JS extractor) declared page numbers are furniture only when declared |
| F-control | killed | PW8 extracted-text flow guards missing units, trailing output and control characters |
| F-missing | killed | PW8 extracted-text flow guards missing units, trailing output and control characters; PW8 PDF text check (Chrome render, pinned pure-JS extractor) a number changed only in the PDF; PW8 PDF text check (Chrome render, pinned pure-JS extractor) a number rounded only in the PDF |
| F-unexpected | killed | PW8 extracted-text flow guards figure text must be exactly the SVG text, in SVG order, before its caption; PW8 DOCX archive and OOXML guards a run marked not-hidden is visible text, so a number there is caught as text; PW8 PDF text check (Chrome render, pinned pure-JS extractor) a figure value changed inside the printed figure (glyph by glyph SVG text) |
| F-figure-exact | killed | PW8 extracted-text flow guards figure text must be exactly the SVG text, in SVG order, before its caption; PW8 PDF text check (Chrome render, pinned pure-JS extractor) a figure value changed inside the printed figure (glyph by glyph SVG text) |
| F-trailing | killed | PW8 extracted-text flow guards missing units, trailing output and control characters; PW8 PDF text check (Chrome render, pinned pure-JS extractor) an inserted number in drawn text; PW8 review ASCIIHex appended number is read and refused |
| F-planted-number | killed | PW8 extracted-text flow guards missing units, trailing output and control characters; PW8 PDF text check (Chrome render, pinned pure-JS extractor) a number changed only in the PDF; PW8 DOCX read-back (pandoc render, direct OOXML scan) a number changed only in the DOCX |
| F-raster | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) raster profile refuses printed figure text |
| O-invisible | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) invisible, off-page and tiny text are each hidden text; white decoy is invisible independently of its image |
| O-offpage | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) invisible, off-page and tiny text are each hidden text |
| O-tiny | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) invisible, off-page and tiny text are each hidden text; remaining reviewer fixture pdf-zero-size-control fails |
| O-min-default | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) invisible, off-page and tiny text are each hidden text; remaining reviewer fixture pdf-zero-size-control fails |
| O-title | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) metadata: an Info field not pinned, a changed title, and XMP; PW8 planted-number suite pdf: insert in metadata is blocked |
| O-pinned | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) metadata: an Info field not pinned, a changed title, and XMP; PW8 planted-number suite pdf: move in metadata is blocked |
| O-xmp | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) metadata: an Info field not pinned, a changed title, and XMP |
| O-alt-unexpected | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) alt text in the PDF tags: changed, and missing |
| O-alt-missing | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) alt text in the PDF tags: changed, and missing |
| O-require-alt | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) alt text in the PDF tags: changed, and missing |
| O-marked | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) ActualText that replaces a number is refused; ligature ActualText is allowed |
| O-ligatures | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) ActualText that replaces a number is refused; ligature ActualText is allowed |
| O-annotation | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) a link annotation and an outline entry are outside the verified manuscript; annotation URI is refused by overlapping annotation guards; annotation refusal does not depend on text keys or appearance inventory |
| O-outline | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) a link annotation and an outline entry are outside the verified manuscript |
| P-invisible | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) invisible, off-page and tiny text are each hidden text; white decoy is invisible independently of its image; PDF opacity and unsupported graphics states fail closed |
| P-offpage | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) invisible, off-page and tiny text are each hidden text |
| P-encrypt | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) an undecodable or encrypted PDF is refused, not skipped |
| P-filter | killed | PW8 pure-JS PDF extractor beyond Chrome composite fonts need ToUnicode; filters other than Flate and ASCIIHex are refused |
| P-tounicode-gap | killed | PW8 pure-JS PDF extractor beyond Chrome a glyph code missing from ToUnicode is refused |
| P-simple-byte | killed | PW8 pure-JS PDF extractor beyond Chrome Differences encodings map glyph names; unknown names and unmapped bytes are refused |
| P-type0 | killed | PW8 pure-JS PDF extractor beyond Chrome composite fonts need ToUnicode; filters other than Flate and ASCIIHex are refused |
| P-encoding | killed | PW8 pure-JS PDF extractor beyond Chrome Differences encodings map glyph names; unknown names and unmapped bytes are refused |
| P-glyph-name | killed | PW8 pure-JS PDF extractor beyond Chrome Differences encodings map glyph names; unknown names and unmapped bytes are refused |
| P-form | killed | PW8 pure-JS PDF extractor beyond Chrome Form XObjects are followed and inline images are skipped |
| P-marked | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) ActualText that replaces a number is refused; ligature ActualText is allowed |
| P-structure | killed | PW8 PDF text check (Chrome render, pinned pure-JS extractor) the honest Chrome PDF verifies: text, vector figure text, alt tag, metadata; PW8 PDF text check (Chrome render, pinned pure-JS extractor) the extractor reads every page, the alt tag and the Info dictionary; PW8 PDF text check (Chrome render, pinned pure-JS extractor) ActualText that replaces a number is refused; ligature ActualText is allowed |
| P-annot-uri | survived |  |
| P-annot-contents | killed | PW8 pure-JS PDF extractor beyond Chrome UTF-16 and PDFDocEncoding text strings, annotations and outlines are read |
| P-outline | killed | PW8 pure-JS PDF extractor beyond Chrome UTF-16 and PDFDocEncoding text strings, annotations and outlines are read; PW8 PDF text check (Chrome render, pinned pure-JS extractor) a link annotation and an outline entry are outside the verified manuscript |
| P-later-wins | killed | PW8 pure-JS PDF extractor beyond Chrome compressed object streams and incremental updates are read; later definitions win |
| P-objstm | killed | PW8 pure-JS PDF extractor beyond Chrome compressed object streams and incremental updates are read; later definitions win |
| P-trailer-last | killed | PW8 pure-JS PDF extractor beyond Chrome compressed object streams and incremental updates are read; later definitions win |
| P-inline-image | killed | PW8 pure-JS PDF extractor beyond Chrome Form XObjects are followed and inline images are skipped |
| P-utf16 | killed | PW8 pure-JS PDF extractor beyond Chrome UTF-16 and PDFDocEncoding text strings, annotations and outlines are read; PW8 PDF text check (Chrome render, pinned pure-JS extractor) the honest Chrome PDF verifies: text, vector figure text, alt tag, metadata; PW8 PDF text check (Chrome render, pinned pure-JS extractor) the extractor reads every page, the alt tag and the Info dictionary |
| D-crc | killed | PW8 DOCX archive and OOXML guards duplicate entries, encrypted entries, ZIP64 markers and bad CRCs are refused |
| D-duplicate | killed | PW8 DOCX archive and OOXML guards duplicate entries, encrypted entries, ZIP64 markers and bad CRCs are refused |
| D-encrypted | killed | PW8 DOCX archive and OOXML guards duplicate entries, encrypted entries, ZIP64 markers and bad CRCs are refused |
| D-zip64 | killed | PW8 DOCX archive and OOXML guards duplicate entries, encrypted entries, ZIP64 markers and bad CRCs are refused |
| D-method | killed | PW8 DOCX archive and OOXML guards duplicate entries, encrypted entries, ZIP64 markers and bad CRCs are refused |
| D-vanish | killed | PW8 DOCX archive and OOXML guards endnotes, comment anchors, moves, specVanish, webHidden and embedded parts; PW8 DOCX read-back (pandoc render, direct OOXML scan) hidden, tiny and white runs; PW8 owner DOCX edit read-back an added paragraph or a hidden run is refused |
| D-tiny | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) hidden, tiny and white runs |
| D-white | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) hidden, tiny and white runs |
| D-on | killed | PW8 DOCX archive and OOXML guards a run marked not-hidden is visible text, so a number there is caught as text |
| D-instr | killed | PW8 DOCX archive and OOXML guards endnotes, comment anchors, moves, specVanish, webHidden and embedded parts |
| D-fldsimple | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) comments, headers, footnotes, fields and text boxes |
| D-textbox | survived |  |
| D-hyperlink | killed | PW8 DOCX archive and OOXML guards a hyperlink element, a missing alt text and an unknown picture description |
| D-comment-anchor | killed | PW8 DOCX archive and OOXML guards endnotes, comment anchors, moves, specVanish, webHidden and embedded parts |
| D-header | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) comments, headers, footnotes, fields and text boxes |
| D-comments | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) comments, headers, footnotes, fields and text boxes; owner comment is refused by overlapping findings and channel guards |
| D-notes | killed | PW8 DOCX archive and OOXML guards endnotes, comment anchors, moves, specVanish, webHidden and embedded parts; PW8 DOCX read-back (pandoc render, direct OOXML scan) comments, headers, footnotes, fields and text boxes |
| D-rels | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) metadata, media and hyperlinks |
| D-embedded | killed | PW8 DOCX archive and OOXML guards endnotes, comment anchors, moves, specVanish, webHidden and embedded parts |
| D-ins | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) tracked changes are refused in a rendered DOCX |
| D-del | killed | PW8 DOCX archive and OOXML guards endnotes, comment anchors, moves, specVanish, webHidden and embedded parts |
| D-tracked-render | killed | PW8 DOCX archive and OOXML guards endnotes, comment anchors, moves, specVanish, webHidden and embedded parts; PW8 DOCX read-back (pandoc render, direct OOXML scan) tracked changes are refused in a rendered DOCX |
| D-alt-unexpected | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) a number moved into a table cell, alt text and a table caption attribute |
| D-alt-missing | killed | PW8 DOCX archive and OOXML guards a hyperlink element, a missing alt text and an unknown picture description |
| D-image-path | killed | PW8 DOCX archive and OOXML guards a hyperlink element, a missing alt text and an unknown picture description |
| D-table-caption | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) a number moved into a table cell, alt text and a table caption attribute |
| D-properties | killed | PW8 DOCX read-back (pandoc render, direct OOXML scan) metadata, media and hyperlinks; PW8 planted-number suite docx: round in metadata is blocked; PW8 planted-number suite docx: move in metadata is blocked |
| D-media | killed | unreferenced embedded media cannot smuggle unchecked content into DOCX |
| D-readback-findings | survived |  |
| D-readback-count | killed | PW8 owner DOCX edit read-back an added paragraph or a hidden run is refused |
| D-readback-anchor | killed | PW8 owner DOCX edit read-back an owner edit inside software text or a signed value is refused |
