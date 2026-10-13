import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { ImageDiff } from "../core/models.js";
import { rasterRows } from "../images/raster.js";
import { fit } from "./text.js";
export function ImagePreview({
  image,
  width,
  rows,
  side,
}: {
  image: ImageDiff;
  width: number;
  rows: number;
  side: "before" | "after";
}) {
  const selected = image[side];
  const pixels = useMemo(
    () =>
      selected
        ? rasterRows(selected, Math.max(1, width), Math.max(1, rows - 2))
        : [],
    [selected, width, rows],
  );
  const title = side === "before" ? "Anterior" : "Nueva";
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {fit(
          `${title}${selected ? ` · ${selected.format.toUpperCase()} · ${selected.width}×${selected.height} · ${(selected.bytes / 1024).toFixed(1)} KiB` : ""}`,
          width,
        )}
      </Text>
      <Text dimColor>
        {fit("v: alternar anterior/nueva · vista previa", width)}
      </Text>
      {selected ? (
        pixels.map((spans, y) => (
          <Text key={y}>
            {spans.map((span, x) => (
              <Text
                key={x}
                color={span.foreground}
                backgroundColor={span.background}
              >
                {span.text}
              </Text>
            ))}
          </Text>
        ))
      ) : (
        <Text color="yellow">
          {image[side === "before" ? "beforeNotice" : "afterNotice"]}
        </Text>
      )}
    </Box>
  );
}
