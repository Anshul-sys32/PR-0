import type { ReactNode } from "react";

type Block = { kind: "paragraph" | "quote" | "code" | "heading" | "list"; text: string[]; level?: number; ordered?: boolean; language?: string };

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  let paragraph: string[] = [];
  let list: Block | undefined;
  let code: string[] | undefined;
  let language = "";

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = undefined;
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      if (code) {
        blocks.push({ kind: "code", text: code, language });
        code = undefined;
        language = "";
      } else {
        code = [];
        language = line.slice(3).trim().replace(/[^a-zA-Z0-9_+-]/g, "");
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: heading[1]?.length ?? 2, text: [heading[2] ?? ""] });
      continue;
    }
    const listItem = /^(?:([-*+])|(\d+)\.)\s+(.+)$/.exec(line);
    if (listItem) {
      flushParagraph();
      const ordered = Boolean(listItem[2]);
      if (list && list.ordered !== ordered) flushList();
      list ??= { kind: "list", text: [], ordered };
      list.text.push(listItem[3] ?? "");
      continue;
    }
    if (list) flushList();
    if (line.startsWith("> ")) {
      flushParagraph();
      blocks.push({ kind: "quote", text: [line.slice(2)] });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  if (code) blocks.push({ kind: "code", text: code, language });
  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g);
  return tokens.filter(Boolean).map((token, index) => {
    const key = `${index}:${token}`;
    if (token.startsWith("`") && token.endsWith("`")) return <code key={key}>{token.slice(1, -1)}</code>;
    if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) return <strong key={key}>{token.slice(2, -2)}</strong>;
    if ((token.startsWith("*") && token.endsWith("*")) || (token.startsWith("_") && token.endsWith("_"))) return <em key={key}>{token.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
    if (link) {
      const label = link[1] ?? token;
      const href = link[2] ?? "";
      try {
        const url = new URL(href);
        if (url.protocol === "https:" || url.protocol === "http:") return <a key={key} href={url.href} target="_blank" rel="noreferrer">{label}</a>;
      } catch { /* Invalid and non-web URLs remain inert text. */ }
      return <span key={key}>{label} ({href})</span>;
    }
    return <span key={key}>{token}</span>;
  });
}

export function MessageText({ content }: { content: string }) {
  return <div className="message-content">{parseBlocks(content).map((block, index) => {
    const key = `${block.kind}:${index}`;
    if (block.kind === "code") return <pre className="message-code" key={key}><code>{block.text.join("\n")}</code></pre>;
    if (block.kind === "heading") {
      const Heading = `h${block.level ?? 2}` as "h1" | "h2" | "h3";
      return <Heading key={key}>{renderInline(block.text.join(""))}</Heading>;
    }
    if (block.kind === "quote") return <blockquote key={key}>{renderInline(block.text.join("\n"))}</blockquote>;
    if (block.kind === "list") {
      const List = block.ordered ? "ol" : "ul";
      return <List key={key}>{block.text.map((item, itemIndex) => <li key={`${itemIndex}:${item}`}>{renderInline(item)}</li>)}</List>;
    }
    return <p key={key}>{renderInline(block.text.join("\n"))}</p>;
  })}</div>;
}
