'use strict';

// Root entrypoint for the kpack (Paketo) node-start buildpack.
//
// The Paketo node-start buildpack looks for a start command it recognises at
// the app root. This repository is a Next.js 16 app configured with
// `output: "standalone"` (see next.config.mjs), so `next build` emits its own
// server at `.next/standalone/server.js`. This shim exists only so Paketo can
// detect a `node <file>` start command at the root; it then delegates to that
// standalone server.
//
// Two things are set before the standalone server loads:
//   * HOSTNAME=0.0.0.0 so the standalone server binds all interfaces (it
//     otherwise defaults to localhost, unreachable from the container edge).
//   * NODE_ENV defaults to "production" if unset, so a stray development
//     value from the build phase cannot leak into the runtime.
//
// The Next.js standalone server installs its own SIGTERM/SIGINT drain, so this
// shim must NOT install a second, competing shutdown handler.

process.env.HOSTNAME = '0.0.0.0';
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';

const path = require('path');
const standaloneServer = path.join(__dirname, '.next', 'standalone', 'server.js');

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(standaloneServer);
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND' && err.message.includes(standaloneServer)) {
    console.error(
      '[server] Could not find the Next.js standalone server at ' +
        standaloneServer +
        '. Run `npm run build` before starting the app.'
    );
    process.exit(1);
  }
  throw err;
}
