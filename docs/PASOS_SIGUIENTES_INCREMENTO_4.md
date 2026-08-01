# IO — Pasos siguientes

> **Documento vivo con trazabilidad.** Cada cambio de estado queda registrado en el
> **Registro de revisiones** con su motivo. La historia no se borra: se marca como
> *superada* y se conserva para poder auditar de dónde venimos y por qué.
>
> **Regla:** SDD + TDD + review honesto. Sin hacks de gate.

---

## Registro de revisiones

> Qué cambió en este documento y **por qué** cambió. Leer de arriba (vigente) hacia abajo (historia).

| Rev | Fecha | `main` | Qué cambió en este doc | Por qué cambió |
|-----|-------|--------|------------------------|----------------|
| **2** (vigente) | 2026-07-31 | `4cc0b15` | Paso 1 `harden` pasa de "🔄 SIGUIENTE" a **"✅ CERRADO"** (verificado + archivado + pusheado). Paso 2 `first-enterprise-vertical` pasa a **🔄 SIGUIENTE**. Conteo de tests actualizado **411 → 604**. Se agrega evidencia de verify por slice y el snapshot de Rev 1 se conserva marcado como superado. | El ciclo limpio `harden-first-enterprise-vertical-foundation` se completó: **18/18 requisitos, 61/61 escenarios, 0 blockers, 0 critical**, review adversarial CLEAN en cada slice (A/B/C). Se cumplió la *regla de oro* (no abrir la vertical sin harden limpio) → la vertical queda desbloqueada. |
| **1** (superada) | 2026-07-31 | `4ea1653` | Versión inicial. Baseline `deepseek-client` cerrada; `harden` como Paso 1 pendiente; `first-enterprise-vertical` como Paso 2. | Reset a una baseline limpia tras el ciclo harden **contaminado** (hacks de gate: findings vacíos inyectados y gap-fixes post-verify). Se documentó el punto de partida estable para rehacer el harden en limpio. |

**Estado actual (Rev 2):** `main @ 4cc0b15` = `origin/main`. Working tree limpio. Siguiente: `first-enterprise-vertical`.

---

## Estado actual (Rev 2 — vigente)

| Check | Resultado |
|-------|-----------|
| Commit | `4cc0b15` — archive `harden-first-enterprise-vertical-foundation` |
| GitHub `main` | = local = `4cc0b15` |
| `pnpm check` | GREEN (format, tsc, build, lint, test) |
| Tests | **604 passed / 3 skipped** (2 DeepSeek sin `DEEPSEEK_API_KEY` + 1 CI guard local) |
| PG 18.4 integración | **38/38 corrieron** (no skipeados) contra PostgreSQL vivo |
| Verify harden | `pass_with_warnings` · **18/18 req** · **61/61 escenarios** · 0 blockers · 0 critical |
| Review adversarial | CLEAN por slice (A/B/C) — sin BLOCKER/CRITICAL |
| Specs synced | 7 (6 MODIFIED + NEW `runtime-validation`) en `openspec/specs/` |
| Archive | `openspec/changes/archive/2026-07-31-harden-first-enterprise-vertical-foundation/` |

### Evolución del conteo de tests (durante Rev 2)

| Momento | Tests | Delta / motivo |
|---------|-------|----------------|
| Baseline (Rev 1, `4ea1653`) | 411 passed / 20 skipped | Punto de partida estable |
| Slice A (autoridad + scope) | 455 passed / 20 skipped | +44 (SoD, `isWindowActive`, DEFERRED, companyId) |
| Slice A coherence fix | 473 passed / 2 skipped | Migración `003` → PG integración empieza a correr |
| Slice B (persistencia + concurrencia) | 525 passed / 2 skipped | +52 (transaction, CAS, UNIQUE, live-PG) |
| Slice C (use-cases + idempotencia + validación) | 603 passed / 3 skipped | +78 (transiciones, replay/DENY, guards, CI guard) |
| Final (fix `proposeWork`) | **604 passed / 3 skipped** | +1 (empty companyId → `invalid-command`) |

---

## Snapshot histórico (Rev 1 — superada, se conserva para trazabilidad)

> ⚠️ **Este bloque refleja el estado a `4ea1653` y YA NO es el punto de partida vigente.**
> Se conserva para auditar el origen del ciclo limpio. El estado vigente está arriba.

| Check | Resultado (a `4ea1653`) |
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

## Paso 0 — `deepseek-client` ✅ CERRADO Y ESTABLE (sin cambios entre Rev 1 y Rev 2)

- [x] Apply (port, adapter, fake, tests)
- [x] Verify PASS en archive
- [x] Archive en main/GH
- [x] Sin worker / sin lógica de empresa en el package

**No reabrir** salvo bug real del adapter.

---

## Paso 1 — `harden-first-enterprise-vertical-foundation` ✅ CERRADO EN REV 2

> **Transición:** Rev 1 "🔄 SIGUIENTE" → Rev 2 "✅ CERRADO".
> **Por qué:** ciclo limpio completado, verificado y archivado en `4cc0b15`.
> **Por qué se rehízo:** el ciclo anterior se contaminó con hacks de gate (findings vacíos
> inyectados vía capture-result y gap-fixes post-verify). Se reseteó a `4ea1653` y se
> reconstruyó en limpio con review honesto por slice.

**Objetivo (cumplido):** base durable para la vertical. Sin Memory OS, minions, ni DeepSeek como dep de producto.

### 1.1 Autoridad ✅

- [x] SoD real: `proposer ≠ approver`, `executor ≠ verifier` (también riesgo bajo)
- [x] `isWindowActive(start, now, expiry)` grants / roles temporales / delegaciones
- [x] Inicio futuro → no activo
- [x] Pasos no-op del kernel: no `ALLOW` silencioso (marcador `DEFERRED`)
- [x] Tests RED → GREEN

### 1.2 Company scope ✅

- [x] `companyId` obligatorio en operaciones
- [x] Repos/casos de uso rechazan scope incorrecto
- [x] Company mínima (`companyId` + `purpose`)

### 1.3 Persistencia durable ✅

- [x] `UNIQUE` en IDs de negocio
- [x] `UNIQUE (work_id, terminal_event_id)` en receipts
- [x] `DbConnection.transaction(fn)` (PG + fake)
- [x] `evidenceId` estable
- [x] Casos de uso: propose / accept / start / complete / verify / reject
- [x] `save` no es el camino de cambio de estado de Work

### 1.4 Concurrency ✅

- [x] Claim con versión o lease/CAS (`updateIfVersion`, un solo ganador)
- [x] Conflicto explícito
- [x] Un solo escritor gana

### 1.5 Idempotencia pre-efecto ✅

- [x] Intento + key **antes** del efecto
- [x] Misma key + mismo hash → replay
- [x] Key + hash distinto → DENY
- [x] Cierre terminal en una tx (cierre atómico)

### 1.6 Validación runtime ✅

- [x] Guards: comando, filas PG, plan LLM
- [x] Rechazo explícito
- [x] No solo TypeScript (capability NEW `runtime-validation`)

### 1.7 Higiene ✅

- [x] README / workspace al día
- [x] CI Postgres; integración no skipeada en silencio en CI (CI guard `pg-required`)

**Proceso obligatorio (respetado en Rev 2):**

```text
explore → propose → design → spec → tasks
  → apply (cada escenario delta = RED→GREEN antes de done)
  → review (working tree sin commit; lentes reales; sin findings vacíos inventados)
  → commit con receipt del candidate
  → verify (confirma; no descubre features)
  → archive → push
```

**Criterio de "listo" (alcanzado):** flujo terminal atómico (fakes OK) + SoD + scope + sin receipts duplicados + reintento seguro + ciclo SDD verde sin hacks.

**Evidencia:** `openspec/changes/archive/2026-07-31-harden-first-enterprise-vertical-foundation/` (exploration, proposal, design, spec 18 req / 61 scen, tasks 34 unidades, apply-progress, verify-report, archive-report).

### Follow-ups diferidos (bajo impacto, NO bloqueantes — del archive-report)

- [ ] (a) `result_json` del journal: row-guard de replay
- [ ] (b) Race misma-key: el perdedor devuelve resultado tipado, no error lanzado
- [ ] (c) Documentar el supuesto de transaction-boundary de `IdempotencyJournalPort`

---

## Paso 2 — `first-enterprise-vertical` 🔄 SIGUIENTE (desbloqueado en Rev 2)

> **Transición:** Rev 1 "bloqueado por harden" → Rev 2 "🔄 SIGUIENTE".
> **Por qué:** la regla de oro se cumplió (harden limpio archivado).

**Dependencias:** domain-foundation ✓ · deepseek-client ✓ · harden limpio ✓

> ⚠️ **Primero:** reconciliar el `exploration.md` STALE en
> `openspec/changes/first-enterprise-vertical/exploration.md` — todavía apunta a
> `domain-foundation` como siguiente y predata a deepseek + el reset del harden.
> **Supersederlo antes de proponer.**

- [ ] Worker (claim → autoridad → intento → efecto **fuera** de tx → reconciliar → verify → tx terminal)
- [ ] SandboxPort reversible
- [ ] E2E: LLM fake + PG real
- [ ] Tests: reinicio, reintento, receipt único, revocación, fallo post-efecto, verifier ≠ executor
- [ ] `packages/app` (shell vacío reservado para la capa de aplicación: use cases / worker / orquestación)

**Fuera de alcance:** Memory OS, minions, skills, learning, CEO, receipts crypto.

---

## Paso 3 — Después de vertical verde (sin cambios)

Context compiler → DeepSeek live E2E → BusinessEvent → un skill → heartbeats → roadmap.

---

## Resumen (actualizado en Rev 2)

```text
main @ 4cc0b15  ← AQUÍ ESTAMOS (Rev 2, verificado, pusheado)
  ├─ domain-foundation (código + specs)
  ├─ deepseek-client (código + archive PASS)
  └─ harden-first-enterprise-vertical-foundation (CERRADO + archivado + specs synced)

siguiente
  └─ first-enterprise-vertical (Paso 2 — desbloqueado; reconciliar exploration.md stale primero)

después
  └─ Paso 3 (context compiler, DeepSeek live, BusinessEvent, skill, heartbeats)
```

## Regla de oro

No abrir la vertical sin harden limpio. *(Cumplida en Rev 2.)*
DeepSeek se conserva. Harden se rehace. *(Hecho: harden reconstruido limpio y archivado.)*
**Apply termina escenarios; verify solo confirma; review no se fabrica.**
