# Daemon Operation

Operational notes for the daemon entrypoint (`packages/app/src/daemon/main.ts`,
started via the `start` script in `packages/app/package.json`).

## Running

From the repo root:

```sh
pnpm --filter @io/app start
```

The start script boots Node 24's native TypeScript support
(`--experimental-transform-types`) with a zero-dependency module-resolution
hook (`packages/app/src/daemon/ts-launcher/`): relative `.js` imports resolve
to sibling `.ts` sources and `@io/<pkg>/...` specifiers resolve to
`packages/<pkg>` source, because the workspace packages expose no `exports`
map. No transpiler, no bundler, no additional runtime dependencies.

Required environment: `DATABASE_URL`, `DEEPSEEK_API_KEY`, `IO_SANDBOX_ROOT`,
`IO_INTERVAL_MS` (finite, greater than 0), and the four principals
`IO_PROPOSER`, `IO_APPROVER`, `IO_EXECUTOR`, `IO_VERIFIER`. Invalid
configuration fails fast and names the offending setting (exit code 1).

## External Supervision

The daemon does NOT restart itself — it is a single long-lived worker process
that must be supervised externally (systemd `Restart=on-failure`, a Docker
`restart:` policy, etc.):

```ini
# /etc/systemd/system/io-daemon.service
[Unit]
Description=IO daemon
After=network-online.target

[Service]
WorkingDirectory=/srv/io/packages/app
ExecStart=/usr/bin/node --experimental-transform-types --import ./src/daemon/ts-launcher/register.mjs ./src/daemon/main.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Termination: the first `SIGTERM`/`SIGINT` triggers graceful shutdown (stop
scheduling → drain in-flight work → close the database pool → close the LLM
client → exit 0); a second termination signal forces immediate exit 1.

## Migrations

Migrations 001–009 are an OPERATOR prerequisite: apply them to the target
database BEFORE the first boot. The daemon NEVER auto-migrates — schema
management stays exclusively with the operator.
