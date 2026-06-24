# @hasna/styles

Style management platform for AI coding agents — profiles, preferences, health checks, and design system enforcement

[![npm](https://img.shields.io/npm/v/@hasna/styles)](https://www.npmjs.com/package/@hasna/styles)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/styles
```

## CLI Usage

```bash
styles --help
```

- `styles list`
- `styles info <name>`
- `styles use <name>`
- `styles init`
- `styles profile list`
- `styles profile create`

### Compact output by default

Open Styles CLIs are compact by default, including when an agent runs them in a
non-TTY shell. List/status commands show summaries, cap rows, truncate long text,
and print a hint for the detail path.

Use gradual disclosure when you need more:

```bash
styles list --limit 5
styles list --cursor 5 --limit 5
styles list --verbose
styles info minimalist
styles list --json
```

`--json` is the explicit full machine-readable path. Detail commands such as
`styles info <name>` and `styles kits get <id>` show one record at a time.

## MCP Server

```bash
styles-mcp
```

28 tools available.

## Storage

Styles stores data locally in SQLite under the Hasna data directory by default.
Remote sync is explicit and repo-native:

```bash
export HASNA_STYLES_STORAGE_MODE=remote
export HASNA_STYLES_DATABASE_URL=postgres://...
export HASNA_STYLES_S3_BUCKET=my-style-artifacts
export HASNA_STYLES_S3_PREFIX=open-styles/prod
export HASNA_STYLES_AWS_REGION=us-east-1

styles storage status
styles storage status --verbose
styles storage status --json
styles storage push --dry-run
styles storage sync
styles storage artifacts status
```

The package does not require the legacy shared cloud package.

## Data Directory

Data is stored in `~/.hasna/styles/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
