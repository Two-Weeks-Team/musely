import fs from "node:fs";
import validator from "gltf-validator";
const out = [];
for (const lod of [0, 1]) {
  const p = new URL(`../region-lod${lod}.glb`, import.meta.url);
  const report = await validator.validateBytes(
    new Uint8Array(fs.readFileSync(p)),
    { uri: p.pathname.split("/").pop() },
  );
  out.push({ lod, ...report });
  console.log(lod, JSON.stringify(report.issues));
}
fs.writeFileSync(
  new URL("../validation.json", import.meta.url),
  JSON.stringify(out, null, 2),
);
