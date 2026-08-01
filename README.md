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

Los tests de integración de `@io/database` y los tests E2E de `packages/app` (`packages/app/test/e2e/*.integration.test.ts`, el vertical real: worker + sandbox + ciclo completo contra PostgreSQL en vivo) corren contra PostgreSQL 18.4 en vivo. Localmente, si no hay un contenedor alcanzable y `IO_REQUIRE_PG` no está definido, se saltan (`describe.skipIf(!reachable && !e2eRequirePg)`) — comportamiento correcto para desarrollo. En CI **no se saltan**: el job `check` levanta un servicio `postgres:18` y ejecuta con `IO_REQUIRE_PG=1`, de modo que si PostgreSQL no está disponible las suites **fallan ruidosamente** en lugar de pasar en silencio (guard: `packages/database/test/pg-required.integration.test.ts`; el E2E de app falla en `createE2eHarness` con ECONNREFUSED). Verificar localmente que la integración corrió: `pnpm vitest run packages/app/test/e2e --reporter=verbose` debe mostrar las suites `E2E (…): …` ejecutándose, no `skipped`.

**Siguiente paso:** revisión del cambio `first-enterprise-vertical` (ver `openspec/changes/`).
