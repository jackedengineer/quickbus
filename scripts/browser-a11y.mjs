import { execFileSync } from 'node:child_process';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import axe from 'axe-core';

const [page, label] = process.argv.slice(2);
if (!/^\d+$/.test(page ?? '') || !/^[a-z0-9-]{1,40}$/.test(label ?? ''))
  throw Error('Use browser-a11y.mjs <DevTools page ID> <safe-state-label>.');
const directory = 'artifacts/local/a11y';
await mkdir(directory, { recursive: true, mode: 0o700 });
const source = `${directory}/${label}-scan.js`;
const output = `${directory}/${label}.json`;
await writeFile(
  source,
  `async () => {
  ${axe.source}
  const result = await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice'] }
  });
  const summarize = (rule) => ({ id: rule.id, impact: rule.impact,
    help: rule.help, helpUrl: rule.helpUrl,
    targets: rule.nodes.map((node) => node.target) });
  return { engine: result.testEngine, at: result.timestamp,
    location: window.location.origin + window.location.pathname,
    violations: result.violations.map(summarize),
    incomplete: result.incomplete.map(summarize),
    passedRules: result.passes.length };
}`,
  { mode: 0o600 },
);
try {
  execFileSync(
    'pnpm',
    [
      '--package=chrome-devtools-mcp@1.12.0',
      'dlx',
      'chrome-devtools',
      'evaluate_script',
      '--pageId',
      page,
      '--sourcePath',
      source,
      '--filePath',
      output,
    ],
    { stdio: 'pipe', maxBuffer: 5 * 1024 * 1024 },
  );
  const report = JSON.parse(await readFile(output, 'utf8'));
  console.log(JSON.stringify({ label, ...report }));
  if (report.violations?.length) process.exitCode = 1;
} catch (error) {
  console.error(
    error instanceof SyntaxError
      ? 'Scan output was not JSON; inspect its private artifact.'
      : 'Browser scan failed; inspect the selected page and retry.',
  );
  process.exitCode = 1;
} finally {
  await unlink(source);
}
