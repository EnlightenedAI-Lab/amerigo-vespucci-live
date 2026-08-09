import { inflateRawSync } from 'node:zlib';

/**
 * Extract one entry from a ZIP buffer by filename (central directory scan).
 * @param {Buffer} buffer
 * @param {string} targetName
 */
export function extractZipEntry(buffer, targetName) {
  if (!buffer || buffer.length < 22) return null;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return null;

  const cdOffset = buffer.readUInt32LE(eocd + 16);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  let offset = cdOffset;
  const end = cdOffset + cdSize;

  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    if (name !== targetName && !name.endsWith(`/${targetName}`)) continue;

    const locNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const locExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + locNameLen + locExtraLen;
    const data = buffer.subarray(dataStart, dataStart + compSize);
    if (method === 0) return data;
    if (method === 8) return inflateRawSync(data);
    return null;
  }
  return null;
}
