import { createRequire } from 'module';

// Express 4 ignores the promise an async handler returns, so anything thrown in
// one (outside its own try) became an unhandled rejection — and Node exits on
// those, taking every user's session and the unsaved DB writes with it. Route
// the rejection to next(err) instead, so the error handler answers with a 500.
const require = createRequire(import.meta.url);
const Layer = require('express/lib/router/layer.js');

Layer.prototype.handle_request = function handle(req: any, res: any, next: (err?: any) => void) {
  const fn = this.handle;
  if (fn.length > 3) return next(); // error handler, not a request handler
  try {
    const result = fn(req, res, next);
    if (result && typeof result.then === 'function') {
      result.then(undefined, (err: any) => next(err ?? new Error('Request handler rejected')));
    }
  } catch (err) {
    next(err);
  }
};

// Last line of defence for background work (startup backfills, timers, crons)
process.on('unhandledRejection', (reason: any) => {
  console.error('[unhandledRejection]', reason?.stack || reason?.message || reason);
});

// A synchronous throw in a timer / stream / upload callback used to end the
// process: everyone's session and the last unsaved writes gone. Log it and keep
// serving — the database lives in memory, so its state is still consistent.
process.on('uncaughtException', (err: any) => {
  console.error('[uncaughtException]', err?.stack || err?.message || err);
});
