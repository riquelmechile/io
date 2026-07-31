# IO — Pasos siguientes

> **Estado verificado 2026-07-31:** baseline limpia en `main` = **`4ea1653`**.  
> Local = GitHub. Working tree limpio. `pnpm check` GREEN · **411 passed / 20 skipped**.  
> **Orden:** deepseek cerrado → harden limpio → vertical.  
> **Regla:** SDD + TDD + review honesto. Sin hacks de gate.

---

## Baseline estable (verificada)

| Check | Resultado |
|-------|-----------|
| Commit | `4ea1653` — archive deepseek-client |
| GitHub `main` | = local = `4ea1653` |
| `pnpm check` | GREEN (format, tsc, build, lint, test) |
| Tests | 411 passed / 20 skipped |
| Packages | `trust-kernel`, `database`, `business-domain`, `llm-client` |
| Sin restos harden | use-cases, validation, 003 sql, idempotency-adapter, runtime-validation: **ausentes** |
| DeepSeek archive | verify **PASS** 7/7 · 12/12 · blockers 0 |
| DeepSeek aislamiento | cero imports `@io/*`; `openai` solo en `deepseek-client.ts`; boundary 23/23 |

### Backup del trabajo contaminado (no es main)

| Branch | Contenido |
|--------|-----------|
| `backup/pre-reset-harden-4c353fa` | commits harden en código (`d56123b` + `4c353fa`) |
| `backup/harden-wip-reference` | eso + docs/planning/archive falso del harden (solo referencia) |

---

## Paso 0 — `deepseek-client` ✅ CERRADO Y ESTABLE

- [x] Apply (port, adapter, fake, tests)
- [x] Verify PASS en archive
- [x] Archive en main/GH
- [x] Sin worker / sin lógica de empresa en el package

**No reabrir** salvo bug real del adapter.

---

## Paso 1 — `harden-first-enterprise-vertical-foundation` 🔄 SIGUIENTE (ciclo limpio)

**Objetivo:** base durable para la vertical. Sin Memory OS, minions, ni DeepSeek como dep de producto.

### 1.1 Autoridad

- [ ] SoD real: `proposer ≠ approver`, `executor ≠ verifier` (también riesgo bajo)
- [ ] `isWindowActive(start, now, expiry)` grants / roles temporales / delegaciones
- [ ] Inicio futuro → no activo
- [ ] Pasos no-op del kernel: no `ALLOW` silencioso
- [ ] Tests RED → GREEN

### 1.2 Company scope

- [ ] `companyId` obligatorio en operaciones
- [ ] Repos/casos de uso rechazan scope incorrecto
- [ ] Company mínima (`companyId` + `purpose`)

### 1.3 Persistencia durable

- [ ] `UNIQUE` en IDs de negocio
- [ ] Preferible `UNIQUE (work_id, terminal_event_id)` en receipts
- [ ] `DbConnection.transaction(fn)` (PG + fake)
- [ ] `evidenceId` estable
- [ ] Casos de uso: propose / accept / start / complete / verify / reject
- [ ] `save` no es el camino de cambio de estado de Work

### 1.4 Concurrency

- [ ] Claim con versión o lease/CAS
- [ ] Conflicto explícito
- [ ] Un solo escritor gana

### 1.5 Idempotencia pre-efecto

- [ ] Intento + key **antes** del efecto
- [ ] Misma key + mismo hash → replay
- [ ] Key + hash distinto → DENY
- [ ] Cierre terminal en una tx

### 1.6 Validación runtime

- [ ] Guards: comando, filas PG, plan LLM
- [ ] Rechazo explícito
- [ ] No solo TypeScript

### 1.7 Higiene

- [ ] README / workspace al día
- [ ] CI Postgres; integración no skipeada en silencio en CI

**Proceso obligatorio:**

```text
explore → propose → design → spec → tasks
  → apply (cada escenario delta = RED→GREEN antes de done)
  → review (working tree sin commit; lentes reales; sin findings vacíos inventados)
  → commit con receipt del candidate
  → verify (confirma; no descubre features)
  → archive → push
```

**Listo cuando:** flujo terminal atómico (fakes OK) + SoD + scope + sin receipts duplicados + reintento seguro + ciclo SDD verde sin hacks.

Referencia opcional (no copiar ciego): branch `backup/harden-wip-reference` (design/spec previos).

---

## Paso 2 — `first-enterprise-vertical`

**Solo con Paso 1 archivado limpio.**

Dependencias: domain-foundation ✓ · deepseek-client ✓ · harden limpio ✓

- [ ] Worker (claim → autoridad → intento → efecto fuera tx → reconciliar → verify → tx terminal)
- [ ] SandboxPort reversible
- [ ] E2E: LLM fake + PG real
- [ ] Tests: reinicio, reintento, receipt único, revocación, fallo post-efecto, verifier ≠ executor

Fuera de alcance: Memory OS, minions, skills, learning, CEO, receipts crypto.

---

## Paso 3 — Después de vertical verde

Context compiler → DeepSeek live E2E → BusinessEvent → un skill → heartbeats → roadmap.

---

## Resumen

```text
main @ 4ea1653  ← AQUÍ ESTAMOS (verificado)
  ├─ domain-foundation (código + specs)
  └─ deepseek-client (código + archive PASS)

siguiente
  └─ harden-first-enterprise-vertical-foundation (SDD limpio)

después
  └─ first-enterprise-vertical
```

## Regla de oro

No abrir la vertical sin harden limpio.  
DeepSeek se conserva. Harden se rehace.  
**Apply termina escenarios; verify solo confirma; review no se fabrica.**
