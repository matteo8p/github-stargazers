#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import fetch, { Response } from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import pc from 'picocolors';

interface CLIOptions {
  gh_token?: string;
  output: string;
  delay: number;
  max?: number;
}

interface StargazerUser {
  login: string;
}

interface UserContact {
  username: string;
  name: string | null;
  email: string | null;
  linkedin: string | null;
  x: string | null;
}

interface GitHubUser {
  login: string;
  name: string | null;
  email: string | null;
  blog: string | null;
  bio: string | null;
  twitter_username: string | null;
}

interface GitHubEventCommitAuthor {
  email?: string | null;
}

interface GitHubEventCommit {
  author?: GitHubEventCommitAuthor | null;
}

interface GitHubEventPayload {
  commits?: GitHubEventCommit[] | null;
}

interface GitHubEvent {
  type?: string | null;
  payload?: GitHubEventPayload | null;
}

const DEFAULT_DELAY_MS = 500;
const DEFAULT_OUTPUT = 'stargazers.csv';
const MAX_PER_PAGE = 100;

const glyphs = {
  banner: '✨',
  info: 'ℹ️',
  success: '✅',
  warn: '⚠️',
  fetch: '📡',
  reorder: '🧭',
  write: '💾',
  progress: '🔎',
};

const program = new Command();

function logDivider(): void {
  console.log(pc.dim('────────────────────────────────────────────'));
}

function logSection(title: string): void {
  logDivider();
  console.log(pc.bold(pc.magenta(`${glyphs.banner} ${title}`)));
  logDivider();
}

function logInfo(message: string): void {
  console.log(pc.cyan(`${glyphs.info} ${message}`));
}

function logSuccess(message: string): void {
  console.log(pc.green(`${glyphs.success} ${message}`));
}

function logWarning(message: string): void {
  console.log(pc.yellow(`${glyphs.warn} ${message}`));
}

function logAction(message: string): void {
  console.log(pc.blue(`${glyphs.fetch} ${message}`));
}

function logReorder(message: string): void {
  console.log(pc.magenta(`${glyphs.reorder} ${message}`));
}

function logWrite(message: string): void {
  console.log(pc.bold(pc.blue(`${glyphs.write} ${message}`)));
}

program
  .name('@matteo8p/stargazer')
  .description('Fetch GitHub stargazers and attempt to enrich contact information.')
  .argument('<repo>', 'GitHub repository in owner/repo format (optionally prefixed with @)')
  .option('--gh_token <token>', 'GitHub personal access token (uses GH_TOKEN/GITHUB_TOKEN env vars if omitted)')
  .option('-o, --output <file>', `CSV output path (default: ${DEFAULT_OUTPUT})`, DEFAULT_OUTPUT)
  .option('--delay <ms>', 'Delay between user lookups in milliseconds', parseDelay, DEFAULT_DELAY_MS)
  .option('--max <count>', 'Maximum number of stargazers to process', parseMax)
  .action(async (repoArg: string, options: CLIOptions) => {
    try {
      await main(repoArg, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\nError: ${message}`);
      process.exitCode = 1;
    }
  })
  .showHelpAfterError('(use --help for usage information)');

program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});

export async function main(repoArgument: string, options: CLIOptions): Promise<void> {
  const { owner, repo } = parseRepo(repoArgument);
  const token = resolveToken(options.gh_token);
  const headers = buildHeaders(token);

  logSection('GitHub Stargazer Harvest');
  logInfo(`Repository ${pc.bold(`${owner}/${repo}`)}`);
  if (options.max) {
    logInfo(`Limiting to the first ${pc.bold(String(options.max))} newest stargazers`);
  }
  logAction('Collecting stargazer list from GitHub...');
  const stargazers = await collectStargazers(owner, repo, headers, options.max);
  if (!stargazers.length) {
    logWarning('No stargazers found for this repository.');
    return;
  }

  logSuccess(`Captured ${pc.bold(String(stargazers.length))} stargazer${stargazers.length === 1 ? '' : 's'}.`);
  const outputPath = path.resolve(options.output || DEFAULT_OUTPUT);
  ensureDirectory(path.dirname(outputPath));
  const stream = fs.createWriteStream(outputPath, { encoding: 'utf8' });
  logWrite(`Streaming CSV results to ${pc.bold(outputPath)}`);
  stream.write('username,name,email,linkedin,x\n');

  let processed = 0;
  let emailsFound = 0;

  logAction('Enriching user profiles...');
  for (const login of stargazers) {
    const contact = await enrichUser(login, headers, options.delay);
    if (contact.email) {
      emailsFound += 1;
    }
    processed += 1;
    stream.write(formatCsvRow(contact));
    logProgress(contact, processed, stargazers.length);
    await sleep(options.delay);
  }

  process.stdout.write('\n');
  await finalizeStream(stream);
  logDivider();
  logSuccess(`Saved results to ${pc.bold(outputPath)}`);
  logInfo(`Total users processed: ${pc.bold(String(processed))}`);
  logInfo(`Emails found: ${pc.green(pc.bold(String(emailsFound)))}`);
  logInfo(`No email: ${pc.dim(String(processed - emailsFound))}`);
}

function parseDelay(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError('Delay must be a non-negative integer');
  }
  return parsed;
}

function parseMax(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('Max must be a positive integer');
  }
  return parsed;
}

function parseRepo(input: string): { owner: string; repo: string } {
  const trimmed = input.trim().replace(/^@+/, '');
  const [owner, repo] = trimmed.split('/');
  if (!owner || !repo) {
    throw new Error('Repository must be provided as owner/repo');
  }
  return { owner, repo };
}

function resolveToken(optionToken?: string): string | null {
  return optionToken || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;
}

function buildHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3.star+json',
    'User-Agent': '@matteo8p/stargazer-cli',
  };
  if (token) {
    headers.Authorization = `token ${token}`;
  } else {
    logWarning('Running without a GitHub token. Requests are limited to 60 per hour.');
  }
  return headers;
}

async function collectStargazers(
  owner: string,
  repo: string,
  headers: Record<string, string>,
  max?: number,
): Promise<string[]> {
  const pages: string[][] = [];
  let page = 1;
  while (true) {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/stargazers`);
    url.searchParams.set('per_page', String(MAX_PER_PAGE));
    url.searchParams.set('page', String(page));
    logAction(`Requesting page ${pc.bold(String(page))} of stargazers...`);
    const response = await fetch(url.toString(), { headers });
    await assertOk(response, 'fetch stargazers');
    const pageData: Array<{ user?: StargazerUser; login?: string }> = await response.json();
    if (!pageData.length) {
      logInfo(`Page ${pc.bold(String(page))} returned no data; assuming end of list.`);
      break;
    }
    const pageLogins: string[] = [];
    for (const entry of pageData) {
      const login = entry.user?.login || entry.login;
      if (login) {
        pageLogins.push(login);
      }
    }
    pages.push(pageLogins);
    logSuccess(`Collected ${pc.bold(String(pageLogins.length))} stargazer${pageLogins.length === 1 ? '' : 's'} from page ${pc.bold(String(page))}.`);
    page += 1;
    await sleep(200);
  }
  const results: string[] = [];
  const totalFetched = pages.reduce((count, pageLogins) => count + pageLogins.length, 0);
  logReorder(`Reordering ${pc.bold(String(totalFetched))} stargazer${totalFetched === 1 ? '' : 's'} from newest to oldest...`);
  for (let i = pages.length - 1; i >= 0; i -= 1) {
    const pageLogins = pages[i];
    for (let j = pageLogins.length - 1; j >= 0; j -= 1) {
      results.push(pageLogins[j]);
      if (max && results.length >= max) {
        logInfo(`Reached requested maximum of ${pc.bold(String(max))} stargazers.`);
        return results;
      }
    }
  }
  return results;
}

async function enrichUser(
  username: string,
  headers: Record<string, string>,
  delay: number,
): Promise<UserContact> {
  const baseInfo = await fetchUser(username, headers);
  const linkedIn = extractLinkedIn(baseInfo.blog, baseInfo.bio);
  const twitter = extractTwitter(baseInfo.twitter_username, baseInfo.blog, baseInfo.bio);
  let email = normalizeEmail(baseInfo.email);
  if (!email) {
    await sleep(delay);
    email = await findEmailInEvents(username, headers);
  }

  return {
    username,
    name: baseInfo.name || null,
    email,
    linkedin: linkedIn,
    x: twitter,
  };
}

async function fetchUser(username: string, headers: Record<string, string>): Promise<GitHubUser> {
  const response = await fetch(`https://api.github.com/users/${username}`, { headers });
  await assertOk(response, `fetch profile for ${username}`);
  return response.json();
}

async function findEmailInEvents(username: string, headers: Record<string, string>): Promise<string | null> {
  const url = new URL(`https://api.github.com/users/${username}/events/public`);
  url.searchParams.set('per_page', '100');
  const response = await fetch(url.toString(), { headers });
  if (response.status === 404) {
    return null;
  }
  await assertOk(response, `fetch events for ${username}`);
  const events: GitHubEvent[] = await response.json();
  for (const event of events) {
    if (event.type !== 'PushEvent') {
      continue;
    }
    const commits = event.payload?.commits || [];
    for (const commit of commits) {
      const email = normalizeEmail(commit.author?.email || null);
      if (email) {
        return email;
      }
    }
  }
  return null;
}

function extractLinkedIn(...candidates: Array<string | null>): string | null {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const match = candidate.match(/https?:\/\/([\w.-]*linkedin\.com\/[\w\-/]+)(?:\b|$)/i);
    if (match) {
      const url = match[0];
      return sanitizeUrl(url);
    }
  }
  return null;
}

function extractTwitter(
  handle?: string | null,
  ...candidates: Array<string | null>
): string | null {
  if (handle) {
    return handle.startsWith('http') ? handle : `https://twitter.com/${handle}`;
  }
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const match = candidate.match(/https?:\/\/([\w.-]*twitter\.com\/[\w\-/]+)(?:\b|$)/i);
    if (match) {
      const url = match[0];
      return sanitizeUrl(url);
    }
  }
  return null;
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    return url;
  }
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) {
    return null;
  }
  const trimmed = email.trim();
  if (!trimmed || trimmed.endsWith('@users.noreply.github.com')) {
    return null;
  }
  return trimmed;
}

function formatCsvRow(contact: UserContact): string {
  const cells = [contact.username, contact.name, contact.email, contact.linkedin, contact.x];
  return `${cells.map(csvEscape).join(',')}\n`;
}

function csvEscape(value: string | null): string {
  if (value === null || value === undefined) {
    return '';
  }
  const needsQuotes = /[",\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function sleep(ms: number): Promise<void> {
  if (!ms) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDirectory(directory: string): void {
  if (!directory || directory === '.') {
    return;
  }
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function logProgress(contact: UserContact, index: number, total: number): void {
  const status = contact.email ? pc.green('✓') : pc.dim('·');
  const detail = contact.email ? pc.green(contact.email) : pc.dim('email not found');
  const label = `${glyphs.progress} ${status} [${index}/${total}] ${pc.bold(contact.username)}: ${detail}`;
  const paddedLabel = label.padEnd(90, ' ');
  process.stdout.write(`\r${paddedLabel}`);
}

async function finalizeStream(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.on('finish', resolve);
    stream.end();
  });
}

async function assertOk(response: Response, context: string): Promise<void> {
  if (response.ok) {
    return;
  }
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = response.headers.get('x-ratelimit-reset');
    const resetDate = reset ? new Date(Number.parseInt(reset, 10) * 1000) : null;
    const resetInfo = resetDate ? ` Rate limit resets at ${resetDate.toISOString()}.` : '';
    throw new Error(`GitHub API rate limit exceeded while attempting to ${context}.${resetInfo}`);
  }
  const body = await response.text();
  throw new Error(`GitHub API request failed (${response.status} ${response.statusText}) while attempting to ${context}. ${body}`);
}

export type { CLIOptions, UserContact };
