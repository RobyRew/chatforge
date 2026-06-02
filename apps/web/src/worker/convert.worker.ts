// Vite worker entry. Registers the engine's message handler (see @chatforge/core/worker).
// Excluded from the app tsconfig because it runs in a WebWorker lib context, not DOM.
import '@chatforge/core/worker';
