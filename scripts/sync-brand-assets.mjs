import { copyFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  join(root, "brand", "trackvault-logo.png"),
  join(root, "brand", "trackvault-logo.svg"),
];

const source = candidates.find((path) => existsSync(path));
if (!source) {
  console.error(
    "Missing brand asset. Add brand/trackvault-logo.png or brand/trackvault-logo.svg.",
  );
  process.exit(1);
}

const ext = source.endsWith(".svg") ? ".svg" : ".png";
const publicDir = join(root, "public");
const assetsDir = join(root, "src", "assets");
mkdirSync(publicDir, { recursive: true });
mkdirSync(assetsDir, { recursive: true });

copyFileSync(source, join(publicDir, `favicon${ext}`));
copyFileSync(source, join(assetsDir, `trackvault-logo${ext}`));
console.log(`Synced ${source} → public/favicon${ext}, src/assets/trackvault-logo${ext}`);
