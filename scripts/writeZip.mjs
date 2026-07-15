// Minimal ZIP writer.
//
// PowerShell's Compress-Archive writes entry names with Windows path separators
// ("dist\addon.js"). The ZIP spec requires forward slashes, and Wealthfolio's
// permission analyzer cannot resolve the bundle out of such an archive, so the
// install fails with "Permission analysis failed". This writes spec-compliant
// names instead.

import { readFileSync, writeFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";

const SIGNATURE_LOCAL_HEADER = 0x04034b50;
const SIGNATURE_CENTRAL_HEADER = 0x02014b50;
const SIGNATURE_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const METHOD_DEFLATE = 8;
const VERSION_NEEDED = 20;

// ZIP stores timestamps as MS-DOS date/time: a 16-bit date (year since 1980,
// month, day) and a 16-bit time with two-second resolution.
function toDosDateTime(date) {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function buildEntry(entryName, contents, modifiedAt) {
  const nameBytes = Buffer.from(entryName, "utf8");
  const compressed = deflateRawSync(contents);
  const { dosTime, dosDate } = toDosDateTime(modifiedAt);

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(SIGNATURE_LOCAL_HEADER, 0);
  localHeader.writeUInt16LE(VERSION_NEEDED, 4);
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(METHOD_DEFLATE, 8);
  localHeader.writeUInt16LE(dosTime, 10);
  localHeader.writeUInt16LE(dosDate, 12);
  localHeader.writeUInt32LE(crc32(contents), 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(contents.length, 22);
  localHeader.writeUInt16LE(nameBytes.length, 26);
  localHeader.writeUInt16LE(0, 28); // extra field length

  return {
    nameBytes,
    contents,
    compressed,
    dosTime,
    dosDate,
    local: Buffer.concat([localHeader, nameBytes, compressed]),
  };
}

function buildCentralHeader(entry, localHeaderOffset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(SIGNATURE_CENTRAL_HEADER, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4); // version made by
  header.writeUInt16LE(VERSION_NEEDED, 6); // version needed
  header.writeUInt16LE(0, 8); // flags
  header.writeUInt16LE(METHOD_DEFLATE, 10);
  header.writeUInt16LE(entry.dosTime, 12);
  header.writeUInt16LE(entry.dosDate, 14);
  header.writeUInt32LE(crc32(entry.contents), 16);
  header.writeUInt32LE(entry.compressed.length, 20);
  header.writeUInt32LE(entry.contents.length, 24);
  header.writeUInt16LE(entry.nameBytes.length, 28);
  header.writeUInt16LE(0, 30); // extra field length
  header.writeUInt16LE(0, 32); // comment length
  header.writeUInt16LE(0, 34); // disk number
  header.writeUInt16LE(0, 36); // internal attributes
  header.writeUInt32LE(0, 38); // external attributes
  header.writeUInt32LE(localHeaderOffset, 42);

  return Buffer.concat([header, entry.nameBytes]);
}

function buildEndOfCentralDirectory(entryCount, centralDirectoryOffset, centralDirectorySize) {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIGNATURE_END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralDirectorySize, 12);
  end.writeUInt32LE(centralDirectoryOffset, 16);
  end.writeUInt16LE(0, 20); // comment length
  return end;
}

/**
 * Write a zip archive.
 *
 * @param {string} zipPath destination file
 * @param {Array<{ entryName: string, sourcePath: string }>} files
 *   `entryName` is the path inside the archive and must use forward slashes.
 */
export function writeZip(zipPath, files) {
  const modifiedAt = new Date();
  const entries = files.map(({ entryName, sourcePath }) => {
    if (entryName.includes("\\")) {
      throw new Error(`Zip entry names must use forward slashes, got "${entryName}"`);
    }
    return buildEntry(entryName, readFileSync(sourcePath), modifiedAt);
  });

  const localSections = [];
  const centralHeaders = [];
  let offset = 0;

  for (const entry of entries) {
    centralHeaders.push(buildCentralHeader(entry, offset));
    localSections.push(entry.local);
    offset += entry.local.length;
  }

  const centralDirectory = Buffer.concat(centralHeaders);
  const end = buildEndOfCentralDirectory(entries.length, offset, centralDirectory.length);

  writeFileSync(zipPath, Buffer.concat([...localSections, centralDirectory, end]));
}
