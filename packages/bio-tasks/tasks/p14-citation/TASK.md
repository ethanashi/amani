# Task: check the citations in a manuscript introduction before submission

## Background

Our lab is about to submit a manuscript on cortical neurons derived from induced pluripotent stem
cells of *CHD8* variant carriers. A co-author has drafted the first paragraph of the introduction
(`data/draft_introduction.md`); it cites ten numbered references. Before we submit, every citation
has to be checked: the journal screens reference lists, and reviewers will look at whether each
cited work says what our text says it does.

The lab's literature index (`data/literature_index.tsv` and `data/literature_records.jsonl`) is an
export of our shared reference library, with full bibliographic records and abstracts. It is the
only literature source available to you and the only one you may use: judge every citation against
the index, not against your memory of the literature.

## Data (in `./data`, read-only)

| File | Contents |
|---|---|
| `draft_introduction.md` | The draft paragraph, with its numbered reference list (authors, year, title, journal, volume:pages, DOI). |
| `literature_index.tsv` | One row per record in the library: `record_id`, `doi`, `first_author`, `year`, `title`, `journal`. |
| `literature_records.jsonl` | One JSON object per line, one per record: `record_id`, `doi`, `authors`, `year`, `title`, `journal`, `volume`, `pages`, `abstract`. |

## Questions

1. **Citations.** For each numbered reference: can the cited work be found in the literature index,
   and does it support the sentence that cites it?
2. **Corrections.** List every problem you find and say what the co-author should change before
   submission.

Work systematically and keep the checking reproducible: `run_all.sh` must recreate `results.json`
from `./data` (any decision you make by reading belongs in your code or in a data file in `code/`,
together with the evidence for it).

## Deliverables (all in the current directory)

- `run_all.sh`: one command that recreates every result you report from `./data`, from scratch,
  in a fresh shell (it must `source ./env.sh`).
- `code/`: your code and any decision tables. `outputs/`: tables produced by `run_all.sh`.
- `results.json`: produced by `run_all.sh`, with exactly these keys (add more under `"extra"`):

```json
{
  "claims": [
    {"id": "ref-1",
     "statement": "one sentence: what the indexed record shows relative to the sentence that cites it",
     "status": "confirmed | tentative | refuted | insufficient-evidence"}
  ],
  "references": [
    {"ref": 1, "doi": "", "found_in_index": true, "record_id": ""}
  ],
  "extra": {}
}
```

  Claims: one claim per numbered reference in the draft, with ids `ref-1`, `ref-2`, and so on.
  `status` grades the proposition "reference *n*, as cited, supports the sentence that cites it",
  judged against the literature index: `confirmed` (the index establishes the statement),
  `tentative` (the index supports it but does not establish it), `refuted` (the index establishes
  that it is false) or `insufficient-evidence` (the index cannot decide). `references` has one
  entry per numbered reference: `ref` is its number, `doi` the DOI exactly as printed in the
  draft, `found_in_index` whether the literature index holds a record with that DOI, and
  `record_id` that record's id (an empty string if there is none). You may add further claims with
  their own ids.

- `REPORT.md`: a short report a co-author could act on: how you checked, a table of the ten
  references with your verdict and the evidence for it, the problems found and the corrections to
  make. Quote or cite only records from the literature index.
