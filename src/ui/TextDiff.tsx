import React, { useMemo } from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import type { DiffLine } from "../core/models.js";
import { splitDiff, changedSpans } from "../core/splitDiff.js";
import { fit } from "./text.js";

function Cell({ line, side, width, span }: {
  line?: DiffLine;
  side: "before" | "after";
  width: number;
  span?: { start: number; end: number };
}) {
  const changed = line?.kind === "delete" || line?.kind === "add";
  const color = changed ? side === "before" ? "red" : "green" : undefined;
  const background = changed ? side === "before" ? "#321b22" : "#183326" : undefined;
  const number = line ? side === "before" ? line.old : line.new : undefined;
  const gutter = line ? `${String(number ?? "").padStart(5)} ${changed ? side === "before" ? "-" : "+" : " "} ` : "        ";
  const prefix = fit(gutter, width);
  const body = fit(line?.text ?? "", Math.max(0, width - stringWidth(prefix)));
  const chars = Array.from(body);
  const start = Math.min(span?.start ?? 0, chars.length);
  const end = Math.min(span?.end ?? 0, chars.length - (body.endsWith("…") ? 1 : 0));
  const padding = " ".repeat(Math.max(0, width - stringWidth(prefix + body)));
  return <Text {...(color ? { color } : {})} {...(background ? { backgroundColor: background } : {})}>
    {prefix}{span && end > start ? <>
      {chars.slice(0, start).join("")}
      <Text bold color="white" backgroundColor={side === "before" ? "#662c39" : "#24573b"}>{chars.slice(start, end).join("")}</Text>
      {chars.slice(end).join("")}
    </> : body}{padding}
  </Text>;
}

export function TextDiff({ lines, width, rows, scroll, split, fallback = false }: {
  lines: DiffLine[];
  width: number;
  rows: number;
  scroll: number;
  split: boolean;
  fallback?: boolean;
}) {
  const paired = useMemo(() => splitDiff(lines), [lines]);
  const leftWidth = Math.floor((width - 1) / 2);
  const rightWidth = width - leftWidth - 1;
  return <Box flexDirection="column" width={width}>
    {split ? <Box height={1}>
      <Box width={leftWidth}><Text bold color="red">{fit("Anterior (−)", leftWidth)}</Text></Box>
      <Text dimColor>│</Text>
      <Box width={rightWidth}><Text bold color="green">{fit("Nueva (+)", rightWidth)}</Text></Box>
    </Box> : fallback ? <Text color="yellow">{fit("Amplía a 80 columnas para vista paralela", width)}</Text> : null}
    {split ? paired.slice(scroll, scroll + rows).map((row, index) => {
      if (row.shared) return <Text key={scroll + index} {...(row.shared.kind === "header" ? { color: "cyan" } : { dimColor: true })}>{fit(row.shared.text, width)}</Text>;
      const spans = row.before?.kind === "delete" && row.after?.kind === "add"
        ? changedSpans(row.before.text, row.after.text) : undefined;
      return <Box height={1} key={scroll + index}>
        <Box width={leftWidth}><Cell {...(row.before ? { line: row.before } : {})} side="before" width={leftWidth} {...(spans ? { span: spans.before } : {})} /></Box>
        <Text dimColor>│</Text>
        <Box width={rightWidth}><Cell {...(row.after ? { line: row.after } : {})} side="after" width={rightWidth} {...(spans ? { span: spans.after } : {})} /></Box>
      </Box>;
    }) : lines.slice(scroll, scroll + rows).map((line, index) => {
      const numbered = line.kind === "add" || line.kind === "delete" || line.kind === "context";
      const prefix = numbered ? `${String(line.old ?? "").padStart(5)} ${String(line.new ?? "").padStart(5)} ${line.kind === "add" ? "+" : line.kind === "delete" ? "-" : " "} ` : "";
      return <Text key={scroll + index} {...(line.kind === "add" ? { color: "green" } : line.kind === "delete" ? { color: "red" } : line.kind === "header" ? { color: "cyan" } : {})}>{fit(prefix + line.text, width)}</Text>;
    })}
  </Box>;
}
