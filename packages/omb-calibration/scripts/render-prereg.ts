// Renders PREREGISTRATION.md from the specs (node packages/omb-calibration/scripts/render-prereg.ts).
import { writeFileSync } from "node:fs";
import { readCards, renderPreregistration, TASKS_DIR } from "../src/index.ts";
writeFileSync(new URL("../PREREGISTRATION.md", import.meta.url), renderPreregistration(readCards(TASKS_DIR)));
