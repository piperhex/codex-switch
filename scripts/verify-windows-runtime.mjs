import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const peSignature = 0x00004550;
const sectionHeaderSize = 40;
const runtimeDll = /^(?:vcruntime\d+.*|msvcp\d+.*|msvcr\d+.*|concrt\d+.*|vcomp\d+.*)\.dll$/i;

function peHeaders(bytes) {
  if (bytes.toString("ascii", 0, 2) !== "MZ") throw new Error("Missing Windows executable header.");
  const pe = bytes.readUInt32LE(0x3c);
  if (bytes.readUInt32LE(pe) !== peSignature) throw new Error("Invalid PE signature.");
  const optional = pe + 24;
  const magic = bytes.readUInt16LE(optional);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error("Unsupported PE optional header.");
  const is64 = magic === 0x20b;
  const directories = optional + (is64 ? 112 : 96);
  const sectionTable = optional + bytes.readUInt16LE(pe + 20);
  const sectionCount = bytes.readUInt16LE(pe + 6);
  const sections = Array.from({ length: sectionCount }, (_, index) => {
    const offset = sectionTable + index * sectionHeaderSize;
    return {
      address: bytes.readUInt32LE(offset + 12),
      size: bytes.readUInt32LE(offset + 16),
      raw: bytes.readUInt32LE(offset + 20),
    };
  });
  return {
    directories,
    directoryCount: bytes.readUInt32LE(directories - 4),
    headerSize: bytes.readUInt32LE(optional + 60),
    imageBase: is64 ? Number(bytes.readBigUInt64LE(optional + 24)) : bytes.readUInt32LE(optional + 28),
    sections,
  };
}

function fileOffset(headers, bytes, address) {
  if (address >= 0 && address < headers.headerSize && address < bytes.length) return address;
  const section = headers.sections.find(({ address: start, size }) => address >= start && address < start + size);
  const offset = section && section.raw + address - section.address;
  if (offset === undefined || offset < 0 || offset >= bytes.length) {
    throw new Error(`Invalid PE import address: ${address}`);
  }
  return offset;
}

function importNames(bytes, headers, { directory, size, nameOffset, delayed = false }) {
  if (directory >= headers.directoryCount) return [];
  const entry = headers.directories + directory * 8;
  const address = bytes.readUInt32LE(entry);
  const length = bytes.readUInt32LE(entry + 4);
  if (!address && !length) return [];
  if (!address || length < size) throw new Error("Invalid PE import directory.");
  const names = [];
  for (let relative = 0; relative + size <= length; relative += size) {
    const offset = fileOffset(headers, bytes, address + relative);
    if (offset + size > bytes.length) throw new Error("Truncated PE import descriptor.");
    if (bytes.subarray(offset, offset + size).every((value) => value === 0)) return names;
    const nameAddress = bytes.readUInt32LE(offset + nameOffset);
    const usesRva = !delayed || (bytes.readUInt32LE(offset) & 1) !== 0;
    const nameStart = fileOffset(headers, bytes, usesRva ? nameAddress : nameAddress - headers.imageBase);
    const nameEnd = bytes.indexOf(0, nameStart);
    if (nameEnd < 0) throw new Error("Unterminated PE import name.");
    names.push(bytes.toString("ascii", nameStart, nameEnd));
  }
  throw new Error("Unterminated PE import directory.");
}

export function windowsImports(bytes) {
  const headers = peHeaders(bytes);
  return [...new Set([
    ...importNames(bytes, headers, { directory: 1, size: 20, nameOffset: 12 }),
    ...importNames(bytes, headers, { directory: 13, size: 32, nameOffset: 4, delayed: true }),
  ])];
}

export function verifyWindowsRuntime(executable) {
  const imports = windowsImports(readFileSync(executable));
  const runtimeImports = imports.filter((name) => runtimeDll.test(name));
  if (runtimeImports.length) {
    throw new Error(`${basename(executable)} requires an external Visual C++ runtime: ${runtimeImports.join(", ")}`);
  }
  console.log(`Verified ${basename(executable)} has no external Visual C++ runtime imports (${imports.join(", ")}).`);
  return imports;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("Usage: node scripts/verify-windows-runtime.mjs <executable>");
  verifyWindowsRuntime(process.argv[2]);
}
