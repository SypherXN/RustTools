/**
 * Rust / lz4net legacy stream decompressor (fixed fork of rustworld LZ4Reader).
 * Fixes DataView byteOffset handling and output chunk assembly.
 */
import { rustworldLz4 as lz4 } from "./rustworld-lz4.js";

const BLOCK_SIZE = 1024 * 1024;

const ChunkFlags = {
  None: 0x00,
  Compressed: 0x01,
  HighCompression: 0x02,
  Passes: 0x04 | 0x08 | 0x10,
} as const;

export function decompressLz4LegacyStream(input: Uint8Array): Uint8Array {
  const bytes =
    input.byteOffset === 0 && input.byteLength === input.buffer.byteLength
      ? input
      : input.slice();

  const reader = new Lz4LegacyReader(bytes);
  return reader.decompress();
}

class Lz4LegacyReader {
  private readonly bytes: Uint8Array;
  private readonly dataview: DataView;
  private streamPosition = 0;
  private ended = false;
  private readonly chunks: Uint8Array[] = [];

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.dataview = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  decompress(): Uint8Array {
    while (!this.ended) {
      if (!this.acquireNextChunk()) break;
    }

    const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  private acquireNextChunk(): boolean {
    if (this.ended) return false;

    do {
      const flags = this.tryReadVarInt();
      if (flags === undefined) return false;

      const isCompressed = (flags & ChunkFlags.Compressed) !== 0;
      const originalLength = this.readVarInt();
      const compressedLength = isCompressed ? this.readVarInt() : originalLength;

      if (compressedLength > originalLength) {
        throw new Error("Corrupt LZ4 chunk: compressed length exceeds original length");
      }

      const compressed = new Uint8Array(compressedLength);
      const read = this.readBlock(compressed, 0, compressedLength);
      if (read !== compressedLength) {
        throw new Error("Corrupt LZ4 chunk: unexpected end of stream");
      }

      let chunk: Uint8Array;
      if (!isCompressed) {
        chunk = compressed;
      } else {
        const passes = flags >> 2;
        if (passes !== 0) {
          throw new Error("Multi-pass LZ4 chunks are not supported");
        }
        const output = new Uint8Array(originalLength);
        const written = lz4.decompressBlock(compressed, output, 0, compressed.length, 0);
        if (written <= 0) {
          throw new Error("LZ4 block decompression failed");
        }
        chunk = output.subarray(0, originalLength);
      }

      this.chunks.push(chunk);

      if (originalLength < BLOCK_SIZE) {
        this.ended = true;
        return true;
      }
    } while (this.chunks[this.chunks.length - 1]?.length === 0);

    return true;
  }

  private tryReadVarInt(): number | undefined {
    let count = 0;
    let result = 0;

    while (true) {
      if (this.streamPosition >= this.bytes.byteLength) return undefined;

      const buffer = this.dataview.getUint8(this.streamPosition);
      this.streamPosition++;

      if (buffer === 0) {
        if (count === 0) return undefined;
        throw new Error("Invalid varint in LZ4 stream");
      }

      result += (buffer & 0x7f) << count;
      count += 7;
      if ((buffer & 0x80) === 0 || count >= 64) break;
    }

    return result >>> 0;
  }

  private readVarInt(): number {
    const value = this.tryReadVarInt();
    if (value === undefined) {
      throw new Error("Unexpected end of LZ4 stream while reading varint");
    }
    return value;
  }

  private readBlock(buffer: Uint8Array, offset: number, length: number): number {
    let total = 0;
    while (length > 0) {
      const read = this.innerRead(buffer, offset, length);
      if (read === 0) break;
      offset += read;
      length -= read;
      total += read;
    }
    return total;
  }

  private innerRead(output: Uint8Array, offset: number, length: number): number {
    const available = this.bytes.byteLength - this.streamPosition;
    if (available <= 0) return 0;
    const read = Math.min(length, available);
    output.set(this.bytes.subarray(this.streamPosition, this.streamPosition + read), offset);
    this.streamPosition += read;
    return read;
  }
}
