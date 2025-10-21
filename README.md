# GitHub Stargazer Scraper

CLI for exporting the newest stargazers on a GitHub repository with enriched contact details. It gathers each stargazer's name, best-effort email, LinkedIn profile, and X/Twitter account, then stores the results in a CSV file.

## Installation

Run the following `npx` command. It will create a CSV file in the current directory.

```bash
# Run without installing
npx @matteo8p/stargazer --gh_token <token> @repo_owner/repo_name

# or install globally
npm install -g @matteo8p/stargazer
stargazer --gh_token <token> owner/repo
```

## Authentication

To avoid GitHub's anonymous rate limits (60 requests/hour), provide a personal access token created at https://github.com/settings/tokens:

- Pass it with `--gh_token <token>`
- Or export `GH_TOKEN`/`GITHUB_TOKEN` before running the CLI.

Tokens need `public_repo` scope for public repositories; more scopes are only required for private repos.

### Create a GitHub Token

1. Sign in to your GitHub account and open https://github.com/settings/tokens.
2. Under **Fine-grained tokens**, click **Generate new token** (for better security) or use the **classic** tab if you prefer traditional tokens.
3. Give the token a descriptive name such as "stargazer CLI" and set an expiration date—GitHub recommends 30–90 days.
4. Select the owner (your user or an organization) that has access to the repositories you plan to inspect.
5. In the **Repository access** section, choose **All repositories** or the specific repos you need.
6. For scopes/permissions, enable **Repository → Metadata** (default) and **Repository → Contents: Read**; for classic tokens, select at least the `public_repo` scope.
7. Click **Generate token**, then copy the token immediately—GitHub shows it only once.

## Usage

```bash
npx @matteo8p/stargazer [options] owner/repo
```

### Options

| Flag | Description |
| --- | --- |
| `--gh_token <token>` | GitHub personal access token (fall back to `GH_TOKEN`/`GITHUB_TOKEN`). |
| `-o, --output <file>` | CSV destination (default: `stargazers.csv`). |
| `--delay <ms>` | Delay between user lookups in milliseconds (default: `500`). |
| `--max <count>` | Maximum number of newest stargazers to process. |

### Examples

```bash
# Export the 50 most recent stargazers to a custom file
npx @matteo8p/stargazer --gh_token $GH_TOKEN --max 50 --output data/latest.csv matteo8p/some-repo

# Run with default CSV output and no hard limit (process all stargazers)
npx @matteo8p/stargazer --gh_token $GH_TOKEN matteo8p/another-repo

# Try it without a token (subject to strict rate limits)
npx @matteo8p/stargazer modelcontextprotocol/inspector
```

The CLI streams results to CSV while printing colorful progress logs showing GitHub pagination, per-user enrichment, and summary counts once complete.

## Output Format

The generated CSV contains these columns:

```
username,name,email,linkedin,x
```

Emails are inferred from profiles or recent push events (excluding `@users.noreply.github.com`). LinkedIn and X values are detected from profile links/usernames when available.

## Development

```bash
# Install dependencies
npm install

# Live-run the TypeScript source
npm run dev -- matteo8p/your-repo

# Compile to dist/
npm run build

# Execute the compiled CLI locally
npm run start -- --gh_token $GH_TOKEN matteo8p/your-repo
```

## Rate Limits & Etiquette

- Even with a token, GitHub enforces request caps; the CLI respects delays between profile lookups.
- Consider increasing `--delay` if you encounter secondary rate limiting.
- Avoid distributing email addresses without consent.

## License

ISC
