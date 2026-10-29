// Dream Sound: serves this folder on port 5310 (all network interfaces). No dependencies; run with: node server.mjs
// The server itself lives in ../dream-common/serve.mjs, shared by every Dream tool; /dl/* goes to the Dream Library (port 5230).
import { serveFolder } from '../dream-common/serve.mjs';
serveFolder(import.meta.url, { name: 'Dream Sound', port: 5310 });
