#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const root = new URL('.', import.meta.url).pathname;
const lockPath = join(root, 'sources-lock.json');
const repositories = [
  ['facebook/react', 'main', 'MIT', 'github-readme'],
  ['microsoft/vscode', 'main', 'MIT', 'github-readme'],
  ['nodejs/node', 'main', 'MIT', 'github-readme'],
  ['denoland/deno', 'main', 'MIT', 'github-readme'],
  ['vitejs/vite', 'main', 'MIT', 'github-readme'],
  ['kubernetes/kubernetes', 'master', 'Apache-2.0', 'github-readme'],
  ['rust-lang/rust', 'main', 'MIT OR Apache-2.0', 'github-readme'],
  ['golang/go', 'master', 'BSD-3-Clause', 'github-readme'],
  ['tokio-rs/tokio', 'master', 'MIT', 'github-readme'],
  ['pallets/flask', 'main', 'BSD-3-Clause', 'github-readme'],
  ['rust-lang/book', 'main', 'MIT OR Apache-2.0', 'doc-site'],
  ['mdn/content', 'main', 'CC-BY-SA-2.5', 'doc-site'],
  ['kubernetes/website', 'main', 'CC-BY-4.0', 'doc-site'],
];

const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'markanto-compat-audit' };
async function getJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}
async function getText(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

let locked;
try { locked = JSON.parse(await readFile(lockPath, 'utf8')); } catch { locked = null; }
await rm(join(root, 'documents'), { recursive: true, force: true });
await rm(join(root, 'LICENSES'), { recursive: true, force: true });
await mkdir(join(root, 'documents'), { recursive: true });
await mkdir(join(root, 'LICENSES'), { recursive: true });

const sources = [];
for (const [repo, branch, license, category] of repositories) {
  const prior = locked?.repositories?.find((item) => item.repo === repo);
  const sha = prior?.commit ?? (await getJson(`https://api.github.com/repos/${repo}/commits/${branch}`)).sha;
  const tree = await getJson(`https://api.github.com/repos/${repo}/git/trees/${sha}?recursive=1`);
  const markdown = tree.tree
    .filter((item) => item.type === 'blob' && /(?:^README\.md$|^(?:docs?|documentation|content|src)\/.*\.md$)/iu.test(item.path))
    .filter((item) => item.size > 200 && item.size <= 80_000)
    .sort((a, b) => (a.path === 'README.md' ? -1 : b.path === 'README.md' ? 1 : a.path.localeCompare(b.path)))
    .slice(0, category === 'doc-site' ? 16 : 10);
  for (const item of markdown) {
    const url = `https://raw.githubusercontent.com/${repo}/${sha}/${item.path}`;
    const text = await getText(url);
    const target = join(root, 'documents', category, repo.replace('/', '__'), item.path.replaceAll('/', '__'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
    sources.push({ category, repo, commit: sha, path: item.path, license, url, local: target.slice(root.length) });
  }
  const licenseNodes = tree.tree.filter((item) => item.type === 'blob' && /^(LICENSE(?:[-.][^/]*)?|COPYING)$/iu.test(item.path));
  for (const licenseNode of licenseNodes) {
	const text = await getText(`https://raw.githubusercontent.com/${repo}/${sha}/${licenseNode.path}`);
	await writeFile(join(root, 'LICENSES', `${repo.replace('/', '__')}-${basename(licenseNode.path)}`), text);
  }
}

// Deterministic, locally authored assistant-style samples. These are synthetic,
// public-domain audit fixtures rather than transcripts from a model provider.
for (let index = 1; index <= 60; index += 1) {
  const crossLine = index % 5 === 0 ? '**a deliberately hard-wrapped\nstrong phrase**' : '**a strong phrase**';
  const reference = index % 6 === 0 ? '\n[guide]: https://example.com/guide\n\nRead the [guide].\n' : '';
  const html = index % 7 === 0 ? '\n<details><summary>More</summary>Extra context.</details>\n' : '';
  const table = index % 3 === 0 ? '\n| Option | Meaning |\n| --- | --- |\n| fast | Low latency |\n' : '';
  const text = `# Assistant answer ${index}\n\nHere is ${crossLine} in a typical technical explanation.\n\n- Install the package.\n- Run \`tool check\`.\n- Review [the guide](https://example.com/guide).\n\n\`\`\`ts\nconst sample = ${index};\nconsole.log(sample);\n\`\`\`\n${table}${reference}${html}`;
  const local = `documents/llm-generated/answer-${String(index).padStart(3, '0')}.md`;
  await mkdir(dirname(join(root, local)), { recursive: true });
  await writeFile(join(root, local), text);
  sources.push({ category: 'llm-generated', generator: 'collect.mjs deterministic template', license: 'CC0-1.0', local });
}

const output = { repositories: repositories.map(([repo, branch, license, category]) => {
  const first = sources.find((item) => item.repo === repo);
  return { repo, branch, commit: first.commit, license, category };
}), documents: sources };
await writeFile(lockPath, `${JSON.stringify(output, null, 2)}\n`);
await writeFile(join(root, 'SOURCES.md'), `# Real-world corpus sources\n\nThe corpus is reproduced by \`node collect.mjs\`. GitHub material is pinned to the commits in \`sources-lock.json\`; each document records its raw URL and SPDX-style licence label. Licence texts are in \`LICENSES/\`. Synthetic assistant-style samples are deterministic CC0 fixtures authored for this audit, not model transcripts.\n\nDocuments: ${sources.length}.\n`);
console.log(`collected ${sources.length} documents`);
