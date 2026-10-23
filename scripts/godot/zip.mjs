import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_EXTRA_ID = 0x0001;
const EOCD_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;
const MAX_COMMENT = 0xffff;
const LOCAL_HEADER_SIZE = 30;
const U32_MAX = 0xffffffff;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/**
 * @typedef {{ size: number, read: (start: number, length: number) => Promise<Buffer> }} ZipSource
 * @typedef {{ name: string, method: number, compressedSize: number, size: number, localHeaderOffset: number }} ZipEntry
 */

/** @returns {ZipSource} */
export function bufferSource(buffer) {
  return {
    size: buffer.length,
    read: async (start, length) => buffer.subarray(start, start + length),
  };
}

/**
 * Reads byte ranges of a remote archive, so one member of a large archive
 * downloads without the rest.
 * @returns {Promise<ZipSource>}
 */
export async function httpSource(url) {
  const head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (!head.ok) throw new Error(`HEAD ${url}: HTTP ${head.status}`);
  const size = Number(head.headers.get('content-length'));
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error(`HEAD ${url}: no content-length`);
  const resolved = head.url;
  return {
    size,
    read: async (start, length) => {
      const response = await fetch(resolved, {
        headers: { range: `bytes=${start}-${start + length - 1}` },
      });
      if (response.status !== 206)
        throw new Error(`GET ${resolved} range: HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length !== length) {
        throw new Error(`GET ${resolved} range: expected ${length} bytes, got ${body.length}`);
      }
      return body;
    },
  };
}

/** @returns {Promise<ZipEntry[]>} */
export async function listEntries(source) {
  const tailLength = Math.min(source.size, EOCD_SIZE + MAX_COMMENT + ZIP64_LOCATOR_SIZE);
  const tailStart = source.size - tailLength;
  const tail = await source.read(tailStart, tailLength);
  const eocd = tail.lastIndexOf(signatureBytes(EOCD_SIGNATURE));
  if (eocd < 0) throw new Error('not a ZIP archive: no end of central directory');

  let count = tail.readUInt16LE(eocd + 10);
  let directorySize = tail.readUInt32LE(eocd + 12);
  let directoryOffset = tail.readUInt32LE(eocd + 16);
  const locator = eocd - ZIP64_LOCATOR_SIZE;
  if (locator >= 0 && tail.readUInt32LE(locator) === ZIP64_LOCATOR_SIGNATURE) {
    const zip64Offset = Number(tail.readBigUInt64LE(locator + 8));
    const zip64 = await source.read(zip64Offset, 56);
    if (zip64.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) throw new Error('corrupt ZIP64 directory');
    count = Number(zip64.readBigUInt64LE(32));
    directorySize = Number(zip64.readBigUInt64LE(40));
    directoryOffset = Number(zip64.readBigUInt64LE(48));
  }

  const directory = await source.read(directoryOffset, directorySize);
  const entries = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (directory.readUInt32LE(at) !== CENTRAL_SIGNATURE)
      throw new Error('corrupt central directory');
    const nameLength = directory.readUInt16LE(at + 28);
    const extraLength = directory.readUInt16LE(at + 30);
    const commentLength = directory.readUInt16LE(at + 32);
    const entry = {
      name: directory.toString('utf8', at + 46, at + 46 + nameLength),
      method: directory.readUInt16LE(at + 10),
      size: directory.readUInt32LE(at + 24),
      compressedSize: directory.readUInt32LE(at + 20),
      localHeaderOffset: directory.readUInt32LE(at + 42),
    };
    applyZip64Extra(
      entry,
      directory.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength),
    );
    entries.push(entry);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** @returns {Promise<Buffer>} */
export async function readEntry(source, entry) {
  const header = await source.read(entry.localHeaderOffset, LOCAL_HEADER_SIZE);
  if (header.readUInt32LE(0) !== LOCAL_SIGNATURE)
    throw new Error(`corrupt local header: ${entry.name}`);
  const dataStart =
    entry.localHeaderOffset + LOCAL_HEADER_SIZE + header.readUInt16LE(26) + header.readUInt16LE(28);
  const data = await source.read(dataStart, entry.compressedSize);
  let content;
  if (entry.method === METHOD_STORED) content = data;
  else if (entry.method === METHOD_DEFLATE) content = inflateRawSync(data);
  else throw new Error(`unsupported compression method ${entry.method}: ${entry.name}`);
  if (content.length !== entry.size) throw new Error(`size mismatch: ${entry.name}`);
  return content;
}

/** Fields stored as 0xFFFFFFFF in the central directory live in the ZIP64
 *  extra field instead, in this fixed order, present only when saturated. */
function applyZip64Extra(entry, extra) {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const length = extra.readUInt16LE(at + 2);
    if (id === ZIP64_EXTRA_ID) {
      let field = at + 4;
      for (const key of ['size', 'compressedSize', 'localHeaderOffset']) {
        if (entry[key] !== U32_MAX) continue;
        entry[key] = Number(extra.readBigUInt64LE(field));
        field += 8;
      }
      return;
    }
    at += 4 + length;
  }
}

function signatureBytes(signature) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(signature);
  return bytes;
}
