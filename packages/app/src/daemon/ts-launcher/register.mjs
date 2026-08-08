// Preload entry (`--import`): register the ts-hook resolve hooks BEFORE the
// daemon entrypoint loads — Node 24 `node:module` API, zero dependencies.

import { registerHooks } from 'node:module';

import { resolve } from './ts-hook.mjs';

registerHooks({ resolve });
