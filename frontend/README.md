# Yggltree app (frontend)

The screens and the code that keeps each device's copy of the family's data in sync. It's built with Vue 3, Vite, and Yjs.

- `npm run dev -w frontend`: the app with hot reload. Use `npm run dev:hub` from the repository root in another terminal.
- `npm test -w frontend`: the test suite.
- `npm run build -w frontend`: the production build in `dist/`. The family computer's hub serves it, and the relay gets a copy.

The folders:

- `src/views`: the pages.
- `src/components`: the shared pieces.
- `src/data`: the family document, the modules, and sync.
- `src/addons`: the module list.
- `src/stores`: the Pinia stores.

For setup and how the pieces fit, see [`../Yggltree_vault/Development.md`](../Yggltree_vault/Development.md) and [`../Yggltree_vault/Architecture.md`](../Yggltree_vault/Architecture.md).
