// Builds the Tauri updater manifest (latest.json) for a release.
//
// Usage:  node scripts/make-latest-json.mjs <version> [bundleDir]
// Example: node scripts/make-latest-json.mjs 1.1.2
//
// Reads the NSIS bundle's .exe + .sig produced by `npm run tauri build`
// (with createUpdaterArtifacts enabled) and writes latest.json next to them.
// Upload latest.json together with the .exe and .exe.sig to a GitHub release
// — the app's updater fetches it from releases/latest/download/latest.json.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/make-latest-json.mjs <version> [bundleDir]");
  process.exit(1);
}
const dir = process.argv[3] ?? "src-tauri/target/release/bundle/nsis";
const exe = `Scratch_${version}_x64-setup.exe`;
const sigPath = join(dir, `${exe}.sig`);

let signature;
try {
  signature = readFileSync(sigPath, "utf8").trim();
} catch {
  console.error(`Missing signature file: ${sigPath}`);
  console.error("Build with the signing key set (TAURI_SIGNING_PRIVATE_KEY).");
  process.exit(1);
}

const manifest = {
  version,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/NghiaNguyenTT/scratch/releases/download/v${version}/${exe}`,
    },
  },
};

const out = join(dir, "latest.json");
writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${out}`);
console.log(`Upload to the v${version} release: ${exe}, ${exe}.sig, latest.json`);
