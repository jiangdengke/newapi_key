import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

const staticSourcePath = resolve(".next/static");
const staticTargetPath = resolve(".next/standalone/.next/static");

rmSync(staticTargetPath, { recursive: true, force: true });
mkdirSync(dirname(staticTargetPath), { recursive: true });
cpSync(staticSourcePath, staticTargetPath, { recursive: true });
