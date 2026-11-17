#!/usr/bin/env node
// Pre-commit safety check: fails if git would track secrets, env files, dumps or obvious credentials.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

const forbiddenNames = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$)/,
  /\.(dump|backup|bak|sqlite3?|db|pem|key|p12|pfx)$/i,
];
const contentRules = [
  {
    name: 'PostgreSQL URL with inline password',
    re: /postgres(?:ql)?:\/\/[^:\s/]+:(?!YOUR_|REPLACE_|\$\{|\*|p@)[^@\s]{3,}@/,
  },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: '64-hex secret assignment', re: /SECRET\s*=\s*[0-9a-f]{64}\b/i },
];
// Test fixtures use obviously fake URLs such as postgresql://u:p@...
const allowContent = new Set(['scripts/check-secrets.mjs']);

const problems = [];
for (const file of files) {
  if (forbiddenNames.some((re) => re.test(file)))
    problems.push(`${file}: file type must not be committed`);
  if (allowContent.has(file) || /\.(png|jpe?g|gif|ico|woff2?)$/i.test(file)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const rule of contentRules)
    if (rule.re.test(text)) problems.push(`${file}: looks like a ${rule.name}`);
}
if (problems.length) {
  console.error('✖ Possible secrets found:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(
  `✔ No secrets detected in ${files.length} tracked/untracked files (gitignored files excluded).`,
);
