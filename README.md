<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/io-hero-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/io-hero-light.svg">
  <img alt="IO — empresa agéntica: empresa primero, cero tokens cuando no hay novedad y evidencia verificable siempre" src="docs/assets/io-hero-dark.svg" width="100%">
</picture>

<h1 align="center">IO</h1>

<p align="center">
  <strong>La empresa digital operada por trabajadores agénticos, diseñada para que el silencio no cueste nada.</strong><br>
  Empresa primero. Agentes después. Trabajo verificable siempre.
</p>

<p align="center">
  <img alt="CI" src="https://github.com/riquelmechile/io/actions/workflows/ci.yml/badge.svg">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&amp;logoColor=white&amp;style=flat">
  <img alt="Node.js 24 LTS" src="https://img.shields.io/badge/Node.js-24_LTS-339933?logo=node.js&amp;logoColor=white&amp;style=flat">
  <img alt="pnpm monorepo" src="https://img.shields.io/badge/pnpm-monorepo-F69220?logo=pnpm&amp;logoColor=white&amp;style=flat">
  <img alt="Vitest" src="https://img.shields.io/badge/Vitest-6E9F43?logo=vitest&amp;style=flat">
  <img alt="Biome" src="https://img.shields.io/badge/Biome-60A5FA?logo=biome&amp;style=flat">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&amp;logoColor=white&amp;style=flat">
</p>

<p align="center">
  <a href="#io-en-30-segundos">30 segundos</a> ·
  <a href="#empezar-en-5-minutos">Empezar</a> ·
  <a href="#modelo-mental">Modelo mental</a> ·
  <a href="#arquitectura">Arquitectura</a> ·
  <a href="#estado-del-proyecto">Estado</a> ·
  <a href="#documentación">Documentación</a>
</p>

> **Estado:** desarrollo activo. La fundación y la primera vertical empresarial ya corren de punta a punta contra PostgreSQL vivo y DeepSeek real. IO **todavía no es un sistema listo para producción**. Esta documentación describe el estado real, sin inflar capacidades.

---

## IO en 30 segundos

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/io-system-map-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/io-system-map-light.svg">
  <img alt="Mapa operativo de IO: empresa, eventos, heartbeat determinístico, cero tokens sin novedad, trabajo, worker, evidencia y aprendizaje" src="docs/assets/io-system-map-dark.svg" width="100%">
</picture>

IO no intenta construir un chatbot más grande ni un enjambre de agentes hablando entre sí. Su unidad principal es la **empresa**.

Trabajadores de IA ejecutan trabajo de negocio — documentos, análisis y entregables — dentro de sandboxes reversibles, bajo autoridad humana explícita. Cada activación tiene costo, cada trabajador tiene límites y cada resultado debe dejar evidencia verificable.

| Contrato | Qué significa en IO |
|---|---|
| **Empresa antes que agente** | Estrategia, procesos, puestos y autoridad existen antes de elegir un modelo. |
| **El silencio cuesta cero** | Si no hay novedad material, el heartbeat termina sin invocar al LLM. |
| **Autoridad proporcional al riesgo** | El fundador/directorio conserva finalidad, capital y acciones irreversibles. |
| **Evidencia antes que confianza** | Receipts, eventos y journals prueban qué ocurrió. |
| **Costo como parte del razonamiento** | Tokens, contexto y KV-cache se tratan como recursos económicos. |

La visión completa — capas empresariales, memoria y economía cognitiva — está en el [documento fundacional](docs/IO_EMPRESA_AGENTICA_ARQUITECTURA_Y_MEMORIA_2026.md).

---

## Empezar en 5 minutos

Requisitos: Node 24 LTS (ver [.nvmrc](.nvmrc)), pnpm 11 y Docker.

```bash
git clone https://github.com/riquelmechile/io.git
cd io
nvm use
corepack enable
pnpm install
docker compose up -d
pnpm test
```

PostgreSQL local queda disponible mediante [docker-compose.yml](docker-compose.yml) en:

```text
postgresql://io:io_dev@localhost:5432/io_dev
```

Para ejecutar todas las puertas de calidad:

```bash
pnpm check
```

`pnpm check` ejecuta, en orden: format → typecheck → build → lint → test.

<details>
<summary><strong>Qué comprueba el CI con PostgreSQL en vivo</strong></summary>

El CI ([ci.yml](.github/workflows/ci.yml)) corre integración y E2E contra un servicio `postgres:18` real con `IO_REQUIRE_PG=1`. Si la base no está disponible, las suites fallan ruidosamente: el vertical real no se oculta detrás de skips silenciosos.

</details>

---

## Modelo mental

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/io-workflow-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/io-workflow-light.svg">
  <img alt="Flujo de activación de IO: detectar, decidir, activar, ejecutar, probar y aprender bajo límites humanos" src="docs/assets/io-workflow-dark.svg" width="100%">
</picture>

La idea central es simple: **estar disponible 24/7 no significa llamar al modelo 24/7**.

```text
Empresa → estrategia → portafolio → procesos → puestos
       → trabajadores agénticos → trabajo → artefactos
       → resultados → aprendizaje
```

Un evento entra al sistema. Antes de gastar tokens, un gate determinístico decide si existe novedad material. Solo entonces se activa la empresa, se despacha trabajo y un worker puede usar el LLM. El resultado vuelve como evidencia y aprendizaje.

### El camino de una activación

1. **Evento de negocio.** Algo cambia en el stream append-only de la empresa.
2. **Heartbeat.** Una función pura decide si existe novedad material.
3. **Cero tokens cuando corresponde.** Si nada exige acción, termina como `no-llm-heartbeat`.
4. **Supervisor.** Descubre empresas y activa únicamente las que tienen trabajo real.
5. **Work dispatch.** Se toma el `Work` aceptado más antiguo.
6. **Worker.** Plan LLM → sandbox reversible → cierre atómico.
7. **Evidencia.** Receipts de negocio y journal de idempotencia dejan constancia verificable.

<details>
<summary><strong>Abrir el flujo técnico</strong></summary>

```mermaid
flowchart TD
    E["Stream de eventos de negocio\nappend-only · PostgreSQL"] --> G{"Heartbeat gate\nfunción pura · sin LLM"}
    G -- "sin novedad material" --> Z["no-llm-heartbeat\n0 tokens"]
    G -- "novedad material" --> S["Supervisor\nactiva la empresa"]
    S --> D["Work dispatch\nWork aceptado más antiguo"]
    D --> W["Ciclo de worker"]
    W --> P["Plan LLM\nDeepSeek Flash"]
    P --> X["Sandbox\nreversible"]
    X --> R["Cierre atómico\nreceipts + journal"]
    R --> E
```

La fuente de verdad es un log de eventos de negocio append-only en PostgreSQL. Los cursores permiten procesamiento *at-least-once* y recuperación segura ante caídas.

</details>

---

## Por qué existe

Muchos sistemas agénticos gastan tokens incluso cuando no hay trabajo nuevo: loops periódicos consultan al modelo solo para descubrir que no deben hacer nada. Eso eleva el costo, invalida contexto útil y hace difícil sostener una empresa agéntica 24/7.

IO parte de otra premisa: **el costo es parte del razonamiento**.

- Cada activación tiene presupuesto y utilidad esperada.
- El contexto se compila con prefijos estables por cohorte para favorecer hits de KV-cache.
- El modelo se invoca después de una decisión determinística, no para decidir si merece ser invocado.
- La autonomía se asigna por autoridad y riesgo, no por entusiasmo con el modelo.

---

## Arquitectura

IO es un monorepo TypeScript con pnpm workspaces y arquitectura hexagonal. El dominio puro no depende de proveedores externos; PostgreSQL, DeepSeek y el sandbox viven detrás de puertos reemplazables.

### Mapa de paquetes

| Paquete | Responsabilidad |
|---|---|
| [`@io/business-domain`](packages/business-domain) | Dominio puro: Work, receipts, eventos de negocio y heartbeat. |
| [`@io/trust-kernel`](packages/trust-kernel) | Principals y evaluación de autoridad. |
| [`@io/context`](packages/context) | Compilación de contexto y prefijos estables para economía de KV-cache. |
| [`@io/database`](packages/database) | PostgreSQL: eventos append-only, cursores, work, receipts y journal. |
| [`@io/llm-client`](packages/llm-client) | Cliente DeepSeek: thinking, tools y costo de cache. |
| [`@io/app`](packages/app) | Composición: supervisor, dispatch y proceso worker con sandbox. |

Las decisiones arquitectónicas aceptadas se registran como ADR en el [índice de decisiones](docs/adr/README.md).

<details>
<summary><strong>Qué autoridad mantiene el humano</strong></summary>

El fundador/directorio conserva la autoridad constitucional de la empresa: finalidad, capital, límites críticos y acciones irreversibles. Los trabajadores operan con libertad proporcional al riesgo y con límites explícitos de misión, presupuesto y desempeño.

</details>

<details>
<summary><strong>Qué significa «evidencia verificable»</strong></summary>

IO no considera suficiente que un agente declare «terminé». Las acciones relevantes deben quedar reflejadas en artefactos, eventos, receipts o journals que permitan comprobar qué ocurrió y reconstruir el estado sin depender de memoria conversacional.

</details>

---

## Estado del proyecto

IO se construye por incrementos verificables: cada incremento debe funcionar y producir evidencia antes de avanzar al siguiente.

| Estado | Qué |
|---|---|
| **Completado** | Fundación de desarrollo root-only ([ADR-0004](docs/adr/README.md)), dominio (Work, receipts, eventos y heartbeat), trust kernel, persistencia PostgreSQL, cliente DeepSeek con E2E en vivo, compilador de contexto, activación por heartbeat, supervisor timer y work dispatch, daemon durable, heartbeat decision events, escalada Flash→Pro, fencing tokens, supervisor recovery (Scope B), cold-start discovery, Skill outcome BusinessEvents y la fundación de evidencia de Learning/promotion (contratos de candidatos, políticas, agregación de outcomes, validación descriptor-safe de evidencia, observaciones, evidencia explícita y referencias y alcances de autoridad). |
| **Siguiente** | Incremento 8 — Learning/promotion: evaluador de promociones y puertos de candidatos y autoridad sobre la fundación de evidencia ya entregada; luego capa app y persistencia PostgreSQL para completar el ciclo `candidate → active`, trazado en [pasos siguientes](docs/PASOS_SIGUIENTES_INCREMENTO_4.md). |

Todo el trabajo se entrega bajo Spec-Driven Development. El historial verificable está en [`openspec/changes/archive/`](openspec/changes/archive/).

---

## Documentación

| Necesito | Ir a |
|---|---|
| **Entender la visión completa** | [Arquitectura maestra, memoria y economía cognitiva](docs/IO_EMPRESA_AGENTICA_ARQUITECTURA_Y_MEMORIA_2026.md) |
| **Revisar decisiones aceptadas** | [Índice de ADR](docs/adr/README.md) |
| **Seguir el próximo incremento** | [Pasos siguientes](docs/PASOS_SIGUIENTES_INCREMENTO_4.md) |
| **Contribuir al proyecto** | [Guía de contribución](CONTRIBUTING.md) |
| **Auditar cambios entregados** | [Archivo OpenSpec](openspec/changes/archive/) |
| **Operar el proceso durable** | [Operación del daemon](docs/daemon-operation.md) |

<details>
<summary><strong>Compatibilidad de los visuales</strong></summary>

GitHub selecciona automáticamente los pares dark/light del hero, mapa y flujo mediante `<picture>`. [`docs/assets/io-operating-model.svg`](docs/assets/io-operating-model.svg) aporta una vista estable del modelo operativo, independiente del tema, para enlaces o renderizadores que necesiten una única ruta fija.

</details>

---

## Metodología

IO se desarrolla con **Spec-Driven Development sobre OpenSpec**: propuesta → especificación → diseño → tareas → implementación → verificación → archivo.

La implementación sigue TDD estricto (**RED → GREEN → REFACTOR**) y la entrega se autoriza mediante evidencia de revisión. La documentación obedece la misma idea: primero el camino mínimo para entender y ejecutar; la profundidad queda disponible cuando hace falta.

---

## Cuando algo falla

<details>
<summary><strong>PostgreSQL no está disponible</strong></summary>

Comprueba primero que el servicio local esté levantado:

```bash
docker compose up -d
```

Las suites que requieren PostgreSQL deben fallar de forma explícita cuando `IO_REQUIRE_PG=1`; no esperes un skip silencioso.

</details>

<details>
<summary><strong>No sé por dónde seguir leyendo</strong></summary>

- Si quieres entender **la idea**: empieza por [IO en 30 segundos](#io-en-30-segundos).
- Si quieres **ejecutar el repo**: ve a [Empezar en 5 minutos](#empezar-en-5-minutos).
- Si quieres entender **la arquitectura completa**: abre el [documento fundacional](docs/IO_EMPRESA_AGENTICA_ARQUITECTURA_Y_MEMORIA_2026.md).
- Si quieres entender **por qué se tomó una decisión**: revisa los [ADR](docs/adr/README.md).
- Si quieres ver **qué se entregó realmente**: revisa [OpenSpec](openspec/changes/archive/).

</details>

---

<p align="center">
  <strong>IO no se mide por cantidad de agentes ni tokens gastados.</strong><br>
  Se mide por trabajo terminado, costo por resultado y aprendizaje comprobado.
</p>
