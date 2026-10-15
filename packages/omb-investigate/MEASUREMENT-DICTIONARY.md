# Explicit measurement dictionaries

A served table declaration may opt into `measurement_dictionary` version 1. This
is trusted nominal design, at the same trust level as explicitly declared strata.
It is never inferred from header inclusion, column names, observed times, or an
analysis plan. Without this block, existing regeneration/redaction is unchanged.

```json
{
  "file": "dictionary.tsv",
  "columns": [
    {"name": "field", "storage": "string"},
    {"name": "unit", "storage": "string"},
    {"name": "month", "storage": "integer"}
  ],
  "measurement_dictionary": {
    "version": 1,
    "target": "measurements.tsv",
    "fields": {"measurement": "field", "unit": "unit", "offset": "month"},
    "measurements": [
      {"column": "initial", "unit": "mg/L", "slot": "baseline"},
      {"column": "later", "unit": "ug/L", "slot": "followup"}
    ],
    "visits": {
      "offsetUnit": "month",
      "slots": [
        {"id": "baseline", "order": 0, "offset": 0, "baseline": true},
        {"id": "followup", "order": 1, "offset": 6, "baseline": false}
      ]
    }
  }
}
```

Every object is closed: excess keys are refused rather than discarded. The block
requires `version`, `target`, `fields`, and `measurements`; `visits` is optional.
Target paths use the same data-root-relative convention as table paths (`data/`
is stripped for the public served-card table form). Target tables and columns
must exist; columns must explicitly declare numeric/measurement storage or role,
and cannot be identifiers, matrix axes, or exposures. A dictionary is a record
table, not a matrix, and cannot carry entity/allocation design. Its optional key
may name only the measurement-reference field.

`fields` requires distinct `measurement` and `unit` source column names. Optional
`slot`, `order`, `offset`, and `baseline` bindings require a visit declaration.
An entry in `measurements` has exactly `column`, `unit`, and (when visits exist)
`slot`. Measurement columns are unique, with at most 4096 entries. Unit strings
use a bounded physical vocabulary of SI symbols, SI prefixes/full names, and
common physical/time units, joined by `.` `/` `*` or `·` and optional powers
−3 through 3 (excluding zero). They are at most 96 characters with at most six
atoms. Examples include `mg/L`, `microgram.L`, `mmol/L`, `kg*m/s^2`, and `unitless`.
Numeric values, arbitrary alphabetic result nouns, and prose are refused. New
unit atoms need an explicit validator revision; unknown text is not accepted as
an opaque unit.

Visits require `offsetUnit` (second/minute/hour/day/week/month/year) and 1–256
slots. Each slot has exactly a bounded identifier `id`, zero-based consecutive
integer `order`, finite numeric `offset`, and boolean `baseline`. Offsets strictly
increase in declared order, have absolute magnitude at most 10^12, and exactly
one zero-offset slot is the baseline. Negative pre-baseline and fractional
nominal offsets are supported. Only order and nominal offset are numeric schema
exceptions; measurements, counts, means, ranges, numeric unit payloads, and
outcome/exposure relationships are never dictionary fields. Offsets must be
nominal declared schedule constants, never inferred from observed dates or data.
Every slot is referenced; no partial or unused visit blocks are accepted.

The declared source bindings must match the declared constants in an exact row
bijection. Numeric source offsets/order may use an equivalent decimal/scientific
spelling; output uses canonical numeric strings. A bound baseline field uses
literal `true`/`false`. Slot bindings use the exact slot identifier, not arbitrary
visit descriptions. Omit a binding for an untrusted producer label such as
`visit_role`; baseline can instead be established from the explicit schedule.
Unit-only dictionaries omit both `visits` and every entry's `slot` field.

Compilation stores the closed constants, null inventories, and no raw-cell slots
for bound metadata. Rendering reconstructs these fields from the declaration,
independent of original row order. Other explicitly declared bare-numeric columns retain only the existing
bounded measurement-inventory language and are regenerated; all other columns of this declared dictionary are redacted, including
low-cardinality and numeric-prefix prose. No source text format or level payload
is retained for those redacted columns.
Neighboring source bytes are not new trusted inputs. Independent audit checks the
source and generated projection exactly before exempting pairs of validated
metadata fields; relationships involving adjacent measurements remain checked.
Rebuild independently validates the closed language and cross-table references,
then compares worker-visible bytes. Repeated audit cohorts retain the complete
nominal dictionary, without using it to select entity namespaces.

Existing cards require a separately authored contract revision and new calibration
and run evidence to opt in. Do not retrofit a declaration into an already served
run or amend preregistration/experiment artifacts. Old contracts continue to use
the old practice behavior; this implementation alone does not establish c12
correctness. Revalidate c12 and c01–24/c25–36 offline, then run the authorized live
check after the active live batch has finished.
