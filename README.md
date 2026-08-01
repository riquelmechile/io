# IO

IO es una empresa digital operada por trabajadores agénticos y dirigida por un fundador/directorio humano. El repositorio se encuentra en fase de arquitectura y planificación: **el desarrollo de la aplicación aún no ha comenzado**.

## Documentación

- [Arquitectura maestra, memoria y economía cognitiva](docs/IO_EMPRESA_AGENTICA_ARQUITECTURA_Y_MEMORIA_2026.md)
- [Índice de decisiones arquitectónicas](docs/adr/README.md)
- [Contrato de dominio v2](openspec/changes/io-domain-contract-v2/exploration.md)
- [Contrato de puertos y confianza v2](openspec/changes/io-ports-trust-contract-v2/exploration.md)
- [Contrato de persistencia y recuperación](openspec/changes/io-persistence-recovery-contract/exploration.md)
- [Contrato de entrega y calidad](openspec/changes/io-delivery-quality-contract/exploration.md)

## Estado

Los ADR y contratos aprobados consolidan límites de dominio, autoridad, persistencia, recuperación y flujo de desarrollo. La fundación de desarrollo está bootstrapeada (ADR-0004): toolchain root-only (TypeScript 6 strict-ESM + Node 24 LTS + Vitest + Biome + tsc) y los primeros slices transicionales de paquete viven en `packages/` (`app`, `business-domain`, `database`, `llm-client`, `trust-kernel`) — todos implementados bajo SDD (OpenSpec en `openspec/changes/`). Existe CI de aplicación/toolchain (`.github/workflows/ci.yml`) además del workflow de gobernanza de contribuciones.

### PostgreSQL en CI (obligatorio, sin skips silenciosos)

Los tests de integración de `@io/database` corren contra PostgreSQL 18.4 en vivo. Localmente, si no hay un contenedor alcanzable, se saltan (`describe.skipIf(!reachable)`) — comportamiento correcto para desarrollo. En CI **no se saltan**: el job `check` levanta un servicio `postgres:18` y ejecuta con `IO_REQUIRE_PG=1`, de modo que si PostgreSQL no está disponible la suite **falla ruidosamente** en lugar de pasar en silencio (guard: `packages/database/test/pg-required.integration.test.ts`). Verificar localmente que la integración corrió: `pnpm vitest run packages/database --reporter=verbose` debe mostrar las suites `integration: …` ejecutándose, no `skipped`.

**Siguiente paso:** continua el pipeline SDD del cambio `harden-first-enterprise-vertical-foundation` (ver `openspec/changes/`).
