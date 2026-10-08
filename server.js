'use strict';

// Homeroom builds this repo on the Kubernetes Paketo (kpack) builder. Its
// node-start buildpack finds the app by looking for an entrypoint file in the
// repo root (server.js, index.js, app.js, main.js, ...) and launches it with
// `node <file>`. Before this file existed the build stopped there:
//
//   paketo-buildpacks/node-start: could not find app in /workspace:
//   expected one of server.js | server.cjs | ... | index.mjs
//
// The real server is the Next.js standalone build emitted by `next build`
// (see the `build` script in package.json), so delegate to it. The standalone
// server installs its own graceful SIGTERM/SIGINT drain (stop accepting
// connections, finish in-flight requests, exit) and reads PORT from the
// environment, so this shim does not add another one.
const fs = require('node:fs');
const path = require('node:path');

// Next's standalone server takes the bind address from HOSTNAME and falls
// back to the container's own hostname, which is not always resolvable. Next's
// official container image pins HOSTNAME to 0.0.0.0 for exactly this reason;
// do the same so the app always binds every interface.
process.env.HOSTNAME = '0.0.0.0';

const standaloneServer = path.join(__dirname, '.next', 'standalone', 'server.js');

if (!fs.existsSync(standaloneServer)) {
  console.error(
    '[startup] ' + standaloneServer + ' not found. Run `npm run build` first.'
  );
  process.exit(1);
}

require(standaloneServer);
