// style_generator.mjs
// 自动化生成解耦后的 MapLibre GL 样式文件
// 针对全部 74 个 source-layer 与 529 个渲染图层深度重绘
// 参考国际标杆制图标准：
// 1. 官方原版 (default)
// 2. 谷歌矢量清新风 (google) - 参考 Google Maps 2024 / Mapbox Streets
// 3. 高德素雅商务风 (amap) - 参考 AutoNavi Standard / Mapbox Navigation Light
// 4. 暗夜黑金极客风 (dark) - 参考 Mapbox Dark v11 / Alidade Dark Gold
// 5. 科技深蓝孪生风 (tech-blue) - 参考 Cyberpunk Smart City / CityEngine Digital Twin

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const BASE_DIR = path.dirname(__filename);
const s0Path = path.join(BASE_DIR, 'assets/styles/tdtStyle-vec-0.raw.json');
const s1Path = path.join(BASE_DIR, 'assets/styles/tdtStyle-vec-1.raw.json');

const s0 = JSON.parse(fs.readFileSync(s0Path, 'utf8'));
const s1 = JSON.parse(fs.readFileSync(s1Path, 'utf8'));

/**
 * 解析 RGBA 字符串
 */
function parseRgba(str) {
	if (!str || typeof str !== 'string') return null;
	const m = str.match(/rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)/);
	if (!m) return null;
	return {
		r: parseFloat(m[1]),
		g: parseFloat(m[2]),
		b: parseFloat(m[3]),
		a: m[4] !== undefined ? parseFloat(m[4]) : 1.0
	};
}

/**
 * RGB 转 HSL
 */
function rgbToHsl(r, g, b) {
	r /= 255; g /= 255; b /= 255;
	const max = Math.max(r, g, b), min = Math.min(r, g, b);
	let h, s, l = (max + min) / 2;

	if (max === min) {
		h = s = 0;
	} else {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r: h = (g - b) / d + (g < b ? 6 : 0); break;
			case g: h = (b - r) / d + 2; break;
			case b: h = (r - g) / d + 4; break;
		}
		h /= 6;
	}
	return { h: h * 360, s, l };
}

/**
 * 道路要素分类器：准确区分高速路面、高速描边、白主路面、次级主路面、微细支路及人行道
 */
function classifyRoad(colorStr, layer) {
	const sLayer = layer['source-layer'] || '';
	if (['AC', 'CF'].includes(sLayer)) return 'ramp';
	if (['AG', 'AK', 'AH'].includes(sLayer)) return 'secondary';
	if (['t8ji', 't9ji', 'CH', 'Q5', 'Z7'].includes(sLayer)) return 'minor';

	const rgba = parseRgba(colorStr);
	if (!rgba) return 'minor_surface';
	const { h, s, l } = rgbToHsl(rgba.r, rgba.g, rgba.b);

	// 1. 洁白主路面 (普通城市道路/国道/省道路面)
	if (l >= 0.94 && s <= 0.12) {
		return 'white_surface';
	}
	// 2. 高速/快速路/高等级国道表面 (黄色/琥珀金/橘色/粉紫)
	if ((s >= 0.35 && l >= 0.65 && (h <= 65 || h >= 250)) || (s >= 0.25 && l >= 0.70 && h >= 40 && h <= 65)) {
		return 'highway_surface';
	}
	// 3. 高等级公路外描边 (赭石/深红棕/紫黑描边)
	if (s >= 0.28 && l < 0.65 && (h <= 55 || h >= 250)) {
		return 'highway_casing';
	}
	// 4. 次级道路表面 (麦黄/浅米)
	if (s >= 0.20 && l >= 0.60 && h >= 35 && h <= 75) {
		return 'secondary_surface';
	}
	// 5. 普通道路描边 (浅沙/暖灰/淡褐路基)
	if (l < 0.90 && (s <= 0.35 || (h >= 25 && h <= 65 && l < 0.88))) {
		return 'standard_casing';
	}

	return 'minor_surface';
}

/**
 * 4 大优秀矢量瓦片深度定制主题配置字典
 */
export const THEMES_PALETTE = {
	// ==================== 主题 1: 谷歌现代矢量清新风 (Google Maps Modern Pastel) ====================
	google: {
		// 基底与陆地
		background: 'rgba(165, 201, 235, 1)',          // #a5c9eb Google经典透亮天蓝水面
		landBase: 'rgba(248, 249, 250, 1)',            // #f8f9fa 极简纯净微冷浅灰白
		urbanBlock: 'rgba(241, 243, 244, 0.95)',       // #f1f3f4 标志性街区单元微灰
		commercialBlock: 'rgba(237, 238, 240, 0.95)',  // #edeef0
		sand: 'rgba(254, 247, 230, 0.95)',             // #fef7e6 柔和金沙滩
		park: 'rgba(203, 230, 196, 1)',                // #cbe6c4 Google标配护眼薄荷鼠尾草绿
		
		// 水系水体
		waterFill: 'rgba(165, 201, 235, 1)',           // 与海面完全一致
		waterLine: 'rgba(138, 180, 225, 0.85)',        // #8ab4e1 水体微蓝轮廓
		waterText: 'rgba(25, 103, 210, 0.95)',         // #1967d2 Google经典水系注记蓝
		waterHalo: 'rgba(165, 201, 235, 0.95)',        // 水面同色光晕
		
		// 建筑白模 (2D轮廓与3D拉伸)
		building2dFill: 'rgba(235, 237, 240, 0.95)',   // #ebedf0
		building2dStroke: 'rgba(218, 220, 224, 0.9)',  // #dadce0
		buildingExtrusion: 'rgba(225, 227, 230, 0.95)',
		
		// 道路体系
		highwaySurface: 'rgba(254, 215, 102, 1)',      // #fed766 Google琥珀暖金
		highwayCasing: 'rgba(229, 168, 0, 0.95)',      // #e5a800 赭石描边
		trunkSurface: 'rgba(255, 255, 255, 1)',        // 主干道洁白
		trunkCasing: 'rgba(218, 220, 224, 0.95)',      // #dadce0 优雅冷灰描边
		secondarySurface: 'rgba(255, 255, 255, 1)',
		secondaryCasing: 'rgba(228, 231, 234, 0.9)',
		minorSurface: 'rgba(255, 255, 255, 1)',
		minorCasing: 'rgba(236, 239, 241, 0.85)',
		pedestrianSurface: 'rgba(248, 249, 250, 0.9)',
		pedestrianCasing: 'rgba(218, 220, 224, 0.8)',
		rampSurface: 'rgba(255, 229, 153, 1)',
		rampCasing: 'rgba(229, 176, 38, 0.9)',
		
		// 轨道交通
		railway: 'rgba(154, 160, 166, 0.9)',           // #9aa0a6 铁道灰
		railwayDash: 'rgba(255, 255, 255, 1)',
		subway: 'rgba(74, 123, 176, 0.85)',
		
		// 行政边界与海疆
		nationalBorder: 'rgba(128, 134, 139, 0.95)',   // #80868b 国界深灰
		marineBorder: 'rgba(110, 118, 129, 0.95)',     // 九段线/领海基线
		provincialBorder: 'rgba(154, 160, 166, 0.85)',
		countyBorder: 'rgba(189, 193, 198, 0.8)',
		
		// 注记文字与光晕
		textCapital: 'rgba(32, 33, 36, 0.98)',         // #202124 首都/直辖市深炭灰
		textCity: 'rgba(60, 64, 67, 0.95)',            // #3c4043 城市地名
		textTown: 'rgba(95, 99, 104, 0.92)',           // #5f6368 城镇地名
		textRoad: 'rgba(60, 64, 67, 0.95)',            // 道路名称
		textPoi: 'rgba(68, 71, 70, 0.92)',             // POI文字
		textGreen: 'rgba(46, 125, 50, 0.95)',          // #2e7d32 绿地山名
		haloDefault: 'rgba(255, 255, 255, 0.95)',      // 洁白光晕
		haloGreen: 'rgba(203, 230, 196, 0.95)'
	},

	// ==================== 主题 2: 高德素雅商务风 (AMap Clean Navigation) ====================
	amap: {
		// 基底与陆地
		background: 'rgba(155, 198, 243, 1)',          // #9bc6f3 高德标志性天青蔚蓝水体
		landBase: 'rgba(245, 243, 236, 1)',            // #f5f3ec 高德暖宣纸米白基底
		urbanBlock: 'rgba(238, 235, 226, 0.95)',       // #eeebe2 暖沙街区面
		commercialBlock: 'rgba(234, 230, 220, 0.95)',
		sand: 'rgba(250, 240, 218, 0.95)',             // #faf0da 暖金沙地
		park: 'rgba(209, 235, 211, 1)',                // #d1ebd3 高德马卡龙浅青竹绿
		
		// 水系水体
		waterFill: 'rgba(155, 198, 243, 1)',           // 与海面完全一致
		waterLine: 'rgba(125, 175, 230, 0.85)',        // #7dafe6
		waterText: 'rgba(21, 101, 192, 0.95)',         // #1565c0 沉稳深水系字色
		waterHalo: 'rgba(155, 198, 243, 0.95)',
		
		// 建筑白模
		building2dFill: 'rgba(232, 228, 220, 0.9)',    // #e8e4dc
		building2dStroke: 'rgba(215, 208, 196, 0.85)', // #d7d0c4
		buildingExtrusion: 'rgba(223, 218, 208, 0.95)',
		
		// 道路体系
		highwaySurface: 'rgba(255, 159, 67, 1)',       // #ff9f43 高德标志性出行活力橙
		highwayCasing: 'rgba(230, 119, 0, 0.95)',      // #e67700 兵马俑橙色描边
		trunkSurface: 'rgba(255, 226, 138, 1)',        // #ffe28a 麦芽暖黄
		trunkCasing: 'rgba(217, 184, 85, 0.95)',       // #d9b855
		secondarySurface: 'rgba(255, 255, 255, 1)',
		secondaryCasing: 'rgba(220, 214, 204, 0.9)',   // 暖灰描边
		minorSurface: 'rgba(255, 255, 255, 1)',
		minorCasing: 'rgba(227, 222, 195, 0.85)',
		pedestrianSurface: 'rgba(245, 243, 236, 0.9)',
		pedestrianCasing: 'rgba(215, 208, 196, 0.8)',
		rampSurface: 'rgba(255, 190, 118, 1)',         // #ffbe76
		rampCasing: 'rgba(230, 119, 0, 0.9)',
		
		// 轨道交通
		railway: 'rgba(168, 160, 150, 0.85)',          // #a8a096
		railwayDash: 'rgba(255, 255, 255, 1)',
		subway: 'rgba(43, 120, 197, 0.85)',            // #2b78c5 翡翠蓝轨交
		
		// 行政边界与海疆
		nationalBorder: 'rgba(136, 128, 117, 0.95)',   // #888075
		marineBorder: 'rgba(117, 108, 96, 0.95)',
		provincialBorder: 'rgba(168, 160, 150, 0.85)',
		countyBorder: 'rgba(200, 192, 180, 0.8)',
		
		// 注记文字与光晕
		textCapital: 'rgba(28, 37, 44, 0.98)',         // #1c252c 板岩深黑
		textCity: 'rgba(44, 52, 55, 0.95)',            // #2c3437
		textTown: 'rgba(80, 91, 98, 0.92)',            // #505b62
		textRoad: 'rgba(38, 50, 56, 0.95)',            // #263238
		textPoi: 'rgba(55, 71, 79, 0.92)',             // #37474f
		textGreen: 'rgba(45, 106, 79, 0.95)',          // #2d6a4f
		haloDefault: 'rgba(245, 243, 236, 0.98)',      // 宣纸暖白光晕
		haloGreen: 'rgba(209, 235, 211, 0.95)'
	},

	// ==================== 主题 3: 暗夜黑金极客风 (Mapbox Dark v11 / Alidade Dark Gold) ====================
	dark: {
		// 基底与陆地 (高对比玄武岩基底与暗渊海洋)
		background: 'rgba(8, 12, 18, 1)',              // #080c12 深邃静谧暗渊蓝黑海洋
		landBase: 'rgba(28, 38, 54, 1)',                // #1c2636 玄武岩深灰黑陆地 (与海洋清晰区分)
		urbanBlock: 'rgba(36, 48, 68, 0.95)',           // #243044 暗炭钢灰街区
		commercialBlock: 'rgba(40, 54, 76, 0.95)',
		sand: 'rgba(42, 40, 34, 0.95)',                 // #2a2822 暗金褐
		park: 'rgba(18, 42, 30, 0.92)',                 // #122a1e 极暗黑松墨绿 (鲜明辨识)
		
		// 水系水体
		waterFill: 'rgba(12, 18, 28, 1)',               // #0c121c 深夜暗蓝水体
		waterLine: 'rgba(56, 96, 144, 0.9)',            // #386090 清晰水岸微蓝轮廓
		waterText: 'rgba(96, 165, 250, 0.95)',          // #60a5fa 冰蓝水名
		waterHalo: 'rgba(8, 12, 18, 0.95)',
		
		// 建筑白模 (2D轮廓与3D拉伸)
		building2dFill: 'rgba(42, 56, 78, 0.9)',        // #2a384e
		building2dStroke: 'rgba(70, 92, 124, 0.85)',    // #465c7c
		buildingExtrusion: 'rgba(64, 88, 120, 0.95)',   // #405878 立体拉伸质感黑金高模
		
		// 道路体系 (流光黑金，层级分明清晰可见)
		highwaySurface: 'rgba(245, 158, 11, 1)',        // #f59e0b 璀璨夜光琥珀金
		highwayCasing: 'rgba(120, 53, 15, 0.95)',       // #78350f 深暗金描边
		trunkSurface: 'rgba(217, 119, 6, 0.95)',        // #d97706 琥珀暖暗金
		trunkCasing: 'rgba(69, 26, 3, 0.92)',           // #451a03
		secondarySurface: 'rgba(156, 163, 175, 0.92)',  // #9ca3af 钢青冷银次干道 (清晰可见)
		secondaryCasing: 'rgba(31, 41, 55, 0.9)',
		minorSurface: 'rgba(100, 116, 139, 0.85)',      // #64748b 清晰可见的普通路网 (绝不死黑)
		minorCasing: 'rgba(24, 32, 44, 0.85)',
		pedestrianSurface: 'rgba(51, 65, 85, 0.8)',
		pedestrianCasing: 'rgba(17, 24, 39, 0.8)',
		rampSurface: 'rgba(251, 191, 36, 0.95)',        // #fbbf24
		rampCasing: 'rgba(146, 64, 14, 0.9)',
		
		// 轨道交通
		railway: 'rgba(148, 163, 184, 0.85)',           // #94a3b8 钢轨
		railwayDash: 'rgba(245, 158, 11, 0.9)',         // 流光暗金铁轨枕木
		subway: 'rgba(16, 185, 129, 0.9)',              // #10b981 荧光翡翠绿地铁线
		
		// 行政边界与海疆
		nationalBorder: 'rgba(234, 179, 8, 1)',         // #eab308 尊贵奢华香槟金国界
		marineBorder: 'rgba(245, 158, 11, 1)',          // 璀璨暗金九段线
		provincialBorder: 'rgba(148, 163, 184, 0.9)',   // 银灰省界
		countyBorder: 'rgba(71, 85, 105, 0.85)',
		
		// 注记文字与光晕
		textCapital: 'rgba(255, 255, 255, 1)',          // 星光纯白
		textCity: 'rgba(241, 245, 249, 0.98)',          // #f1f5f9 亮灰白
		textTown: 'rgba(203, 213, 225, 0.95)',          // #cbd5e1 浅银灰城镇
		textRoad: 'rgba(254, 215, 170, 0.95)',          // #fed7aa 暖香槟路名
		textPoi: 'rgba(226, 232, 240, 0.95)',           // #e2e8f0
		textGreen: 'rgba(74, 222, 128, 0.98)',          // #4ade80 荧光嫩绿
		haloDefault: 'rgba(8, 12, 18, 0.95)',           // #080c12 极深暗夜光晕
		haloGreen: 'rgba(18, 42, 30, 0.95)'
	},

	// ==================== 主题 4: 科技深蓝孪生风 (Cyber Tech Blue Large Screen) ====================
	'tech-blue': {
		// 基底与陆地 (高对比度数字孪生地表，彻底告别死黑盲区)
		background: 'rgba(4, 10, 24, 1)',               // #040a18 极夜矩阵深渊暗蓝黑海洋
		landBase: 'rgba(18, 38, 72, 1)',                // #122648 数字孪生科技蓝陆地 (明暗反差鲜明，清晰可见地表轮廓)
		urbanBlock: 'rgba(24, 52, 96, 0.95)',           // #183460 赛博晶格街区
		commercialBlock: 'rgba(28, 62, 112, 0.95)',
		sand: 'rgba(20, 52, 90, 0.95)',                 // #14345a 电光靛蓝
		park: 'rgba(10, 58, 64, 0.92)',                 // #0a3a40 赛博青翠绿地 (清晰可辨)
		
		// 水系水体 (鲜明发光水体)
		waterFill: 'rgba(8, 22, 46, 1)',                // #08162e 深渊水体
		waterLine: 'rgba(0, 229, 255, 0.95)',           // #00e5ff 激光电光青岸线 (极高辨识度)
		waterText: 'rgba(0, 229, 255, 0.98)',           // #00e5ff 激光电光青文字
		waterHalo: 'rgba(4, 10, 24, 0.95)',
		
		// 建筑白模 (2D轮廓与3D拉伸)
		building2dFill: 'rgba(28, 64, 120, 0.85)',      // #1c4078 科技建筑体
		building2dStroke: 'rgba(0, 240, 255, 0.7)',     // #00f0ff 赛博全息线框边
		buildingExtrusion: 'rgba(37, 99, 235, 0.92)',   // #2563eb 赛博全息3D拉伸立体光柱 (高亮震撼)
		
		// 道路体系 (极光脉冲全系高亮，各级道路层级严密、全线清晰可见)
		highwaySurface: 'rgba(0, 242, 254, 1)',         // #00f2fe 赛博极光霓虹电光青
		highwayCasing: 'rgba(0, 115, 179, 0.95)',       // #0073b3 描边
		trunkSurface: 'rgba(56, 189, 248, 0.98)',       // #38bdf8 荧光蔚蓝
		trunkCasing: 'rgba(14, 82, 136, 0.95)',         // #0e5288
		secondarySurface: 'rgba(96, 165, 250, 0.95)',   // #60a5fa 亮科技蓝次级道路 (彻底清晰！)
		secondaryCasing: 'rgba(26, 68, 128, 0.9)',
		minorSurface: 'rgba(74, 126, 196, 0.85)',       // #4a7ec4 清晰可见的普通路网 (绝不死黑隐形！)
		minorCasing: 'rgba(16, 42, 80, 0.85)',
		pedestrianSurface: 'rgba(56, 102, 168, 0.8)',
		pedestrianCasing: 'rgba(0, 210, 255, 0.5)',
		rampSurface: 'rgba(0, 245, 212, 1)',            // #00f5d4 激光薄荷青
		rampCasing: 'rgba(0, 140, 120, 0.9)',
		
		// 轨道交通
		railway: 'rgba(0, 245, 212, 0.9)',              // #00f5d4 荧光青轨道
		railwayDash: 'rgba(255, 255, 255, 0.95)',
		subway: 'rgba(236, 72, 153, 0.95)',             // #ec4899 霓虹洋红发光地铁线
		
		// 行政边界与海疆
		nationalBorder: 'rgba(0, 240, 255, 1)',         // #00f0ff 激光青高亮国界
		marineBorder: 'rgba(0, 240, 255, 1)',           // 极光高亮九段线
		provincialBorder: 'rgba(56, 189, 248, 0.9)',    // #38bdf8 科技蓝省界
		countyBorder: 'rgba(59, 130, 246, 0.85)',
		
		// 注记文字与光晕
		textCapital: 'rgba(255, 255, 255, 1)',          // 极光纯白高亮
		textCity: 'rgba(224, 242, 254, 0.98)',          // #e0f2fe 亮冰白城市名
		textTown: 'rgba(186, 230, 253, 0.95)',          // #bae6fd 城镇注记 (清晰明朗)
		textRoad: 'rgba(240, 249, 255, 0.95)',          // #f0f9ff 道路名称
		textPoi: 'rgba(103, 232, 249, 0.95)',           // #67e8f9 电光青POI
		textGreen: 'rgba(52, 211, 153, 0.98)',          // #34d399 荧光青碧绿地文字
		haloDefault: 'rgba(4, 10, 24, 0.95)',           // #040a18 极深暗夜光晕
		haloGreen: 'rgba(6, 36, 42, 0.95)'
	}
};

/**
 * 核心层级定制引擎：对每个图层进行全量精细化重绘
 */
function applyThemeToLayer(layer, themeName) {
	const theme = THEMES_PALETTE[themeName];
	if (!theme) return;

	const sLayer = layer['source-layer'] || '';
	const type = layer.type;
	if (!layer.paint) layer.paint = {};
	const paint = layer.paint;
	const layout = layer.layout || {};

	// 1. 全局背景底色 (Ocean / Canvas)
	if (type === 'background') {
		paint['background-color'] = theme.background;
		return;
	}

	// 2. 面图层 (Fill)
	if (type === 'fill') {
		// (1) 陆地板块基底 (BV / Y9)
		if (sLayer === 'BV' || sLayer === 'Y9') {
			paint['fill-color'] = theme.landBase;
			return;
		}
		// (2) 城市建成区 / 街区单元 (AP)
		if (sLayer === 'AP') {
			paint['fill-color'] = theme.urbanBlock;
			return;
		}
		// (3) 商业/住宅功能街区 (AL)
		if (sLayer === 'AL') {
			paint['fill-color'] = theme.commercialBlock;
			return;
		}
		// (4) 绿地/公园/林地 (CK)
		if (sLayer === 'CK') {
			paint['fill-color'] = theme.park;
			return;
		}
		// (5) 水系水体/广域水面与大洋 (sea / BM / AR / Y3)
		if (['sea', 'BM', 'AR', 'Y3'].includes(sLayer)) {
			paint['fill-color'] = theme.waterFill;
			return;
		}
		// (6) 沙洲滩涂/低缩放填充 (Y5 / Y6)
		if (sLayer === 'Y5' || sLayer === 'Y6') {
			paint['fill-color'] = theme.sand;
			return;
		}
		// (7) 建筑轮廓底面 (CE)
		if (sLayer === 'CE') {
			paint['fill-color'] = theme.building2dFill;
			if (paint['fill-outline-color']) {
				paint['fill-outline-color'] = theme.building2dStroke;
			}
			return;
		}
		// (8) 地铁面 (tdt_ditie)
		if (sLayer === 'tdt_ditie') {
			paint['fill-color'] = theme.subway;
			paint['fill-opacity'] = 0.75;
			return;
		}
		// 其余通用面
		if (paint['fill-color']) {
			paint['fill-color'] = theme.landBase;
		}
		return;
	}

	// 3. 3D 建筑拉伸图层 (Fill-Extrusion)
	if (type === 'fill-extrusion') {
		if (sLayer === 'CE') {
			paint['fill-extrusion-color'] = theme.buildingExtrusion;
			paint['fill-extrusion-vertical-gradient'] = true; // 启用环境垂直光照渐变，强化3D立体纵深！
			paint['fill-extrusion-opacity'] = (themeName === 'dark' || themeName === 'tech-blue') ? 0.85 : 0.92;
		}
		return;
	}

	// 4. 线图层 (Line)
	if (type === 'line') {
		// (1) 水体岸线与江河线网 (BM / AR / AN / AW / BG / BO)
		if (['BM', 'AR', 'AN', 'AW', 'BO'].includes(sLayer)) {
			paint['line-color'] = theme.waterLine;
			return;
		}

		// (2) 边界体系：国家法定陆界与海疆领海线
		if (['AU', 'Y1', 'Y2', 'BG'].includes(sLayer)) {
			paint['line-color'] = theme.nationalBorder;
			if (themeName === 'dark' || themeName === 'tech-blue') {
				paint['line-width'] = 1.6;
			}
			return;
		}
		if (['Z1', 'Z2', 'Z6', 'Z9', 'huangyandao34'].includes(sLayer)) {
			// 南海九段线、十段线、黄岩岛领海基线
			paint['line-color'] = theme.marineBorder;
			if (themeName === 'dark' || themeName === 'tech-blue') {
				paint['line-width'] = 1.5;
			}
			return;
		}
		if (sLayer === 'AV') {
			// 省级境界
			paint['line-color'] = theme.provincialBorder;
			return;
		}
		if (['BE', 'AE'].includes(sLayer)) {
			// 地级市与区县界
			paint['line-color'] = theme.countyBorder;
			return;
		}

		// (3) 轨道交通与地铁 (BA / tdt_ditie)
		if (sLayer === 'BA') {
			if (paint['line-dasharray']) {
				paint['line-color'] = theme.railwayDash;
			} else {
				paint['line-color'] = theme.railway;
			}
			return;
		}
		if (sLayer === 'tdt_ditie') {
			paint['line-color'] = theme.subway;
			paint['line-width'] = 2.0;
			return;
		}

		// (4) 建筑线框 (CE / respt)
		if (sLayer === 'CE' || sLayer === 'respt') {
			paint['line-color'] = theme.building2dStroke;
			return;
		}

		// (5) 道路路网全系细化 (AA / AB / CC / AC / CF / AG / AK / AH / CH / Q5 / Z7 / t8ji / t9ji)
		if (['AA', 'AB', 'CC', 'AC', 'CF', 'AG', 'AK', 'AH', 'CH', 'Q5', 'Z7', 't8ji', 't9ji'].includes(sLayer)) {
			const mapRoadColor = (originalColor) => {
				const cat = classifyRoad(originalColor, layer);
				switch (cat) {
					case 'highway_surface':   return theme.highwaySurface;
					case 'highway_casing':    return theme.highwayCasing;
					case 'white_surface':     return theme.trunkSurface;
					case 'secondary_surface': return theme.secondarySurface;
					case 'standard_casing':   return theme.trunkCasing;
					case 'ramp':              return paint['line-width'] > 3 ? theme.rampCasing : theme.rampSurface;
					case 'secondary':         return paint['line-width'] > 3 ? theme.secondaryCasing : theme.secondarySurface;
					case 'minor':             return paint['line-width'] > 2 ? theme.minorCasing : theme.minorSurface;
					default:                  return theme.minorSurface;
				}
			};

			const val = paint['line-color'];
			if (typeof val === 'string') {
				paint['line-color'] = mapRoadColor(val);
			} else if (val && Array.isArray(val.stops)) {
				val.stops = val.stops.map(st => [st[0], mapRoadColor(st[1])]);
			}
			return;
		}

		// 默认线图层兜底
		if (paint['line-color']) {
			paint['line-color'] = theme.countyBorder;
		}
		return;
	}

	// 5. 注记符号图层 (Symbol)
	if (type === 'symbol') {
		// (1) 水系水名与海洋海湾注记 (BK / sea_poihy / BQ / AI)
		if (['BK', 'sea_poihy', 'BQ', 'AI'].includes(sLayer)) {
			paint['text-color'] = theme.waterText;
			paint['text-halo-color'] = theme.waterHalo;
			paint['text-halo-width'] = 1.6;
			return;
		}

		// (2) 绿地公园与名胜山峰 (CK / CA)
		if (['CK', 'CA'].includes(sLayer)) {
			paint['text-color'] = theme.textGreen;
			paint['text-halo-color'] = theme.haloGreen;
			paint['text-halo-width'] = 1.6;
			return;
		}

		// (3) 国家首都与世界大国 (BC / AF / country_3level_w_vec)
		if (['BC', 'AF', 'country_3level_w_vec'].includes(sLayer)) {
			paint['text-color'] = theme.textCapital;
			paint['text-halo-color'] = theme.haloDefault;
			paint['text-halo-width'] = 2.0;
			return;
		}

		// (4) 主要地级市与世界主要国家城市 (BL / CJ / country_5level_w_vec / AY / CB)
		if (['BL', 'CJ', 'country_5level_w_vec', 'AY', 'CB'].includes(sLayer)) {
			paint['text-color'] = theme.textCity;
			paint['text-halo-color'] = theme.haloDefault;
			paint['text-halo-width'] = 1.8;
			return;
		}

		// (5) 区县/重要城镇/地理单元 (BN / CD / AS / BH / BB / BS / AZ / BT / AT)
		if (['BN', 'CD', 'AS', 'BH', 'BB', 'BS', 'AZ', 'BT', 'AT'].includes(sLayer)) {
			paint['text-color'] = theme.textTown;
			paint['text-halo-color'] = theme.haloDefault;
			paint['text-halo-width'] = 1.5;
			return;
		}

		// (6) 乡镇村庄/微地名/藏南地标 (BW / AJ / BZ / BY / BF / zangnan)
		if (['BW', 'AJ', 'BZ', 'BY', 'BF', 'zangnan'].includes(sLayer)) {
			paint['text-color'] = theme.textTown;
			paint['text-halo-color'] = theme.haloDefault;
			paint['text-halo-width'] = 1.3;
			return;
		}

		// (7) 道路编号与道路名称 (AA / CC)
		if (['AA', 'CC'].includes(sLayer)) {
			// 如果带有盾牌路牌背景图标，文字保护为纯白高亮
			const icon = typeof layout['icon-image'] === 'string' ? layout['icon-image'] : '';
			if (icon && (icon.includes('gaosu') || icon.includes('guodao') || icon.includes('shengdao'))) {
				paint['text-color'] = 'rgba(255, 255, 255, 1)';
				paint['text-halo-color'] = 'rgba(0, 0, 0, 0.5)';
				paint['text-halo-width'] = 0.5;
			} else {
				paint['text-color'] = theme.textRoad;
				paint['text-halo-color'] = theme.haloDefault;
				paint['text-halo-width'] = 1.5;
			}
			return;
		}

		// (8) 商业生活POI、公共设施、国家地标与门牌号 (BI / AX / TA / respt / tdt_ditie_poi)
		if (['BI', 'AX', 'TA', 'respt', 'tdt_ditie_poi'].includes(sLayer)) {
			paint['text-color'] = theme.textPoi;
			paint['text-halo-color'] = theme.haloDefault;
			paint['text-halo-width'] = 1.4;
			return;
		}

		// 默认注记文字兜底 (确保无缺失 text-color 导致黑字黑背景隐身)
		paint['text-color'] = theme.textTown;
		paint['text-halo-color'] = theme.haloDefault;
		paint['text-halo-width'] = 1.4;
	}
}

export const DEFAULT_DEMO_TK = "b88bfb160c81dab8d9d20aaa74846360";

/**
 * 构造统一标准样式模版
 * @param {Object} options
 * @param {string} options.host 服务地址 (用于代理和静态资源)
 * @param {string} options.theme 主题名称: default | google | amap | dark | tech-blue
 * @param {'proxy' | 'direct'} options.mode 接入方案: proxy(方案二本地代理中转) | direct(方案一官方前端直连)
 * @param {string} options.tk 天地图官方服务令牌 Token
 */
export function buildUnifiedStyle(options = {}) {
	const host = options.host || process.env.BASE_URL || 'http://127.0.0.1:8890';
	const theme = options.theme || 'default'; // 'default' | 'google' | 'amap' | 'dark' | 'tech-blue'
	const mode = options.mode || 'proxy'; // 'proxy' | 'direct'
	const tk = options.tk || DEFAULT_DEMO_TK;

	// 支持分拆：part === 'vec' (纯底图 295 层) | part === 'cva' (纯注记 234 层) | 默认全合并 (529 层)
	let rawLayers;
	if (options.part === 'vec') {
		rawLayers = s0.layers;
	} else if (options.part === 'cva') {
		rawLayers = s1.layers;
	} else {
		rawLayers = [...s0.layers, ...s1.layers];
	}
	const clonedLayers = JSON.parse(JSON.stringify(rawLayers));

	// 核心清洗与桌面端/多端兼容性适配：彻底消除 QGIS / ArcGIS 的崩溃与字体警告
	for (const l of clonedLayers) {
		// 1. 彻底移除空 line-dasharray: [] 等导致 QGIS / ArcGIS C++ 数组越界崩溃的非法属性
		if (l.paint && Array.isArray(l.paint['line-dasharray']) && l.paint['line-dasharray'].length < 2) {
			delete l.paint['line-dasharray'];
		}

		// 2. 保证 3D 建筑物面 (fill-extrusion) 的垂直环境光渐变与立体纵深，彻底激活 16-18 级 2.5D 楼宇立体渲染
		if (l.type === 'fill-extrusion') {
			if (l.paint) {
				l.paint['fill-extrusion-vertical-gradient'] = true;
				if (l.paint['fill-extrusion-opacity'] < 0.8) {
					l.paint['fill-extrusion-opacity'] = 0.85;
				}
			}
		}

		// 3. 字体栈清洗与规范化：彻底消除 404 字体请求导致的 WorkerTile 崩溃与瓦片空白
		// 天地图官方字形服务只支持单字体名，且 "Open Sans Regular" 与 "Unicode MS Regular" 会直接报 404
		if (l.layout && l.layout['text-font']) {
			const tf = l.layout['text-font'];
			const tfStr = JSON.stringify(tf);
			if (tfStr.includes('Open Sans Regular') || tfStr.includes('Unicode MS Regular')) {
				l.layout['text-font'] = ['WenQuanYi Micro Hei Mono'];
			}
		}

		// 4. 背景层底色保证从 0 级生效 (消除 Zoom 0 画布透明/黑屏问题)
		if (l.type === 'background') {
			l.minzoom = 0;
		}
	}

	// 方案二 (本地代理转码为标准 MVT) vs 方案一 (前端直连官方并由前端自愈转码)
	const tilesUrl = mode === 'direct'
		? [`tdt-direct://{z}/{x}/{y}?tk=${tk}`]
		: [`${host}/mvt/{z}/{x}/{y}`];

	// 统一样式头部
	// 注入 sea 海洋矢量图层（确保 Zoom 0 及各级大洋矢量切片在所有 GIS 客户端中完美渲染水体底色）
	if (options.part !== 'cva') {
		const hasSeaLayer = clonedLayers.some(l => l['source-layer'] === 'sea');
		if (!hasSeaLayer) {
			const bgLayerIdx = clonedLayers.findIndex(l => l.type === 'background');
			const initialWaterColor = (theme !== 'default' && THEMES_PALETTE[theme])
				? THEMES_PALETTE[theme].waterFill
				: (clonedLayers[0]?.paint?.['background-color'] || 'rgba(170, 198, 238, 1)');
			const seaFillLayer = {
				id: 'base-dynamic-tdt-sea',
				type: 'fill',
				source: 'base-tdt-vector-tile',
				'source-layer': 'sea',
				minzoom: 0,
				maxzoom: 22,
				layout: { visibility: 'visible' },
				paint: {
					'fill-color': initialWaterColor
				}
			};
			if (bgLayerIdx >= 0) {
				clonedLayers.splice(bgLayerIdx + 1, 0, seaFillLayer);
			} else {
				clonedLayers.unshift(seaFillLayer);
			}
		}
	}

	const style = {
		version: 8,
		name: `Tianditu Standard Decoupled (${theme} - ${mode === 'direct' ? '方案一直连' : '方案二代理'})`,
		metadata: {
			"tdt:decoupled": true,
			"tdt:theme": theme,
			"tdt:mode": mode,
			"tdt:part": options.part || 'all',
			"tdt:layers_count": clonedLayers.length
		},
		sources: {
			"base-tdt-vector-tile": {
				type: "vector",
				tiles: tilesUrl,
				minzoom: 0,
				maxzoom: 18
			}
		},
		sprite: `${host}/static/sprite/png`,
		glyphs: `https://vector.tianditu.gov.cn/static/font/{fontstack}/{range}.pbf`,
		layers: clonedLayers
	};

	if (theme === 'default') {
		return style;
	}

	if (theme === 'custom') {
		const customConfigPath = path.join(BASE_DIR, 'static/custom-theme-config.json');
		let customConfig = {};
		if (fs.existsSync(customConfigPath)) {
			try {
				customConfig = JSON.parse(fs.readFileSync(customConfigPath, 'utf8'));
			} catch (e) {
				console.error('[StyleGenerator] Failed to read custom-theme-config.json:', e);
			}
		}
		const baseTheme = customConfig.baseTheme || 'default';
		if (baseTheme !== 'default') {
			for (const layer of style.layers) {
				applyThemeToLayer(layer, baseTheme);
			}
		}
		// 1. 应用源层级别覆盖 (sourceLayerOverrides)
		if (customConfig.sourceLayerOverrides) {
			for (const layer of style.layers) {
				const sLayer = layer['source-layer'] || (layer.type === 'background' ? 'background' : null);
				if (sLayer && customConfig.sourceLayerOverrides[sLayer]) {
					const overrides = customConfig.sourceLayerOverrides[sLayer];
					if (!layer.paint) layer.paint = {};
					for (const [k, v] of Object.entries(overrides)) {
						if (v !== undefined && v !== null && v !== '') {
							layer.paint[k] = v;
						}
					}
				}
			}
		}
		// 2. 应用样式层级别细粒度覆盖 (layerOverrides - 529个具体渲染层)
		if (customConfig.layerOverrides) {
			for (const layer of style.layers) {
				if (customConfig.layerOverrides[layer.id]) {
					const overrides = customConfig.layerOverrides[layer.id];
					if (!layer.paint) layer.paint = {};
					for (const [k, v] of Object.entries(overrides)) {
						if (v !== undefined && v !== null && v !== '') {
							layer.paint[k] = v;
						}
					}
				}
			}
		}
		return style;
	}

	// 深度重绘全量 529 个图层的样式
	for (const layer of style.layers) {
		applyThemeToLayer(layer, theme);
	}

	return style;
}

/**
 * 预编译生成静态样式 JSON 文件
 * 生成：
 * 1. 方案二（本地代理模式）: static/style.json, static/style-{theme}.json
 * 2. 方案一（前端直连模式）: static/style-direct.json, static/style-direct-{theme}.json
 */
export function generateAllStyles(baseHost = process.env.BASE_URL || 'http://127.0.0.1:8890') {
	const themes = ['default', 'google', 'amap', 'dark', 'tech-blue'];
	const customConfigPath = path.join(BASE_DIR, 'static/custom-theme-config.json');
	if (fs.existsSync(customConfigPath)) {
		themes.push('custom');
	}
	
	// 1. 生成方案二：代理模式样式 (全量主题 + 单独 vec 底图 + 单独 cva 注记)
	for (const t of themes) {
		const s = buildUnifiedStyle({ theme: t, mode: 'proxy', host: baseHost });
		const outName = t === 'default' ? 'style.json' : `style-${t}.json`;
		const outPath = path.join(BASE_DIR, 'static', outName);
		fs.writeFileSync(outPath, JSON.stringify(s, null, 2), 'utf8');
		console.log(`[Style-Proxy] 成功生成方案二代理样式: static/${outName} (${s.layers.length} 个图层)`);
	}
	// 额外生成独立的 vec 底图与 cva 注记样式 (满足桌面端分层加载习惯)
	const sVec = buildUnifiedStyle({ theme: 'default', mode: 'proxy', part: 'vec', host: baseHost });
	fs.writeFileSync(path.join(BASE_DIR, 'static/style-vec.json'), JSON.stringify(sVec, null, 2), 'utf8');
	console.log(`[Style-Proxy] 成功生成独立矢量底图样式: static/style-vec.json (${sVec.layers.length} 个图层)`);

	const sCva = buildUnifiedStyle({ theme: 'default', mode: 'proxy', part: 'cva', host: baseHost });
	fs.writeFileSync(path.join(BASE_DIR, 'static/style-cva.json'), JSON.stringify(sCva, null, 2), 'utf8');
	console.log(`[Style-Proxy] 成功生成独立矢量注记样式: static/style-cva.json (${sCva.layers.length} 个图层)`);

	// 2. 生成方案一：前端直连模式样式
	for (const t of themes) {
		const s = buildUnifiedStyle({ theme: t, mode: 'direct', host: baseHost });
		const outName = t === 'default' ? 'style-direct.json' : `style-direct-${t}.json`;
		const outPath = path.join(BASE_DIR, 'static', outName);
		fs.writeFileSync(outPath, JSON.stringify(s, null, 2), 'utf8');
		console.log(`[Style-Direct] 成功生成方案一直连样式: static/${outName} (${s.layers.length} 个图层)`);
	}
}

if (process.argv[1] && process.argv[1].endsWith('style_generator.mjs')) {
	generateAllStyles();
}
