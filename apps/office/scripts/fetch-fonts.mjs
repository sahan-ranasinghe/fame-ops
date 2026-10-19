// The office site's fonts, served from the site itself (Sahan, 19 October 2026): no page waits on fonts.googleapis.com and
// no browser contacts Google for fonts. Run once when the fonts change; the output is committed:
//
//   node scripts/fetch-fonts.mjs        (from apps/office)
//
// It asks Google Fonts for the same families and weights the site used before (plus the Sinhala fonts of the design), keeps
// the Latin subsets (latin, latin-ext) of the Latin fonts and the Sinhala subset of the Sinhala fonts, saves each woff2 in
// public/fonts/ and writes public/fonts/fonts.css (font-display: swap, the unicode-range of each subset), with each family's
// licence (all SIL Open Font License 1.1) beside them.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../public/fonts/", import.meta.url));
// A browser that gets woff2 with unicode-range subsets.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const LATIN = ["latin", "latin-ext"];
const FAMILIES = [
  { family: "Archivo", weights: [700, 800], subsets: LATIN, ofl: "archivo" },
  { family: "IBM Plex Mono", weights: [500, 600], subsets: LATIN, ofl: "ibmplexmono" },
  { family: "IBM Plex Sans", weights: [400, 500, 600, 700], subsets: LATIN, ofl: "ibmplexsans" },
  { family: "Yaldevi", weights: [400, 500, 600, 700], subsets: ["sinhala"], ofl: "yaldevi" },
  { family: "Gemunu Libre", weights: [700, 800], subsets: ["sinhala"], ofl: "gemunulibre" },
];

const slug = (s) => s.toLowerCase().replace(/\s+/g, "-");

async function get(url, as = "text") {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return as === "bytes" ? Buffer.from(await res.arrayBuffer()) : res.text();
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const faces = [];
const files = new Map(); // a woff2's URL → its file name (a variable font serves several weights from one file)
let bytes = 0;
for (const f of FAMILIES) {
  const css = await get(`https://fonts.googleapis.com/css2?family=${f.family.replace(/ /g, "+")}:wght@${f.weights.join(";")}&display=swap`);
  for (const [, subset, body] of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    if (!f.subsets.includes(subset)) continue;
    const weight = body.match(/font-weight:\s*(\d+)/)[1];
    const url = body.match(/url\((https:[^)]+\.woff2)\)/)[1];
    const range = body.match(/unicode-range:\s*([^;]+);/)[1].trim();
    if (!files.has(url)) {
      const name = `${slug(f.family)}-${weight}-${subset}.woff2`;
      const data = await get(url, "bytes");
      await writeFile(OUT + name, data);
      files.set(url, name);
      bytes += data.length;
    }
    faces.push(
      `/* ${f.family} ${weight}, ${subset} */\n@font-face {\n  font-family: "${f.family}";\n  font-style: normal;\n  font-weight: ${weight};\n` +
        `  font-display: swap;\n  src: url(/fonts/${files.get(url)}) format("woff2");\n  unicode-range: ${range};\n}`,
    );
  }
  await writeFile(OUT + `OFL-${slug(f.family)}.txt`, await get(`https://raw.githubusercontent.com/google/fonts/main/ofl/${f.ofl}/OFL.txt`));
}
const head = "/* The office site's fonts, served by the site (scripts/fetch-fonts.mjs; SIL Open Font License 1.1: OFL-*.txt). */\n";
await writeFile(OUT + "fonts.css", head + faces.join("\n") + "\n");
console.log(`${files.size} files, ${(bytes / 1024).toFixed(0)} KB, ${faces.length} faces → public/fonts/`);
