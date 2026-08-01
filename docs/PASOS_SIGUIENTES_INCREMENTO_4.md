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
| **3** (vigente) | 2026-08-01 | `2523614` | Paso 2 `first-enterprise-vertical` pasa de "🔄 SIGUIENTE" a **"✅ CERRADO"** (verificado + archivado + pusheado). Paso 3 pasa a **🔄 SIGUIENTE**. Conteo de tests actualizado **604 → 757** (+E2E 9/9 vs PG vivo). Se registra la decisión del usuario (marker reintentable = paridad con la fundación) y las 3 correcciones del review adversarial. El snapshot de Rev 2 se conserva marcado como superado. | El ciclo SDD `first-enterprise-vertical` se completó: **18/18 requisitos, 47/47 escenarios, 0 blockers**, verify **PASS**, review adversarial CLEAN por slice (A/B/C). La primera vertical de empresa corre de punta a punta contra PostgreSQL vivo. |
| **2** (superada) | 2026-07-31 | `4cc0b15` | Paso 1 `harden` pasa de "🔄 SIGUIENTE" a **"✅ CERRADO"** (verificado + archivado + pusheado). Paso 2 `first-enterprise-vertical` pasa a **🔄 SIGUIENTE**. Conteo de tests actualizado **411 → 604**. Se agrega evidencia de verify por slice y el snapshot de Rev 1 se conserva marcado como superado. | El ciclo limpio `harden-first-enterprise-vertical-foundation` se completó: **18/18 requisitos, 61/61 escenarios, 0 blockers, 0 critical**, review adversarial CLEAN en cada slice (A/B/C). Se cumplió la *regla de oro* (no abrir la vertical sin harden limpio) → la vertical queda desbloqueada. |
| **1** (superada) | 2026-07-31 | `4ea1653` | Versión inicial. Baseline `deepseek-client` cerrada; `harden` como Paso 1 pendiente; `first-enterprise-vertical` como Paso 2. | Reset a una baseline limpia tras el ciclo harden **contaminado** (hacks de gate: findings vacíos inyectados y gap-fixes post-verify). Se documentó el punto de partida estable para rehacer el harden en limpio. |

**Estado actual (Rev 3):** `main @ 2523614` = `origin/main`. Working tree limpio. Siguiente: Paso 3.

---

## Estado actual (Rev 3 — vigente)

| Check | Resultado |
|-------|-----------|
| Commit | `2523614` — archive `first-enterprise-vertical` |
| GitHub `main` | = local = `2523614` |
| `pnpm check` | GREEN (format, tsc, build, lint, test) |
| Tests | **757 passed / 3 skipped** (2 DeepSeek sin `DEEPSEEK_API_KEY` + 1 CI guard local) |
| E2E PG 18.4 | **9/9 corrieron** (no skipeados) contra PostgreSQL vivo |
| Verify vertical | **PASS** · **18/18 req** · **47/47 escenarios** · 0 blockers · 0 critical/warning |
| Review adversarial | CLEAN por slice (A/B/C) — 3 defectos cazados y corregidos (ver Paso 2) |
| Specs synced | 3 NEW (`worker-cycle`, `sandbox-port`, `idempotency-journal`) en `openspec/specs/` (total 17) |
| Archive | `openspec/changes/archive/2026-08-01-first-enterprise-vertical/` |

### Evolución del conteo de tests (durante Rev 3)

| Momento | Tests | Delta / motivo |
|---------|-------|----------------|
| Baseline (Rev 2, `4cc0b15`) | 604 passed / 3 skipped | Fundación harden |
| Slice A (marker journal + sandbox + app shell) | 667 passed / 3 skipped | +63 (marker `aborted_retryable`, SandboxPort reversible, fakes durables) |
| Slice B (worker core + finalize twin) | 745 passed / 3 skipped | +78 (ciclo, authority/SoD, reconcile, finalize T1/T2, parity) |
| Slice B correcciones (claim resume + terminal guard) | 748 passed / 3 skipped | +3 (retry no-brick, guard doble-recibo) |
| Slice C (E2E live PG + atomicidad) | **757 passed / 3 skipped** | +9 (E2E vs PG vivo; fix atomicidad intrínseca) |

---

## Snapshot histórico (Rev 2 — superada, se conserva para trazabilidad)

> ⚠️ **Este bloque refleja el estado a `4cc0b15` (harden cerrado) y YA NO es el punto de partida vigente.**

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

## Paso 2 — `first-enterprise-vertical` ✅ CERRADO EN REV 3

> **Transición:** Rev 2 "🔄 SIGUIENTE" → Rev 3 "✅ CERRADO" (verificado + archivado + pusheado en `2523614`).
> **Por qué:** el ciclo SDD se completó — verify **PASS** (18/18 req, 47/47 escenarios, 0 blockers), E2E 9/9 vs PG vivo, review adversarial CLEAN por slice.

**Dependencias:** domain-foundation ✓ · deepseek-client ✓ · harden limpio ✓ · `exploration.md` stale superseded ✓

- [x] Worker (claim → autoridad → intento → efecto **fuera** de tx → reconciliar → verify → tx terminal)
- [x] SandboxPort reversible (create-document + undo; fakes in-memory/durable; adapter fs)
- [x] E2E: LLM fake + PG real (harness sobre scratch DB aislada, migraciones 001–005)
- [x] Tests: reinicio, reintento, receipt único, revocación, fallo post-efecto, verifier ≠ executor
- [x] `packages/app` (capa de aplicación: worker / sandbox / orquestación)

**Decisión del usuario (registrada):** el "brick" del CAS-loss de finalize se cerró con un **marker reintentable durable (`aborted_retryable`) = paridad con la fundación**, aceptando un cambio de dominio sobre la fundación harden archivada (se eligió sobre fail-closed `UNRESOLVED` o documentar la divergencia).

**3 correcciones del review adversarial (todas cazadas en review, todas testeadas):**
1. **Claim resume-aware** (BLOCKER): el retry de un Work `in_progress` moría en `startWork` (`invalid-transition`), brickkeando la key → el claim consulta el journal antes del CAS y resume el Work propio sin re-claim.
2. **Guard terminal-resume** (WARNING): la rama de resume podía re-aplicar un efecto + emitir un 2.º recibo para un Work terminal → ruteo honesto a replay/DENY/UNRESOLVED + state guard en finalize T1.
3. **Atomicidad intrínseca de finalize T1** (BLOCKER): T1 ignoraba la conexión tx-scoped y autocommitaba (atómico solo detrás de un decorador de test) → factory de repos tx-scoped espejando `completeWorkAtomically`; decorador retirado.

**Fuera de alcance (respetado):** Memory OS, minions, skills, learning, CEO, receipts crypto, context compiler, DeepSeek real.

**Follow-ups diferidos (del archive-report):** borrar `TxRoutingConnection` muerto; wiring de producción del repository factory; continuación de recovery crash-before-effect; 3 follow-ups de harden que interactúan con el replay path.

---

## Paso 3 — Después de vertical verde 🔄 SIGUIENTE (desbloqueado en Rev 3)

Context compiler → DeepSeek live E2E → BusinessEvent → un skill → heartbeats → roadmap.

---

## Resumen (actualizado en Rev 3)

```text
main @ 2523614  ← AQUÍ ESTAMOS (Rev 3, verificado, pusheado)
  ├─ domain-foundation (código + specs)
  ├─ deepseek-client (código + archive PASS)
  ├─ harden-first-enterprise-vertical-foundation (CERRADO + archivado + specs synced)
  └─ first-enterprise-vertical (CERRADO + archivado + 3 specs NEW synced)

siguiente
  └─ Paso 3 (context compiler, DeepSeek live, BusinessEvent, skill, heartbeats)
```

## Regla de oro

No abrir la vertical sin harden limpio. *(Cumplida en Rev 2; vertical cerrada en Rev 3.)*
DeepSeek se conserva. Harden se rehace. *(Hecho: harden reconstruido limpio y archivado.)*
**Apply termina escenarios; verify solo confirma; review no se fabrica.** *(Rev 3: el review adversarial cazó 3 defectos reales — claim brick, doble recibo, atomicidad — y se corrigieron con tests, no se taparon.)*
