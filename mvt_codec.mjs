// mvt_codec.mjs
// 天地图专有矢量切片解码与标准 Mapbox Vector Tile (MVT) 重新转码模块
// 结合 tdt-full-reverse 逆向成果，实现纯 Node.js（零第三方依赖）的标准 MVT 编解码

import http from 'http';
import https from 'https';

const REFERER = "https://map.tianditu.gov.cn/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
export const DEFAULT_DEMO_TK = (typeof process !== 'undefined' && process.env && process.env.TDT_TK)
	? process.env.TDT_TK
	: "b88bfb160c81dab8d9d20aaa74846360";

/* ================= 1. 坐标与 QuadKey 编码 ================= */
export function pkEncode(x, y, z) {
	let n = "";
	for (let a = z; a >= 0; --a) {
		const r = 1 << a;
		let o = 0;
		if (x & r) o |= 1;
		if (y & r) o |= 2;
		n += o;
	}
	let o = n.split("").reverse().join("");
	const S = "9876";
	const E = (e, t, r) => e.substring(0, t) + r + e.substring(t + 1);
	for (let a = 0; a < S.length; a++) {
		const e = Number(S[a]);
		if (e >= o.length) continue;
		o = E(o, e, 1 + Number(o.substring(e, e + 1)));
	}
	let t = "", r = "", nn = 0;
	for (let q = 0; q < o.length; q++) {
		const i = 3 * Number(o[q]);
		let a = t.length - 1;
		const s = String.fromCharCode(97 + i);
		if (s === r) {
			nn++;
			if (nn === 1) a++;
			else if (nn > 10) a--;
			t = t.slice(0, a) + nn;
		} else {
			r = s;
			t += s;
			nn = 0;
		}
	}
	return t;
}

const TDT_CANDIDATE_HOSTS = [
	'tile0.tianditu.gov.cn',
	'tile1.tianditu.gov.cn',
	'tile2.tianditu.gov.cn'
];

/* ================= 2. 瓦片拉取与解密基础工具 ================= */
export async function fetchTiandituTile(x, y, z, tk = DEFAULT_DEMO_TK, retries = 5) {
	const pk = pkEncode(x, y, z);
	let lastErr = null;
	const baseIndex = (x + y) % TDT_CANDIDATE_HOSTS.length;

	for (let attempt = 0; attempt < retries; attempt++) {
		const host = TDT_CANDIDATE_HOSTS[(baseIndex + attempt) % TDT_CANDIDATE_HOSTS.length];
		const url = `https://${host}/vts?t=vt&pk=${encodeURIComponent(pk)}&tk=${encodeURIComponent(tk)}&v=1.0`;

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 6000);

			const resp = await fetch(url, {
				headers: {
					Referer: REFERER,
					"User-Agent": UA,
					Accept: "*/*",
					Connection: "keep-alive"
				},
				signal: controller.signal
			});
			clearTimeout(timeoutId);

			if (resp.status === 404) {
				if (attempt < 2) continue;
				return Buffer.alloc(0);
			}

			const buf = Buffer.from(await resp.arrayBuffer());
			const ct = resp.headers.get("content-type") || "";

			if (ct.includes("json") || (buf.length && buf[0] === 0x7b)) {
				try {
					const body = JSON.parse(buf.toString("utf8"));
					if (String(body?.code) === "301010") {
						throw new Error("tdt_permission(令牌无权/过期/域名白名单)");
					}
					if (body?.code != null || body?.msg) {
						throw new Error(String(body.msg || `tdt_code_${body.code}`));
					}
				} catch (e) {
					if (String(e.message).startsWith("tdt_")) throw e;
				}
			}

			if (!resp.ok) {
				throw new Error(`tdt_http_${resp.status} on ${host}`);
			}

			return buf;
		} catch (e) {
			lastErr = e;
			const isAbort = e.name === 'AbortError' || e.message?.includes('aborted');
			const errMsg = isAbort ? `请求超时(6s) on ${host}` : (e.message || String(e));

			if (attempt < retries - 1) {
				const delay = Math.min(2500, Math.floor(250 * Math.pow(1.5, attempt) + Math.random() * 150));
				console.warn(`[TDT-Retry] 切片 (${z}/${x}/${y}) 第 ${attempt + 1}/${retries} 次失败: ${errMsg}，切换至 ${TDT_CANDIDATE_HOSTS[(baseIndex + attempt + 1) % TDT_CANDIDATE_HOSTS.length]} 将在 ${delay}ms 后重试...`);
				await new Promise(r => setTimeout(r, delay));
			}
		}
	}

	throw new Error(`切片 (${z}/${x}/${y}) 重试 ${retries} 次全部失败: ${lastErr?.message || '网络连接异常'}`);
}

function R_(buf) {
	let pos = 0;
	const u32 = () => {
		let s = 0, sh = 0;
		for (let k = 0; k < 6; k++) {
			if (pos >= buf.length) return -1;
			const c = buf[pos++];
			s |= (c & 127) << sh;
			if (!(c & 128)) return s >>> 0;
			sh += 7;
		}
		return -1;
	};
	return { u32, get pos() { return pos; }, set pos(v) { pos = v; }, len: buf.length };
}
const zig = (t) => (t % 2 === 1 ? -(t + 1) / 2 : t / 2);

function splitFields(buf) {
	const out = [];
	const r = R_(buf);
	while (r.pos < buf.length) {
		const tag = r.u32();
		if (tag < 0) break;
		const fl = tag >>> 3, wt = tag & 7;
		if (![0, 1, 2, 5].includes(wt)) break;
		if (wt === 0) {
			const vs = r.pos;
			const num = r.u32();
			if (num < 0) break;
			out.push({ fl, wt, num, start: vs });
			continue;
		}
		if (wt === 1) { out.push({ fl, wt, start: r.pos }); r.pos += 8; continue; }
		if (wt === 5) { out.push({ fl, wt, start: r.pos }); r.pos += 4; continue; }
		const L = r.u32();
		if (L < 0 || L > buf.length - r.pos) break;
		out.push({ fl, wt, L, start: r.pos });
		r.pos += L;
	}
	return out;
}

function parseTop(buf) {
	const r = R_(buf);
	const fields = [];
	let guard = 0;
	while (r.pos < buf.length && guard++ < buf.length * 4 + 20) {
		const s0 = r.pos;
		const tag = r.u32();
		if (tag < 0 || tag === 0) return { fields, ok: false };
		const fl = tag >>> 3, wt = tag & 7;
		if (![0, 1, 2, 5].includes(wt)) return { fields, ok: false };
		if (wt === 0) { const v = r.u32(); if (v < 0) return { fields, ok: false }; fields.push({ fl, wt, v, start: s0 }); continue; }
		if (wt === 1) { fields.push({ fl, wt, start: r.pos }); r.pos += 8; continue; }
		if (wt === 5) { fields.push({ fl, wt, start: r.pos }); r.pos += 4; continue; }
		const L = r.u32();
		if (L < 0 || L > buf.length - r.pos) return { fields, ok: false };
		fields.push({ fl, wt, L, start: r.pos });
		r.pos += L;
		if (r.pos <= s0) return { fields, ok: false };
	}
	return { fields, ok: r.pos === buf.length };
}

function detectLayers(body) {
	const layers = [];
	for (let i = 0; i < body.length; i++) {
		if (body[i] !== 0x1a) continue;
		const rr = R_(body.slice(i));
		if (rr.u32() !== 0x1a) continue;
		const L = rr.u32();
		if (L <= 0 || L > body.length - (i + rr.pos)) continue;
		const cs = i + rr.pos;
		const content = body.slice(cs, cs + L);
		const res = parseTop(content);
		if (!res.ok) continue;
		if (!res.fields.some((x) => x.fl === 5 && x.wt === 0)) continue;
		if (!res.fields.some((x) => x.fl === 15 && x.wt === 0)) continue;
		const nameField = res.fields.find((x) => x.fl === 2 && x.wt === 2);
		if (!nameField) continue;
		const nameStr = content.slice(nameField.start, nameField.start + nameField.L).toString("utf8");
		if (!/^[A-Za-z0-9_-]{2,30}$/.test(nameStr)) continue;
		layers.push({ bodyPos: i, content, L, total: rr.pos + L });
	}
	return layers;
}

function parseCommands(buf) {
	const r = R_(buf);
	const paths = [];
	let cur = null, left = 0, x = 0, y = 0, seenCmd = false, sawClose = false, partial = false;
	const graceful = () => {
		if (sawClose && paths.length) { partial = true; return true; }
		return false;
	};
	const fail = () => (graceful() ? { paths, partial } : null);
	while (r.pos < buf.length) {
		if (left <= 0) {
			const c = r.u32();
			if (c < 0) return fail();
			const id = c & 7;
			left = c >>> 3;
			// 低级别世界瓦片大陆多边形点数常超过 7000~20000+ 点，放宽上限至 200000
			if (![2, 3, 7].includes(id) || left > 200000) return fail();
			if (!seenCmd && id !== 2) return fail();
			seenCmd = true;
			if (id === 2) { if (cur) paths.push(cur); cur = { points: [], closed: false }; }
			if (id === 7) {
				if (cur && cur.points.length >= 2) {
					cur.points.push(cur.points[0]);
					cur.closed = true;
					paths.push(cur);
					sawClose = true;
				}
				cur = null;
				left = 0;
				continue;
			}
		}
		left--;
		const a = r.u32(), b = r.u32();
		if (a < 0 || b < 0) return fail();
		x += zig(a); y += zig(b);
		// 低比例尺跨瓦片缓冲多边形坐标跨度可达更大范围
		if (x < -20000 || x > 25000 || y < -20000 || y > 25000) {
			if (graceful()) return { paths, partial };
			return null;
		}
		if (!cur) return fail();
		cur.points.push([x, y]);
	}
	if (!seenCmd) return null;
	if (cur) paths.push(cur);
	return { paths, partial };
}

function findCommands(buf, depth = 0) {
	const direct = parseCommands(buf);
	if (direct && direct.paths.length) return direct;
	if (depth >= 8) return null;
	for (const f of splitFields(buf)) {
		if (f.fl !== 1 || f.wt !== 2) continue;
		const nested = findCommands(buf.slice(f.start, f.start + f.L), depth + 1);
		if (nested && nested.paths.length) return nested;
	}
	return null;
}

function readVarint64(buf, pos) {
	let result = 0n, shift = 0n;
	for (let k = 0; k < 10; k++) {
		if (pos >= buf.length) return null;
		const c = BigInt(buf[pos++]);
		result |= (c & 0x7fn) << shift;
		if (!(c & 0x80n)) return { value: result, pos };
		shift += 7n;
	}
	return null;
}

function parseValue(buf) {
	const fields = splitFields(buf);
	let value = null, kind = "empty";
	for (const f of fields) {
		if (f.fl === 1 && f.wt === 2) {
			const s = buf.slice(f.start, f.start + f.L);
			const st = s.toString("utf8");
			if (!st.includes("\uFFFD") && Buffer.from(st, "utf8").equals(s)) { value = st; kind = "string"; }
			else { value = { __raw_hex: s.toString("hex") }; kind = "rawhex"; }
		} else if ((f.fl === 2 || f.fl === 3) && f.wt === 5) {
			value = buf.readFloatLE(f.start); kind = "float32";
		} else if (f.fl === 3 && f.wt === 1) {
			value = buf.readDoubleLE(f.start); kind = "float64";
		} else if ([4, 5, 6, 7].includes(f.fl) && f.wt === 0) {
			const r = readVarint64(buf, f.start);
			if (!r) continue;
			if (f.fl === 6) {
				const mag = r.value >> 1n;
				const v = (r.value & 1n) ? -(mag + 1n) : mag;
				value = v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : Number(v);
				kind = "sint64";
			} else if (f.fl === 7) {
				value = r.value !== 0n; kind = "bool";
			} else {
				value = r.value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(r.value) : Number(r.value);
				kind = f.fl === 5 ? "uint64" : "int64";
			}
		}
	}
	return { value, kind };
}

function parseTags(buf) {
	const r = R_(buf);
	const arr = [];
	while (r.pos < buf.length) {
		const v = r.u32();
		if (v < 0) break;
		arr.push(v);
	}
	return arr;
}

function parseFeature(fbuf) {
	const fields = splitFields(fbuf);
	const pathGroups = [];
	let type = null, tagsRaw = null, partial = false;
	for (const f of fields) {
		if (f.fl === 1 && f.wt === 2) {
			const sub = fbuf.slice(f.start, f.start + f.L);
			const res = findCommands(sub);
			if (res && res.paths.length) {
				pathGroups.push(res.paths);
				if (res.partial) partial = true;
			}
		} else if (f.fl === 2 && f.wt === 0) {
			type = f.num;
		} else if (f.fl === 3 && f.wt === 2) {
			tagsRaw = fbuf.slice(f.start, f.start + f.L);
		}
	}
	const tags = tagsRaw ? parseTags(tagsRaw) : [];
	return { pathGroups, type, tags, partial };
}

function parseLayer(layer) {
	const c = layer.content;
	const fields = splitFields(c);
	let name = "", extent = 4096, version = 2;
	const keys = [], values = [], valueKinds = [], features = [];
	for (const f of fields) {
		if (f.fl === 2 && f.wt === 2) name = c.slice(f.start, f.start + f.L).toString("utf8");
		else if (f.fl === 5 && f.wt === 0) extent = f.num;
		else if (f.fl === 15 && f.wt === 0) version = f.num;
		else if (f.fl === 4 && f.wt === 2) keys.push(c.slice(f.start, f.start + f.L).toString("utf8"));
		else if (f.fl === 3 && f.wt === 2) {
			const { value, kind } = parseValue(c.slice(f.start, f.start + f.L));
			values.push(value); valueKinds.push(kind);
		} else if (f.fl === 1 && f.wt === 2) {
			const sub = c.slice(f.start, f.start + f.L);
			const feat = parseFeature(sub);
			if (feat && feat.type != null) features.push(feat);
		}
	}
	if (!name || !/^[A-Za-z0-9_-]{2,30}$/.test(name)) return null;
	return { name, extent, version, keys, values, valueKinds, features };
}

function readTagXor(buf, pos) {
	if (pos >= buf.length) return null;
	const b = buf[pos];
	const v = (b & 0x80) ? (b ^ 0xff) : b;
	return { fl: v >>> 3, wt: v & 7 };
}

function readLenXor(buf, pos, remain) {
	const b = buf[pos];
	if (b & 0x80) {
		const s1 = b ^ 0xff;
		if (s1 <= remain) return { v: s1, n: 1 };
		if (pos + 1 < buf.length) {
			const b2 = buf[pos + 1];
			const s2 = ((b & 0x7f) | ((b2 & 0x7f) << 7)) ^ 0xff;
			if (s2 > 0 && s2 <= remain) return { v: s2, n: 2 };
		}
		return { v: -1, n: 0 };
	}
	return { v: b, n: 1 };
}

function parseFeatureContainerXor(buf) {
	let pos = 0, geom = null, type = null, tags = [], partial = false;
	while (pos < buf.length) {
		const tag = readTagXor(buf, pos);
		if (!tag) { pos++; continue; }
		pos++;
		if (tag.wt === 0) {
			const r = R_(buf.slice(pos));
			const v = r.u32();
			if (tag.fl === 2) type = v;
			pos += r.pos;
			continue;
		}
		if (tag.wt === 2) {
			const rl = readLenXor(buf, pos, buf.length - pos - 1);
			if (rl.v < 0) break;
			pos += rl.n;
			const data = buf.slice(pos, pos + rl.v);
			if (tag.fl === 1) {
				const res = parseCommands(data);
				if (res) { geom = res.paths; if (res.partial) partial = true; }
				else {
					const inner = parseFeatureContainerXor(data);
					if (inner.geom) { geom = inner.geom; if (inner.type != null) type = inner.type; if (inner.tags.length) tags = inner.tags; if (inner.partial) partial = true; }
				}
			} else if (tag.fl === 3) {
				tags = parseTags(data);
			}
			pos += rl.v;
			continue;
		}
		break;
	}
	return { geom, type, tags, partial };
}

function readVarintXor(buf, pos = 0) {
	let res = 0, shift = 0, bytesRead = 0;
	while (pos < buf.length) {
		const b = buf[pos++];
		bytesRead++;
		const real = b ^ 0xff;
		res |= (real & 0x7f) << shift;
		if (!(real & 0x80)) {
			return { val: res, bytesRead };
		}
		shift += 7;
		if (shift > 35) break;
	}
	return null;
}

function parsePreambleLayer(raw) {
	if (raw[0] !== 0x1a) return null;
	const vx = readVarintXor(raw, 1);
	if (!vx || vx.val <= 0 || vx.val > raw.length - 1 - vx.bytesRead) return null;
	const content = raw.slice(1 + vx.bytesRead, 1 + vx.bytesRead + vx.val);
	let pos = 0, name = "";
	const keys = [], values = [], valueKinds = [], rawFeatures = [];
	let extent = 4096, version = 2;
	while (pos < content.length) {
		const tag = readTagXor(content, pos);
		if (!tag) { pos++; continue; }
		pos++;
		if (tag.wt === 0) {
			const r = R_(content.slice(pos));
			const v = r.u32();
			if (v < 0) break;
			if (tag.fl === 5) extent = v;
			else if (tag.fl === 15) version = v;
			pos += r.pos;
			continue;
		}
		if (tag.wt === 2) {
			const rl = readLenXor(content, pos, content.length - pos - 1);
			if (rl.v < 0) break;
			pos += rl.n;
			const data = content.slice(pos, pos + rl.v);
			if (tag.fl === 1) {
				const feat = parseFeatureContainerXor(data);
				if (feat && feat.geom) rawFeatures.push(feat);
			}
			else if (tag.fl === 2) name = data.toString("utf8");
			else if (tag.fl === 4) keys.push(data.toString("utf8"));
			else if (tag.fl === 3) {
				let val = null, kind = "empty";
				for (const vf of splitFields(data)) {
					if (vf.fl === 1 && vf.wt === 2) {
						const s = data.slice(vf.start, vf.start + vf.L);
						const st = s.toString("utf8");
						if (!st.includes("\uFFFD") && Buffer.from(st, "utf8").equals(s)) { val = st; kind = "string"; }
						else { val = { __raw_hex: s.toString("hex") }; kind = "rawhex"; }
					} else if (vf.fl === 3 && vf.wt === 5) { val = data.readFloatLE(vf.start); kind = "float32"; }
					else if (vf.fl === 3 && vf.wt === 1) { val = data.readDoubleLE(vf.start); kind = "float64"; }
				}
				values.push(val); valueKinds.push(kind);
			}
			pos += rl.v;
			continue;
		}
		break;
	}
	// 支持包含纯几何且无属性键的图层（如 sea 海洋水体图层）
	if (!name || !/^[A-Za-z0-9_-]{2,30}$/.test(name) || !rawFeatures.length) return null;
	const features = rawFeatures.map((rf) => {
		const props = {};
		if (rf.tags) {
			for (let i = 0; i + 1 < rf.tags.length; i += 2) {
				const k = rf.tags[i], v = rf.tags[i + 1];
				if (k < keys.length && v < values.length) props[keys[k]] = values[v];
			}
		}
		return {
			type: rf.type || 2,
			tags: rf.tags || [],
			props,
			paths: rf.geom.map((p) => ({ points: p.points, closed: p.closed })),
			partial: !!rf.partial
		};
	});
	return {
		name, extent, version, keys, values, valueKinds, features
	};
}

function parseBareBlock(buf) {
	const top = parseTop(buf);
	if (!top.ok) return null;
	const fields = top.fields;
	const nameIdx = fields.findIndex((f) => f.fl === 2 && f.wt === 2);
	if (nameIdx < 0) return null;
	const name = buf.slice(fields[nameIdx].start, fields[nameIdx].start + fields[nameIdx].L).toString("utf8");
	if (!/^[A-Za-z0-9_]{2,20}$/.test(name)) return null;
	const featFields = fields.slice(0, nameIdx);
	const layerFields = fields.slice(nameIdx + 1);
	const keys = [], values = [], valueKinds = [];
	let extent = 4096, version = 2;
	for (const f of layerFields) {
		if (f.fl === 4 && f.wt === 2) keys.push(buf.slice(f.start, f.start + f.L).toString("utf8"));
		else if (f.fl === 3 && f.wt === 2) {
			const { value, kind } = parseValue(buf.slice(f.start, f.start + f.L));
			values.push(value); valueKinds.push(kind);
		}
		else if (f.fl === 5 && f.wt === 0) extent = f.v;
		else if (f.fl === 15 && f.wt === 0) version = f.v;
	}

	const rawFeatures = [];
	let cur = null;
	const flush = () => {
		if (cur && cur.type != null && cur.geoms.length) rawFeatures.push(cur);
		cur = null;
	};
	for (const f of featFields) {
		if (f.fl === 1 && f.wt === 2) {
			const sub = buf.slice(f.start, f.start + f.L);
			const wrapped = parseFeature(sub);
			const wrappedComplete = wrapped.type != null && (wrapped.pathGroups ? wrapped.pathGroups.flat() : []).length;
			if (wrappedComplete) {
				flush();
				rawFeatures.push({ type: wrapped.type, tags: wrapped.tags || [], geoms: wrapped.pathGroups.flat(), wrapped: true, partial: !!wrapped.partial });
				continue;
			}
			const res = findCommands(sub);
			if (!res || !res.paths.length) return null;
			(cur ||= { geoms: [], type: null, tags: [], partial: false }).geoms.push(...res.paths);
			if (res.partial) cur.partial = true;
		}
		else if (f.fl === 2 && f.wt === 0) {
			if (cur && (cur.tags?.length || cur.geoms?.length)) flush();
			(cur ||= { geoms: [], type: null, tags: [], partial: false }).type = f.v;
		}
		else if (f.fl === 3 && f.wt === 2) {
			if (!cur || !cur.geoms.length || cur.type == null) return null;
			cur.tags = parseTags(buf.slice(f.start, f.start + f.L));
			flush();
		}
	}
	flush();
	if (!rawFeatures.length) return null;

	const features = [];
	for (const rf of rawFeatures) {
		if (![1, 2, 4].includes(rf.type)) continue;
		if (rf.tags && rf.tags.length % 2) continue;
		features.push({
			type: rf.type,
			tags: rf.tags || [],
			paths: rf.geoms.map((p) => ({ points: p.points, closed: p.closed })),
			partial: !!rf.partial
		});
	}
	if (!features.length) return null;
	return { name, extent, version, keys, values, valueKinds, features };
}

/* ================= 3. 全瓦片解码核心 ================= */
export function decodeTiandituTile(buf) {
	if (!buf || !buf.length) return [];
	const raw = Buffer.from(buf);
	if (raw.length > 99) raw[99] = raw[99] ^ 0xff;

	// 1. 尝试解析 Preamble 块（包含高层级城市级瓦片的 BV 陆地背景多边形，XOR 编码）
	const preamble = parsePreambleLayer(raw);

	// 2. 扫描标准 MVT 图层 (Tag 0x1a)
	const layerRecs = detectLayers(raw);
	const layers = [];
	const firstStd = layerRecs.length ? Math.min(...layerRecs.map((r) => r.bodyPos)) : raw.length;

	// 3. 在首个标准图层之前，探测是否存在裸图层块 Bare Block（如低层级 z<=2 大陆/边界瓦片）
	let bare = null;
	if (firstStd > 0) {
		for (let h = 0; h < Math.min(firstStd, 12); h++) {
			const b = parseBareBlock(raw.slice(h, firstStd));
			if (b && b.features.length) {
				bare = b;
				break;
			}
		}
	}

	const mapPaths = (f) => (f.pathGroups ? f.pathGroups.flat() : f.paths).map((p) => ({ points: p.points, closed: p.closed }));

	// 4. 合并 preamble 与 bare 图层（若同名则优先保留要素数更多者）
	if (bare && preamble && bare.name === preamble.name) {
		layers.push(bare.features.length >= preamble.features.length ? bare : preamble);
	} else {
		if (preamble && preamble.features && preamble.features.length) {
			layers.push({
				name: preamble.name, extent: preamble.extent, version: preamble.version,
				keys: preamble.keys, values: preamble.values, valueKinds: preamble.valueKinds,
				features: preamble.features.map((f) => ({
					type: f.type, tags: f.tags,
					paths: mapPaths(f), partial: !!f.partial,
				})),
			});
		}
		if (bare && bare.features && bare.features.length) {
			layers.push(bare);
		}
	}

	// 5. 追加所有标准图层
	for (const lr of layerRecs) {
		const L = parseLayer(lr);
		if (L && L.features.length) {
			layers.push({
				name: L.name, extent: L.extent, version: L.version,
				keys: L.keys, values: L.values, valueKinds: L.valueKinds,
				features: L.features.map((f) => ({
					type: f.type, tags: f.tags,
					paths: mapPaths(f), partial: !!f.partial,
				})),
			});
		}
	}
	return layers;
}

/* ================= 4. 标准 MVT (Mapbox Vector Tile) 编码器 ================= */
class ProtoWriter {
	constructor() { this.parts = []; this.length = 0; }
	writeVarint(val) {
		let v = BigInt(val);
		const bytes = [];
		while (v >= 0x80n) {
			bytes.push(Number((v & 0x7fn) | 0x80n));
			v >>= 7n;
		}
		bytes.push(Number(v));
		const b = Buffer.from(bytes);
		this.parts.push(b);
		this.length += b.length;
	}
	writeTag(field, wireType) { this.writeVarint((field << 3) | wireType); }
	writeBytes(bytes) { this.parts.push(bytes); this.length += bytes.length; }
	writeStringField(field, str) {
		const b = Buffer.from(str, 'utf8');
		this.writeTag(field, 2);
		this.writeVarint(b.length);
		this.writeBytes(b);
	}
	writeMessageField(field, subWriter) {
		const b = subWriter.toBuffer();
		this.writeTag(field, 2);
		this.writeVarint(b.length);
		this.writeBytes(b);
	}
	toBuffer() { return Buffer.concat(this.parts, this.length); }
}

function encodeZigzag(n) { return (n << 1) ^ (n >> 31); }

function encodeVarintDirect(val, target = []) {
	let v = BigInt(val);
	while (v >= 0x80n) {
		target.push(Number((v & 0x7fn) | 0x80n));
		v >>= 7n;
	}
	target.push(Number(v));
	return target;
}

export function encodeToStandardMVT(layers) {
	if (!layers || !layers.length) return Buffer.alloc(0);
	const tileWriter = new ProtoWriter();

	for (const layer of layers) {
		if (!layer.features || !layer.features.length) continue;
		const layerWriter = new ProtoWriter();

		// 15: version = 2
		layerWriter.writeTag(15, 0);
		layerWriter.writeVarint(layer.version || 2);

		// 1: name
		layerWriter.writeStringField(1, layer.name);

		// 5: extent (4096)
		layerWriter.writeTag(5, 0);
		layerWriter.writeVarint(layer.extent || 4096);

		// 3: keys
		for (const k of layer.keys) {
			layerWriter.writeStringField(3, k);
		}

		// 4: values
		for (let i = 0; i < layer.values.length; i++) {
			const v = layer.values[i];
			const valWriter = new ProtoWriter();
			if (typeof v === 'string') {
				valWriter.writeStringField(1, v);
			} else if (typeof v === 'number') {
				if (Number.isInteger(v)) {
					if (v >= 0) {
						valWriter.writeTag(5, 0); // uint64
						valWriter.writeVarint(v);
					} else {
						valWriter.writeTag(6, 0); // sint64
						valWriter.writeVarint(encodeZigzag(v));
					}
				} else {
					const b = Buffer.alloc(8);
					b.writeDoubleLE(v, 0);
					valWriter.writeTag(3, 1); // double
					valWriter.writeBytes(b);
				}
			} else if (typeof v === 'boolean') {
				valWriter.writeTag(7, 0);
				valWriter.writeVarint(v ? 1 : 0);
			} else {
				valWriter.writeStringField(1, String(v == null ? '' : (v.__raw_hex || v)));
			}
			layerWriter.writeMessageField(4, valWriter);
		}

		// 2: features
		for (const feat of layer.features) {
			const featWriter = new ProtoWriter();
			// 天地图类型映射到 MVT 标准枚举:
			// 天地图: 1=Line, 2=Polygon, 4=Point
			// MVT标准: 1=Point, 2=LineString, 3=Polygon
			let mvtType = 1;
			if (feat.type === 1) mvtType = 2; // LineString
			else if (feat.type === 2) mvtType = 3; // Polygon
			else if (feat.type === 4) mvtType = 1; // Point
			else mvtType = feat.type;

			// 3: type
			featWriter.writeTag(3, 0);
			featWriter.writeVarint(mvtType);

			// 2: tags (packed) - 严格校验偶数配对及索引有效范围，杜绝 GDAL/QGIS 内存越界崩溃
			if (feat.tags && feat.tags.length >= 2) {
				const validTags = [];
				for (let t = 0; t + 1 < feat.tags.length; t += 2) {
					const k = feat.tags[t];
					const v = feat.tags[t + 1];
					if (k < layer.keys.length && v < layer.values.length) {
						validTags.push(k, v);
					}
				}
				if (validTags.length) {
					const tagBuf = [];
					for (const t of validTags) {
						encodeVarintDirect(t, tagBuf);
					}
					featWriter.writeTag(2, 2);
					featWriter.writeVarint(tagBuf.length);
					featWriter.writeBytes(Buffer.from(tagBuf));
				}
			}

			// 4: geometry (packed)
			const geomBuf = [];
			let cursorX = 0, cursorY = 0;
			if (mvtType === 1) { // Point
				const allPoints = feat.paths.flatMap(p => p.points);
				if (allPoints.length) {
					encodeVarintDirect((1 & 7) | (allPoints.length << 3), geomBuf);
					for (const pt of allPoints) {
						const dx = Math.round(pt[0]) - cursorX;
						const dy = Math.round(pt[1]) - cursorY;
						encodeVarintDirect(encodeZigzag(dx), geomBuf);
						encodeVarintDirect(encodeZigzag(dy), geomBuf);
						cursorX = Math.round(pt[0]);
						cursorY = Math.round(pt[1]);
					}
				}
			} else if (mvtType === 2) { // LineString
				for (const path of feat.paths) {
					const pts = path.points;
					if (pts.length < 2) continue;
					encodeVarintDirect((1 & 7) | (1 << 3), geomBuf);
					let dx = Math.round(pts[0][0]) - cursorX;
					let dy = Math.round(pts[0][1]) - cursorY;
					encodeVarintDirect(encodeZigzag(dx), geomBuf);
					encodeVarintDirect(encodeZigzag(dy), geomBuf);
					cursorX = Math.round(pts[0][0]);
					cursorY = Math.round(pts[0][1]);

					const lineCount = pts.length - 1;
					encodeVarintDirect((2 & 7) | (lineCount << 3), geomBuf);
					for (let j = 1; j < pts.length; j++) {
						dx = Math.round(pts[j][0]) - cursorX;
						dy = Math.round(pts[j][1]) - cursorY;
						encodeVarintDirect(encodeZigzag(dx), geomBuf);
						encodeVarintDirect(encodeZigzag(dy), geomBuf);
						cursorX = Math.round(pts[j][0]);
						cursorY = Math.round(pts[j][1]);
					}
				}
			} else if (mvtType === 3) { // Polygon (包含单面与 MultiPolygon)
				for (let pIdx = 0; pIdx < feat.paths.length; pIdx++) {
					const path = feat.paths[pIdx];
					const pts = path.points;
					if (pts.length < 3) continue;
					const isClosed = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
					let ringPts = isClosed ? pts.slice(0, -1) : pts.slice();
					if (ringPts.length < 3) continue;

					// 计算环的带符号面积（屏幕像素系: X向右, Y向下）
					let sum = 0;
					const n = ringPts.length;
					for (let i = 0; i < n; i++) {
						const p1 = ringPts[i];
						const p2 = ringPts[(i + 1) % n];
						sum += (p1[0] * p2[1] - p2[0] * p1[1]);
					}
					const signedArea = sum / 2;

					// 过滤掉面积小于 1.5 的零面积退化碎环（防止 MapLibre earcut 三角剖分崩溃导致整块多边形不渲染）
					if (Math.abs(signedArea) < 1.5) continue;

					// 外环必须顺时针 (signedArea > 0)，若为逆时针则反转
					if (pIdx === 0 && signedArea < 0) {
						ringPts.reverse();
					}

					encodeVarintDirect((1 & 7) | (1 << 3), geomBuf); // MoveTo(1)
					let dx = Math.round(ringPts[0][0]) - cursorX;
					let dy = Math.round(ringPts[0][1]) - cursorY;
					encodeVarintDirect(encodeZigzag(dx), geomBuf);
					encodeVarintDirect(encodeZigzag(dy), geomBuf);
					cursorX = Math.round(ringPts[0][0]);
					cursorY = Math.round(ringPts[0][1]);

					encodeVarintDirect((2 & 7) | ((ringPts.length - 1) << 3), geomBuf); // LineTo(n-1)
					for (let j = 1; j < ringPts.length; j++) {
						dx = Math.round(ringPts[j][0]) - cursorX;
						dy = Math.round(ringPts[j][1]) - cursorY;
						encodeVarintDirect(encodeZigzag(dx), geomBuf);
						encodeVarintDirect(encodeZigzag(dy), geomBuf);
						cursorX = Math.round(ringPts[j][0]);
						cursorY = Math.round(ringPts[j][1]);
					}
					encodeVarintDirect((7 & 7) | (1 << 3), geomBuf); // ClosePath(1)
					// MVT 2.1 规范 4.3.3.3: ClosePath 命令使游标返回闭合环起点，重置当前游标
					cursorX = Math.round(ringPts[0][0]);
					cursorY = Math.round(ringPts[0][1]);
				}
			}

			if (geomBuf.length) {
				featWriter.writeTag(4, 2);
				featWriter.writeVarint(geomBuf.length);
				featWriter.writeBytes(Buffer.from(geomBuf));
				layerWriter.writeMessageField(2, featWriter);
			}
		}

		tileWriter.writeMessageField(3, layerWriter);
	}

	return tileWriter.toBuffer();
}

/**
 * 完整转码：输入天地图原始加密/混淆瓦片 Buffer，输出标准 Mapbox Vector Tile (MVT) Buffer
 */
export function convertTiandituToStandardMVT(rawBuf) {
	const layers = decodeTiandituTile(rawBuf);
	return encodeToStandardMVT(layers);
}
