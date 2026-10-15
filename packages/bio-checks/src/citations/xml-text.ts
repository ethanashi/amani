// Deliberately restricted XML reader: no DTD/entity expansion, no external I/O.
// Unsupported markup raises an error, which the resolver maps to unverified.
const blocks = new Set(["article", "front", "body", "back", "sec", "p", "title", "article-title", "abstract",
  "list", "list-item", "table", "tr", "td", "th", "caption", "ref", "ref-list", "label", "break", "br", "h4"]);

function entities(value: string): string {
  return value.replace(/&([^;\s]+);|&/g, (match, entity: string | undefined) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (entity && Object.hasOwn(named, entity)) return named[entity]!;
    if (entity && /^#(?:\d+|x[\da-fA-F]+)$/.test(entity)) {
      const code = entity.startsWith("#x") ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0x10ffff &&
          !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff)) return String.fromCodePoint(code);
    }
    throw new Error(`Unsupported XML entity: ${match}`);
  });
}

// A single forward scan avoids the ambiguous nested quantifiers of the old tag regex.
function readTag(xml: string, start: number) {
  let position = start + 1;
  const closing = xml[position] === "/";
  if (closing) position++;
  const name = /^[A-Za-z_][\w.:-]*/.exec(xml.slice(position))?.[0];
  if (!name) throw new Error("Invalid XML tag");
  position += name.length;
  const attributes = new Map<string, string>();
  while (position < xml.length) {
    const before = position;
    while (/[ \t\r\n]/.test(xml[position] ?? "")) position++;
    if (xml[position] === ">") return { name, closing, selfClosing: false, attributes, end: position + 1 };
    if (!closing && xml.startsWith("/>", position)) return { name, closing, selfClosing: true, attributes, end: position + 2 };
    if (closing || position === before) throw new Error("Invalid XML tag");
    const key = /^[A-Za-z_][\w.:-]*/.exec(xml.slice(position))?.[0];
    if (!key || attributes.has(key)) throw new Error("Invalid XML tag");
    position += key.length;
    while (/[ \t\r\n]/.test(xml[position] ?? "")) position++;
    if (xml[position++] !== "=") throw new Error("Invalid XML tag");
    while (/[ \t\r\n]/.test(xml[position] ?? "")) position++;
    const quote = xml[position++];
    if (quote !== '"' && quote !== "'") throw new Error("Invalid XML tag");
    const end = xml.indexOf(quote, position);
    if (end < 0 || xml.slice(position, end).includes("<")) throw new Error("Invalid XML tag");
    attributes.set(key, entities(xml.slice(position, end)));
    position = end + 1;
  }
  throw new Error("Invalid XML tag");
}

const excluded = new Set(["back", "ref-list", "ref", "journal-meta", "permissions", "license", "processing-meta"]);
const localName = (name: string): string => name.replace(/^.*:/, "");

export function xmlText(xml: string, requireArticle = false): string {
  const stack: { name: string; hidden: boolean; start: number; citation: boolean }[] = [];
  const text: string[] = [];
  const append = (value: string): void => { if (!stack.at(-1)?.hidden) text.push(value); };
  let position = 0;
  let roots = 0;
  let declared = false;
  while (position < xml.length) {
    const rest = xml.slice(position);
    if (rest.startsWith("<!--")) {
      const end = xml.indexOf("-->", position + 4);
      if (end < 0 || xml.slice(position + 4, end).includes("--")) throw new Error("Invalid XML comment");
      position = end + 3; continue;
    }
    if (rest.startsWith("<![CDATA[")) {
      const end = xml.indexOf("]]>", position + 9);
      if (end < 0 || !stack.length) throw new Error("Invalid CDATA");
      append(xml.slice(position + 9, end)); position = end + 3; continue;
    }
    if (rest.startsWith("<?")) {
      const target = /^<\?([A-Za-z_][\w.:-]*)(?=\s|\?>)/.exec(rest)?.[1];
      const end = xml.indexOf("?>", position + 2);
      if (!target || end < 0) throw new Error("Invalid XML processing instruction");
      if (target.toLowerCase() === "xml") {
        if (target !== "xml" || declared || roots || stack.length || text.some(t => t.trim()) ||
            !/^<\?xml\s+[^?]*\?>/.test(rest)) throw new Error("Invalid XML declaration");
        declared = true;
      }
      position = end + 2; continue;
    }
    if (rest.startsWith("<!DOCTYPE")) {
      // External identifiers are ignored, never fetched. Internal subsets are refused.
      const declaration = /^<!DOCTYPE\s+article(?:\s+(?:PUBLIC\s+"[^"]*"\s+"[^"]*"|SYSTEM\s+"[^"]*"))?\s*>/.exec(rest)?.[0];
      if (!declaration || roots || stack.length) throw new Error("Unsupported DTD");
      position += declaration.length; continue;
    }
    if (rest[0] !== "<") {
      const next = xml.indexOf("<", position);
      const chunk = xml.slice(position, next < 0 ? xml.length : next);
      if (requireArticle && !stack.length && chunk.trim()) throw new Error("Text outside article");
      if (chunk.includes("]]>")) throw new Error("Invalid text");
      append(entities(chunk)); position += chunk.length; continue;
    }
    const tag = readTag(xml, position);
    const name = localName(tag.name);
    if (tag.closing) {
      const frame = stack.pop();
      if (frame?.name !== tag.name) throw new Error("Unbalanced XML");
      // Drop only citation-only superscripts, including punctuation between their xrefs.
      // Scientific exponents and figure/table xrefs remain literal text.
      if (name === "sup" && frame.citation && /^[\s,;–—\-()[\]]*$/.test(text.slice(frame.start).join(""))) {
        text.splice(frame.start);
      }
      if (!frame.hidden && blocks.has(name)) append(" ");
      if (excluded.has(name)) append(" ");
    } else {
      if (!stack.length) {
        roots++;
        if (requireArticle && (roots !== 1 || tag.name !== "article")) throw new Error("Expected article XML");
      }
      const citation = name === "xref" && tag.attributes.get("ref-type") === "bibr";
      if (citation && localName(stack.at(-1)?.name ?? "") === "sup") stack.at(-1)!.citation = true;
      if (blocks.has(name) || excluded.has(name)) append(" ");
      const hidden = Boolean(stack.at(-1)?.hidden || excluded.has(name) || citation);
      if (!tag.selfClosing) stack.push({ name: tag.name, hidden, start: text.length, citation: false });
    }
    position = tag.end;
  }
  if (stack.length || (requireArticle && roots !== 1)) throw new Error("Incomplete XML");
  return text.join("").replace(/\s+/gu, " ").trim();
}

/** Europe PMC abstracts are HTML-like fragments; bare comparison signs are prose. */
export function abstractText(value: string): string {
  return xmlText(value.replace(/<(?=\s|[0-9=]|$)/gu, "&lt;"));
}
