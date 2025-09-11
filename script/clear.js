import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, "../dist");

try {
  fs.rmSync(distPath, { recursive: true });
  console.log("clear success");
} catch (error) {
    
}
