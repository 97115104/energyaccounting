/**
 * Visual QA for the wing grammar: renders every family's default butterfly plus
 * edge variants into one PNG grid so silhouette changes can be eyeballed at
 * both picker (~64px) and hero scale. Run with:
 *   bun run scripts/preview-butterfly.tsx
 * Output: /tmp/butterfly-grid.png
 */

import { renderToStaticMarkup } from "react-dom/server";
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";
import { Butterfly } from "../src/components/Butterfly";
import { WING_EDGES, WING_FAMILIES } from "../src/lib/butterflyGeometry";
import { defaultIdentity, normalizeIdentity, type IdentityConfig } from "../src/lib/identity";

function identityFor(family: string, wing?: Record<string, unknown>): IdentityConfig {
  const base = defaultIdentity(`prev-${family}`);
  return normalizeIdentity(
    { ...base, archetype: family, wing: { family, ...wing } },
    base.seed,
  );
}

const CELL = 150;
const LABEL = 18;

type Cell = { identity: IdentityConfig; label: string };

// Row 1-2: the eight families at their default wings.
// Rows 3+: edge sweep per representative family, to check margin treatment.
const rows: Cell[][] = [
  WING_FAMILIES.slice(0, 4).map((f) => ({ identity: identityFor(f), label: f })),
  WING_FAMILIES.slice(4).map((f) => ({ identity: identityFor(f), label: f })),
  WING_EDGES.map((edge) => ({
    identity: identityFor("monarch", { edge }),
    label: `monarch ${edge}`,
  })),
  WING_EDGES.map((edge) => ({
    identity: identityFor("swallowtail", { edge, tail: "long" }),
    label: `swallowtail ${edge}`,
  })),
  [
    { identity: identityFor("swallowtail", { tail: "twin" }), label: "swallowtail twin" },
    { identity: identityFor("peacock", { edge: "scalloped" }), label: "peacock scalloped" },
    { identity: identityFor("owl", { edge: "angular" }), label: "owl angular" },
    { identity: identityFor("glasswing"), label: "glasswing clear" },
  ],
];

const cols = Math.max(...rows.map((r) => r.length));
const width = cols * CELL;
const height = rows.length * (CELL + LABEL);

const cells = rows
  .flatMap((row, ry) =>
    row.map((cell, cx) => {
      const inner = renderToStaticMarkup(
        <Butterfly identity={cell.identity} size={CELL - 10} />,
      );
      const x = cx * CELL + 5;
      const y = ry * (CELL + LABEL) + 5;
      return `<g transform="translate(${x},${y})">${inner}</g>
        <text x="${cx * CELL + CELL / 2}" y="${y + CELL + 6}" font-size="11" font-family="sans-serif" text-anchor="middle">${cell.label}</text>`;
    }),
  )
  .join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${cells}</svg>`;

writeFileSync(
  "/tmp/butterfly-grid.png",
  new Resvg(svg, { background: "#fffbea", fitTo: { mode: "width", value: width * 2 } })
    .render()
    .asPng(),
);
console.log(`wrote /tmp/butterfly-grid.png (${rows.length} rows)`);
