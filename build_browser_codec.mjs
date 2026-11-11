import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mvtCodecPath = path.join(__dirname, 'mvt_codec.mjs');
const browserCodecPath = path.join(__dirname, 'static', 'tdt_browser_codec.js');

let code = fs.readFileSync(mvtCodecPath, 'utf8');

// Strip Node imports & exports
code = code.replace(/import\s+[^;]+;\r?\n?/g, '');
code = code.replace(/export\s+const\s+DEFAULT_DEMO_TK\s*=\s*[^;]+;/g, '');
code = code.replace(/export\s+async\s+function\s+fetchTiandituTile[\s\S]*?^}/m, '');
code = code.replace(/export\s+function\s+/g, 'function ');
code = code.replace(/export\s+class\s+/g, 'class ');

const banner = `/**
 * 天地图纯前端直连解码转码器 (TdtBrowserCodec)
 * 允许在浏览器前端直接请求官方 TVT 矢量瓦片，并在前端内存中解密转码为标准 MVT 2.1
 * 彻底规避官方 /vts 接口的 400 Bad Request（将 {z}/{x}/{y} 换算为 pk 空间四叉树码）
 */
(function(global) {
  'use strict';

  class BrowserBuffer extends Uint8Array {
    static alloc(size) { return new BrowserBuffer(size); }
    static from(source, encoding) {
      if (typeof source === 'string') return new BrowserBuffer(new TextEncoder().encode(source));
      if (source instanceof ArrayBuffer) return new BrowserBuffer(source);
      if (ArrayBuffer.isView(source)) return new BrowserBuffer(source.buffer, source.byteOffset, source.byteLength);
      return new BrowserBuffer(source);
    }
    static concat(list, totalLength) {
      if (totalLength === undefined) totalLength = list.reduce((acc, curr) => acc + curr.length, 0);
      const result = new BrowserBuffer(totalLength);
      let offset = 0;
      for (const item of list) { result.set(item, offset); offset += item.length; }
      return result;
    }
    slice(start, end) {
      const sub = this.subarray(start, end);
      const res = new BrowserBuffer(sub.length);
      res.set(sub);
      return res;
    }
    toString(encoding) { return new TextDecoder(encoding || 'utf-8').decode(this); }
    readFloatLE(offset) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getFloat32(offset, true); }
    readDoubleLE(offset) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getFloat64(offset, true); }
    writeDoubleLE(value, offset) { new DataView(this.buffer, this.byteOffset, this.byteLength).setFloat64(offset, value, true); }
    equals(other) {
      if (this.length !== other.length) return false;
      for (let i = 0; i < this.length; i++) { if (this[i] !== other[i]) return false; }
      return true;
    }
  }

  const Buffer = BrowserBuffer;

`;

const footer = `
  global.TdtBrowserCodec = {
    pkEncode,
    decodeTiandituTile,
    encodeToStandardMVT,
    BrowserBuffer
  };
})(typeof window !== 'undefined' ? window : globalThis);
`;

const finalOutput = banner + code + footer;
fs.writeFileSync(browserCodecPath, finalOutput, 'utf8');
console.log(`Successfully generated: ${browserCodecPath} Size: ${finalOutput.length}`);
