/**
 * Label, caption and alt-text templates. A template is static text plus placeholders:
 *   [m:<factId>]   formatted value of a certified fact
 *   [e:<entityId>] name from a certified entity record (digits allowed: C9orf72, rs429358)
 *   [lvl:<factId>] interval level of a certified fact ("95%")
 * Static text must pass the strict lint below (section 2.5); every number comes from a placeholder.
 */
import type { NumberGrade } from "./port.ts";
import { refuse } from "./refusal.ts";
import type { FactStore, UseContext } from "./store.ts";

export interface BindingSource {
  readonly type: "fact" | "series" | "entity" | "unit" | "ci-level" | "axis" | "constant";
  readonly id: string;
  readonly sourceRecordId: string | null;
  readonly grade: NumberGrade | null;
}

export type Segment =
  | { readonly kind: "static"; readonly text: string }
  | { readonly kind: "bound"; readonly text: string; readonly source: BindingSource };

export const stat = (text: string): Segment => ({ kind: "static", text });

export type TemplateIssueCode =
  | "unbound-number" | "number-word" | "html-entity" | "format-char" | "url" | "non-normalised"
  | "mixed-script" | "markup" | "placeholder-syntax" | "too-long" | "binding-extended" | "quantifier-without-count";

export interface TemplateIssue { readonly code: TemplateIssueCode; readonly detail: string }

const PLACEHOLDER = /\[(m|e|lvl):([A-Za-z0-9_.:\-]{1,160}(?:#\d{1,6})?)\]/gu;

/**
 * Every English cardinal and ordinal word (compositions such as "ninety-one" or "a hundred" contain one),
 * fractions, multipliers and percent words. Numbers in words never print; they must be placeholders.
 */
const NUMBER_WORDS = new RegExp(
  "\\b(?:zero|nil|nought|naught|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve"
  + "|(?:thir|four|fif|six|seven|eigh|nine)teen(?:th)?s?"
  + "|(?:twen|thir|for|four|fif|six|seven|eigh|nine)t(?:y|ies|ieths?)"
  + "|thirds?|fourths?|fifths?|sixths?|sevenths?|eighths?|ninths?|tenths?|elevenths?|twelfths?"
  + "|(?:hundred|thousand|million|billion|trillion)(?:s|ths?)?|dozens?|half|halves|halved|halving|quarters?|twice|thrice"
  + "|doubl(?:e|ed|es|ing)|tripl(?:e|ed|es|ing)|quadrupl(?:e|ed|es|ing)|[a-z]*-?fold|percent|per\\s+cent|per\\s+mille|times\\s+as)\\b",
  "iu",
);

/** Quantity words (section 2.5 item 6 and close kin): a sentence using one needs a certified count in it. */
/* "treat all" and "treat none" are the decision-curve reference strategies, not quantities. */
const QUANTIFIERS = /\b(?:(?<!\btreat(?:ing)?\s)(?:all|none)|every|both|each|most|majority|minority|few|fewer|several|many|numerous|handful|couple|countless|vast)\b/iu;

export interface ParsedTemplate {
  readonly fragments: readonly string[];
  readonly placeholders: readonly { readonly ns: "m" | "e" | "lvl"; readonly id: string }[];
}

/** Splits a template into static fragments (n+1) and placeholders (n). */
export function parseTemplate(template: string): ParsedTemplate {
  const fragments: string[] = [];
  const placeholders: { ns: "m" | "e" | "lvl"; id: string }[] = [];
  let last = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    fragments.push(template.slice(last, match.index));
    placeholders.push({ ns: match[1] as "m" | "e" | "lvl", id: match[2]! });
    last = match.index + match[0].length;
  }
  fragments.push(template.slice(last));
  return { fragments, placeholders };
}

function scriptsOf(token: string): Set<string> {
  const scripts = new Set<string>();
  for (const ch of token) {
    if (/\p{Script=Latin}/u.test(ch)) scripts.add("Latin");
    else if (/\p{Script=Greek}/u.test(ch)) scripts.add("Greek");
    else if (/\p{Script=Cyrillic}/u.test(ch)) scripts.add("Cyrillic");
    else if (/\p{L}/u.test(ch)) scripts.add("Other");
  }
  return scripts;
}

/** Lints static text (no placeholders). Used for template fragments and the template library. */
export function lintStaticText(text: string): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const add = (code: TemplateIssueCode, detail: string) => issues.push({ code, detail });
  if (/\p{N}/u.test(text)) add("unbound-number", `number outside a placeholder in "${text}"`);
  const word = NUMBER_WORDS.exec(text);
  if (word) add("number-word", `number word "${word[0]}"`);
  if (/&(?:#|[A-Za-z][A-Za-z0-9]*;)/u.test(text)) add("html-entity", "character or entity reference");
  if (/[a-z][a-z0-9+.\-]*:\/\/|\bwww\.|\bdoi\.org\b|\b[\w-]+\.(?:org|com|net|io|gov|edu)\b/iu.test(text)) add("url", "URL or host name");
  if (/[<>{}`\\|]/u.test(text) || /^\s*#/u.test(text)) add("markup", "markup character");
  if (/[\[\]]/u.test(text)) add("placeholder-syntax", "stray bracket (unknown or malformed placeholder)");
  for (const token of text.split(/[^\p{L}\p{M}]+/u)) {
    if (token && scriptsOf(token).size > 1) add("mixed-script", `token "${token}" mixes scripts`);
  }
  return issues;
}

/** Lints a whole template: invisible characters anywhere, normalisation, then each static fragment. */
export function lintTemplate(template: string, maxLength = 300): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  if (typeof template !== "string") return [{ code: "placeholder-syntax", detail: "template is not a string" }];
  if (template.length > maxLength) issues.push({ code: "too-long", detail: `template exceeds ${maxLength} characters` });
  if (/[\p{Cf}\p{Cc}\p{Zl}\p{Zp}]/u.test(template)) issues.push({ code: "format-char", detail: "control, bidi or zero-width character" });
  if (template.normalize("NFKC") !== template) issues.push({ code: "non-normalised", detail: "text changes under NFKC (fullwidth, ligature or compatibility form)" });
  const parsed = parseTemplate(template);
  for (const fragment of parsed.fragments) issues.push(...lintStaticText(fragment));
  issues.push(...bindingExtensions(parsed));
  const quantifier = parsed.fragments.map((f) => QUANTIFIERS.exec(f)).find((m) => m);
  if (quantifier && !parsed.placeholders.some((p) => p.ns === "m")) {
    issues.push({ code: "quantifier-without-count", detail: `"${quantifier[0]}" needs a certified count ([m:]) in the same text` });
  }
  return issues;
}

const NUMERIC_NS: ReadonlySet<string> = new Set(["m", "lvl"]);
/** Characters that, touching a number, would extend it or combine it with another number. */
const EXTENDS_BEFORE = /[\p{L}\p{N}.,_^/*×%‰−+\-]$/u;
const EXTENDS_AFTER = /^(?:[\p{L}\p{N}_^/*×%‰⁺⁻]|[.,][\p{L}\p{N}])/u;
const OPERATOR_ONLY = /^\s*(?:[×*/^+\-−]|\p{L})?\s*$/u;

/** Static text may not extend a numeric placeholder, nor join two placeholders into one expression. */
function bindingExtensions(parsed: ParsedTemplate): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  parsed.placeholders.forEach((ph, i) => {
    const before = parsed.fragments[i]!, after = parsed.fragments[i + 1]!;
    const prev = parsed.placeholders[i - 1], next = parsed.placeholders[i + 1];
    const touchesNumeric = (other: typeof ph | undefined) => !!other && (NUMERIC_NS.has(ph.ns) || NUMERIC_NS.has(other.ns));
    if (after === "" && touchesNumeric(next)) issues.push({ code: "binding-extended", detail: `[${ph.ns}:${ph.id}] touches the next placeholder` });
    if (!NUMERIC_NS.has(ph.ns)) return;
    if (EXTENDS_BEFORE.test(before) || (before === "" && prev)) issues.push({ code: "binding-extended", detail: `text before [${ph.ns}:${ph.id}] extends the number` });
    if (EXTENDS_AFTER.test(after)) issues.push({ code: "binding-extended", detail: `text after [${ph.ns}:${ph.id}] extends the number` });
    if (next && NUMERIC_NS.has(next.ns) && after !== "" && OPERATOR_ONLY.test(after)) {
      issues.push({ code: "binding-extended", detail: `[${ph.ns}:${ph.id}] and [${next.ns}:${next.id}] are joined into one expression` });
    }
  });
  return issues;
}

export function assertTemplate(template: string, where: string): ParsedTemplate {
  const issues = lintTemplate(template);
  if (issues.length) refuse("template-lint", `${where}: template refused`, issues.map((i) => `${i.code}: ${i.detail}`));
  return parseTemplate(template);
}

/** Resolves a template into static and bound segments under the figure's use context. */
export function resolveTemplate(template: string, store: FactStore, ctx: UseContext): Segment[] {
  const parsed = assertTemplate(template, ctx.where);
  const out: Segment[] = [];
  let counted = false;
  parsed.fragments.forEach((fragment, i) => {
    if (fragment) out.push(stat(fragment));
    const ph = parsed.placeholders[i];
    if (!ph) return;
    if (ph.ns === "e") {
      const [id, indexText] = ph.id.split("#") as [string, string | undefined];
      const entity = store.entity(id, ctx.where);
      const index = indexText === undefined ? 0 : Number(indexText);
      if (indexText === undefined && entity.texts.length !== 1) refuse("invalid-spec", `${ctx.where}: entity list ${id} needs an index`);
      const text = entity.texts[index] ?? refuse("missing-record", `${ctx.where}: entity ${ph.id} is out of range`);
      out.push({ kind: "bound", text, source: { type: "entity", id: ph.id, sourceRecordId: entity.sourceRecordId, grade: null } });
      return;
    }
    if (ph.id.includes("#")) refuse("template-lint", `${ctx.where}: only entity lists take an index`);
    const fact = store.fact(ph.id, ctx);
    if (ph.ns === "lvl") {
      if (fact.ciLevel === null) refuse("invalid-spec", `${ctx.where}: ${ph.id} has no interval level`);
      out.push({ kind: "bound", text: store.formatter.ciLevel(fact.ciLevel), source: { type: "ci-level", id: fact.id, sourceRecordId: fact.sourceRecordId, grade: fact.grade } });
      return;
    }
    counted ||= fact.kind === "count";
    out.push({ kind: "bound", text: store.formatter.scalar(fact), source: { type: "fact", id: fact.id, sourceRecordId: fact.sourceRecordId, grade: fact.grade } });
    if (fact.grade === "exec") out.push(stat("†"));
  });
  if (!counted && parsed.fragments.some((f) => QUANTIFIERS.test(f))) refuse("template-lint", `${ctx.where}: a quantity word needs a certified count in the same text`);
  return out;
}

export const segmentsText = (segments: readonly Segment[]): string => segments.map((s) => s.text).join("");

/** Placeholder form of a segment list: the auditable, placeholder-bound version of the text. */
export function segmentsTemplate(segments: readonly Segment[]): string {
  return segments.map((s) => {
    if (s.kind === "static") return s.text;
    switch (s.source.type) {
      case "fact": return `[m:${s.source.id}]`;
      case "entity": return `[e:${s.source.id}]`;
      case "ci-level": return `[lvl:${s.source.id}]`;
      default: return `[${s.source.type}:${s.source.id}]`;
    }
  }).join("");
}
