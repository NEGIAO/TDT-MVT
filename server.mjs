// server.mjs
// 天地图矢量切片本地解码代理与样式托管服务
// 实现“样式与数据完全解耦”的方法二

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchTiandituTile, decodeTiandituTile, encodeToStandardMVT, DEFAULT_DEMO_TK } from './mvt_codec.mjs';
import { buildUnifiedStyle } from './style_generator.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '8890', 10);
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');
const MAX_CACHE_MB = parseInt(process.env.MAX_CACHE_MB || '1024', 10);
const STATIC_DIR = path.join(__dirname, 'static');
const CLIENT_DIR = path.join(__dirname, 'client');
const DICT_PATH = path.join(__dirname, 'assets/data/tdt_field_dictionary.json');

// 全局异常与未捕获 Rejection 守卫，防止瞬时网络重置或 WAF 418 冲垮服务进程
process.on('unhandledRejection', (reason) => {
	console.warn('[Process] 拦截到未处理异步 Rejection (服务受保护):', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
	console.error('[Process] 拦截到未处理同步 Exception (服务受保护):', err?.message || err);
});

// 确保缓存目录存在（若无权限则回退到当前目录下的 cache）
try {
	if (!fs.existsSync(CACHE_DIR)) {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
	}
} catch (err) {
	console.warn(`[Cache] 创建缓存目录 ${CACHE_DIR} 失败，将尝试回退到本地 ./cache:`, err.message);
}

// 缓存容量保护机制（LRU 清理）
function cleanupCacheIfNeeded() {
	try {
		if (!fs.existsSync(CACHE_DIR)) return;
		const files = fs.readdirSync(CACHE_DIR);
		let totalBytes = 0;
		const fileStats = [];

		for (const f of files) {
			if (!f.endsWith('.pbf')) continue;
			const fp = path.join(CACHE_DIR, f);
			try {
				const st = fs.statSync(fp);
				if (st.size === 0) {
					// 0 字节文件属于旧版本解析失败遗留的损坏缓存，直接删除防止污染新版
					fs.unlinkSync(fp);
					continue;
				}
				totalBytes += st.size;
				fileStats.push({ path: fp, mtime: st.mtimeMs, size: st.size });
			} catch (_) {}
		}

		const totalMB = totalBytes / (1024 * 1024);
		if (totalMB > MAX_CACHE_MB) {
			console.log(`[Cache] 缓存体积 (${totalMB.toFixed(1)}MB) 超出上限 (${MAX_CACHE_MB}MB)，开始执行 LRU 清理...`);
			fileStats.sort((a, b) => a.mtime - b.mtime);
			const targetBytes = MAX_CACHE_MB * 0.8 * 1024 * 1024;
			let deletedCount = 0;
			let freedBytes = 0;

			for (const file of fileStats) {
				if (totalBytes - freedBytes <= targetBytes) break;
				try {
					fs.unlinkSync(file.path);
					freedBytes += file.size;
					deletedCount++;
				} catch (_) {}
			}
			console.log(`[Cache] LRU 清理完成：删除 ${deletedCount} 个过期切片，释放 ${(freedBytes / 1024 / 1024).toFixed(1)}MB`);
		}
	} catch (e) {
		console.warn('[Cache] 缓存容量检查异常:', e.message);
	}
}

// 启动时检查一次，且每 30 分钟检查一次
cleanupCacheIfNeeded();
setInterval(cleanupCacheIfNeeded, 30 * 60 * 1000).unref();

// 加载数据字典供前端要素探查使用
let fieldDict = {};
try {
	if (fs.existsSync(DICT_PATH)) {
		fieldDict = JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'));
	}
} catch (e) {
	console.warn('[Dict] 加载字段字典失败:', e.message);
}

// 预先提取 73 个矢量图层元数据 (符合 TileJSON 3.0.0 与 Mapbox Vector Tile 规范，防止 QGIS / ArcGIS 崩溃)
function buildVectorLayersMetadata() {
	const metadata = [];
	try {
		const stylePath = path.join(STATIC_DIR, 'style.json');
		if (!fs.existsSync(stylePath)) return [];
		const s = JSON.parse(fs.readFileSync(stylePath, 'utf8'));
		const layerMap = new Map();
		for (const l of s.layers) {
			const sLayer = l['source-layer'];
			if (!sLayer) continue;
			if (!layerMap.has(sLayer)) {
				layerMap.set(sLayer, {
					id: sLayer,
					minzoom: l.minzoom || 1,
					maxzoom: l.maxzoom || 19,
					description: fieldDict.layers?.[sLayer]?.description || `${sLayer} 矢量要素层`,
					fields: {
						"Z5": "String (名称/注记)",
						"S8": "Number (符号/要素子类码)",
						"A6": "Number (数据包码)",
						"B7": "String (地名文字)",
						"O4": "Number (等级)"
					}
				});
			} else {
				const item = layerMap.get(sLayer);
				if (l.minzoom && l.minzoom < item.minzoom) item.minzoom = l.minzoom;
				if (l.maxzoom && l.maxzoom > item.maxzoom) item.maxzoom = l.maxzoom;
			}
		}
		return Array.from(layerMap.values());
	} catch (e) {
		console.warn('[TileJSON] 构建矢量图层元数据异常:', e.message);
		return [];
	}
}
const VECTOR_LAYERS = buildVectorLayersMetadata();

// MIME 类型表
const MIME_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.pbf': 'application/x-protobuf',
	'.ico': 'image/x-icon',
	'.qlr': 'application/x-qgis-layer-definition; charset=utf-8',
	'.lyrx': 'application/json; charset=utf-8',
	'.qml': 'text/xml; charset=utf-8'
};

const stats = {
	totalRequests: 0,
	cacheHits: 0,
	proxyFetched: 0,
	failedRequests: 0
};

// 空切片缓存（当特定区域无数据时使用，避免客户端反复重试报错）
const EMPTY_MVT = Buffer.from([]);

// 并发请求限制与队列（提升并发至 16，加快视口瓦片并行加载）
const MAX_CONCURRENT_FETCHES = 16;
let activeFetches = 0;
const fetchQueue = [];

function runWithConcurrency(fn) {
	return new Promise((resolve, reject) => {
		fetchQueue.push({ fn, resolve, reject });
		processQueue();
	});
}

function processQueue() {
	while (activeFetches < MAX_CONCURRENT_FETCHES && fetchQueue.length > 0) {
		const item = fetchQueue.shift();
		activeFetches++;
		item.fn()
			.then(item.resolve, item.reject)
			.finally(() => {
				activeFetches--;
				processQueue();
			});
	}
}

// 正在拉取转码中的切片 Promise 缓存（请求合并，避免多图层重复拉取同一瓦片）
const inFlightRequests = new Map();

/**
 * 处理矢量切片代理请求: /mvt/:z/:x/:y
 */
async function handleMvtRequest(req, res, z, x, y, tk) {
	const tileKey = `${z}_${x}_${y}.pbf`;
	const cacheFile = path.join(CACHE_DIR, tileKey);

	stats.totalRequests++;

	// 1. 命中本地磁盘缓存
	if (fs.existsSync(cacheFile)) {
		try {
			const buf = fs.readFileSync(cacheFile);
			stats.cacheHits++;
			if (buf.length === 0) {
				res.writeHead(200, {
					'Content-Type': 'application/x-protobuf',
					'Access-Control-Allow-Origin': '*',
					'Cache-Control': 'no-cache, no-store, must-revalidate',
					'X-Tile-Empty': 'true',
					'X-Tile-Layers': '0'
				});
				res.end(EMPTY_MVT);
				return;
			}
			res.writeHead(200, {
				'Content-Type': 'application/x-protobuf',
				'Access-Control-Allow-Origin': '*',
				'Cache-Control': 'public, max-age=604800',
				'X-Tile-Cache': 'HIT'
			});
			res.end(buf);
			return;
		} catch (e) {
			console.warn(`[Cache] 读取缓存文件失败 ${tileKey}:`, e.message);
		}
	}

	// 2. 本地无缓存，向天地图官方接口拉取、解密并重新转码为标准 MVT
	// 使用 inFlightRequests 进行请求合并，防止同一瓦片被并发重复请求
	let transcodePromise = inFlightRequests.get(tileKey);
	if (!transcodePromise) {
		transcodePromise = runWithConcurrency(async () => {
			stats.proxyFetched++;
			const rawEncryptedBuf = await fetchTiandituTile(x, y, z, tk || DEFAULT_DEMO_TK);
			if (!rawEncryptedBuf || rawEncryptedBuf.length === 0) {
				return { buf: EMPTY_MVT, isEmpty: true, layerCount: 0 };
			}

			// 解密私有协议 -> 解析图层/要素/几何/标签 -> 转码为标准 Mapbox MVT
			const decodedLayers = decodeTiandituTile(rawEncryptedBuf);
			const standardMvtBuf = encodeToStandardMVT(decodedLayers);
			const isEmpty = !standardMvtBuf || standardMvtBuf.length === 0;

			// 异步写入磁盘缓存（仅对非空瓦片缓存，防止 0 字节损坏文件污染缓存）
			if (!isEmpty) {
				fs.writeFile(cacheFile, standardMvtBuf, (err) => {
					if (err) console.error(`[Cache] 写入磁盘失败 ${tileKey}:`, err.message);
				});
			}

			return { buf: standardMvtBuf, isEmpty, layerCount: decodedLayers.length };
		});

		inFlightRequests.set(tileKey, transcodePromise);
		transcodePromise.catch(() => {});
		transcodePromise.finally(() => {
			inFlightRequests.delete(tileKey);
		});
	}

	try {
		const result = await transcodePromise;
		if (result.isEmpty || !result.buf || result.buf.length === 0) {
			res.writeHead(200, {
				'Content-Type': 'application/x-protobuf',
				'Access-Control-Allow-Origin': '*',
				'Cache-Control': 'no-cache, no-store, must-revalidate',
				'X-Tile-Empty': 'true',
				'X-Tile-Layers': '0'
			});
			res.end(EMPTY_MVT);
			return;
		}

		res.writeHead(200, {
			'Content-Type': 'application/x-protobuf',
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': 'public, max-age=604800',
			'X-Tile-Cache': 'MISS',
			'X-Tile-Layers': result.layerCount
		});
		res.end(result.buf);
	} catch (err) {
		stats.failedRequests++;
		console.error(`[MVT] 切片最终获取/转码失败 (${z}/${x}/${y}):`, err.message);

		// 明确返回 503 Service Unavailable，带 Retry-After 和 no-cache 头
		// 严禁返回 204（返回 204 会导致 MapLibre 认为该瓦片永久为空，不再重试并出现永久海蓝色空洞）
		res.writeHead(503, {
			'Content-Type': 'text/plain; charset=utf-8',
			'Access-Control-Allow-Origin': '*',
			'Retry-After': '2',
			'Cache-Control': 'no-cache, no-store, must-revalidate',
			'X-Tile-Error': encodeURIComponent(err.message || 'unknown')
		});
		res.end(`Tile Transcode Temporary Error: ${err.message}`);
	}
}

/**
 * 静态文件分发
 */
function serveStaticFile(res, filePath) {
	if (!fs.existsSync(filePath)) {
		res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
		res.end('404 Not Found');
		return;
	}

	const ext = path.extname(filePath).toLowerCase();
	const contentType = MIME_TYPES[ext] || 'application/octet-stream';

	try {
		const stat = fs.statSync(filePath);
		if (stat.isDirectory()) {
			res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end('Directory listing forbidden');
			return;
		}

		const stream = fs.createReadStream(filePath);
		res.writeHead(200, {
			'Content-Type': contentType,
			'Content-Length': stat.size,
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400'
		});
		stream.pipe(res);
	} catch (e) {
		res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
		res.end(`Internal Server Error: ${e.message}`);
	}
}

// 创建 HTTP 服务
const server = http.createServer(async (req, res) => {
	const prefix = (req.headers['x-forwarded-prefix'] || process.env.BASE_PATH || '').replace(/\/+$/, '');
	const reqUrl = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
	let pathname = reqUrl.pathname;
	if (prefix && pathname.startsWith(prefix)) {
		pathname = pathname.slice(prefix.length) || '/';
	}
	const userAgent = req.headers['user-agent'] || 'unknown';
	console.log(`[REQ] ${req.method} ${pathname}${reqUrl.search} (Client: ${userAgent.substring(0, 40)})`);

	// 跨域预检请求处理
	if (req.method === 'OPTIONS') {
		res.writeHead(204, {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': '*',
			'Access-Control-Max-Age': '86400'
		});
		res.end();
		return;
	}
	const tk = reqUrl.searchParams.get('tk') || DEFAULT_DEMO_TK;
	const hostOrigin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || `127.0.0.1:${PORT}`}${prefix}`;

	// 1.0 客户端容错与自愈机制：如果 QGIS / ArcGIS 用户误将切片模板填入“样式 URL”
	// 例如请求 /mvt/{z}/{x}/{y} 或 /mvt/%7Bz%7D/%7Bx%7D/%7By%7D，直接返回样式文件以自愈配置
	if (pathname.includes('{z}') || pathname.includes('%7Bz%7D') || pathname.includes('{x}') || pathname.includes('%7Bx%7D')) {
		const style = buildUnifiedStyle({ host: hostOrigin, theme: 'default', mode: 'proxy', tk });
		res.writeHead(200, {
			'Content-Type': 'application/json; charset=utf-8',
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': 'no-cache'
		});
		res.end(JSON.stringify(style));
		return;
	}

	// 1.0.1 客户端容错：如果用户将 style.json 填入瓦片 URL，并带切片坐标请求 /style.json/{z}/{x}/{y}
	const styleTileMatch = pathname.match(/^\/style(?:\.json|\/)?\/(\d+)\/(\d+)\/(\d+)(?:\.pbf)?$/);
	if (styleTileMatch) {
		const z = parseInt(styleTileMatch[1], 10);
		const x = parseInt(styleTileMatch[2], 10);
		const y = parseInt(styleTileMatch[3], 10);
		await handleMvtRequest(req, res, z, x, y, tk);
		return;
	}

	// 1. MVT 切片代理路由: /mvt/{z}/{x}/{y}
	const mvtMatch = pathname.match(/^\/mvt\/(\d+)\/(\d+)\/(\d+)(?:\.pbf)?$/);
	if (mvtMatch) {
		const z = parseInt(mvtMatch[1], 10);
		const x = parseInt(mvtMatch[2], 10);
		const y = parseInt(mvtMatch[3], 10);
		await handleMvtRequest(req, res, z, x, y, tk);
		return;
	}

	// 1.1 兼容官方风格 /vts 接口: /vts?t=vt&z={z}&x={x}&y={y}&tk={tk}
	if (pathname === '/vts' || (pathname === '/style.json' && reqUrl.searchParams.has('z') && reqUrl.searchParams.has('x'))) {
		const zStr = reqUrl.searchParams.get('z');
		const xStr = reqUrl.searchParams.get('x');
		const yStr = reqUrl.searchParams.get('y');
		if (zStr !== null && xStr !== null && yStr !== null) {
			const z = parseInt(zStr, 10);
			const x = parseInt(xStr, 10);
			const y = parseInt(yStr, 10);
			if (!isNaN(z) && !isNaN(x) && !isNaN(y)) {
				await handleMvtRequest(req, res, z, x, y, tk);
				return;
			}
		}
	}

	// 2. 样式文件路由: 
	// 方案二 (本地代理模式): /style.json, /style-{theme}.json
	// 方案一 (官方直连模式): /style-direct.json, /style-direct-{theme}.json
	const styleMatch = pathname.match(/^\/style(?:-(direct))?(?:-([a-zA-Z0-9_-]+))?\.json$/);
	if (styleMatch) {
		const isDirect = styleMatch[1] === 'direct';
		let themeName = styleMatch[2] || (isDirect ? 'default' : styleMatch[1] || 'default');
		if (themeName === 'direct') themeName = 'default';
		const mode = isDirect ? 'direct' : 'proxy';

		let part = 'all';
		let realTheme = themeName;
		if (themeName === 'vec') { part = 'vec'; realTheme = 'default'; }
		if (themeName === 'cva') { part = 'cva'; realTheme = 'default'; }

		const style = buildUnifiedStyle({ host: hostOrigin, theme: realTheme, mode, part, tk });
		res.writeHead(200, {
			'Content-Type': 'application/json; charset=utf-8',
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': 'no-cache'
		});
		res.end(JSON.stringify(style));
		return;
	}

	// 2.5 TileJSON 规范元数据路由: /tilejson.json (供 QGIS、ArcGIS Pro 等客户端一键直接识别与添加)
	if (pathname === '/tilejson.json' || pathname === '/mvt/tilejson.json') {
		const tileJson = {
			tilejson: "3.0.0",
			name: "天地图标准矢量瓦片服务 (Tianditu Decoupled MVT)",
			description: "天地图官方矢量切片解码为标准 Mapbox MVT 服务，兼容 QGIS 与 ArcGIS Pro",
			version: "1.0.0",
			scheme: "xyz",
			tiles: [
				`${hostOrigin}/mvt/{z}/{x}/{y}`
			],
			minzoom: 0,
			maxzoom: 18,
			bounds: [-180, -85.051129, 180, 85.051129],
			center: [116.397, 39.908, 10],
			format: "pbf",
			vector_layers: VECTOR_LAYERS
		};
		// 写入 static 目录供静态文件方式读取
		try {
			fs.writeFileSync(path.join(STATIC_DIR, 'tilejson.json'), JSON.stringify(tileJson, null, 2), 'utf8');
		} catch (e) {}

		res.writeHead(200, {
			'Content-Type': 'application/json; charset=utf-8',
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': 'no-cache'
		});
		res.end(JSON.stringify(tileJson, null, 2));
		return;
	}

	// 2.55 ArcGIS REST 服务目录与探测路由
	if (pathname === '/arcgis/rest/info' || pathname === '/arcgis/rest/info/') {
		res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
		res.end(JSON.stringify({ currentVersion: 10.91, fullVersion: "10.9.1", authInfo: { isTokenBasedSecurity: false } }));
		return;
	}
	if (pathname === '/arcgis/rest/services' || pathname === '/arcgis/rest/services/') {
		res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
		res.end(JSON.stringify({
			currentVersion: 10.91,
			folders: ['tdt'],
			services: [
				{ name: 'tdt/VectorTileServer', type: 'VectorTileServer' },
				{ name: 'google/VectorTileServer', type: 'VectorTileServer' },
				{ name: 'amap/VectorTileServer', type: 'VectorTileServer' },
				{ name: 'dark/VectorTileServer', type: 'VectorTileServer' },
				{ name: 'tech_blue/VectorTileServer', type: 'VectorTileServer' },
				{ name: 'custom/VectorTileServer', type: 'VectorTileServer' }
			]
		}, null, 2));
		return;
	}
	if (pathname.match(/^\/arcgis\/rest\/services\/(?:tdt|google|amap|dark|tech_blue|custom)\/?$/)) {
		const sName = pathname.split('/')[4];
		res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
		res.end(JSON.stringify({
			currentVersion: 10.91,
			services: [
				{ name: `${sName}/VectorTileServer`, type: 'VectorTileServer' }
			]
		}, null, 2));
		return;
	}

	// 2.6 ArcGIS Pro 原生 VectorTileServer 协议支持 (多主题通用)
	// 允许在 ArcGIS Pro 中使用“从路径添加数据 (Add Data From Path)”直接以 Vector Tile Service 添加
	const agsServerMatch = pathname.match(/^\/arcgis\/rest\/services\/([a-zA-Z0-9_-]+)\/VectorTileServer\/?$/);
	if (agsServerMatch) {
		const serviceName = agsServerMatch[1];
		// 生成 0-18 级完整的 Web Mercator LODs 比例尺与分辨率数组 (ArcGIS Pro 渲染必需)
		// 注意: Esri 矢量切片规范中，512x512 瓦片在 0 级的 resolution 是 78271.516964，scale 是 295828763.7957775
		// 512 像素 * 78271.516964 米/像素 = 40075016.6855 米 (地球赤道全长)
		// 若误填为 256 瓦片的 156543.033928，会导致 ArcGIS Pro 计算的瓦片行列号减半，坐标发生 2 倍巨幅偏移
		const lods = Array.from({ length: 19 }, (_, i) => ({
			level: i,
			resolution: 78271.516964 / Math.pow(2, i),
			scale: 295828763.7957775 / Math.pow(2, i)
		}));

		const vtServerMeta = {
			currentVersion: 10.91,
			name: `${serviceName}/VectorTileServer`,
			capabilities: "TilesOnly",
			type: "indexedVector",
			defaultStyles: "resources/styles",
			tiles: [
				"tile/{z}/{y}/{x}.pbf"
			],
			exportTilesAllowed: false,
			initialExtent: {
				xmin: -20037508.342787,
				ymin: -20037508.342787,
				xmax: 20037508.342787,
				ymax: 20037508.342787,
				spatialReference: { wkid: 102100, latestWkid: 3857 }
			},
			fullExtent: {
				xmin: -20037508.342787,
				ymin: -20037508.342787,
				xmax: 20037508.342787,
				ymax: 20037508.342787,
				spatialReference: { wkid: 102100, latestWkid: 3857 }
			},
			minScale: 0.0,
			maxScale: 0.0,
			minLOD: 0,
			maxLOD: 18,
			tileInfo: {
				rows: 512,
				cols: 512,
				dpi: 96,
				format: "pbf",
				origin: { x: -20037508.342787, y: 20037508.342787 },
				spatialReference: { wkid: 102100, latestWkid: 3857 },
				lods
			},
			minzoom: 0,
			maxzoom: 18,
			resourceInfo: {
				styleVersion: 8,
				tileCompression: "none"
			}
		};
		res.writeHead(200, {
			'Content-Type': 'application/json; charset=utf-8',
			'Access-Control-Allow-Origin': '*'
		});
		res.end(JSON.stringify(vtServerMeta, null, 2));
		return;
	}

	// 2.7 ArcGIS Pro 样式资源请求: resources/styles 与 resources/styles/root.json (多主题映射)
	const agsStyleMatch = pathname.match(/^\/arcgis\/rest\/services\/([a-zA-Z0-9_-]+)\/VectorTileServer\/resources\/styles(?:\/root\.json|\/)?$/);
	if (agsStyleMatch) {
		const serviceName = agsStyleMatch[1];
		let theme = 'default';
		if (serviceName.includes('google')) theme = 'google';
		else if (serviceName.includes('amap')) theme = 'amap';
		else if (serviceName.includes('dark')) theme = 'dark';
		else if (serviceName.includes('tech_blue') || serviceName.includes('tech-blue')) theme = 'tech-blue';
		else if (serviceName.includes('custom')) theme = 'custom';

		const style = buildUnifiedStyle({ host: hostOrigin, theme, mode: 'proxy', tk });
		// 适配 ArcGIS Pro 规范的 sources 定义与 sprite 路径
		style.sources = {
			'esri': {
				type: 'vector',
				url: '../../'
			}
		};
		// 将图层的 source 统一指向 esri，使 ArcGIS Pro 原生渲染器能够精确绑定
		for (const l of style.layers) {
			if (l.source === 'base-tdt-vector-tile') {
				l.source = 'esri';
			}
		}
		style.sprite = `${hostOrigin}/arcgis/rest/services/${serviceName}/VectorTileServer/resources/sprites/sprite`;
		res.writeHead(200, {
			'Content-Type': 'application/json; charset=utf-8',
			'Access-Control-Allow-Origin': '*'
		});
		res.end(JSON.stringify(style));
		return;
	}

	// 2.8 ArcGIS Pro 资源元数据: resources/info 与 resources/info/root.json
	if (pathname.match(/^\/arcgis\/rest\/services\/[a-zA-Z0-9_-]+\/VectorTileServer\/resources\/info(?:\/root\.json|\/)?$/)) {
		res.writeHead(200, {
			'Content-Type': 'application/json; charset=utf-8',
			'Access-Control-Allow-Origin': '*'
		});
		res.end(JSON.stringify({
			resourceVersion: 2,
			styleVersion: 8,
			tileCompression: "none"
		}, null, 2));
		return;
	}

	// 2.9 ArcGIS Pro 精灵图资源: resources/sprites/sprite(.json|.png)
	if (pathname.match(/^\/arcgis\/rest\/services\/[a-zA-Z0-9_-]+\/VectorTileServer\/resources\/sprites\/sprite/)) {
		if (pathname.endsWith('.json')) {
			serveStaticFile(res, path.join(STATIC_DIR, 'sprite/png.json'));
			return;
		}
		if (pathname.endsWith('.png')) {
			serveStaticFile(res, path.join(STATIC_DIR, 'sprite/png.png'));
			return;
		}
	}

	// 2.10 ArcGIS Pro 切片请求: /arcgis/rest/services/:service/VectorTileServer/tile/{level}/{row}/{col}.pbf
	const agsTileMatch = pathname.match(/^\/arcgis\/rest\/services\/[a-zA-Z0-9_-]+\/VectorTileServer\/tile\/(\d+)\/(\d+)\/(\d+)(?:\.pbf)?$/);
	if (agsTileMatch) {
		const z = parseInt(agsTileMatch[1], 10);
		// Esri 顺序为 {level}/{row}/{column} -> {z}/{y}/{x}
		const y = parseInt(agsTileMatch[2], 10);
		const x = parseInt(agsTileMatch[3], 10);
		await handleMvtRequest(req, res, z, x, y, tk);
		return;
	}

	// 3. 字段字典 API (供前端要素探查与高亮使用)
	if (pathname === '/api/dictionary') {
		res.writeHead(200, {
			'Content-Type': 'application/json; charset=utf-8',
			'Access-Control-Allow-Origin': '*'
		});
		res.end(JSON.stringify(fieldDict));
		return;
	}

	// 3.1 自定义样式持久化保存 API: POST /api/save-style
	if (pathname === '/api/save-style' && req.method === 'POST') {
		let bodyStr = '';
		req.on('data', chunk => { bodyStr += chunk; });
		req.on('end', () => {
			try {
				const data = JSON.parse(bodyStr);
				const config = data.config || {};
				const fullStyle = data.fullStyle;

				// 1. 保存轻量级配置 overrides
				const configPath = path.join(STATIC_DIR, 'custom-theme-config.json');
				fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

				// 2. 如果传递了 fullStyle，则分别保存为代理模式与直连模式样式
				if (fullStyle && fullStyle.layers) {
					// 方案二 (代理模式)
					const proxyStyle = JSON.parse(JSON.stringify(fullStyle));
					if (!proxyStyle.sources) proxyStyle.sources = {};
					if (!proxyStyle.sources['base-tdt-vector-tile']) proxyStyle.sources['base-tdt-vector-tile'] = { type: 'vector' };
					proxyStyle.sources['base-tdt-vector-tile'].tiles = [`${hostOrigin}/mvt/{z}/{x}/{y}`];
					proxyStyle.sources['base-tdt-vector-tile'].url = `${hostOrigin}/tilejson.json`;
					fs.writeFileSync(path.join(STATIC_DIR, 'style-custom.json'), JSON.stringify(proxyStyle, null, 2), 'utf8');

					// 方案一 (直连模式)
					const directStyle = JSON.parse(JSON.stringify(fullStyle));
					if (!directStyle.sources) directStyle.sources = {};
					if (!directStyle.sources['base-tdt-vector-tile']) directStyle.sources['base-tdt-vector-tile'] = { type: 'vector' };
					directStyle.sources['base-tdt-vector-tile'].tiles = [`tdt-direct://{z}/{x}/{y}?tk=${DEFAULT_DEMO_TK}`];
					delete directStyle.sources['base-tdt-vector-tile'].url;
					fs.writeFileSync(path.join(STATIC_DIR, 'style-direct-custom.json'), JSON.stringify(directStyle, null, 2), 'utf8');
				}

				console.log('[Style-Save] 自定义样式已持久化至磁盘 (style-custom.json & custom-theme-config.json)');
				res.writeHead(200, {
					'Content-Type': 'application/json; charset=utf-8',
					'Access-Control-Allow-Origin': '*'
				});
				res.end(JSON.stringify({ 
					success: true, 
					message: '自定义样式已成功持久化至服务器 (static/style-custom.json)！' 
				}));
			} catch (e) {
				res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
				res.end(JSON.stringify({ success: false, error: e.message }));
			}
		});
		return;
	}

	// 3.2 获取当前已持久化的自定义配置: GET /api/custom-config
	if (pathname === '/api/custom-config') {
		const configPath = path.join(STATIC_DIR, 'custom-theme-config.json');
		let conf = {};
		if (fs.existsSync(configPath)) {
			try {
				conf = JSON.parse(fs.readFileSync(configPath, 'utf8'));
			} catch (e) {}
		}
		res.writeHead(200, {
			'Content-Type': 'application/json; charset=utf-8',
			'Access-Control-Allow-Origin': '*'
		});
		res.end(JSON.stringify(conf));
		return;
	}

	// 4. 服务状态与统计信息 API
	if (pathname === '/api/status') {
		res.writeHead(200, {
			'Content-Type': 'application/json; charset=utf-8',
			'Access-Control-Allow-Origin': '*'
		});
		res.end(JSON.stringify({
			status: 'online',
			port: PORT,
			stats,
			cacheFilesCount: fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR).length : 0
		}));
		return;
	}

	// 5. 静态资源路由: /static/... 与 /client/...
	if (pathname.startsWith('/static/')) {
		const subPath = pathname.slice('/static/'.length);
		const safePath = path.normalize(path.join(STATIC_DIR, subPath));
		if (!safePath.startsWith(STATIC_DIR)) {
			res.writeHead(403, { 'Content-Type': 'text/plain' });
			res.end('Access Denied');
			return;
		}
		serveStaticFile(res, safePath);
		return;
	}
	if (pathname.startsWith('/client/')) {
		const subPath = pathname.slice('/client/'.length);
		const safePath = path.normalize(path.join(CLIENT_DIR, subPath));
		if (!safePath.startsWith(CLIENT_DIR)) {
			res.writeHead(403, { 'Content-Type': 'text/plain' });
			res.end('Access Denied');
			return;
		}
		serveStaticFile(res, safePath);
		return;
	}

	// 6. 首页路由: / -> static/index.html
	if (pathname === '/' || pathname === '/index.html') {
		const indexPath = path.join(STATIC_DIR, 'index.html');
		serveStaticFile(res, indexPath);
		return;
	}

	// 未匹配路由
	res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
	res.end('404 Not Found');
});

server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
	console.log(`=======================================================`);
	console.log(`🚀 天地图矢量切片本地解码代理与样式解耦服务已启动!`);
	console.log(`📍 本地服务主页:     http://127.0.0.1:${PORT}/`);
	console.log(`📍 标准 MVT 瓦片源:  http://127.0.0.1:${PORT}/mvt/{z}/{x}/{y}`);
	console.log(`🎨 默认官方样式:    http://127.0.0.1:${PORT}/style.json`);
	console.log(`🎨 谷歌清新风:      http://127.0.0.1:${PORT}/style-google.json`);
	console.log(`🎨 高德素雅风:      http://127.0.0.1:${PORT}/style-amap.json`);
	console.log(`🎨 暗夜黑金主题:    http://127.0.0.1:${PORT}/style-dark.json`);
	console.log(`🎨 大屏科技蓝主题:  http://127.0.0.1:${PORT}/style-tech-blue.json`);
	console.log(`💾 磁盘瓦片缓存目录: ${CACHE_DIR}`);
	console.log(`=======================================================`);
});
