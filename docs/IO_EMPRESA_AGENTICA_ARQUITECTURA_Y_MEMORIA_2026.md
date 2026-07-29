# IO — Empresa agéntica: arquitectura maestra, memoria, aprendizaje y economía cognitiva

> **Estado:** documento fundacional de investigación y decisión arquitectónica.  
> **Fecha de corte:** 29 de julio de 2026.  
> **Repositorio:** `riquelmechile/io`.  
> **Alcance:** IO se construirá como producto propio. No reutiliza como núcleo Paperclip, EAUTO-AI, Elcontador, Mastra, LangGraph, CrewAI, AutoGen, Mem0, Zep, Engram ni otro framework agéntico. Las referencias estudiadas sirven únicamente para extraer principios, riesgos y patrones comprobables.

---

## 1. Decisión ejecutiva

IO será una **empresa digital operada por trabajadores agénticos**, dirigida por un fundador/directorio humano y capaz de crear, administrar y escalar múltiples productos y unidades de negocio.

No será:

- un chatbot;
- un enjambre de prompts;
- un plugin de IDE;
- un clon de un framework de agentes;
- una capa sobre otro runtime;
- una simulación teatral de cargos empresariales;
- una memoria vectorial con una interfaz bonita.

Será un sistema empresarial completo que modele y ejecute:

```text
Empresa
  → estrategia
    → portafolio
      → procesos
        → departamentos
          → puestos
            → trabajadores agénticos
              → objetivos
                → proyectos
                  → trabajo
                    → artefactos
                      → resultados
                        → aprendizaje
```

La unidad principal no es el agente. La unidad principal es la **empresa**, con sus objetivos, procesos, recursos, autoridad y resultados.

---

## 2. Principios no negociables

1. **Autoridad humana constitucional.** El fundador/directorio conserva la autoridad sobre la finalidad de la empresa, capital, límites críticos, acciones irreversibles y modificación de la constitución.
2. **Libertad proporcional al riesgo.** Los agentes pueden investigar, planificar, coordinar, crear documentos, experimentar en sandbox y ejecutar acciones reversibles dentro de políticas y presupuestos.
3. **Separación de funciones.** Proponer, revisar, aprobar, ejecutar y verificar son capacidades distintas.
4. **Memoria no es verdad operacional.** Una memoria puede orientar; los hechos operacionales sensibles deben verificarse contra fuentes autoritativas.
5. **Aprendizaje desde outcomes.** La empresa aprende de resultados comprobados, no de la seguridad verbal del modelo.
6. **Trabajo durable.** Reinicios, timeouts o compactaciones no pueden borrar compromisos, decisiones ni progreso.
7. **Comunicación estructurada.** El chat coordina; las tareas, decisiones, contratos, artefactos y receipts constituyen el registro oficial.
8. **Costo como parte del razonamiento.** Cada activación tiene un presupuesto y una utilidad esperada.
9. **Contexto como recurso escaso.** La información se recupera selectivamente y se organiza para aprovechar KV cache.
10. **Construcción incremental.** La empresa mínima debe funcionar y producir evidencia antes de aumentar departamentos, agentes o autonomía.

---

## 3. Lecciones del libro completo

Referencia principal: [The Amazing Gentleman Programming Book](https://the-amazing-gentleman-programming-book.vercel.app/es).

### 3.1 Capítulos 1 y 2 — Entrega, comunicación y conocimiento

La empresa debe operar mediante ciclos pequeños:

```text
necesidad
→ criterios observables
→ trabajo acotado
→ entrega
→ feedback
→ corrección
```

Debe existir una separación explícita entre:

- **fuente de conocimiento:** políticas, manuales, decisiones, procedimientos y contexto;
- **fuente de ejecución:** objetivo, tarea, responsable, estado, deadline y entregable.

Una conversación no reemplaza ninguna de las dos. Toda decisión nacida en una conversación debe consolidarse en el sistema oficial.

### 3.2 Capítulos 3 y 7 — Dominio protegido

Las reglas empresariales deben sobrevivir a cambios de modelos, APIs, interfaces, bases de datos y herramientas.

```text
Dominio empresarial
  ├── empresas
  ├── objetivos
  ├── procesos
  ├── departamentos
  ├── puestos
  ├── contratos
  ├── autoridad
  ├── presupuestos
  ├── aprendizaje
  └── resultados

Infraestructura
  ├── DeepSeek
  ├── PostgreSQL
  ├── GitHub
  ├── correo
  ├── navegador
  └── sistema operativo
```

La infraestructura sirve al dominio; no lo define.

### 3.3 Capítulo 6 — Complejidad y límites

Cada proceso debe declarar:

- entradas y salidas;
- complejidad esperada;
- presupuesto de tiempo y tokens;
- condición terminal;
- escenarios de error;
- límites de iteración;
- fallos parciales;
- estrategia de recuperación.

### 3.4 Capítulo 8 — Scope Rule empresarial

Una capacidad se mantiene en el scope mínimo real:

- usada por un puesto: pertenece al puesto;
- usada por varios puestos del mismo departamento: pertenece al departamento;
- usada por varias unidades: se transforma en servicio corporativo;
- no se crea una capacidad compartida por una reutilización hipotética.

### 3.5 Capítulo 10 — Contratos y estados válidos

Los agentes no deben intercambiar texto libre como contrato operativo. Trabajo, comunicaciones, aprobaciones, memorias y resultados deben tener esquemas que hagan explícitos sus estados válidos.

### 3.6 Capítulo 15 — Especialización agéntica

Un agente universal con autoridad amplia aumenta errores, cambios no relacionados y falsa confianza. Cada trabajador debe poseer:

- misión;
- manager;
- responsabilidades;
- competencias;
- herramientas;
- ámbito de autoridad;
- presupuesto;
- formato de entrega;
- definición de buen desempeño.

### 3.7 Capítulo 17 — Liderazgo, delegación y feedback

Un director no debe resolver el trabajo de todos. Debe crear contexto, asignar autoridad, remover bloqueos, revisar hitos y aumentar la autonomía del equipo mediante feedback verificable.

### 3.8 Capítulo 18 — Arquitectura como gestión de restricciones

IO comenzará como un **monolito modular**. Microservicios, bases especializadas o motores distribuidos solo se introducirán cuando una métrica demuestre la necesidad.

### 3.9 Capítulo 19 — Patrones de orquestación

IO implementará directamente:

- routing;
- prompt chaining;
- ejecución paralela;
- orchestrator-workers;
- evaluator-optimizer;
- handoffs;
- human-in-the-loop;
- límites de costo y ciclos.

El patrón se elige según la tarea. No toda tarea justifica múltiples agentes.

### 3.10 Capítulo 20 — Contexto, memoria y skills

La API del modelo es stateless. La continuidad debe ser construida externamente mediante:

- estado de trabajo;
- memoria persistente;
- recuperación;
- compactación;
- skills;
- contexto selectivo;
- herramientas;
- políticas.

La memoria no consiste en reenviar todo el historial. Consiste en recuperar el mínimo conjunto de información que permite actuar correctamente.

### 3.11 Capítulo 21 — Confianza verificable

Una afirmación del agente como “terminado”, “aprobado” o “correcto” no constituye evidencia. IO deberá vincular la autorización con:

- identidad exacta del trabajo;
- versión y hash del artefacto;
- política aplicada;
- evidencia ejecutada;
- actor autorizado;
- estado terminal;
- receipt.

---

## 4. Capas empresariales de IO

IO tendrá nueve capas centrales y tres planos transversales.

### 4.1 Constitución y directorio

- propósito;
- propiedad;
- autoridad humana;
- principios;
- restricciones críticas;
- modificación constitucional;
- decisiones reservadas al directorio.

### 4.2 Estrategia, capital y portafolio

- visión;
- objetivos corporativos;
- tesis de inversión;
- unidades de negocio;
- productos;
- asignación de capital;
- experimentos;
- escalamiento, pausa o cierre.

### 4.3 Modelo operativo

- mapa de procesos;
- propietarios de procesos;
- entradas y salidas;
- controles;
- SLA;
- indicadores;
- riesgos;
- procedimientos.

### 4.4 Organización y fuerza laboral

- departamentos;
- puestos;
- trabajadores;
- organigrama;
- competencias;
- capacidad;
- contratos;
- onboarding;
- desempeño;
- carrera;
- sucesión.

### 4.5 Objetivos, proyectos y trabajo

- objetivos y resultados clave;
- programas;
- proyectos;
- tareas;
- dependencias;
- bloqueos;
- entregables;
- deadlines;
- ownership.

### 4.6 Coordinación y comunicación

- delegaciones;
- consultas;
- handoffs;
- solicitudes entre departamentos;
- escalaciones;
- decisiones;
- anuncios;
- reuniones;
- compromisos.

### 4.7 Cognición y orquestación

- selección Flash/Pro;
- thinking/non-thinking;
- routing;
- planificación;
- equipos temporales;
- loops de revisión;
- herramientas;
- condición terminal;
- presupuesto.

### 4.8 Conocimiento, memoria y aprendizaje

- conocimiento institucional;
- memoria episódica;
- memoria semántica;
- procedimientos;
- skills;
- currículos;
- evaluaciones;
- incidentes;
- outcomes;
- consolidación.

### 4.9 Ejecución y mundo exterior

- repositorios;
- correo;
- navegador;
- shell;
- documentos;
- APIs;
- despliegues;
- sandboxes;
- sistemas empresariales.

### 4.10 Planos transversales

#### Confianza y autoridad

Identidad, permisos, políticas, aprobaciones, secretos, privacidad, auditoría, receipts y segregación de funciones.

#### Economía computacional

Presupuesto por empresa, departamento, puesto, tarea, modelo, herramienta y resultado.

#### Observabilidad y evaluación

Trazas, estados, calidad, costos, errores, correcciones, SLA, outcomes e impacto.

---

## 5. Producto técnico

IO será un producto propio con cuatro superficies.

### 5.1 Aplicación web/PWA

Centro de mando para fundador y directorio:

- empresas y productos;
- organigrama;
- trabajadores;
- objetivos;
- procesos;
- proyectos;
- bandeja de decisiones;
- aprobaciones;
- memoria;
- capacitación;
- presupuesto;
- costos DeepSeek;
- auditoría.

### 5.2 Runtime servidor

- API;
- workers;
- scheduler;
- heartbeats;
- workflows durables;
- comunicación;
- memoria;
- ejecución;
- observabilidad.

### 5.3 Daemon local

- Git;
- shell;
- archivos;
- tests;
- navegador;
- sandboxes;
- recursos locales;
- ejecución autorizada.

### 5.4 CLI

```text
io company
io portfolio
io org
io worker
io work
io memory
io train
io budget
io approvals
io audit
io doctor
```

Un IDE puede integrarse posteriormente, pero no será el núcleo de la empresa.

---

## 6. Stack verificado al 29 de julio de 2026

### 6.1 Lenguaje

**TypeScript 6.x inicialmente.** TypeScript 6.0 es la versión estable de transición hacia el port nativo de TypeScript 7; no se debe declarar TypeScript 7 como estable hasta que la publicación oficial lo confirme.

Referencia: [TypeScript 6.0 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html).

### 6.2 Runtime

**Node.js 24 LTS**, usando siempre el último parche de seguridad disponible de la rama 24.x.

Node.js 26 es Current y no entrará en LTS hasta octubre de 2026. Producción debe usar una rama LTS.

Referencias:

- [Node.js releases](https://nodejs.org/en/about/previous-releases)
- [Node.js security releases — July 2026](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases)

### 6.3 Persistencia

**PostgreSQL 18.4** como fuente autoritativa. PostgreSQL 19 permanece en beta durante julio de 2026 y no debe usarse en producción.

Referencias:

- [PostgreSQL release notes](https://www.postgresql.org/docs/release/)
- [PostgreSQL 19 Beta 2](https://www.postgresql.org/about/news/postgresql-19-beta-2-released-3350/)

### 6.4 Dependencias permitidas

No se utilizarán frameworks que contengan decisiones agénticas o empresariales. Sí se permiten primitivas de infraestructura mantenidas y auditables:

- runtime y librería estándar;
- driver PostgreSQL;
- librería criptográfica madura cuando la estándar no cubra el caso;
- herramientas de compilación, lint y testing;
- navegador y estándares web;
- sistema operativo y contenedores cuando corresponda.

### 6.5 Componentes propios

IO construirá directamente:

- dominio empresarial;
- runtime agéntico;
- scheduler;
- workflow engine;
- communication bus;
- memory system;
- learning engine;
- contratos;
- policy engine;
- approvals;
- receipts;
- context compiler;
- DeepSeek client;
- KV-cache manager;
- budget engine;
- evaluation engine;
- UI kernel;
- CLI;
- daemon.

---

## 7. DeepSeek V4 y economía cognitiva

IO estará optimizado directamente para:

- `deepseek-v4-flash`;
- `deepseek-v4-pro`.

Según la documentación oficial vigente:

| Modelo | Entrada cache hit / 1M | Entrada cache miss / 1M | Salida / 1M | Contexto | Concurrencia |
|---|---:|---:|---:|---:|---:|
| V4 Flash | US$0,0028 | US$0,14 | US$0,28 | 1M | 2500 |
| V4 Pro | US$0,003625 | US$0,435 | US$0,87 | 1M | 500 |

Referencias:

- [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)
- [DeepSeek V4 release](https://api-docs.deepseek.com/news/news260424/)
- [Rate Limit & Isolation](https://api-docs.deepseek.com/quick_start/rate_limit/)

### 7.1 Política de modelos

```text
Flash non-thinking
→ clasificación, triage, seguimiento y procedimientos mecánicos

Flash thinking
→ análisis operativo normal

Pro thinking
→ planificación, evaluación, investigación compleja y arquitectura

Pro high/max
→ estrategia crítica, incidentes, conflictos y revisión adversarial
```

La jerarquía laboral no determina el modelo. La complejidad, riesgo y valor de la tarea sí.

### 7.2 KV cache

DeepSeek reutiliza automáticamente prefijos idénticos desde el token inicial. No garantiza un hit del 100%; las entradas pueden expirar después de horas o días sin uso.

Referencia: [DeepSeek Context Caching](https://api-docs.deepseek.com/news/news0802/).

Orden canónico del contexto:

```text
1. Protocolo DeepSeek
2. Constitución
3. Políticas corporativas
4. Empresa y departamento
5. Contrato del puesto
6. Competencias certificadas
7. Skills activadas
8. Proceso empresarial
9. Baseline del producto/proyecto
────────────────────────────────
10. Memoria recuperada
11. Trabajo actual
12. Evidencia reciente
13. Resultados de herramientas
```

Los bloques 1–9 forman el prefijo estable. Los bloques 10–13 son el sufijo dinámico.

No se deben colocar al principio:

- fecha actual;
- IDs aleatorios;
- nonce;
- heartbeat;
- snapshot reciente;
- mensaje variable;
- tool result.

### 7.3 Cache cohorts

`user_id` permite aislamiento de KV cache y scheduling. No debe contener datos personales.

Ejemplos:

```text
io-corporate-governance-v1
io-product-research-v1
io-engineering-v1
io-finance-v1
io-security-v1
```

Dos trabajadores comparten cohorte solo si comparten política, privacidad y prefijo exacto.

---

# 8. Investigación de Engram

Repositorio: [Gentleman-Programming/engram](https://github.com/Gentleman-Programming/engram).

Engram es un sistema de memoria persistente para agentes de programación. Su arquitectura principal utiliza:

- binario en Go;
- SQLite;
- FTS5;
- MCP por stdio;
- API HTTP local;
- CLI y TUI;
- sesiones;
- observaciones estructuradas;
- búsqueda progresiva;
- sincronización Git;
- replicación cloud opcional.

### 8.1 Patrones valiosos de Engram

#### Memorias estructuradas

En vez de almacenar conversaciones completas, el agente guarda decisiones, descubrimientos, bugfixes, patrones y configuraciones.

#### Ciclo de sesión

```text
inicio
→ trabajo
→ memorias significativas
→ resumen de sesión
→ recuperación en la siguiente sesión
```

#### Divulgación progresiva

Engram recomienda:

1. búsqueda compacta;
2. contexto temporal alrededor del resultado;
3. recuperación del contenido completo.

Esto reduce tokens y evita cargar todo el historial.

#### Topic keys

Una clave estable permite actualizar conocimiento que evoluciona sin crear infinitos duplicados.

Ejemplos:

```text
architecture/auth-model
decision/database-choice
pattern/error-handling
```

#### Higiene

- deduplicación exacta;
- contador de duplicados;
- revisión temporal;
- soft delete;
- revisions;
- scopes `project`, `personal` y `global`;
- conflictos y relaciones como `supersedes` o `conflicts_with`.

#### Local-first

SQLite local continúa siendo fuente de verdad; cloud es replicación opcional.

### 8.2 Limitaciones de Engram para IO

Engram no debe usarse como memoria central de IO porque:

1. **Está orientado a agentes de programación**, no a empresas, contratos, clientes, procesos y capital.
2. **Confía en que el agente decida qué guardar.** En IO, ciertas memorias deben producirse obligatoriamente desde eventos determinísticos.
3. **La observación es la unidad principal.** IO necesita business objects, relaciones, estados, authority weight y lineage.
4. **SQLite local no es suficiente** para una empresa multiagente concurrente con control de acceso y consistencia compartida.
5. **FTS5 es excelente para búsqueda textual**, pero no resuelve por sí solo temporalidad, causalidad, relaciones y conflictos empresariales.
6. **Los scopes son demasiado simples** para empresa, unidad, departamento, puesto, agente, cliente, producto y clasificación de información.
7. **El topic upsert reemplaza contenido actual**, mientras IO debe preservar historia completa y construir una vista vigente aparte.
8. **El agente participa en el juicio de conflictos.** En IO, un juicio agéntico puede proponer una relación, pero la promoción requiere política y evidencia.
9. **No modela outcomes.** Una memoria no incorpora de manera nativa la relación entre recomendación, acción, resultado y valor económico.
10. **No es una fuente operacional.** No debe decidir el estado vigente de un contrato, presupuesto o proceso crítico.

### 8.3 Decisión sobre Engram

**No se incorporará Engram como dependencia de IO.**

Se incorporarán conceptualmente estos principios:

- local-first cuando el ámbito lo permita;
- observaciones estructuradas;
- sesiones;
- topic keys;
- scopes;
- búsqueda progresiva;
- revisión y expiración;
- deduplicación;
- conflicto y supersesión;
- soft delete;
- sincronización explícita;
- herramientas de diagnóstico.

IO implementará estos principios dentro de su propio **IO Memory OS**.

---

# 9. IO Memory OS

La memoria empresarial no será una tabla ni un vector store. Será un sistema compuesto.

## 9.1 Tipos de memoria

### Working memory

Estado efímero de una ejecución:

- plan actual;
- subtareas;
- tool results;
- intentos;
- tokens;
- deadline;
- checkpoints.

### Episodic memory

Hechos que ocurrieron:

- tareas ejecutadas;
- reuniones;
- decisiones;
- incidentes;
- comunicaciones;
- acciones;
- resultados.

Será append-only.

### Semantic memory

Conocimiento consolidado:

- conceptos;
- hechos;
- modelos de negocio;
- definiciones;
- relaciones;
- contexto de mercado.

### Procedural memory

Cómo realizar trabajo:

- procesos;
- SOP;
- skills;
- checklists;
- plantillas;
- criterios de aceptación.

### Organizational memory

- constitución;
- políticas;
- responsabilidades;
- organigrama;
- autoridad;
- estrategia;
- decisiones corporativas.

### Business-object memory

Memoria centrada en objetos:

- empresa;
- producto;
- cliente;
- proveedor;
- contrato;
- proyecto;
- oportunidad;
- activo;
- incidente.

Cada objeto mantiene su evolución temporal, eventos, estado vigente y evidencia.

### Agent memory

- experiencia;
- competencias;
- evaluaciones;
- feedback;
- errores;
- certificaciones;
- hábitos observados;
- desempeño.

### Learning memory

- hipótesis;
- experimento;
- recomendación;
- acción;
- outcome;
- atribución;
- aprendizaje candidato;
- estado de promoción.

### Audit memory

Registro inmutable de:

- quién leyó;
- quién escribió;
- qué cambió;
- con qué autoridad;
- qué política se aplicó;
- qué evidencia existía;
- qué efecto se produjo.

---

## 9.2 Memory Object

Cada unidad de memoria debe contener como mínimo:

```yaml
memory:
  id: uuid
  organization_id: uuid
  namespace: string
  type: episodic | semantic | procedural | organizational | business_object | agent | learning

  subject:
    kind: company | department | role | agent | product | project | customer | contract | other
    id: string

  topic_key: string | null
  title: string
  content: structured payload

  source:
    kind: event | artifact | human | agent | tool | external_source
    id: string
    uri: string | null

  provenance:
    created_by: principal
    observed_at: timestamp
    recorded_at: timestamp
    lineage: [memory_id]
    evidence_refs: [artifact_id]

  validity:
    valid_from: timestamp | null
    valid_to: timestamp | null
    review_after: timestamp | null
    state: candidate | active | needs_review | superseded | disputed | retracted | deleted

  epistemics:
    confidence: 0..1
    authority_weight: number
    claim_kind: fact | observation | inference | opinion | policy | procedure

  security:
    classification: public | internal | confidential | restricted
    read_scope: capability expression
    write_scope: capability expression

  lifecycle:
    revision: integer
    supersedes: [memory_id]
    conflicts_with: [memory_id]
    duplicate_of: memory_id | null
    retention_policy: string

  feedback:
    retrieval_count: integer
    useful_count: integer
    harmful_count: integer
    linked_outcomes: [outcome_id]
```

### Principio central

**No se sobrescribe la historia.**

Una decisión nueva crea un nuevo evento o revisión. La vista vigente se calcula por política, autoridad, temporalidad y evidencia.

---

## 9.3 Proceso de escritura

```text
señal o evento
→ perception gate
→ clasificación
→ sanitización
→ scope y seguridad
→ deduplicación exacta
→ candidatos de similitud/conflicto
→ persistencia append-only
→ indexación
→ actualización de vistas
→ auditoría
```

### Escritura obligatoria determinística

No depende del modelo:

- contrato creado o modificado;
- presupuesto aprobado;
- acción ejecutada;
- artefacto publicado;
- decisión del directorio;
- incidente;
- resultado verificado;
- permiso concedido o revocado.

### Escritura agéntica candidata

El agente puede proponer:

- descubrimiento;
- patrón;
- inferencia;
- oportunidad;
- aprendizaje;
- mejora de proceso.

Estas memorias se guardan como `candidate` hasta cumplir reglas de promoción.

---

## 9.4 Recuperación progresiva

```text
1. Resolver scope, permisos y temporalidad
2. Recuperar business objects relevantes
3. Buscar índices estructurados
4. Búsqueda textual
5. Recorrer relaciones acotadas
6. Búsqueda semántica cuando aporte valor
7. Re-ranking por relevancia, vigencia, autoridad y evidencia
8. Detectar conflictos
9. Construir resumen compacto con referencias
10. Profundizar únicamente cuando el agente lo solicite
```

Orden recomendado:

```text
filtros baratos y determinísticos
→ full-text
→ relaciones
→ semántica
→ juicio del modelo
```

El LLM no debe participar en un loop de retrieval cuando una consulta estructurada puede resolverlo.

---

## 9.5 Resolución de conflictos

Las memorias pueden relacionarse como:

- `related`;
- `compatible`;
- `scoped`;
- `duplicates`;
- `conflicts_with`;
- `supersedes`;
- `retracts`;
- `derived_from`.

El sistema determina vigencia utilizando:

1. scope aplicable;
2. clasificación y permisos;
3. rango temporal;
4. autoridad de la fuente;
5. evidencia;
6. política vigente;
7. estado de revisión;
8. relación de supersesión.

Un agente puede sugerir una relación semántica. No puede borrar silenciosamente una memoria incompatible.

---

## 9.6 Consolidación

La consolidación se ejecutará fuera del camino crítico.

```text
episodios
→ agrupación por objeto/tema
→ detección de patrones
→ contradicciones
→ propuesta semántica
→ evaluación
→ promoción
```

La consolidación debe preservar:

- hechos originales;
- procedencia;
- incertidumbre;
- cambios temporales;
- opiniones minoritarias relevantes.

No debe crear un “resumen bonito” que elimine decisiones, pendientes o errores.

---

## 9.7 Olvido, revisión y retención

Olvidar no significa eliminar arbitrariamente.

Mecanismos:

- TTL para working memory;
- `review_after` para conocimiento cambiante;
- decaimiento de ranking;
- archivado;
- supersesión;
- soft delete;
- hard delete solo por política legal o de privacidad;
- retención inmutable para auditoría.

Las políticas dependen del tipo de memoria y clasificación.

---

## 9.8 Consistencia multiagente

La consistencia es uno de los problemas más difíciles de la memoria compartida.

IO aplicará:

- namespaces por empresa, unidad, departamento, producto y agente;
- permisos de lectura/escritura separados;
- append-only para eventos;
- optimistic concurrency para revisiones;
- current views materializadas;
- locks o leases en consolidaciones;
- idempotency keys;
- lineage;
- causal ordering cuando corresponda;
- auditoría de cada write;
- prohibición de usar memoria como bypass de una fuente operacional.

Referencia conceptual: [Multi-Agent Memory from a Computer Architecture Perspective](https://arxiv.org/abs/2603.10062).

---

## 9.9 Memoria y KV cache

La memoria recuperada siempre pertenece al **sufijo dinámico** del prompt. No debe insertarse antes de la constitución, políticas, contrato o skills.

El contexto compilado registrará:

- IDs de memorias recuperadas;
- tokens aportados;
- razón de selección;
- score;
- conflictos presentes;
- vigencia;
- costo estimado;
- cache hit/miss real;
- impacto posterior.

Esto permitirá aprender qué memorias ayudan y cuáles degradan resultados.

---

## 9.10 Métricas de memoria

### Calidad

- precisión de recuperación;
- relevancia;
- vigencia;
- tasa de contradicciones no detectadas;
- atribución correcta de fuentes;
- cobertura de decisiones;
- pérdida de pendientes tras compactación.

### Economía

- tokens recuperados;
- tokens descartados;
- cache hit ratio;
- costo por consulta;
- costo por memoria útil;
- ahorro frente a full context.

### Aprendizaje

- memorias vinculadas a outcomes positivos;
- memorias corregidas por humanos;
- memorias dañinas;
- skills promovidas;
- recurrencia de errores conocidos.

### Operación

- latencia;
- tamaño por namespace;
- consolidaciones pendientes;
- conflictos abiertos;
- memorias vencidas;
- salud de índices;
- restore verificado.

---

# 10. Aprendizaje y capacitación laboral

Los agentes tendrán tiempo asignado a capacitación y exploración.

## 10.1 Ciclo

```text
brecha detectada
→ objetivo de aprendizaje
→ fuentes autorizadas
→ estudio
→ práctica
→ evaluación independiente
→ simulación
→ comparación contra baseline
→ certificación o rechazo
→ aplicación supervisada
```

## 10.2 Distribución inicial de capacidad

- 70% trabajo productivo;
- 10% coordinación;
- 10% capacitación;
- 5% investigación exploratoria;
- 5% evaluación y mejora de procesos.

La distribución cambia según el cargo.

## 10.3 Resultado de capacitación

Una capacitación debe producir al menos uno:

- competencia certificada;
- mejora medible;
- reducción de errores;
- nueva skill;
- procedimiento actualizado;
- investigación aceptada;
- caso de entrenamiento;
- evaluación reproducible.

Leer documentos o gastar tokens no constituye aprendizaje.

---

# 11. Contratos y creación de la organización por el CEO

El CEO agéntico podrá detectar necesidades y proponer estructura.

```text
necesidad
→ workforce requirement
→ diseño del puesto
→ análisis de duplicidad
→ presupuesto
→ revisión de riesgo
→ currículo
→ simulación
→ aprobación según autoridad
→ contrato versionado
→ onboarding
→ probation
→ certificación
```

El CEO puede crear automáticamente roles temporales de bajo riesgo dentro de un presupuesto preaprobado.

Requiere aprobación humana para:

- cargos con acceso a dinero, secretos o producción crítica;
- aumentos de presupuesto corporativo;
- autoridad de aprobación;
- modificación constitucional;
- eliminación de auditoría;
- contratos jurídicos;
- movimientos irreversibles.

---

# 12. Comunicación empresarial

## 12.1 Fuentes oficiales

```text
Chat = coordinación temporal
Task ledger = compromiso de ejecución
Artifact store = entregable
Decision record = decisión oficial
Receipt = evidencia de ejecución
Outcome = efecto verificado
Memory = conocimiento recuperable
```

## 12.2 Handoff

```yaml
handoff:
  work_id: uuid
  sender: principal
  receiver: principal
  objective: string
  why: string
  scope:
    allowed: []
    forbidden: []
  acceptance_criteria: []
  evidence_refs: []
  current_state:
    completed: []
    pending: []
    blockers: []
  authority:
    read: []
    propose: []
    execute: []
  budget: {}
  deadline: timestamp
  expected_outputs: []
```

Un mensaje sin objetivo, autoridad, evidencia y salida esperada no es una delegación válida.

---

# 13. Runtime propio

## 13.1 Ciclo de trabajador

```text
despertar
→ verificar contrato
→ verificar presupuesto y permisos
→ leer bandeja
→ recuperar memoria
→ compilar contexto
→ seleccionar Flash/Pro
→ razonar
→ producir plan estructurado
→ ejecutar acciones permitidas
→ colaborar o escalar
→ producir artefactos
→ verificar
→ registrar episodio
→ actualizar scorecard
→ reposo
```

## 13.2 Heartbeats

Los agentes estarán disponibles 24/7, pero no llamarán al modelo sin una señal útil.

```text
evento o timer
→ filtro determinístico
→ ¿existe novedad material?
   no → heartbeat sin LLM
   sí → activar Flash
         → escalar a Pro solo por complejidad/riesgo
```

---

# 14. Estructura inicial del repositorio

```text
io/
├── apps/
│   ├── server/
│   ├── web/
│   ├── worker/
│   ├── daemon/
│   └── cli/
├── packages/
│   ├── company/
│   ├── strategy/
│   ├── portfolio/
│   ├── organization/
│   ├── workforce/
│   ├── competency/
│   ├── process/
│   ├── work/
│   ├── communication/
│   ├── contracts/
│   ├── runtime/
│   ├── scheduler/
│   ├── workflows/
│   ├── deepseek/
│   ├── context/
│   ├── memory/
│   ├── learning/
│   ├── tools/
│   ├── policy/
│   ├── approvals/
│   ├── evidence/
│   ├── receipts/
│   ├── budgets/
│   ├── evaluation/
│   ├── incidents/
│   ├── audit/
│   ├── database/
│   ├── http/
│   ├── ui/
│   └── observability/
├── constitution/
├── processes/
├── roles/
├── curricula/
├── skills/
├── schemas/
├── migrations/
├── tests/
└── docs/
```

---

# 15. Roadmap

## Fase 0 — Constitución e investigación

- finalidad;
- autoridad;
- modelo de empresa;
- autonomía;
- DeepSeek economics;
- memoria;
- seguridad;
- ADR iniciales.

## Fase 1 — Metamodelo empresarial

- empresa;
- unidad;
- departamento;
- puesto;
- trabajador;
- proceso;
- competencia;
- objetivo;
- proyecto;
- tarea;
- contrato;
- presupuesto.

## Fase 2 — Trust kernel

- identidad;
- capabilities;
- políticas;
- aprobaciones;
- evidencia;
- receipts;
- auditoría;
- segregación de funciones.

## Fase 3 — DeepSeek economics

- cliente HTTP propio;
- streaming;
- tool protocol;
- context compiler;
- cache cohorts;
- usage telemetry;
- budget caps;
- Flash/Pro routing.

## Fase 4 — Memory OS

- episodios append-only;
- business objects;
- semantic knowledge;
- procedural memory;
- topic keys;
- FTS;
- relaciones;
- conflictos;
- lifecycle;
- progressive disclosure;
- memory evaluation.

## Fase 5 — Empresa mínima

```text
Founder humano
└── CEO agéntico
    ├── Chief of Staff
    ├── Product & Research
    ├── Engineering
    ├── Finance
    └── Auditor
```

## Fase 6 — CEO constructor de organización

- workforce requirements;
- puestos;
- contratos;
- contratación temporal;
- probation;
- reorganización;
- límites constitucionales.

## Fase 7 — Capacitación

- currículos;
- research shifts;
- exámenes;
- simulaciones;
- certificaciones;
- mentoría;
- skill promotion.

## Fase 8 — Company Gym

- empresa simulada;
- correo;
- repositorios;
- proyectos;
- presupuestos;
- incidentes;
- graders de estado final;
- evaluación de autonomía.

## Fase 9 — Integraciones

- GitHub;
- correo;
- calendario;
- navegador;
- shell;
- productos y servicios empresariales.

---

# 16. Criterios de éxito

IO no se evaluará por número de agentes, prompts, tokens o mensajes.

Se evaluará por:

- objetivos logrados;
- utilidad económica;
- calidad y velocidad de decisiones;
- trabajo terminado;
- reducción de errores repetidos;
- continuidad tras reinicios;
- precisión de memoria;
- aprendizaje comprobado;
- autonomía segura;
- costo por resultado;
- trazabilidad;
- capacidad de crear y operar nuevos productos.

---

# 17. Riesgos principales

1. **Sobrearquitectura antes de operar una empresa mínima.**
2. **Memoria contaminada por inferencias presentadas como hechos.**
3. **Agentes que se confirman entre sí.**
4. **Costo de output superior al costo de input.**
5. **Pérdida de KV cache por prefijos inestables.**
6. **Exceso de agentes para tareas secuenciales.**
7. **CEO convertido en cuello de botella.**
8. **Autonomía promovida sin outcomes suficientes.**
9. **Contratos y políticas modificables por quienes deben obedecerlos.**
10. **Confundir memoria con sistema operacional.**
11. **Dependencia de conversaciones no consolidadas.**
12. **Capacitación sin evaluación real.**

---

# 18. Fuentes principales

## Libro

- https://the-amazing-gentleman-programming-book.vercel.app/es

## Engram y Gentle-AI

- https://github.com/Gentleman-Programming/engram
- https://github.com/Gentleman-Programming/engram/blob/main/docs/ARCHITECTURE.md
- https://github.com/Gentleman-Programming/engram/blob/main/DOCS.md
- https://github.com/Gentleman-Programming/gentle-ai/blob/main/docs/engram.md

## DeepSeek

- https://api-docs.deepseek.com/quick_start/pricing/
- https://api-docs.deepseek.com/news/news260424/
- https://api-docs.deepseek.com/quick_start/rate_limit/
- https://api-docs.deepseek.com/news/news0802/

## Memoria agéntica 2026

- APEX-MEM: https://aclanthology.org/2026.acl-long.749/
- Adaptive Memory via Multi-Agent Collaboration: https://aclanthology.org/2026.findings-acl.152/
- Agentic Memory: https://aclanthology.org/2026.acl-long.981/
- Hindsight: https://aclanthology.org/2026.acl-demo.27/
- Multi-Agent Memory consistency: https://arxiv.org/abs/2603.10062
- MOSS: https://arxiv.org/abs/2607.04391
- Episodic-Semantic Memory Architecture: https://arxiv.org/abs/2605.17625

## Infraestructura

- https://nodejs.org/en/about/previous-releases
- https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html
- https://www.postgresql.org/docs/release/

---

# 19. Decisión final

IO construirá su propia memoria empresarial.

Engram demuestra que una memoria útil necesita selección, estructura, sesiones, búsqueda progresiva, higiene, revisión y conflictos. Sin embargo, una empresa necesita además objetos empresariales, vigencia temporal, autoridad, evidencia, permisos, outcomes y consistencia multiagente.

La fórmula adoptada es:

```text
Principios del libro
+ patrones de memoria validados
+ IO Memory OS propio
+ DeepSeek V4 cache-first
+ PostgreSQL como fuente autoritativa
+ contratos, autoridad y outcomes verificables
```

La meta no es que los agentes “recuerden mucho”. La meta es que la empresa pueda distinguir:

- qué ocurrió;
- qué sabe;
- qué cree;
- qué está vigente;
- quién lo afirmó;
- con qué evidencia;
- quién puede utilizarlo;
- qué resultado produjo;
- cuándo debe revisarse;
- y qué merece convertirse en conocimiento institucional.
