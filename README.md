# Easy DB Manager (VS Code Extension)

A secure, multi-engine database manager for VS Code with variables, schema explorer, CRUD and query runner. Supports Postgres and MySQL via native Node drivers.

## Features

- Connections stored securely: secrets in SecretStorage; non-secrets in state/config
- Variables with scopes (user/workspace/connection) and interpolation
- Schema explorer: databases, schemas, tables
- CRUD webview: paginate, insert, edit, delete
- Query runner: large SQL area, Run/Stop, streaming results, Save
- Multi-engine adapter interface with Postgres and MySQL implementations

## Security

- Strict CSP in all webviews, nonce-based, no inline scripts
- User input sanitized in webviews; secrets never logged or exposed
- Passwords stored only in VS Code SecretStorage

## Getting Started

1. Install dependencies

```bash
npm install
```

2. Build

```bash
npm run build
```

3. Launch Extension host (F5) from VS Code.

4. Commands (Cmd+Shift+P)
- DB: Add Connection
- DB: Connect / Disconnect
- DB: Open CRUD for Table
- DB: New Query
- DB: Manage Variables

## Adapters

Adapters implement `DbClient` in `src/adapters/types.ts`. See `postgres.ts` and `mysql.ts` for reference.

## Packaging

```bash
npm run package
```

## Tests

- Unit tests for adapters (TBD)
- Integration tests via Docker (TBD)
- UI smoke tests with `@vscode/test-electron` (TBD)

## License

MIT
# easy-db
