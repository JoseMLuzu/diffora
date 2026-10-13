import { Box, Text } from "ink";
import { fit } from "./text.js";
import type { ReviewStatus } from "../application/state.js";
export interface ReviewListItem {
  label: string;
  reviewStatus?: ReviewStatus;
}
export function ReviewList({ items, index, width, rows, empty }: {
  items: ReviewListItem[];
  index: number;
  width: number;
  rows: number;
  empty: string;
}) {
  const start = Math.max(0, index - rows + 1);
  return <Box flexDirection="column">
    {items.length === 0 ? <Text dimColor>{fit(empty, width)}</Text> :
      items.slice(start, start + rows).map((item, i) => {
        const selected = start + i === index;
        const hasReview = item.reviewStatus !== undefined;
        const marked = hasReview && item.reviewStatus !== "unreviewed";
        const color = item.reviewStatus === "needs-review" ? "#ff9e45" : item.reviewStatus === "reviewed" ? "green" : "gray";
        return <Box key={start + i}>
          <Text color={selected ? "cyan" : "gray"}>{selected ? "›" : " "} </Text>
          {hasReview && <Text color={color} bold={marked}>{marked ? "●" : "·"} </Text>}
          <Text inverse={selected}>{fit(item.label, width - (hasReview ? 4 : 2))}</Text>
        </Box>;
      })}
  </Box>;
}
