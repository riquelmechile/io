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
| **4** (vigente) | 2026-08-01 | `d5b42e9` | Paso 3 pasa de "🔄 SIGUIENTE" a **"✅ COMPLETO"** (6 slices verificados + archivados + pusheados). Se agrega trazabilidad por slice (archive, spec canónica, commits). Conteo de tests **757 → 968**. Specs synced **17 → 21** (4 NEW: `context-compiler`, `business-event`, `skill`, `heartbeat`). Hito acumulado: worker end-to-end vs DeepSeek V4 real + PG vivo, contexto compilado (KV-cache, skills en segmento 7), log append-only BusinessEvent y pre-gate determinístico §13.2 (heartbeats). El snapshot de Rev 3 se conserva marcado como superado. | Los 6 slices del roadmap de Paso 3 se completaron en limpio (context-compiler, deepseek-live-e2e, businessevent, first-skill, skill-segment7, heartbeats): ciclos SDD con verify **PASS** —o PASS WITH WARNINGS por el flake PG preexistente—, archivados y pusheados. |
| **3** (superada) | 2026-08-01 | `2523614` | Paso 2 `first-enterprise-vertical` pasa de "🔄 SIGUIENTE" a **"✅ CERRADO"** (verificado + archivado + pusheado). Paso 3 pasa a **🔄 SIGUIENTE**. Conteo de tests actualizado **604 → 757** (+E2E 9/9 vs PG vivo). Se registra la decisión del usuario (marker reintentable = paridad con la fundación) y las 3 correcciones del review adversarial. El snapshot de Rev 2 se conserva marcado como superado. | El ciclo SDD `first-enterprise-vertical` se completó: **18/18 requisitos, 47/47 escenarios, 0 blockers**, verify **PASS**, review adversarial CLEAN por slice (A/B/C). La primera vertical de empresa corre de punta a punta contra PostgreSQL vivo. |
| **2** (superada) | 2026-07-31 | `4cc0b15` | Paso 1 `harden` pasa de "🔄 SIGUIENTE" a **"✅ CERRADO"** (verificado + archivado + pusheado). Paso 2 `first-enterprise-vertical` pasa a **🔄 SIGUIENTE**. Conteo de tests actualizado **411 → 604**. Se agrega evidencia de verify por slice y el snapshot de Rev 1 se conserva marcado como superado. | El ciclo limpio `harden-first-enterprise-vertical-foundation` se completó: **18/18 requisitos, 61/61 escenarios, 0 blockers, 0 critical**, review adversarial CLEAN en cada slice (A/B/C). Se cumplió la *regla de oro* (no abrir la vertical sin harden limpio) → la vertical queda desbloqueada. |
| **1** (superada) | 2026-07-31 | `4ea1653` | Versión inicial. Baseline `deepseek-client` cerrada; `harden` como Paso 1 pendiente; `first-enterprise-vertical` como Paso 2. | Reset a una baseline limpia tras el ciclo harden **contaminado** (hacks de gate: findings vacíos inyectados y gap-fixes post-verify). Se documentó el punto de partida estable para rehacer el harden en limpio. |

**Estado actual (Rev 4):** `main @ d5b42e9` = `origin/main`. Working tree limpio. Paso 3 **COMPLETO**. Siguiente: actuar sobre la decisión de heartbeat (worker-cycle branching) — ver "Próximos pasos" en Paso 3.

---

## Estado actual (Rev 4 — vigente)

| Check | Resultado |
|-------|-----------|
| Commit | `d5b42e9` — archive `heartbeats` (último de los 6 slices de Paso 3) |
| GitHub `main` | = local = `d5b42e9` |
| `pnpm check` | GREEN (format, tsc, build, lint, test) |
| Tests | **968 passed / 6 skipped** (suite secuencial; ver flake PG diferido en Paso 3) |
| E2E PG 18.4 | GREEN contra PostgreSQL vivo (worker E2E + round-trips de skill / business-event / heartbeat) |
| Paso 3 | **✅ COMPLETO** — 6/6 slices archivados y pusheados (ver trazabilidad en Paso 3) |
| Specs synced | 4 NEW (`context-compiler`, `business-event`, `skill`, `heartbeat`) + MODIFIED (`worker-cycle`, `context-compiler`, `skill`) en `openspec/specs/` (total 21) |
| Archive (último) | `openspec/changes/archive/2026-08-01-heartbeats/` |

### Evolución del conteo de tests (durante Rev 4)

| Momento | Tests | Delta / motivo |
|---------|-------|----------------|
| Baseline (Rev 3, `2523614`) | 757 passed / 3 skipped | Fundación vertical verde |
| context-compiler (`@io/context` + §7.2 + cohort) | 813 passed / 3 skipped | +56 (compiler puro, golden pins, wiring a `prepareIntent`) |
| deepseek-live-e2e (composition root + E2E real) | 829 passed / 6 skipped | +16 (`buildWorkerDeps`, E2E doble-gate vs DeepSeek V4 real) |
| businessevent (log append-only + emisión T1) | 868 passed / 6 skipped | +39 (tipo, port, adapter PG 006, emisión atómica) |
| first-skill (Skill versionada + activación) | 922 passed / 6 skipped | +54 (tipo, registry, `activeSkillsFor`, PG 007) |
| skill-segment7 (skills en segmento 7 + schema v2) | 936 passed / 6 skipped | +14 (render segmento 7, golden v2, seam worker) |
| heartbeats (filtro de novedad §13.2) | **968 passed / 6 skipped** | +32 (`evaluateHeartbeat` puro + seam read-only) |

---

## Snapshot histórico (Rev 3 — superada, se conserva para trazabilidad)

> ⚠️ **Este bloque refleja el estado a `2523614` (first-enterprise-vertical cerrado) y YA NO es el punto de partida vigente.**

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

## Paso 3 — Después de vertical verde ✅ COMPLETO EN REV 4

> **Transición:** Rev 3 "🔄 SIGUIENTE" → Rev 4 "✅ COMPLETO" (6 slices verificados + archivados + pusheados; HEAD `d5b42e9`).
> **Por qué:** se completó la secuencia del roadmap — Context compiler → DeepSeek live E2E → BusinessEvent → un skill → heartbeats → roadmap — con ciclos SDD limpios, verify **PASS** (o PASS WITH WARNINGS por el flake PG preexistente) y review adversarial por slice.

**Secuencia (cumplida):** Context compiler → DeepSeek live E2E → BusinessEvent → un skill → heartbeats → roadmap.

**Hito acumulado:** el worker corre end-to-end contra **DeepSeek V4 real + PostgreSQL vivo**, con contexto compilado (prefijo byte-stable + KV-cache, skills en segmento 7), emite un log append-only de hechos de negocio (**BusinessEvent**) en el cierre terminal, y tiene el pre-gate determinístico de heartbeats (**§13.2**) que decide `no-llm-heartbeat | activate flash` desde los hechos, sin juicio del modelo.

### Trazabilidad por slice

| # | Slice | Entregó | Archive | Spec canónica | Commits |
|---|-------|---------|---------|---------------|---------|
| 1 | `context-compiler` | Compiler puro `@io/context`: orden §7.2 de 13 segmentos, prefijo byte-stable + cache-cohort, wiring a `prepareIntent` | `archive/2026-08-01-context-compiler/` | `context-compiler` (NEW · 7 req / 12 scen) | archive `0c124fd` · PRs `3458b81`/`54a1905`/`5dcd699` |
| 2 | `deepseek-live-e2e` | Composition root `buildWorkerDeps` + E2E doble-gate vs DeepSeek V4 real; KV-cache economics reales | `archive/2026-08-01-deepseek-live-e2e/` | `worker-cycle` (MODIFIED · +6 req) | archive `7825a7f` · PRs `b935511`/`ff9a670` |
| 3 | `businessevent` | Log append-only de hechos de negocio, emisión atómica en T1 junto a CAS / receipt / journal | `archive/2026-08-01-businessevent/` | `business-event` (NEW · 9 req / 12 scen) | archive `de154e5` · PRs `794f009`/`eef6efc`/`11050db` |
| 4 | `first-skill` | `Skill` versionada + registry append-only + activación cohort-safe (`activeSkillsFor`) + PG INSERT-only (007) | `archive/2026-08-01-first-skill/` | `skill` (NEW · 8 req / 10 scen) | archive `f9bd5d9` · PRs `0790e29`/`c6340dc` |
| 5 | `skill-segment7` | Render de skills activas en segmento 7 del prefijo + `CONTEXT_SCHEMA_VERSION` 1→2 + golden v2 + seam worker | `archive/2026-08-01-skill-segment7/` | `context-compiler` + `skill` (MODIFIED · R1/R2/R6 y R7) | archive `2f25358` · PRs `64ff904`/`68a14dc` |
| 6 | `heartbeats` | Filtro de novedad determinístico §13.2 (`evaluateHeartbeat` puro, sin LLM / reloj) + seam read-only sobre el stream de BusinessEvent | `archive/2026-08-01-heartbeats/` | `heartbeat` (NEW · 8 req / 14 scen) | archive `d5b42e9` · PRs `b22e8c5`/`fb24258` |

**Fuera de alcance (respetado):** Memory OS, minions, learning / promotion (Increment 8), CEO, receipts crypto, ejecución de skills por el worker, timer / scheduler, persistencia del cursor.

**Diferido conocido (NO bloqueante):** flake de concurrencia PG preexistente (`business-pg-roundtrip` "two concurrent terminal closes" → `idempotency_journal_attempt_id_key`). No determinístico y fuera del diff de Paso 3; los verify corrieron la suite secuencial y se reclasificó a WARNING con addendum del orquestador.

### Próximos pasos (después de Paso 3)

- [ ] **ACTUAR sobre la decisión de heartbeat** (slice natural siguiente): branching en worker-cycle — saltear `prepareIntent` / `llm.complete` en `no-llm-heartbeat`, correr Flash en `activate` (§2 "costo como parte del razonamiento": el ahorro real del pre-gate construido).
- [ ] Timer / scheduler / cadencia (intervalo / cron + implicancias de recovery durable).
- [ ] Persistencia del cursor (dónde vive el marcador last-seen: ¿journal? ¿tabla nueva? ¿in-memory?).
- [ ] Skill outcome / activation BusinessEvents (más allá de `work.completed`).
- [ ] Learning / promotion (Increment 8): ciclo candidate → active.
- [ ] Memory OS.
- [ ] Extracción de `Skill` al paquete canónico `competency/`.
- [ ] Aislar el test concurrente del flake PG (o gate secuencial-tolerante).

---

## Resumen (actualizado en Rev 4)

```text
main @ d5b42e9  ← AQUÍ ESTAMOS (Rev 4, verificado, pusheado)
  ├─ domain-foundation (código + specs)
  ├─ deepseek-client (código + archive PASS)
  ├─ harden-first-enterprise-vertical-foundation (CERRADO + archivado + specs synced)
  ├─ first-enterprise-vertical (CERRADO + archivado + 3 specs NEW synced)
  └─ Paso 3 (COMPLETO + 6 slices archivados + 4 specs NEW synced)
       ├─ context-compiler (@0c124fd)
       ├─ deepseek-live-e2e (@7825a7f)
       ├─ businessevent (@de154e5)
       ├─ first-skill (@f9bd5d9)
       ├─ skill-segment7 (@2f25358)
       └─ heartbeats (@d5b42e9)

siguiente
  └─ actuar sobre la decisión de heartbeat (worker-cycle branching + Flash gate)
```

## Regla de oro

No abrir la vertical sin harden limpio. *(Cumplida en Rev 2; vertical cerrada en Rev 3.)*
DeepSeek se conserva. Harden se rehace. *(Hecho: harden reconstruido limpio y archivado.)*
**Apply termina escenarios; verify solo confirma; review no se fabrica.** *(Rev 3: el review adversarial cazó 3 defectos reales — claim brick, doble recibo, atomicidad — y se corrigieron con tests, no se taparon.)*
**El costo es parte del razonamiento.** *(Rev 4: Paso 3 completó el pre-gate determinístico §13.2 — heartbeats decide no-LLM vs activate-Flash desde los hechos, sin juicio del modelo; el ahorro real llega al ACTUAR sobre esa decisión.)*
