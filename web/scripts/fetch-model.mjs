// Runs before `npm run build`: puts the detector model in public/onnx so it is served from the site itself.
// Vercel builds from git and the model is not in git (54 MB), so it comes from the GitHub release, checksum-checked.
// A local build keeps whatever is already there (your own export, see ml/export_onnx.py).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const FILE = new URL('../public/onnx/detector-fp16.onnx', import.meta.url);
const SOURCE = 'https://github.com/Ekagraj/Inspecto/releases/download/model-v1/detector-fp16.onnx';
const SHA256 = '06f91c998660b6495c4ff136c096db25c3ee1e2730d25744c0ec5fd7b5af7f64';

if (existsSync(FILE)) process.exit(0);
const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`Model download failed: HTTP ${res.status} from ${SOURCE}`);
const bytes = Buffer.from(await res.arrayBuffer());
const sha = createHash('sha256').update(bytes).digest('hex');
if (sha !== SHA256) throw new Error(`Model checksum mismatch: got ${sha}, expected ${SHA256}`);
mkdirSync(new URL('.', FILE), { recursive: true });
writeFileSync(FILE, bytes);
console.log(`detector-fp16.onnx: ${(bytes.length / 1e6).toFixed(1)} MB from the GitHub release, checksum OK`);
