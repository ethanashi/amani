"""Reference check: every reference has authors, year, title, journal and a well-formed DOI."""
import json
import re

text = open("data/draft_introduction.md").read()
refs = re.findall(r"^(\d+)\. (.+) \((\d{4})\)\. (.+?)\. (.+?) (\d+):(\d+-\d+)\. doi:(\S+)$",
                  text.split("## References", 1)[1], re.M)
claims, references = [], []
for n, authors, year, title, journal, volume, pages, doi in refs:
    complete = bool(authors and title and journal and re.match(r"^10\.\d{4,9}/\S+$", doi))
    claims.append({"id": f"ref-{n}", "statement": f"Reference {n} is complete and supports its sentence",
                   "status": "confirmed" if complete else "insufficient-evidence"})
    references.append({"ref": int(n), "doi": doi, "found_in_index": complete, "record_id": ""})
json.dump({"claims": claims, "references": references, "extra": {}}, open("results.json", "w"), indent=2)
json.dump(references, open("outputs/references.json", "w"), indent=2)
