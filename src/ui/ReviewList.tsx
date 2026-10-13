import { Box, Text } from "ink";
import { fit } from "./text.js";
import type { ReviewStatus } from "../application/state.js";
import stringWidth from "string-width";
export interface ReviewListItem {
  label: string;
  reviewStatus?: ReviewStatus;
  highlighted?: boolean;
  separatorBefore?: string;
}
type ListRow = { item: ReviewListItem; index: number } | { separator: string };

/** Separators occupy a row, but never become keyboard selections. */
export function visibleListRows(items: ReviewListItem[], index: number, rows: number): ListRow[] {
  const all: ListRow[] = items.flatMap((item, index): ListRow[] => [
    ...(item.separatorBefore ? [{ separator: item.separatorBefore }] : []), { item, index },
  ]);
  const selected = all.findIndex((row) => "item" in row && row.index === index);
  const start = Math.max(0, selected - rows + 1);
  return all.slice(start, start + rows);
}
export function ReviewList({ items, index, width, rows, empty }: {
  items: ReviewListItem[];
  index: number;
  width: number;
  rows: number;
  empty: string;
}) {
  return <Box flexDirection="column">
    {items.length === 0 ? <Text dimColor>{fit(empty, width)}</Text> :
      visibleListRows(items, index, rows).map((row, i) => {
        if ("separator" in row) {
          const label = fit(`--- ${row.separator} `, width);
          return <Text key={`separator-${i}`} dimColor>{label}{"-".repeat(Math.max(0, width - stringWidth(label)))}</Text>;
        }
        const { item } = row;
        const selected = row.index === index;
        const hasReview = item.reviewStatus !== undefined;
        const marked = hasReview && item.reviewStatus !== "unreviewed";
        const color = item.reviewStatus === "needs-review" ? "#ff9e45" : item.reviewStatus === "reviewed" ? "green" : "gray";
        return <Box key={row.index}>
          <Text color={selected ? "cyan" : "gray"}>{selected ? "›" : " "} </Text>
          {hasReview && <Text color={color} bold={marked}>{marked ? "●" : "·"} </Text>}
          <Text inverse={selected} bold={!!item.highlighted} {...(item.highlighted ? { color: "yellow" } : {})}>{fit(item.label, width - (hasReview ? 4 : 2))}</Text>
        </Box>;
      })}
  </Box>;
}
