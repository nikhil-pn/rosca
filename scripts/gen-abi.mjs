// Writes web-src/lib/abi.ts from Foundry's build output, so the app always matches the contracts.
// Run after `forge build`: node scripts/gen-abi.mjs
import { readFileSync, writeFileSync } from "node:fs";
const abi = (name) => JSON.stringify(JSON.parse(readFileSync(`out/${name}.sol/${name}.json`, "utf8")).abi);
writeFileSync(
  "web-src/lib/abi.ts",
  `// Generated from out/ by scripts/gen-abi.mjs. Do not edit.\nexport const circleAbi = ${abi("RoscaCircle")} as const;\nexport const factoryAbi = ${abi("RoscaFactory")} as const;\n`,
);
console.log("web-src/lib/abi.ts written");
