import { renderToStaticMarkup } from "react-dom/server";
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";
import { Butterfly } from "../src/components/Butterfly";
import { defaultIdentity, normalizeIdentity } from "../src/lib/identity";

const cases = [
  { family: "swallowtail", wing: { edge: "angular", tail: "long", pattern: "banded", complexity: 3 } },
  { family: "peacock", wing: { edge: "scalloped", tail: "short", pattern: "eyespots", complexity: 4 } },
  { family: "monarch", wing: { edge: "smooth", tail: "none", pattern: "veined", complexity: 2 } },
];

for (const c of cases) {
  const base = defaultIdentity(`prev-${c.family}`);
  const identity = normalizeIdentity(
    { ...base, archetype: c.family, wing: { family: c.family, ...c.wing } },
    base.seed,
  );
  const svg = renderToStaticMarkup(<Butterfly identity={identity} size={240} />).replace(
    "<svg ",
    '<svg xmlns="http://www.w3.org/2000/svg" ',
  );
  writeFileSync(`/tmp/wc-${c.family}.png`, new Resvg(svg, { background: "#fffbea" }).render().asPng());
}
console.log("done");
