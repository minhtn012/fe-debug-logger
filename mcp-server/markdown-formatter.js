// ESM wrapper — loads the shared formatter from parent directory without duplication
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(__dirname, '..', 'formatter', 'markdown-formatter.js'), 'utf8');

// Execute formatter code in function scope and capture the exported function
const fn = new Function(code + '\nreturn formatMarkdown;');
export const formatMarkdown = fn();
