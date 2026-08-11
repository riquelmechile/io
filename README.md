# IO

**La empresa digital operada por trabajadores agénticos, diseñada para que el silencio no cueste nada.**

IO es una empresa real en construcción: trabajadores de IA ejecutan trabajo de negocio — documentos, análisis, entregables — dentro de sandboxes reversibles, bajo la dirección de un fundador/directorio humano. Sin chatbots. Sin enjambres de prompts. Sin teatro de cargos. Una empresa completa, con autoridad, presupuestos, evidencia y resultados.

![CI](https://github.com/riquelmechile/io/actions/workflows/ci.yml/badge.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white&style=flat)
![Node.js](https://img.shields.io/badge/Node.js-24_LTS-339933?logo=node.js&logoColor=white&style=flat)
![pnpm](https://img.shields.io/badge/pnpm-monorepo-F69220?logo=pnpm&logoColor=white&style=flat)
![Vitest](https://img.shields.io/badge/Vitest-6E9F43?logo=vitest&logoColor=white&style=flat)
![Biome](https://img.shields.io/badge/Biome-60A5FA?logo=biome&logoColor=white&style=flat)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white&style=flat)

> **Estado:** desarrollo activo. La fundación y la primera vertical empresarial ya corren de punta a punta contra PostgreSQL vivo y DeepSeek real. IO **todavía no es un sistema listo para producción** — este README documenta el estado real, sin inflar.

---

## Qué es IO

La unidad principal de IO no es el agente: es la **empresa**.

```text
Empresa → estrategia → portafolio → procesos → puestos
       → trabajadores agénticos → trabajo → artefactos
       → resultados → aprendizaje
```

Cada trabajador tiene misión, autoridad explícita, presupuesto y definición de buen desempeño. El fundador/directorio humano conserva la autoridad constitucional: finalidad, capital, límites críticos, acciones irreversibles. Los agentes operan con libertad proporcional al riesgo, y cada acción produce **evidencia verificable**, no afirmaciones de confianza.

La visión completa — capas empresariales, memoria, economía cognitiva — está en el [documento fundacional](docs/IO_EMPRESA_AGENTICA_ARQUITECTURA_Y_MEMORIA_2026.md).

---

## El problema

Los sistemas agénticos tradicionales queman tokens en vacío: loops que consultan al LLM aunque no haya nada nuevo que hacer. El costo se dispara, el KV-cache se invalida y la economía del agente nunca cierra.

IO parte de un principio distinto: **el costo es parte del razonamiento**.

- Cada activación tiene presupuesto y utilidad esperada.
- El contexto es un recurso escaso: se compila con prefijos estables por cohorte para maximizar hits de KV-cache.
- Estar disponible 24/7 no significa llamar al modelo 24/7.

---

## Cómo funciona

El corazón del sistema es la **activación por heartbeat**, la innovación central de economía de costo:

1. **Heartbeat (gate determinístico).** Un evento llega al stream de la empresa y una función pura decide si hay novedad material. Si no la hay, el heartbeat se cierra como `no-llm-heartbeat`: **cero tokens gastados**. El LLM nunca se invoca para decidir si debe ser invocado.
2. **Supervisor.** Un supervisor periódico descubre empresas, evalúa el gate de heartbeat por empresa con cursores durables y activa solo lo que tiene trabajo real.
3. **Work dispatch.** Al activarse una empresa, se despacha el `Work` aceptado más antiguo.
4. **Ciclo de worker.** Plan LLM (DeepSeek Flash) → ejecución en sandbox reversible → cierre atómico con receipts de negocio y journal de idempotencia.

La fuente de verdad es un **log de eventos de negocio append-only en PostgreSQL**: los cursores garantizan procesamiento *at-least-once* y recuperación segura ante caídas.

```mermaid
flowchart TD
    E["Stream de eventos de negocio\n(append-only, PostgreSQL)"] --> G{"Heartbeat gate\nfunción pura, sin LLM"}
    G -- "sin novedad material" --> Z["no-llm-heartbeat\ncosto: 0 tokens"]
    G -- "novedad material" --> S["Supervisor\nactiva la empresa"]
    S --> D["Work dispatch\nWork aceptado más antiguo"]
    D --> W["Ciclo de worker"]
    W --> P["Plan LLM\n(DeepSeek Flash)"]
    P --> X["Ejecución en\nsandbox reversible"]
    X --> R["Cierre atómico\nreceipts + journal de idempotencia"]
```

---

## Arquitectura

Monorepo TypeScript (pnpm workspaces) con arquitectura hexagonal: el dominio puro no depende de nada externo; PostgreSQL, DeepSeek y el sandbox son adaptadores reemplazables detrás de puertos.

| Paquete | Responsabilidad |
|---|---|
| [`@io/business-domain`](packages/business-domain) | Dominio puro, cero dependencias externas: Work, receipts, eventos de negocio, heartbeat. |
| [`@io/trust-kernel`](packages/trust-kernel) | Núcleo de confianza: principals y evaluación de autoridad. |
| [`@io/context`](packages/context) | Compilador de contexto: prefijo estable por cohorte para economía de KV-cache. |
| [`@io/database`](packages/database) | Adaptadores PostgreSQL: eventos append-only, cursores, work, receipts, journal. |
| [`@io/llm-client`](packages/llm-client) | Cliente DeepSeek (API OpenAI-compatible): thinking, tools, costo de cache. |
| [`@io/app`](packages/app) | Raíz de composición: supervisor, dispatch y shell del proceso worker con sandbox. |

Las decisiones de arquitectura están registradas como ADR: ver el [índice de decisiones](docs/adr/README.md).

---

## Estado del proyecto

IO se construye incrementalmente: cada incremento debe funcionar y producir evidencia antes de avanzar al siguiente.

| Estado | Qué |
|---|---|
| **Completado** | Fundación de desarrollo root-only ([ADR-0004](docs/adr/README.md)), fundación de dominio (Work, receipts, eventos de negocio, heartbeat), trust kernel, capa de persistencia PostgreSQL, cliente DeepSeek con E2E en vivo, compilador de contexto, activación por heartbeat, supervisor timer y work dispatch, daemon durable, heartbeat decision events, escalada Flash→Pro, fencing tokens, y supervisor recovery (Scope B). |
| **Siguiente** | Cold-start discovery gap + Skill outcome BusinessEvents — trazado en [pasos siguientes](docs/PASOS_SIGUIENTES_INCREMENTO_4.md). |

Todo el trabajo se entrega bajo Spec-Driven Development: 27 cambios completados, verificados y archivados en [`openspec/changes/archive/`](openspec/changes/archive/).

---

## Empezar

Requisitos: Node 24 LTS (ver [.nvmrc](.nvmrc)), pnpm 11 y Docker.

```bash
git clone https://github.com/riquelmechile/io.git
cd io
nvm use                 # Node 24 LTS
corepack enable         # activa pnpm según packageManager
pnpm install
docker compose up -d    # PostgreSQL 18.4 en localhost:5432
pnpm test               # suite Vitest completa
```

La instancia local de PostgreSQL ([docker-compose.yml](docker-compose.yml)) usa `postgresql://io:io_dev@localhost:5432/io_dev`. El comando `pnpm check` ejecuta todas las puertas de calidad en orden: format → typecheck → build → lint → test.

### CI con PostgreSQL en vivo

El CI ([ci.yml](.github/workflows/ci.yml)) corre la integración y el E2E contra un servicio `postgres:18` real con `IO_REQUIRE_PG=1`: si la base no está disponible, las suites **fallan ruidosamente**. No hay skips silenciosos del vertical real.

---

## Documentación

- [Empresa agéntica: arquitectura maestra, memoria y economía cognitiva](docs/IO_EMPRESA_AGENTICA_ARQUITECTURA_Y_MEMORIA_2026.md) — la visión completa.
- [Índice de ADR](docs/adr/README.md) — decisiones arquitectónicas aceptadas.
- [Pasos siguientes — Incremento 4](docs/PASOS_SIGUIENTES_INCREMENTO_4.md) — documento vivo de trazabilidad.
- [Guía de contribución](CONTRIBUTING.md) — cada PR nace de un issue aprobado.
- [Archivo OpenSpec](openspec/changes/archive/) — historial completo de cambios entregados.

---

## Metodología

IO se desarrolla con **Spec-Driven Development sobre OpenSpec**: cada cambio pasa por propuesta, especificación, diseño, tareas, implementación, verificación y archivo. La implementación sigue TDD estricto (RED → GREEN → REFACTOR) y la entrega se autoriza con receipts que identifican el candidate por sus bytes. Nada entra a `main` sin evidencia.

---

IO no se mide por cantidad de agentes ni tokens gastados. Se mide por trabajo terminado, costo por resultado y aprendizaje comprobado.
