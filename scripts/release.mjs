#!/usr/bin/env node
// Cuts a release: bumps the single product version, dates the changelog,
// commits and tags. Pushing the tag triggers .github/workflows/release.yml.
//
//   node scripts/release.mjs patch|minor|major|X.Y.Z
//   git push origin main --follow-tags
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const die = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};

const arg = process.argv[2];
if (!arg) die('usage: node scripts/release.mjs patch|minor|major|X.Y.Z');

if (git('status', '--porcelain')) die('working tree is not clean; commit or stash first');
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') die('releases are cut from main');

const current = readFileSync('VERSION', 'utf8').trim();
const [ma, mi, pa] = current.split('.').map(Number);
const next =
  arg === 'major' ? `${ma + 1}.0.0`
  : arg === 'minor' ? `${ma}.${mi + 1}.0`
  : arg === 'patch' ? `${ma}.${mi}.${pa + 1}`
  : arg;
if (!/^\d+\.\d+\.\d+$/.test(next)) die(`"${next}" is not X.Y.Z`);
const n = (v) => v.split('.').map(Number).reduce((a, x) => a * 1000 + x, 0);
if (n(next) <= n(current)) die(`${next} must be greater than ${current}`);
if (git('tag', '--list', `v${next}`)) die(`tag v${next} already exists`);

const changelog = readFileSync('CHANGELOG.md', 'utf8');
// [ \t]* rather than \s*: \s would also swallow the blank line after the heading.
const heading = /^## Unreleased[ \t]*$/m;
if (!heading.test(changelog)) die('CHANGELOG.md needs an "## Unreleased" section');
const unreleased = changelog.split(heading)[1].split(/^## /m)[0].trim();
if (!unreleased) die('"## Unreleased" in CHANGELOG.md is empty — describe what changed');

const today = new Date().toISOString().slice(0, 10);
writeFileSync('CHANGELOG.md', changelog.replace(heading, `## Unreleased\n\n## ${next} — ${today}`));
writeFileSync('VERSION', `${next}\n`);
const pkgPath = 'mobile/package.json';
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

git('add', 'VERSION', 'CHANGELOG.md', pkgPath);
git('commit', '-m', `release: v${next}`);
git('tag', '-a', `v${next}`, '-m', `v${next}\n\n${unreleased}`);

console.log(`v${next} tagged. Publish with:\n  git push origin main --follow-tags`);
