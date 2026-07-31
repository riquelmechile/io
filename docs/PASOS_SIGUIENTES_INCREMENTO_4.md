# IO — Pasos siguientes

> **Auditoría:** 2026-07-31 — GitHub `riquelmechile/io` `main` vs local `/data/io`  
> **Orden corregido:** terminar cliente LLM → endurecer fundación → vertical  
> **Regla de proceso:** SDD + TDD + review honesto. Sin hacks de gate ni gap-fix post-verify.

---

## 0. Auditoría: ¿qué quedó estable de verdad?

### Sync GitHub ↔ local

| Check | Resultado |
|-------|-----------|
| `HEAD` local | `4c353fa` |
| `origin/main` | `4c353fa` (idéntico) |
| Working tree | **Sucio:** archive parcial de harden sin commitear + specs tocadas + `docs/PASOS_SIGUIENTES_INCREMENTO_4.md` |
| Harden archive en GitHub | **NO existe** (solo commits de código harden) |

### Packages en GitHub `main`

`business-domain` · `database` · `llm-client` · `trust-kernel`  
(no hay `app` con producto en remote)

### Veredicto por change

| Change | Código en GH | Archive en GH | Verify en archive | ¿Estable? |
|--------|--------------|---------------|-------------------|-----------|
| Persistencia / wire-live-postgres y anteriores | sí | completo (verify + archive-report) | PASS histórico | **Sí — baseline histórica** |
| `domain-foundation` | sí (`40fcc6c` + archive `4f0fd1f`) | **incompleto** (falta `verify-report.md`, `exploration.md`, `archive-report.md`) | no hay verdict en tree | **Código usable; audit trail flojo** |
| `deepseek-client` | sí (`55e1568` + archive `4ea1653`) | **completo** (exploration, design, proposal, tasks, **verify-report PASS 7/7 · 12/12**, archive-report) | **PASS** | **Sí — mejor cierre reciente** |
| `harden-foundation` | sí (`d56123b` + `4c353fa`) | **no en GH**; local uncommitted | ciclo contaminado (capture vacío + UNTESTED + gap-fix) | **No — rehacer limpio** |
| `first-enterprise-vertical` | solo exploration suelta | no | — | **No abrir** |

### Prueba dura de la baseline `4ea1653` (cierre deepseek)

Worktree temporal en `4ea1653`:

- `pnpm test` → **411 passed / 20 skipped** (26 files + 3 skipped)
- `pnpm check` → **GREEN**
- `@io/llm-client`: port puro, `openai` solo en `deepseek-client.ts`, boundary tests, **cero import de business-domain**
- Comentarios “worker” = docs de futuro; **no hay worker cableado**

### Conclusión de estabilidad

```text
BASELINE ESTABLE RECOMENDADA = 4ea1653
  chore(openspec): archive deepseek-client — sync llm-client-port spec

Incluye:
  ✅ toolchain + trust-kernel + PG live (cambios previos)
  ✅ domain-foundation (código + specs canónicos; archive delgado pero producto presente)
  ✅ deepseek-client (código + archive SDD completo con verify PASS)

NO incluye (y no debe contarse como cerrado):
  ❌ harden-foundation (aunque el código ya esté en main de GH)
```

**DeepSeek sí quedó estable** como infra hexagonal aislada.  
**Domain-foundation** quedó estable en **código**, con archive SDD más flaco que el ideal.  
**Harden** está en main de GH pero **no es baseline confiable de proceso** → se rehace limpio desde `4ea1653`.

---

## Paso 0 — Cerrar `deepseek-client` ✅ HECHO Y ESTABLE

**Objetivo:** adaptador listo y aislado, sin worker de producto.

- [x] Apply (port `LlmClient`, adapter DeepSeek, fake, tests)
- [x] Verify PASS (7/7 req, 12/12 scenarios) — en archive
- [x] Archive en GH (`2026-07-31-deepseek-client`)
- [x] No cableado a orquestación / vertical
- [x] Suite en baseline: 411 green

**Criterio de listo:** modelo o fake solo detrás del port. **Cumplido.**

→ No reabrir salvo bug real del adapter.

---

## Paso 1 — `harden-first-enterprise-vertical-foundation` 🔄 REHACER LIMPIO

**Objetivo:** base durable para la primera vertical. Sin Memory OS, sin minions, sin DeepSeek como dependencia de producto.

**Cómo empezar (concreto):**

1. Descartar working tree sucio del “archive” falso de harden.  
2. Resetear main a **`4ea1653`** (o branch `harden-clean` desde ahí) y force-push solo con acuerdo explícito (GH hoy tiene los 2 commits contaminados).  
3. Nuevo ciclo SDD completo desde esa baseline.  
4. Se puede **releer** design/spec viejos como referencia, no como “ya hecho”.

### 1.1 Autoridad

- [ ] SoD real: `proposer ≠ approver`, `executor ≠ verifier` (también en riesgo bajo)
- [ ] `isWindowActive(start, now, expiry)` para grants, roles temporales y delegaciones
- [ ] Grants/roles con inicio futuro → no activos
- [ ] Pasos no implementados del kernel: no devolver `ALLOW` silencioso en camino de producción
- [ ] Tests RED → GREEN de los casos anteriores

### 1.2 Company scope

- [ ] Toda operación de la vertical exige `companyId`
- [ ] Repositorios y casos de uso rechazan o no encuentran si el scope no coincide
- [ ] Company sigue mínima (`companyId` + `purpose`)

### 1.3 Persistencia durable

- [ ] `UNIQUE` en `company_id`, `delegation_id`, `work_id`, `receipt_id`
- [ ] Preferible: `UNIQUE (work_id, terminal_event_id)` para receipts
- [ ] `DbConnection.transaction(fn)` (PG + fake en memoria)
- [ ] `evidenceId` estable (+ hash / refs usables por `BusinessReceipt`)
- [ ] Casos de uso de transición (`propose` / `accept` / `start` / `complete` / `verify` / `reject`)
- [ ] `save(object)` ya no es el camino para cambiar estado de Work

### 1.4 Concurrency

- [ ] Claim de Work con versión esperada **o** lease / compare-and-set
- [ ] Conflicto explícito si otro proceso ya avanzó el estado
- [ ] Un solo escritor gana; el otro no pisa en silencio

### 1.5 Idempotencia pre-efecto

- [ ] Registrar intento + idempotency key **antes** del efecto externo
- [ ] Misma key + mismo hash de request → devolver resultado previo
- [ ] Key + hash distinto → DENY
- [ ] Cierre terminal en la misma transacción: Work + evidencia + cerrar intento + receipt

### 1.6 Validación runtime

- [ ] Guards en bordes: comando de entrada, filas leídas de PG, plan estructurado del LLM
- [ ] Inputs inválidos y transiciones ilegales → rechazo explícito
- [ ] No confiar solo en tipos TypeScript

### 1.7 Higiene de estado

- [ ] README y `pnpm-workspace` alineados al estado real
- [ ] CI: Postgres como service; integración no se skipea en silencio
- [ ] (Opcional) Completar audit trail de `domain-foundation` archive si molesta el vacío de verify-report

**Criterio de listo:** flujo terminal atómico (con fakes) + SoD + scope + sin receipts duplicados + reintento seguro + **ciclo SDD verde sin hacks**.

**Proceso obligatorio:**

```text
explore → propose → design → spec → tasks
  → apply (cada escenario del delta con RED→GREEN antes de marcar done)
  → review (working tree SIN commitear; lentes reales; sin findings:[] inventados)
  → commit con receipt que gobierna el candidate
  → verify (confirma; no descubre features faltantes)
  → archive → push
```

---

## Paso 2 — `first-enterprise-vertical` (SDD completo)

**Solo después del Paso 1 archivado limpio.**

### Dependencias

- `domain-foundation` ✓ (código)
- `deepseek-client` ✓ archivado estable
- `harden-first-enterprise-vertical-foundation` ✓ archivado limpio

### Alcance

- [ ] Worker delgado (claim → autoridad → intento/idempotency → efecto fuera de tx → reconciliar → verify → tx terminal)
- [ ] SandboxPort (acción reversible)
- [ ] E2E: **LLM fake** + Postgres real (DeepSeek live después)
- [ ] Principales distintos según riesgo
- [ ] Pruebas: reinicio · reintento misma key · receipt único · revocación · fallo post-efecto · verificador ≠ ejecutor

### Fuera de alcance

Memory OS · minions · skills completas · learning · CEO/org ampliada · receipts crypto

**Criterio de listo:** trabajo de bajo riesgo punta a punta con guards del Paso 1 en pie.

---

## Paso 3 — Solo después de la vertical verde

1. Context compiler mínimo  
2. DeepSeek live en E2E  
3. `BusinessEvent` append-only  
4. Un skill/procedimiento versionado  
5. Heartbeats sin LLM innecesario  
6. Resto del roadmap  

---

## Resumen visual

```text
GitHub + local @ 4c353fa  ← HEAD actual (incluye harden contaminado)

BASELINE ESTABLE = 4ea1653
  ├─ … wire-live-postgres y anteriores … ✅
  ├─ domain-foundation (código) ✅  archive delgado ⚠️
  └─ deepseek-client ✅ archive + verify PASS

AHORA
  1. reset limpio a 4ea1653 (acordado)
  2. harden-first-enterprise-vertical-foundation (SDD completo, sin hacks)
  3. first-enterprise-vertical
  4. context → DeepSeek live → …
```

---

## Primera acción concreta

1. **Confirmar** baseline `4ea1653` (este doc + worktree ya probaron 411 green).  
2. **Limpiar** dirt local del archive falso de harden.  
3. **`git reset --hard 4ea1653`** + **`git push --force-with-lease origin main`** (solo con OK explícito: reescribe GH y saca d56123b/4c353fa de main).  
4. Arrancar SDD limpio de harden.

---

## Regla de oro

No abrir `first-enterprise-vertical` hasta harden **archivado y verificado en limpio**.  
`deepseek-client` **sí** quedó estable; no hace falta tirarlo.  
El harden en main de GH **no** cuenta como cerrado.  
**Verify no inventa features; Apply las termina. Review no se fabrica.**
