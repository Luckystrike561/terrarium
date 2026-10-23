import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as zlib from 'zlib';

import { AgentStateStore } from '../src/agentStateStore.js';
import type { HttpServerHandle } from '../src/httpServer.js';
import { createHttpServer } from '../src/httpServer.js';

const SPA_INDEX = '<!doctype html><title>current client</title>';
const GODOT_INDEX = '<!doctype html><title>godot client</title>';
const WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

let tmpDir: string;
let staticDir: string;
let godotDir: string;
let handle: HttpServerHandle | undefined;

function writeWithCompressed(dir: string, file: string, content: Buffer | string): void {
  const body = Buffer.from(content);
  fs.writeFileSync(path.join(dir, file), body);
  fs.writeFileSync(path.join(dir, `${file}.br`), zlib.brotliCompressSync(body));
  fs.writeFileSync(path.join(dir, `${file}.gz`), zlib.gzipSync(body));
}

async function start(withGodot: boolean): Promise<HttpServerHandle> {
  handle = await createHttpServer({
    token: 'test-token',
    store: new AgentStateStore(),
    staticDir,
    godotDir: withGodot ? godotDir : path.join(tmpDir, 'never-exported'),
  });
  return handle;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terrarium-godot-route-'));
  staticDir = path.join(tmpDir, 'webview');
  godotDir = path.join(tmpDir, 'godot');
  fs.mkdirSync(staticDir);
  fs.mkdirSync(godotDir);
  fs.writeFileSync(path.join(staticDir, 'index.html'), SPA_INDEX);
  writeWithCompressed(godotDir, 'index.html', GODOT_INDEX);
  writeWithCompressed(godotDir, 'index.wasm', WASM);
});

afterEach(async () => {
  await handle?.app.close();
  handle = undefined;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Godot web export route', () => {
  it('serves the precompressed wasm the client accepts, as application/wasm', async () => {
    const { app } = await start(true);

    const brotli = await app.inject({
      url: '/godot/index.wasm',
      headers: { 'accept-encoding': 'br, gzip' },
    });
    expect(brotli.statusCode).toBe(200);
    expect(brotli.headers['content-type']).toBe('application/wasm');
    expect(brotli.headers['content-encoding']).toBe('br');
    expect(zlib.brotliDecompressSync(brotli.rawPayload)).toEqual(WASM);

    const gzip = await app.inject({
      url: '/godot/index.wasm',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(gzip.headers['content-encoding']).toBe('gzip');
    expect(zlib.gunzipSync(gzip.rawPayload)).toEqual(WASM);

    const identity = await app.inject({
      url: '/godot/index.wasm',
      headers: { 'accept-encoding': 'identity' },
    });
    expect(identity.headers['content-encoding']).toBeUndefined();
    expect(identity.rawPayload).toEqual(WASM);
  });

  it('serves the export index at the directory URL and redirects the bare prefix to it', async () => {
    const { app } = await start(true);

    const index = await app.inject({ url: '/godot/', headers: { 'accept-encoding': 'identity' } });
    expect(index.statusCode).toBe(200);
    expect(index.body).toBe(GODOT_INDEX);

    const bare = await app.inject({ url: '/godot?debug=1' });
    expect(bare.statusCode).toBe(301);
    expect(bare.headers.location).toBe('/godot/?debug=1');
  });

  it('answers a missing export file with 404 instead of the current client', async () => {
    const { app } = await start(true);

    const missing = await app.inject({ url: '/godot/missing.js' });
    expect(missing.statusCode).toBe(404);
    expect(missing.body).not.toContain(SPA_INDEX);
  });

  it('leaves the root route and the history fallback on the current client', async () => {
    const { app } = await start(true);

    expect((await app.inject({ url: '/' })).body).toBe(SPA_INDEX);
    expect((await app.inject({ url: '/some/client/route' })).body).toBe(SPA_INDEX);
  });

  it('falls back to the current client under the prefix when no export was built', async () => {
    const { app } = await start(false);

    const response = await app.inject({ url: '/godot/' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(SPA_INDEX);
  });
});
