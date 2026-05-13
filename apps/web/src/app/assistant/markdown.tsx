import type { ReactNode } from "react";

// Minimal, dependency-free markdown renderer.
// Supports: headings (##, ###), bold (**), italic (* / _), inline code (`),
// fenced code blocks (```), unordered lists (-, *), ordered lists (1.),
// blockquotes (>), and paragraph breaks. No raw HTML is rendered — output is
// React elements only, which keeps the chat surface XSS-safe by construction.

type Block =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; lang: string | null; content: string };

function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block.
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const lang = fence[1] ?? null;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").match(/^```\s*$/)) {
        buf.push(lines[i] ?? "");
        i++;
      }
      // skip closing fence
      if (i < lines.length) i++;
      blocks.push({ kind: "code", lang, content: buf.join("\n") });
      continue;
    }

    // Headings.
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      blocks.push({ kind: "heading", level: 3, text: h3[1] ?? "" });
      i++;
      continue;
    }
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      blocks.push({ kind: "heading", level: 2, text: h2[1] ?? "" });
      i++;
      continue;
    }

    // Unordered list (collect contiguous lines).
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    // Ordered list.
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    // Block quote.
    if (line.startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("> ")) {
        buf.push((lines[i] ?? "").slice(2));
        i++;
      }
      blocks.push({ kind: "quote", text: buf.join(" ") });
      continue;
    }

    // Paragraph — collect until blank line or block-starter.
    const buf: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (next.trim() === "") break;
      if (/^(##|###)\s+/.test(next)) break;
      if (/^[-*]\s+/.test(next)) break;
      if (/^\d+\.\s+/.test(next)) break;
      if (/^```/.test(next)) break;
      if (next.startsWith("> ")) break;
      buf.push(next);
      i++;
    }
    blocks.push({ kind: "paragraph", text: buf.join(" ") });
  }

  return blocks;
}

// Inline tokenizer for **bold**, *italic* / _italic_, `code`.
// We walk the string and emit React elements; HTML is never injected.
function renderInline(input: string): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = "";
  let key = 0;
  const flush = () => {
    if (buf) {
      out.push(buf);
      buf = "";
    }
  };

  let i = 0;
  while (i < input.length) {
    const ch = input[i];

    // Inline code: `...`
    if (ch === "`") {
      const end = input.indexOf("`", i + 1);
      if (end !== -1) {
        flush();
        out.push(
          <code
            key={`c-${key++}`}
            className="rounded bg-muted px-1 py-[1px] font-mono text-[0.85em]"
          >
            {input.slice(i + 1, end)}
          </code>,
        );
        i = end + 1;
        continue;
      }
    }

    // Bold: **...**
    if (ch === "*" && input[i + 1] === "*") {
      const end = input.indexOf("**", i + 2);
      if (end !== -1) {
        flush();
        out.push(
          <strong key={`b-${key++}`} className="font-semibold text-foreground">
            {renderInline(input.slice(i + 2, end))}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }

    // Italic: *...* (single asterisk, not adjacent to another *)
    if (
      ch === "*" &&
      input[i + 1] !== "*" &&
      input[i - 1] !== "*" &&
      input[i + 1] !== " "
    ) {
      const end = input.indexOf("*", i + 1);
      if (end !== -1 && input[end + 1] !== "*") {
        flush();
        out.push(
          <em key={`i-${key++}`}>{renderInline(input.slice(i + 1, end))}</em>,
        );
        i = end + 1;
        continue;
      }
    }

    // Italic: _..._
    if (ch === "_" && input[i + 1] !== " " && input[i + 1] !== "_") {
      const end = input.indexOf("_", i + 1);
      if (end !== -1 && /\W|$/.test(input[end + 1] ?? "")) {
        flush();
        out.push(
          <em key={`i-${key++}`}>{renderInline(input.slice(i + 1, end))}</em>,
        );
        i = end + 1;
        continue;
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

export function renderMarkdown(src: string): ReactNode {
  if (!src) return null;
  const blocks = parseBlocks(src);
  return blocks.map((b, idx) => {
    const key = `b-${idx}`;
    switch (b.kind) {
      case "heading":
        return b.level === 2 ? (
          <h2
            key={key}
            className="mt-3 mb-1 text-[15px] font-semibold tracking-tight text-foreground first:mt-0"
          >
            {renderInline(b.text)}
          </h2>
        ) : (
          <h3
            key={key}
            className="mt-2 mb-1 text-sm font-semibold text-foreground first:mt-0"
          >
            {renderInline(b.text)}
          </h3>
        );
      case "paragraph":
        return (
          <p key={key} className="my-1.5 first:mt-0 last:mb-0">
            {renderInline(b.text)}
          </p>
        );
      case "ul":
        return (
          <ul key={key} className="my-1.5 list-disc space-y-1 pl-5">
            {b.items.map((item, j) => (
              <li key={j}>{renderInline(item)}</li>
            ))}
          </ul>
        );
      case "ol":
        return (
          <ol key={key} className="my-1.5 list-decimal space-y-1 pl-5">
            {b.items.map((item, j) => (
              <li key={j}>{renderInline(item)}</li>
            ))}
          </ol>
        );
      case "quote":
        return (
          <blockquote
            key={key}
            className="my-2 border-l-2 border-border pl-3 text-muted-foreground"
          >
            {renderInline(b.text)}
          </blockquote>
        );
      case "code":
        return (
          <pre
            key={key}
            className="my-2 overflow-x-auto rounded-md bg-muted p-3 text-[0.8em]"
          >
            <code className="font-mono">{b.content}</code>
          </pre>
        );
    }
  });
}
