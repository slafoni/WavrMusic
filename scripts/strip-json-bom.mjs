import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

for (const name of ['package.json', 'package-lock.json']) {
  const file = path.join(root, name);
  let contents;
  try {
    contents = await readFile(file, 'utf8');
  } catch {
    continue;
  }
  if (contents.charCodeAt(0) === 0xfeff) {
    await writeFile(file, contents.slice(1), 'utf8');
  }
}
