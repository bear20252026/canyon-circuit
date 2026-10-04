var CONFIG = structuredClone({
	car: {
		/** Top speed on asphalt (m/s). */
		maxSpeed: 58,
		accel: 30,
		brake: 50,
		reverseSpeed: 14,
		coastDrag: 5,
		/** Yaw rate (rad/s) at low and at top speed. */
		turnLow: 2.3,
		turnHigh: .9,
		/** Lateral grip (1/s). Higher = less slide. */
		grip: 9,
		driftGrip: 2.6,
		driftBase: 1.15,
		driftSteer: .7,
		driftMinSpeed: 17,
		boostSpeed: 74,
		boostAccel: 38,
		/** Nitro burst length (s) fired by one tap of Shift. */
		nitroTime: 1.4,
		/** Seconds for an empty nitro to recharge (skill — drift boosts, tricks, perfect pads — shortens it). */
		nitroCooldown: 8,
		/** Extra acceleration (m/s²) while the nitro burns: a short, sharp kick. */
		nitroAccel: 26,
		/** Lateral speed (m/s) when steering across a corkscrew ribbon. */
		corkSteer: 7,
		draftBonus: 6,
		gravity: 30,
		airTurn: 1.3,
		/** Speed cap multiplier on the sand shoulder. */
		shoulderFactor: .7,
		/** Upward kick from a ramp lip, as a fraction of forward speed. */
		rampKick: .27,
		/** Vertical launch per m/s of speed off a mega ramp. */
		megaKick: .52,
		/** Extra top speed (m/s) per unit of downhill grade — roller-coaster descents. */
		downhillBonus: 26,
		/** Tyre grip on banked roads as a fraction of the normal force (speed presses the car in). */
		bankGrip: .9,
		/**
		* Magnetic banked roads: every banked or twisted road holds the car at any speed, so it never
		* slides down or peels off the slope and drives as if the road were flat (the tilt is visual).
		* Corkscrew ribbons keep their own rail physics. Set false to restore speed-based anchoring.
		*/
		bankMagnet: true,
		/** Extra yaw rate (rad/s) at top speed on a fully tilted bank (the road carries the turn). */
		bankTurn: .8
	},
	race: {
		/** AI cornering pace multiplier (same car, different driving line). */
		aiPace: 1,
		/** Seconds before a broken item crystal reappears. */
		itemRespawn: 3
	},
	camera: {
		fov: 68,
		distance: 7.4,
		height: 2.7,
		follow: 9
	}
});
//#endregion
//#region src/sim/math.ts
/**
* Deterministic math helpers shared by the simulation and presentation layers.
* Nothing here reads clocks, the DOM or Math.random: identical inputs give identical outputs.
*/
var TAU = Math.PI * 2;
var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
var lerp = (a, b, t) => a + (b - a) * t;
var smoothstep = (a, b, x) => {
	const t = clamp((x - a) / (b - a), 0, 1);
	return t * t * (3 - 2 * t);
};
/** Wrap an angle into (-PI, PI]. */
function wrapAngle(a) {
	a = (a + Math.PI) % TAU;
	if (a < 0) a += TAU;
	return a - Math.PI;
}
/** Wrap a track distance difference into (-L/2, L/2]. */
function wrapDelta(ds, length) {
	ds = (ds + length / 2) % length;
	if (ds < 0) ds += length;
	return ds - length / 2;
}
/** Positive modulo. */
function mod(v, m) {
	const r = v % m;
	return r < 0 ? r + m : r;
}
/** Approach `target` by at most `step`. */
function approach(v, target, step) {
	return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}
function rng(seed) {
	let s = seed >>> 0;
	return () => {
		s = s + 1831565813 >>> 0;
		let t = s;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
/** 32-bit FNV-1a over a string, for seeds derived from names/codes. */
function hashString(text) {
	let h = 2166136261;
	for (let i = 0; i < text.length; i += 1) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
//#endregion
//#region src/sim/track.ts
var newCorkFrame = () => ({
	x: 0,
	y: 0,
	z: 0,
	fx: 0,
	fy: 0,
	fz: 1,
	nx: 0,
	ny: 1,
	nz: 0,
	lx: 1,
	ly: 0,
	lz: 0,
	stretch: 1,
	kn: 0,
	roll: 0
});
var cfBase = {
	x: 0,
	y: 0,
	z: 0,
	tx: 0,
	tz: 1,
	rx: -1,
	rz: 0,
	halfW: 10,
	bank: 0
};
var cfA = {
	x: 0,
	y: 0,
	z: 0
};
var cfB = {
	x: 0,
	y: 0,
	z: 0
};
/** Mega ramp dimensions (m). */
var MEGA_RAMP = {
	len: 42,
	height: 19
};
var BANK_G = 30;
var BANK_MU = .9;
function newLoc() {
	return {
		i: 0,
		s: 0,
		d: 0,
		centerY: 0,
		roadY: 0,
		halfW: 10,
		barrier: 13,
		wall: false,
		onRoad: true,
		onSurface: true,
		tx: 0,
		tz: 1,
		rx: -1,
		rz: 0,
		slope: 0,
		rampH: 0,
		rampIndex: -1,
		bank: 0
	};
}
var DENSE_STEPS = 48;
var Track = class {
	spec;
	n;
	length;
	ds;
	x;
	y;
	z;
	tx;
	tz;
	rx;
	rz;
	slope;
	/** Vertical curvature d(slope)/ds (negative on crests). */
	vcurv;
	halfW;
	bank;
	curv;
	canyon;
	ridge;
	bridge;
	heading;
	gates;
	pads;
	ramps;
	items;
	corks;
	bounds;
	constructor(spec) {
		this.spec = spec;
		const pts = spec.points;
		const m = pts.length;
		if (m < 4) throw new Error("track needs at least 4 control points");
		const count = m * DENSE_STEPS + 1;
		const dx = new Float64Array(count);
		const dy = new Float64Array(count);
		const dz = new Float64Array(count);
		const cum = new Float64Array(count);
		let idx = 0;
		for (let k = 0; k < m; k += 1) {
			const p0 = pts[mod(k - 1, m)];
			const p1 = pts[k];
			const p2 = pts[mod(k + 1, m)];
			const p3 = pts[mod(k + 2, m)];
			for (let j = 0; j < DENSE_STEPS; j += 1) {
				catmull(p0, p1, p2, p3, j / DENSE_STEPS, dx, dy, dz, idx);
				idx += 1;
			}
		}
		dx[idx] = dx[0];
		dy[idx] = dy[0];
		dz[idx] = dz[0];
		for (let i = 1; i < count; i += 1) cum[i] = cum[i - 1] + Math.hypot(dx[i] - dx[i - 1], dy[i] - dy[i - 1], dz[i] - dz[i - 1]);
		const total = cum[count - 1];
		const sOfU = (u) => {
			const f = mod(u, m) * DENSE_STEPS;
			const a = Math.floor(f);
			return lerp(cum[a], cum[Math.min(count - 1, a + 1)], f - a);
		};
		const uOfS = (s) => {
			s = mod(s, total);
			let lo = 0;
			let hi = count - 1;
			while (hi - lo > 1) {
				const mid = lo + hi >> 1;
				if (cum[mid] <= s) lo = mid;
				else hi = mid;
			}
			const t = (s - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]);
			return (lo + t) / DENSE_STEPS;
		};
		const denseAt = (s, out) => {
			const u = uOfS(s) * DENSE_STEPS;
			const a = Math.min(count - 2, Math.floor(u));
			const t = u - a;
			out[0] = lerp(dx[a], dx[a + 1], t);
			out[1] = lerp(dy[a], dy[a + 1], t);
			out[2] = lerp(dz[a], dz[a + 1], t);
		};
		const n = Math.max(64, Math.round(total / 2));
		const ds = total / n;
		this.n = n;
		this.length = total;
		this.ds = ds;
		let sStart = spec.start !== void 0 ? sOfU(spec.start) : 0;
		if (spec.start === void 0) sStart = findStraightest(total, ds, n, denseAt);
		const arr = () => new Float64Array(n);
		this.x = arr();
		this.y = arr();
		this.z = arr();
		this.tx = arr();
		this.tz = arr();
		this.rx = arr();
		this.rz = arr();
		this.slope = arr();
		this.vcurv = arr();
		this.halfW = arr();
		this.bank = arr();
		this.curv = arr();
		this.canyon = arr();
		this.ridge = arr();
		this.bridge = arr();
		this.heading = arr();
		const u = arr();
		const tmp = [
			0,
			0,
			0
		];
		for (let i = 0; i < n; i += 1) {
			const s = sStart + i * ds;
			denseAt(s, tmp);
			this.x[i] = tmp[0];
			this.y[i] = tmp[1];
			this.z[i] = tmp[2];
			u[i] = uOfS(s);
		}
		const sAt = (uu) => mod(sOfU(uu) - sStart, total);
		for (const f of spec.features) {
			if (f.type !== "hill") continue;
			const c = f.at !== void 0 ? mod(f.at, total) : sAt(f.u ?? 0);
			const half = Math.max(20, (f.len ?? 160) / 2);
			const amp = f.amp ?? 12;
			for (let i = 0; i < n; i += 1) {
				const rel = wrapDelta(i * ds - c, total);
				if (Math.abs(rel) < half) this.y[i] += amp * (.5 + .5 * Math.cos(Math.PI * rel / half));
			}
		}
		const twists = spec.features.filter((f) => f.type === "twist");
		if (twists.length) {
			const nx = arr(), nz = arr();
			for (let i = 0; i < n; i += 1) {
				const a = mod(i - 1, n), b = (i + 1) % n;
				const tx = this.x[b] - this.x[a], tz = this.z[b] - this.z[a];
				const l = Math.hypot(tx, tz) || 1;
				nx[i] = -tz / l;
				nz[i] = tx / l;
			}
			const off = arr();
			for (const f of twists) {
				const c = f.at !== void 0 ? mod(f.at, total) : sAt(f.u ?? 0);
				const len = Math.max(80, f.len ?? 200);
				const half = len / 2;
				const amp = f.amp ?? 10;
				const cycles = Math.max(.5, f.cycles ?? 1);
				for (let i = 0; i < n; i += 1) {
					const rel = wrapDelta(i * ds - c, total);
					if (Math.abs(rel) >= half) continue;
					const env = Math.pow(.5 + .5 * Math.cos(Math.PI * rel / half), .6);
					off[i] += amp * env * Math.sin(2 * Math.PI * cycles * (rel + half) / len);
				}
			}
			for (let i = 0; i < n; i += 1) {
				this.x[i] += nx[i] * off[i];
				this.z[i] += nz[i] * off[i];
			}
		}
		const rawC = arr();
		const rawR = arr();
		const rawB = arr();
		for (let i = 0; i < n; i += 1) {
			const k = Math.floor(u[i]) % m;
			const t = u[i] - Math.floor(u[i]);
			const a = pts[k];
			const b = pts[(k + 1) % m];
			this.halfW[i] = lerp(a.w, b.w, smoothstep(0, 1, t)) / 2;
			const wa = t < 1 ? 1 - t : 0;
			rawC[i] = (a.kind === "canyon" ? wa : 0) + (b.kind === "canyon" ? t : 0);
			rawR[i] = (a.kind === "ridge" ? wa : 0) + (b.kind === "ridge" ? t : 0);
			rawB[i] = a.kind === "bridge" && b.kind === "bridge" ? 1 : a.kind === "bridge" ? smoothstep(.35, 0, t) : b.kind === "bridge" ? smoothstep(.65, 1, t) : 0;
		}
		smoothCircular(rawC, this.canyon, 18);
		smoothCircular(rawR, this.ridge, 18);
		smoothCircular(rawB, this.bridge, 4);
		for (let i = 0; i < n; i += 1) {
			const a = mod(i - 1, n);
			const b = (i + 1) % n;
			let tx = this.x[b] - this.x[a];
			let tz = this.z[b] - this.z[a];
			const len = Math.hypot(tx, tz) || 1;
			tx /= len;
			tz /= len;
			this.tx[i] = tx;
			this.tz[i] = tz;
			this.rx[i] = -tz;
			this.rz[i] = tx;
			this.slope[i] = (this.y[b] - this.y[a]) / (2 * ds);
			this.heading[i] = Math.atan2(tx, tz);
		}
		const rawV = arr();
		for (let i = 0; i < n; i += 1) rawV[i] = (this.slope[(i + 1) % n] - this.slope[mod(i - 1, n)]) / (2 * ds);
		smoothCircular(rawV, this.vcurv, 2);
		const rawK = arr();
		for (let i = 0; i < n; i += 1) rawK[i] = wrapAngle(this.heading[(i + 1) % n] - this.heading[mod(i - 1, n)]) / (2 * ds);
		smoothCircular(rawK, this.curv, 5);
		this.corks = [];
		const corkFlat = arr();
		for (const f of spec.features) {
			if (f.type !== "corkscrew") continue;
			const s0 = f.at !== void 0 ? mod(f.at, total) : sAt(f.u ?? 0);
			const len = Math.max(80, f.len ?? 120);
			this.corks.push({
				index: this.corks.length,
				s0,
				len,
				radius: clamp(f.radius ?? 8, 5, 14),
				dir: (f.dir ?? 1) < 0 ? -1 : 1,
				hw: clamp(f.width ?? 6, 4, 9)
			});
			for (let i = 0; i < n; i += 1) {
				const rel = wrapDelta(i * ds - s0, total);
				const w = smoothstep(-40, -18, rel) * smoothstep(len + 24, len + 6, rel);
				if (w > corkFlat[i]) corkFlat[i] = w;
			}
		}
		const bankW = arr(), bankT = arr();
		for (const f of spec.features) {
			if (f.type !== "bank") continue;
			const c = f.at !== void 0 ? mod(f.at, total) : sAt(f.u ?? 0);
			const half = Math.max(30, f.len ?? 120) / 2;
			let kSum = 0;
			for (let i = 0; i < n; i += 1) if (Math.abs(wrapDelta(i * ds - c, total)) < half * .6) kSum += this.curv[i];
			const sign = kSum < 0 ? -1 : 1;
			const tanMax = Math.tan(clamp(f.deg ?? 45, 0, 66) * Math.PI / 180);
			const ramp = Math.min(half * .45, 32);
			const win = Math.max(1, Math.round(15 / ds));
			for (let i = 0; i < n; i += 1) {
				const rel = Math.abs(wrapDelta(i * ds - c, total));
				if (rel >= half) continue;
				let kLoc = 0;
				for (let o = -win; o <= win; o += 1) {
					const kk = this.curv[mod(i + o, n)] * sign;
					if (kk > kLoc) kLoc = kk;
				}
				const q = 900 * kLoc / BANK_G;
				const tanCap = kLoc <= 0 ? .18 : BANK_MU * q >= 1 ? tanMax : (q + BANK_MU) / (1 - BANK_MU * q);
				const w = smoothstep(half, half - ramp, rel);
				if (w > bankW[i]) {
					bankW[i] = w;
					bankT[i] = sign * Math.min(tanMax, tanCap);
				}
			}
		}
		const rawBank = arr();
		for (let i = 0; i < n; i += 1) rawBank[i] = lerp(clamp(this.curv[i] * 7, -.18, .18), bankT[i], bankW[i]);
		const sw = Math.max(1, Math.round(8 / ds));
		for (let i = 0; i < n; i += 1) {
			let sum = 0;
			for (let o = -sw; o <= sw; o += 1) sum += rawBank[mod(i + o, n)];
			this.bank[i] = sum / (2 * sw + 1) * (1 - this.bridge[i]) * (1 - corkFlat[i]);
			this.halfW[i] *= lerp(1, 1 / Math.sqrt(1 + this.bank[i] * this.bank[i]), .6);
		}
		this.gates = [];
		for (let k = 0; k < 16; k += 1) {
			let s = mod((k + 1) * total / 16, total);
			if (k < 15) for (const c of this.corks) {
				const rel = wrapDelta(s - c.s0, total);
				if (rel > -5 && rel < c.len + 5) s = mod(rel < c.len / 2 ? c.s0 - 7 : c.s0 + c.len + 7, total);
			}
			this.gates.push({
				index: k,
				s,
				sample: Math.round(s / ds) % n
			});
		}
		this.pads = [];
		this.ramps = [];
		this.items = [];
		for (const f of spec.features) {
			if (f.type === "hill" || f.type === "bank" || f.type === "twist" || f.type === "corkscrew") continue;
			let s = f.at !== void 0 ? mod(f.at, total) : sAt(f.u ?? 0);
			if (s < 70 || s > total - 40) s = mod(s + 110, total);
			const hw = this.halfW[Math.round(s / ds) % n];
			if (f.type === "boost") this.pads.push({
				index: this.pads.length,
				s,
				d: clamp(f.lane ?? 0, -hw + 2.2, hw - 2.2),
				len: 10,
				halfW: 2.1,
				cork: -1
			});
			else if (f.type === "ramp") this.ramps.push({
				index: this.ramps.length,
				s0: mod(s - 14, total),
				len: 14,
				height: 2.4,
				mega: false
			});
			else if (f.type === "mega") this.ramps.push({
				index: this.ramps.length,
				s0: mod(s - MEGA_RAMP.len, total),
				len: MEGA_RAMP.len,
				height: MEGA_RAMP.height,
				mega: true
			});
			else if (f.type === "items") this.items.push({
				index: this.items.length,
				s,
				lanes: [
					-.62,
					-.2,
					.2,
					.62
				].map((t) => t * hw)
			});
		}
		for (const ck of this.corks) {
			const hw = this.halfW[this.sampleIndex(ck.s0 - 20)];
			for (const back of [22, 8]) for (const t of [
				-.55,
				0,
				.55
			]) this.pads.push({
				index: this.pads.length,
				s: mod(ck.s0 - back, total),
				d: t * (hw - 2.2),
				len: 10,
				halfW: 2.1,
				cork: -1
			});
			[
				.3,
				.5,
				.7
			].forEach((u, k) => this.pads.push({
				index: this.pads.length,
				s: mod(ck.s0 + ck.len * u, total),
				d: (k % 2 ? -1 : 1) * ck.dir * ck.hw * .42,
				len: 9,
				halfW: 2,
				cork: ck.index
			}));
		}
		let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
		for (let i = 0; i < n; i += 1) {
			minX = Math.min(minX, this.x[i]);
			maxX = Math.max(maxX, this.x[i]);
			minZ = Math.min(minZ, this.z[i]);
			maxZ = Math.max(maxZ, this.z[i]);
			minY = Math.min(minY, this.y[i]);
			maxY = Math.max(maxY, this.y[i]);
		}
		this.bounds = {
			minX,
			maxX,
			minZ,
			maxZ,
			minY,
			maxY
		};
	}
	/** Sample index nearest to track distance `s`. */
	sampleIndex(s) {
		return mod(Math.round(s / this.ds), this.n);
	}
	barrierAt(i) {
		return this.halfW[i] + 3 + .4;
	}
	isWall(i) {
		return this.canyon[i] > .5 && this.bridge[i] < .5;
	}
	/** Height of the ramp surface at track distance `s` (0 outside ramps). */
	rampAt(s) {
		for (const r of this.ramps) {
			const rel = wrapDelta(s - r.s0, this.length);
			if (rel >= 0 && rel <= r.len) return {
				h: r.height * rel / r.len,
				index: r.index
			};
		}
		return {
			h: 0,
			index: -1
		};
	}
	/** Corkscrew index whose roll zone contains track distance `s`, or -1. */
	corkAt(s) {
		for (const ck of this.corks) {
			const rel = wrapDelta(s - ck.s0, this.length);
			if (rel >= 0 && rel < ck.len) return ck.index;
		}
		return -1;
	}
	/** Distance from `s` to the start of the next corkscrew ahead (Infinity if none within `max`). */
	corkAhead(s, max) {
		let best = Infinity, index = -1;
		for (const ck of this.corks) {
			const rel = wrapDelta(ck.s0 - s, this.length);
			if (rel >= 0 && rel < max && rel < best) {
				best = rel;
				index = ck.index;
			}
		}
		return {
			dist: best,
			index
		};
	}
	/** Roll progress 0..1 through a corkscrew at `s` (clamped). */
	corkU(ck, s) {
		return clamp(wrapDelta(s - ck.s0, this.length) / ck.len, 0, 1);
	}
	/** Roll angle (rad, 0 → 2π) at `s`: eased in and out so the entry and exit are smooth. */
	corkPhi(ck, s) {
		const u = this.corkU(ck, s);
		return Math.PI * 2 * u * u * u * (u * (u * 6 - 15) + 10);
	}
	/** Ribbon half-width: tapers from the approach road to the narrow roll and back. */
	corkHalfW(ck, s) {
		const u = this.corkU(ck, s);
		const w = smoothstep(0, .16, u) * smoothstep(1, .84, u);
		return lerp(this.halfW[this.sampleIndex(s)], ck.hw, w);
	}
	/** World position of ribbon point (s, d) lifted `h` along the surface normal. */
	corkPoint(ck, s, d, h, out) {
		this.frameAt(s, cfBase);
		const phi = this.corkPhi(ck, s);
		const c = Math.cos(phi), sn = Math.sin(phi) * ck.dir;
		const R = ck.radius;
		const off = R * sn;
		const lift = R * (1 - c);
		out.x = cfBase.x + cfBase.rx * (off + d * c - h * sn);
		out.z = cfBase.z + cfBase.rz * (off + d * c - h * sn);
		out.y = cfBase.y + lift + d * sn + h * c;
	}
	/** Full rail frame with numeric tangent and normal curvature at (s, d). */
	corkFrame(ck, s, d, out) {
		const e = 2.5;
		this.corkPoint(ck, s - e, d, 0, cfA);
		this.corkPoint(ck, s + e, d, 0, cfB);
		this.corkPoint(ck, s, d, 0, out);
		let fx = cfB.x - cfA.x, fy = cfB.y - cfA.y, fz = cfB.z - cfA.z;
		const l = Math.hypot(fx, fy, fz) || 1;
		fx /= l;
		fy /= l;
		fz /= l;
		const phi = this.corkPhi(ck, s);
		const c = Math.cos(phi), sn = Math.sin(phi) * ck.dir;
		this.frameAt(s, cfBase);
		let lx = cfBase.rx * c, ly = sn, lz = cfBase.rz * c;
		const lf = lx * fx + ly * fy + lz * fz;
		lx -= fx * lf;
		ly -= fy * lf;
		lz -= fz * lf;
		const ll = Math.hypot(lx, ly, lz) || 1;
		lx /= ll;
		ly /= ll;
		lz /= ll;
		let nx = ly * fz - lz * fy, ny = lz * fx - lx * fz, nz = lx * fy - ly * fx;
		const refY = c, refX = -cfBase.rx * sn, refZ = -cfBase.rz * sn;
		if (nx * refX + ny * refY + nz * refZ < 0) {
			nx = -nx;
			ny = -ny;
			nz = -nz;
		}
		out.fx = fx;
		out.fy = fy;
		out.fz = fz;
		out.nx = nx;
		out.ny = ny;
		out.nz = nz;
		out.lx = lx;
		out.ly = ly;
		out.lz = lz;
		const stretch = l / (2 * e);
		out.stretch = stretch;
		const ax = (cfB.x - 2 * out.x + cfA.x) / (e * e), ay = (cfB.y - 2 * out.y + cfA.y) / (e * e), az = (cfB.z - 2 * out.z + cfA.z) / (e * e);
		out.kn = (ax * nx + ay * ny + az * nz) / (stretch * stretch);
		out.roll = phi * ck.dir;
		return out;
	}
	/** Interpolated centre-line frame at track distance `s`. */
	frameAt(s, out) {
		const f = mod(s, this.length) / this.ds;
		const a = Math.floor(f) % this.n;
		const b = (a + 1) % this.n;
		const t = f - Math.floor(f);
		out.x = lerp(this.x[a], this.x[b], t);
		out.y = lerp(this.y[a], this.y[b], t);
		out.z = lerp(this.z[a], this.z[b], t);
		let tx = lerp(this.tx[a], this.tx[b], t);
		let tz = lerp(this.tz[a], this.tz[b], t);
		const l = Math.hypot(tx, tz) || 1;
		tx /= l;
		tz /= l;
		out.tx = tx;
		out.tz = tz;
		out.rx = -tz;
		out.rz = tx;
		out.halfW = lerp(this.halfW[a], this.halfW[b], t);
		out.bank = lerp(this.bank[a], this.bank[b], t);
	}
	/**
	* Paved width from the centreline: steep banks pave their shoulders into a concrete apron
	* (so wall rides near the rim stay on-road), blending in from ~24° to ~39°.
	*/
	pavedW(i) {
		const apron = clamp((Math.abs(this.bank[i]) - .45) / .35, 0, 1);
		return this.halfW[i] + 3 * apron;
	}
	/**
	* Project a world position onto the track. `hint` is the previous sample index (or -1 for a
	* global search). Height is part of the metric so stacked sections never get confused.
	*/
	locate(x, y, z, hint, out) {
		const n = this.n;
		let best = 0;
		let bestD = Infinity;
		if (hint < 0) for (let i = 0; i < n; i += 1) {
			const ddx = x - this.x[i], ddz = z - this.z[i], ddy = (y - this.y[i]) * 2;
			const dist = ddx * ddx + ddz * ddz + ddy * ddy;
			if (dist < bestD) {
				bestD = dist;
				best = i;
			}
		}
		else for (let k = -28; k <= 28; k += 1) {
			const i = mod(hint + k, n);
			const ddx = x - this.x[i], ddz = z - this.z[i], ddy = (y - this.y[i]) * 2;
			const dist = ddx * ddx + ddz * ddz + ddy * ddy;
			if (dist < bestD) {
				bestD = dist;
				best = i;
			}
		}
		const i = best;
		const px = x - this.x[i];
		const pz = z - this.z[i];
		const along = clamp(px * this.tx[i] + pz * this.tz[i], -this.ds, this.ds);
		const d = px * this.rx[i] + pz * this.rz[i];
		const s = mod(i * this.ds + along, this.length);
		const halfW = this.halfW[i];
		const centerY = this.y[i] + this.slope[i] * along;
		const ramp = Math.abs(d) <= halfW + .5 ? this.rampAt(s) : {
			h: 0,
			index: -1
		};
		out.i = i;
		out.s = s;
		out.d = d;
		out.centerY = centerY;
		out.halfW = halfW;
		out.barrier = this.barrierAt(i);
		out.wall = this.isWall(i);
		out.onRoad = Math.abs(d) <= this.pavedW(i);
		out.onSurface = Math.abs(d) <= halfW + 3 + .5;
		out.rampH = ramp.h;
		out.rampIndex = ramp.index;
		out.roadY = centerY + this.bank[i] * clamp(d, -halfW - 3, halfW + 3) + ramp.h;
		out.tx = this.tx[i];
		out.tz = this.tz[i];
		out.rx = this.rx[i];
		out.rz = this.rz[i];
		out.slope = this.slope[i];
		out.bank = this.bank[i];
		return out;
	}
	/** Maximum |curvature| between two distances ahead of `s` (for AI speed planning). */
	maxCurvature(s, from, to) {
		let k = 0;
		const a = Math.floor((s + from) / this.ds);
		const b = Math.ceil((s + to) / this.ds);
		for (let i = a; i <= b; i += 1) k = Math.max(k, Math.abs(this.curv[mod(i, this.n)]));
		return k;
	}
};
function catmull(p0, p1, p2, p3, t, ox, oy, oz, idx) {
	const k = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)));
	const t0 = 0;
	const t1 = t0 + k(p0, p1);
	const t2 = t1 + k(p1, p2);
	const t3 = t2 + k(p2, p3);
	const tt = lerp(t1, t2, t);
	const comp = (a, b, c, d) => {
		const a1 = (t1 - tt) / (t1 - t0) * a + (tt - t0) / (t1 - t0) * b;
		const a2 = (t2 - tt) / (t2 - t1) * b + (tt - t1) / (t2 - t1) * c;
		const a3 = (t3 - tt) / (t3 - t2) * c + (tt - t2) / (t3 - t2) * d;
		const b1 = (t2 - tt) / (t2 - t0) * a1 + (tt - t0) / (t2 - t0) * a2;
		const b2 = (t3 - tt) / (t3 - t1) * a2 + (tt - t1) / (t3 - t1) * a3;
		return (t2 - tt) / (t2 - t1) * b1 + (tt - t1) / (t2 - t1) * b2;
	};
	ox[idx] = comp(p0.x, p1.x, p2.x, p3.x);
	oy[idx] = comp(p0.y, p1.y, p2.y, p3.y);
	oz[idx] = comp(p0.z, p1.z, p2.z, p3.z);
}
function smoothCircular(src, dst, radius) {
	const n = src.length;
	let sum = 0;
	for (let k = -radius; k <= radius; k += 1) sum += src[mod(k, n)];
	const w = 2 * radius + 1;
	for (let i = 0; i < n; i += 1) {
		dst[i] = sum / w;
		sum += src[mod(i + radius + 1, n)] - src[mod(i - radius, n)];
	}
}
function findStraightest(_total, ds, n, denseAt) {
	const hx = new Float64Array(n);
	const hz = new Float64Array(n);
	const tmp = [
		0,
		0,
		0
	];
	for (let i = 0; i < n; i += 1) {
		denseAt(i * ds, tmp);
		hx[i] = tmp[0];
		hz[i] = tmp[2];
	}
	const heading = new Float64Array(n);
	for (let i = 0; i < n; i += 1) heading[i] = Math.atan2(hx[(i + 1) % n] - hx[mod(i - 1, n)], hz[(i + 1) % n] - hz[mod(i - 1, n)]);
	let best = 0;
	let bestScore = Infinity;
	const back = Math.round(140 / ds);
	const ahead = Math.round(60 / ds);
	for (let i = 0; i < n; i += 4) {
		let score = 0;
		for (let k = -back; k <= ahead; k += 2) score = Math.max(score, Math.abs(wrapAngle(heading[mod(i + k + 1, n)] - heading[mod(i + k - 1, n)])));
		if (score < bestScore) {
			bestScore = score;
			best = i;
		}
	}
	return best * ds;
}
var TOTAL_GATES = 48;
var MAX_RACE_TIME = 300;
var COUNTDOWN = 3;
function newProgress() {
	return {
		gates: 0,
		lapStart: 0,
		lapTimes: [],
		gateTimes: [],
		penalty: 0,
		recoveries: 0,
		finished: false,
		dnf: false,
		finishTime: 0
	};
}
var nextGateIndex = (p) => p.gates % 16;
var totalTime = (p) => p.finishTime + p.penalty;
/**
* True when a move from `sPrev` by the signed along-track distance `ds` crosses the gate at
* `sGate` in the forward direction. Backwards crossings never count.
*/
function crossesForward(sPrev, ds, sGate, length) {
	if (ds <= 0) return false;
	const rel = wrapDelta(sPrev - sGate, length);
	return rel < 0 && rel + ds >= 0;
}
/** Register a valid crossing of the next expected gate at race clock `time`. */
function passGate(p, time) {
	if (p.finished || p.dnf) return "none";
	p.gates += 1;
	p.gateTimes.push(time);
	if (p.gates % 16 === 0) {
		p.lapTimes.push(time - p.lapStart);
		p.lapStart = time;
		if (p.gates >= TOTAL_GATES) {
			p.finished = true;
			p.finishTime = time;
			return "finish";
		}
		return "lap";
	}
	return "gate";
}
/**
* Recovery penalty: the RECOVERY_PENALTY seconds are served on track as a respawn hold
* countdown (the race clock keeps running), so nothing is added to the finish time.
*/
function addRecoveryPenalty(p) {
	if (p.finished || p.dnf) return;
	p.recoveries += 1;
}
/** Apply the 300-second limit; returns true when this call marked the car DNF. */
function applyTimeLimit(p, time) {
	if (p.finished || p.dnf || time < 300) return false;
	p.dnf = true;
	return true;
}
/** Finishers by total time (clock + penalties), then unfinished cars by gates and distance. */
function compareStandings(a, b) {
	const fa = a.progress.finished, fb = b.progress.finished;
	if (fa && fb) return totalTime(a.progress) - totalTime(b.progress) || a.id - b.id;
	if (fa !== fb) return fa ? -1 : 1;
	if (a.progress.dnf !== b.progress.dnf) return a.progress.dnf ? 1 : -1;
	return b.progress.gates - a.progress.gates || a.toNext - b.toNext || a.id - b.id;
}
function bestLap(p) {
	return p.lapTimes.length ? Math.min(...p.lapTimes) : 0;
}
//#endregion
//#region src/sim/car.ts
/**
* Arcade vehicle simulation. Every car uses the same CONFIG.car block; nothing cosmetic can
* reach this file. All state changes happen in fixed 1/60 s steps from explicit inputs.
*/
var DT = 1 / 60;
var CAR_RADIUS = 1.55;
var DRIFT_TIERS = [
	.9,
	1.9,
	3
];
var DRIFT_BOOST = [
	.7,
	1.15,
	1.7
];
/** Half the body width: barriers stop the body edge, not the centre of the car. */
var CAR_HALF_W = 1.05;
/** Seconds a destroyed car burns before it respawns on the spot. */
var WRECK_TIME = 1.6;
/** Seconds a respawned car waits on the road before it may race again. */
var HOLD_TIME = 3;
/** Damage causes, carried in RaceEvent.other for presentation. */
var DAMAGE_CAUSE = {
	wall: 1,
	car: 2,
	item: 3,
	landing: 4
};
var idleInput = () => ({
	throttle: 0,
	brake: 0,
	steer: 0,
	drift: false,
	boost: false,
	item: false,
	recover: false
});
function createCar(id, track, lane, gridS) {
	const car = {
		id,
		x: 0,
		y: 0,
		z: 0,
		yaw: 0,
		vx: 0,
		vz: 0,
		vy: 0,
		vF: 0,
		grounded: true,
		airTime: 0,
		loc: newLoc(),
		odo: gridS,
		lastDs: 0,
		prevS: 0,
		drift: false,
		driftDir: 0,
		driftCharge: 0,
		driftTier: 0,
		driftHeld: 0,
		boostTime: 0,
		meter: 1,
		meterBoosting: false,
		nitro: 0,
		prevBoost: false,
		cork: -1,
		corkFall: 0,
		draftCharge: 0,
		drafting: false,
		trick: 0,
		trickT: 0,
		tricks: 0,
		spin: 0,
		wheelspin: 0,
		shield: 0,
		immune: 0,
		ghostT: 0,
		item: null,
		itemRequest: false,
		recovering: 0,
		wrongWay: 0,
		stuck: 0,
		throttlePressAt: -1,
		prevDrift: false,
		prevItem: false,
		prevRecover: false,
		prevThrottle: false,
		lastPad: -1,
		padTimer: 0,
		rampIndex: -1,
		place: id + 1,
		progress: newProgress(),
		stats: {
			topSpeed: 0,
			nitros: 0,
			corks: 0,
			driftBoosts: 0,
			perfectPads: 0,
			pads: 0,
			tricks: 0,
			draftTime: 0,
			airTime: 0,
			hits: 0,
			dodges: 0,
			blocks: 0,
			itemsUsed: 0,
			wallHits: 0,
			wrecks: 0,
			launch: "none"
		},
		damage: 0,
		wreck: 0,
		hold: 0,
		holdPress: -1,
		warnSeeker: -1,
		warnLocked: false,
		warnLockD: 0,
		warnMine: -1,
		slip: 0,
		anchor: 1,
		steerVis: 0,
		landImpact: 0
	};
	placeOnTrack(car, track, mod(gridS, track.length), lane);
	return car;
}
var frame = {
	x: 0,
	y: 0,
	z: 0,
	tx: 0,
	tz: 1,
	rx: -1,
	rz: 0,
	halfW: 10,
	bank: 0
};
function placeOnTrack(car, track, s, lane) {
	track.frameAt(s, frame);
	car.x = frame.x + frame.rx * lane;
	car.z = frame.z + frame.rz * lane;
	car.y = frame.y + frame.bank * lane;
	car.yaw = Math.atan2(frame.tx, frame.tz);
	track.locate(car.x, car.y, car.z, track.sampleIndex(s), car.loc);
	car.y = car.loc.roadY;
	car.prevS = car.loc.s;
	car.grounded = true;
	car.vy = 0;
	car.rampIndex = car.loc.rampIndex;
}
/** Countdown-phase input handling: launch timing is judged on the first throttle press. */
function countdownStep(car, inp, remaining) {
	const thr = inp.throttle > .5;
	if (thr && !car.prevThrottle) car.throttlePressAt = remaining;
	if (!thr) car.throttlePressAt = -1;
	car.prevThrottle = thr;
	car.prevDrift = inp.drift;
	car.prevItem = inp.item;
	car.prevRecover = inp.recover;
	car.prevBoost = inp.boost;
}
function applyLaunch(car, events) {
	const at = car.throttlePressAt;
	if (at < 0) return;
	if (at <= .4) {
		car.boostTime = Math.max(car.boostTime, 1.3);
		car.stats.launch = "perfect";
		events.push({
			type: "launchPerfect",
			car: car.id
		});
	} else if (at > 1) {
		car.wheelspin = .7;
		car.stats.launch = "early";
		events.push({
			type: "launchEarly",
			car: car.id
		});
	}
}
/** True while a car is out of the racing (recovering, burning or on its respawn hold). */
var inactive = (car) => car.recovering > 0 || car.wreck > 0 || car.hold > 0;
/** Add damage; crossing 1.0 destroys the car. Identical rules for every car. */
function applyDamage(car, amount, events, cause) {
	if (amount <= 0 || car.progress.finished || inactive(car) || car.ghostT > 0) return;
	const before = car.damage;
	car.damage = Math.min(1, before + amount / 2);
	events.push({
		type: "damage",
		car: car.id,
		value: car.damage,
		other: cause
	});
	if (car.damage >= 1) {
		car.wreck = WRECK_TIME;
		car.drift = false;
		car.driftCharge = 0;
		car.driftTier = 0;
		car.trick = 0;
		car.tricks = 0;
		car.boostTime = 0;
		car.meterBoosting = false;
		car.nitro = 0;
		if (car.cork >= 0) {
			car.cork = -1;
			car.grounded = false;
		}
		car.spin = 0;
		car.stats.wrecks += 1;
		events.push({
			type: "explode",
			car: car.id,
			other: cause
		});
		return;
	}
	if (before < .7 && car.damage >= .7) events.push({
		type: "onFire",
		car: car.id
	});
	else if (before < .35 && car.damage >= .35) events.push({
		type: "smoking",
		car: car.id
	});
}
function startRecovery(car, events, reason) {
	if (inactive(car) || car.progress.finished) return;
	car.recovering = .6;
	car.drift = false;
	car.driftCharge = 0;
	car.trick = 0;
	car.tricks = 0;
	car.vx = car.vz = car.vy = 0;
	car.vF = 0;
	car.meterBoosting = false;
	car.nitro = 0;
	car.cork = -1;
	car.corkFall = 0;
	events.push({
		type: "recoverStart",
		car: car.id,
		value: reason === "manual" ? 0 : reason === "fell" ? 1 : 2
	});
}
/** Put the car back on the road at its current spot and start the 3-second hold. */
function respawn(car, track, events, wrecked) {
	car.slip = 0;
	car.anchor = 1;
	const L = track.length;
	let s = car.loc.s;
	const ci = track.corkAt(s);
	if (ci >= 0) s = mod(track.corks[ci].s0 - 30, L);
	const gateS = track.gates[nextGateIndex(car.progress)].s;
	if (wrapDelta(gateS - s, L) < 10) s = mod(gateS - 10, L);
	const lane = clamp(car.loc.d, -car.loc.halfW + 2.5, car.loc.halfW - 2.5) * .35;
	car.odo += wrapDelta(s - car.loc.s, L);
	placeOnTrack(car, track, s, lane);
	car.vx = car.vz = car.vy = car.vF = 0;
	car.lastDs = 0;
	car.prevS = car.loc.s;
	car.hold = HOLD_TIME;
	car.holdPress = -1;
	car.ghostT = HOLD_TIME + 1.2;
	car.immune = Math.max(car.immune, HOLD_TIME + 1.2);
	car.damage = 0;
	car.wreck = 0;
	car.recovering = 0;
	car.boostTime = 0;
	car.nitro = 0;
	car.meterBoosting = false;
	car.cork = -1;
	car.corkFall = 0;
	car.wrongWay = 0;
	car.stuck = 0;
	car.spin = 0;
	car.wheelspin = 0;
	car.drafting = false;
	car.draftCharge = 0;
	addRecoveryPenalty(car.progress);
	events.push({
		type: "recovered",
		car: car.id,
		value: wrecked ? 1 : 0
	});
}
/** Keep the body inside the barriers: canyon walls and rails stop cars at any height. */
function clampToBarrier(car, loc, events) {
	const lim = loc.barrier - CAR_HALF_W;
	const over = Math.abs(loc.d) - lim;
	if (over <= 0) return;
	const sg = Math.sign(loc.d);
	car.x -= loc.rx * sg * over;
	car.z -= loc.rz * sg * over;
	const vn = (car.vx * loc.rx + car.vz * loc.rz) * sg;
	if (vn > 0) {
		car.vx -= loc.rx * sg * vn * 1.3;
		car.vz -= loc.rz * sg * vn * 1.3;
		const loss = clamp(vn / 45, 0, .35);
		car.vx *= 1 - loss;
		car.vz *= 1 - loss;
		if (events && vn > 5) {
			car.stats.wallHits += 1;
			events.push({
				type: "wall",
				car: car.id,
				value: vn
			});
			if (vn > 10 && car.drift) {
				car.drift = false;
				events.push({
					type: "driftLost",
					car: car.id
				});
			}
			if (vn > 14) applyDamage(car, (vn - 14) / 30, events, DAMAGE_CAUSE.wall);
		}
	}
	loc.d = sg * lim;
}
/** A destroyed car skids to a stop and burns, then respawns where it blew up. */
function stepWreck(car, track, events) {
	const dt = DT;
	car.wreck -= dt;
	const k = Math.exp(-2.4 * dt);
	car.vx *= k;
	car.vz *= k;
	car.x += car.vx * dt;
	car.z += car.vz * dt;
	if (!car.grounded) {
		car.vy -= CONFIG.car.gravity * dt;
		car.y += car.vy * dt;
	}
	const prevS = car.loc.s;
	track.locate(car.x, car.y, car.z, car.loc.i, car.loc);
	clampToBarrier(car, car.loc, null);
	if (car.grounded || car.y <= car.loc.roadY) {
		car.y = car.loc.roadY;
		car.vy = 0;
		car.grounded = true;
	}
	const ds = wrapDelta(car.loc.s - prevS, track.length);
	car.odo += ds;
	car.prevS = prevS;
	car.lastDs = 0;
	car.vF = car.vx * Math.sin(car.yaw) + car.vz * Math.cos(car.yaw);
	if (car.wreck <= 0) respawn(car, track, events, true);
}
/** Respawn hold: the car waits on the road; pressing throttle in the last 0.4 s relaunches with a boost. */
function stepHold(car, inp, prevThrottle, events) {
	const thr = inp.throttle > .5;
	if (thr && !prevThrottle) car.holdPress = car.hold;
	if (!thr) car.holdPress = -1;
	car.hold -= DT;
	car.vx = car.vz = car.vy = car.vF = 0;
	car.lastDs = 0;
	car.prevS = car.loc.s;
	if (car.hold > 1e-9) return;
	car.hold = 0;
	car.ghostT = Math.max(car.ghostT, 1);
	car.immune = Math.max(car.immune, 1);
	events.push({
		type: "holdGo",
		car: car.id
	});
	if (car.holdPress >= 0 && car.holdPress <= .4) {
		car.boostTime = Math.max(car.boostTime, 1.1);
		events.push({
			type: "launchPerfect",
			car: car.id,
			value: 1
		});
	}
	car.holdPress = -1;
}
function finishRecovery(car, track, events) {
	respawn(car, track, events, false);
}
/** One fixed simulation step while racing. */
function stepCar(car, inp, track, events) {
	const C = CONFIG.car;
	const dt = DT;
	const driftPressed = inp.drift && !car.prevDrift;
	const itemPressed = inp.item && !car.prevItem;
	const recoverPressed = inp.recover && !car.prevRecover;
	const boostPressed = inp.boost && !car.prevBoost;
	car.prevBoost = inp.boost;
	const prevThrottle = car.prevThrottle;
	car.prevDrift = inp.drift;
	car.prevItem = inp.item;
	car.prevRecover = inp.recover;
	car.prevThrottle = inp.throttle > .5;
	if (itemPressed && car.item && !inactive(car) && car.spin <= 0 && car.cork < 0) car.itemRequest = true;
	car.immune = Math.max(0, car.immune - dt);
	car.shield = Math.max(0, car.shield - dt);
	car.ghostT = Math.max(0, car.ghostT - dt);
	car.spin = Math.max(0, car.spin - dt);
	car.wheelspin = Math.max(0, car.wheelspin - dt);
	car.padTimer = Math.max(0, car.padTimer - dt);
	car.landImpact = Math.max(0, car.landImpact - dt * 3);
	if (car.wreck > 0) {
		stepWreck(car, track, events);
		return;
	}
	if (car.hold > 0) {
		stepHold(car, inp, prevThrottle, events);
		return;
	}
	if (car.recovering > 0) {
		car.recovering -= dt;
		if (car.recovering <= 0) finishRecovery(car, track, events);
		return;
	}
	if (recoverPressed && !car.progress.finished) {
		startRecovery(car, events, "manual");
		return;
	}
	if (car.corkFall > 0) {
		car.corkFall -= dt;
		if (car.corkFall <= 0) {
			car.corkFall = 0;
			startRecovery(car, events, "fell");
			return;
		}
	}
	let steer = clamp(inp.steer, -1, 1);
	let throttle = clamp(inp.throttle, 0, 1);
	let brake = clamp(inp.brake, 0, 1);
	if (car.spin > 0) {
		throttle = 0;
		brake = 0;
		steer = 0;
	}
	if (car.wheelspin > 0) throttle = 0;
	car.steerVis = approach(car.steerVis, steer, dt * 6);
	if (car.nitro > 0) {
		car.nitro = Math.max(0, car.nitro - dt);
		car.boostTime = Math.max(car.boostTime, Math.min(car.nitro, dt * 2));
	} else if (!car.progress.finished) car.meter = Math.min(1, car.meter + dt / C.nitroCooldown);
	if (boostPressed && car.spin <= 0 && car.nitro <= 0) {
		if (car.meter >= 1) {
			car.nitro = C.nitroTime;
			car.meter = 0;
			car.boostTime = Math.max(car.boostTime, C.nitroTime);
			car.stats.nitros += 1;
			events.push({
				type: "nitro",
				car: car.id
			});
		} else events.push({
			type: "nitroDenied",
			car: car.id,
			value: car.meter
		});
	}
	car.meterBoosting = car.nitro > 0;
	const boosting = car.boostTime > 0;
	car.boostTime = Math.max(0, car.boostTime - dt);
	const nitroAcc = car.nitro > 0 ? C.nitroAccel : 0;
	if (car.cork >= 0) {
		stepCork(car, track, events, steer, throttle, brake, boosting, nitroAcc);
		return;
	}
	let fx = Math.sin(car.yaw);
	let fz = Math.cos(car.yaw);
	let vF = car.vx * fx + car.vz * fz;
	const L = car.loc;
	const sp = Math.abs(vF);
	let bankSin = 0;
	let slideAcc = 0;
	if (car.grounded) {
		let slipTarget = 0;
		if (Math.abs(L.bank) > .25) {
			const vAl = Math.max(0, car.vx * L.tx + car.vz * L.tz);
			const bf = bankForces(L.bank, track.curv[L.i], vAl);
			const hold = C.bankGrip * bf.normal;
			bankSin = bf.sin;
			if (C.bankMagnet) car.anchor = Math.max(1, bf.normal / C.gravity);
			else if (bf.pull > hold) {
				car.anchor = bf.normal / C.gravity;
				slipTarget = clamp((bf.pull - hold) / (.6 * C.gravity), 0, 1);
				slideAcc = (bf.pull - hold) * bf.cos * 1.6;
			} else car.anchor = bf.normal / C.gravity;
		} else car.anchor = 1;
		const prevSlip = car.slip;
		car.slip = approach(car.slip, slipTarget, dt * (slipTarget > car.slip ? 5 : 3));
		if (car.slip > .25 && prevSlip <= .25) events.push({
			type: "unanchored",
			car: car.id
		});
		const surface = L.onRoad ? 1 : C.shoulderFactor;
		const downhill = clamp(-L.slope * (fx * L.tx + fz * L.tz), 0, .4) * C.downhillBonus;
		const cap = (boosting ? C.boostSpeed : C.maxSpeed * surface) + (car.drafting ? C.draftBonus : 0) + downhill;
		if (throttle > .05 && vF >= -.5) {
			const target = cap * throttle;
			if (vF < target) {
				const a = C.accel * (1 - .55 * clamp(vF / C.maxSpeed, 0, 1)) + (boosting ? C.boostAccel : 0) + nitroAcc;
				vF = Math.min(target, vF + a * dt);
			}
		} else if (throttle > .05) vF = Math.min(0, vF + C.brake * dt);
		else if (brake > .05) {
			if (vF > .5) vF = Math.max(0, vF - C.brake * brake * dt);
			else vF = Math.max(-C.reverseSpeed, vF - 16 * brake * dt);
		} else vF = approach(vF, 0, C.coastDrag * dt);
		if (vF > cap) vF = Math.max(cap, vF - (boosting ? 8 : 20) * dt);
		const along = fx * L.tx + fz * L.tz;
		vF -= C.gravity * L.slope * along * .42 * dt;
		if (!car.drift && inp.drift && car.driftHeld < .45 && Math.abs(steer) > .35 && vF > C.driftMinSpeed && car.spin <= 0) {
			car.drift = true;
			car.driftDir = Math.sign(steer);
			car.driftCharge = 0;
			car.driftTier = 0;
			events.push({
				type: "driftStart",
				car: car.id,
				value: car.driftDir
			});
		}
		if (car.drift) {
			if (!inp.drift) {
				if (car.driftTier > 0) {
					car.boostTime = Math.max(car.boostTime, DRIFT_BOOST[car.driftTier - 1]);
					car.meter = Math.min(1, car.meter + .06 * car.driftTier);
					car.stats.driftBoosts += 1;
					events.push({
						type: "driftBoost",
						car: car.id,
						value: car.driftTier
					});
				}
				car.drift = false;
			} else if (vF < 11 || car.spin > 0) {
				car.drift = false;
				events.push({
					type: "driftLost",
					car: car.id
				});
			} else {
				car.driftCharge += dt * (.75 + .5 * Math.max(0, steer * car.driftDir));
				const tier = car.driftCharge >= DRIFT_TIERS[2] ? 3 : car.driftCharge >= DRIFT_TIERS[1] ? 2 : car.driftCharge >= DRIFT_TIERS[0] ? 1 : 0;
				if (tier > car.driftTier) events.push({
					type: "driftTier",
					car: car.id,
					value: tier
				});
				car.driftTier = tier;
			}
		}
		let yawRate;
		if (car.drift) yawRate = car.driftDir * (C.driftBase + C.driftSteer * steer * car.driftDir) * clamp(sp / 22, .4, 1);
		else {
			const rate = lerp(C.turnLow, C.turnHigh + C.bankTurn * bankSin, clamp(sp / C.maxSpeed, 0, 1)) * clamp(sp / 4, 0, 1);
			yawRate = steer * rate * (vF < -.5 ? -1 : 1);
		}
		yawRate *= 1 - .6 * car.slip;
		if (car.spin > 0) yawRate = 9 * (car.id % 2 ? 1 : -1) * (car.spin / 1);
		car.yaw = wrapAngle(car.yaw - yawRate * dt);
		const vFwd = vF;
		const nfx = Math.sin(car.yaw);
		const nfz = Math.cos(car.yaw);
		const rx = -nfz;
		const rz = nfx;
		const wvx = fx * vFwd + -fz * (car.vx * -fz + car.vz * fx);
		const wvz = fz * vFwd + fx * (car.vx * -fz + car.vz * fx);
		let f2 = wvx * nfx + wvz * nfz;
		let r2 = wvx * rx + wvz * rz;
		const grip = (car.drift ? C.driftGrip : C.grip) * (L.onRoad ? 1 : .8) * (car.spin > 0 ? .15 : 1) * (1 - car.slip) * (1 - car.slip);
		const r3 = r2 * Math.exp(-grip * dt);
		const speed = Math.hypot(f2, r2);
		const redirected = Math.sqrt(Math.max(0, speed * speed - r3 * r3));
		f2 = f2 + (Math.sign(f2 || 1) * redirected - f2) * .92;
		r2 = r3;
		car.vx = nfx * f2 + rx * r2;
		car.vz = nfz * f2 + rz * r2;
		if (slideAcc > 0) {
			const down = -Math.sign(L.bank);
			car.vx += L.rx * down * slideAcc * dt;
			car.vz += L.rz * down * slideAcc * dt;
		}
		fx = nfx;
		fz = nfz;
		vF = f2;
	} else {
		car.slip = approach(car.slip, 0, dt * 2);
		car.anchor = 0;
		car.vy -= C.gravity * dt;
		const dYaw = steer * C.airTurn * dt;
		car.yaw = wrapAngle(car.yaw - dYaw);
		const c = Math.cos(-dYaw * .5);
		const s = Math.sin(-dYaw * .5);
		const vx = car.vx * c + car.vz * s;
		const vz = -car.vx * s + car.vz * c;
		car.vx = vx * (1 - .1 * dt);
		car.vz = vz * (1 - .1 * dt);
		car.airTime += dt;
		if (driftPressed && car.trick === 0 && car.airTime > .08 && car.spin <= 0) {
			car.trick = steer < -.35 ? 2 : steer > .35 ? 3 : 1;
			car.trickT = 0;
			events.push({
				type: "trickStart",
				car: car.id,
				value: car.trick
			});
		}
		if (car.trick !== 0) {
			car.trickT += dt;
			if (car.trickT >= .5) {
				car.tricks += 1;
				events.push({
					type: "trick",
					car: car.id,
					value: car.trick
				});
				car.trick = 0;
				car.trickT = 0;
			}
		}
		fx = Math.sin(car.yaw);
		fz = Math.cos(car.yaw);
		vF = car.vx * fx + car.vz * fz;
	}
	car.driftHeld = inp.drift ? car.driftHeld + dt : 0;
	const prevY = car.y;
	car.x += car.vx * dt;
	car.z += car.vz * dt;
	if (!car.grounded) car.y += car.vy * dt;
	const prevS = car.loc.s;
	const prevRamp = car.rampIndex;
	track.locate(car.x, car.y, car.z, car.loc.i, car.loc);
	const loc = car.loc;
	clampToBarrier(car, loc, events);
	if (car.wreck > 0) return;
	if (car.grounded) {
		if (!loc.onSurface) car.grounded = false;
		else if (prevRamp >= 0 && loc.rampIndex < 0 && wrapDelta(loc.s - prevS, track.length) > 0) {
			car.grounded = false;
			const mega = track.ramps[prevRamp]?.mega ?? false;
			car.vy = Math.max(car.vy, (mega ? C.megaKick : C.rampKick) * clamp(vF, 0, mega ? 64 : 80) + (mega ? 4 : 2));
			car.airTime = 0;
			car.tricks = 0;
			events.push({
				type: "launch",
				car: car.id,
				value: vF,
				other: mega ? 1 : 0
			});
		} else if (loc.roadY < prevY - .9) {
			car.grounded = false;
			car.airTime = 0;
			car.tricks = 0;
		} else if (!C.bankMagnet && car.slip > .7 && Math.abs(loc.bank) > 1.35) {
			car.grounded = false;
			const down = -Math.sign(loc.bank);
			car.vx += loc.rx * down * 3;
			car.vz += loc.rz * down * 3;
			car.vy = 1.5;
			car.airTime = 0;
			car.tricks = 0;
			events.push({
				type: "peel",
				car: car.id
			});
		} else if (crestLaunch(car, track, fx, fz, vF)) {
			car.grounded = false;
			car.vy = loc.slope * vF * (fx * loc.tx + fz * loc.tz);
			car.y = prevY + car.vy * dt;
			car.airTime = 0;
			car.tricks = 0;
			events.push({
				type: "crest",
				car: car.id,
				value: vF
			});
		} else {
			car.vy = clamp((loc.roadY - prevY) / dt, -40, 40);
			car.y = loc.roadY;
		}
	} else if (car.corkFall <= 0 && loc.onSurface && car.y <= loc.roadY && (car.airTime > .1 && car.vy <= landRoadVy(car) + .4 || car.y < loc.roadY - .35)) {
		car.y = loc.roadY;
		const impact = landRoadVy(car) - car.vy;
		car.vy = 0;
		car.grounded = true;
		car.stats.airTime += car.airTime;
		car.landImpact = clamp(impact / 20, 0, 1);
		const velHeading = Math.atan2(car.vx, car.vz);
		const misalign = Math.abs(wrapAngle(car.yaw - velHeading));
		if (car.trick !== 0) {
			car.vx *= .55;
			car.vz *= .55;
			car.spin = .55;
			car.drift = false;
			events.push({
				type: "crash",
				car: car.id
			});
			applyDamage(car, .25, events, DAMAGE_CAUSE.landing);
		} else if (car.tricks > 0) {
			car.boostTime = Math.max(car.boostTime, .5 + .45 * car.tricks);
			car.meter = Math.min(1, car.meter + .1 * car.tricks);
			car.stats.tricks += car.tricks;
			events.push({
				type: "trickLand",
				car: car.id,
				value: car.tricks
			});
		} else if (car.airTime > .3) events.push({
			type: "land",
			car: car.id,
			value: car.landImpact
		});
		if (misalign > .9 && Math.hypot(car.vx, car.vz) > 8) {
			car.vx *= .8;
			car.vz *= .8;
			events.push({
				type: "rough",
				car: car.id
			});
		}
		car.trick = 0;
		car.trickT = 0;
		car.tricks = 0;
		car.airTime = 0;
	}
	car.rampIndex = car.grounded ? loc.rampIndex : -1;
	if (car.grounded && car.corkFall <= 0) {
		const ci = track.corkAt(loc.s);
		if (ci >= 0) {
			const ck = track.corks[ci];
			const rel = wrapDelta(loc.s - ck.s0, track.length);
			const vAl = car.vx * loc.tx + car.vz * loc.tz;
			if (rel < 14 && vAl > 0) {
				car.cork = ci;
				car.vF = vAl;
				car.drift = false;
				car.slip = 0;
				events.push({
					type: "corkEnter",
					car: car.id,
					value: vAl
				});
			} else {
				car.grounded = false;
				car.corkFall = .9;
				events.push({
					type: "corkFall",
					car: car.id
				});
			}
		}
	}
	if (!car.grounded && !loc.onSurface && car.y < loc.roadY - 12) startRecovery(car, events, "fell");
	if (!car.grounded && car.airTime > 8) startRecovery(car, events, "fell");
	if (car.grounded) checkPads(car, track, events);
	const ds = wrapDelta(loc.s - prevS, track.length);
	car.lastDs = ds;
	car.prevS = prevS;
	car.odo += ds;
	vF = car.vx * fx + car.vz * fz;
	car.vF = vF;
	car.stats.topSpeed = Math.max(car.stats.topSpeed, vF);
	if (fx * loc.tx + fz * loc.tz < -.25 && ds < 0 && car.grounded) car.wrongWay += dt;
	else car.wrongWay = Math.max(0, car.wrongWay - dt * 2);
	if (Math.abs(vF) < 1.2 && throttle > .5 && car.spin <= 0 && car.wheelspin <= 0) car.stuck += dt;
	else car.stuck = 0;
	if (car.stuck > 3 && !car.progress.finished) startRecovery(car, events, "stuck");
}
function checkPads(car, track, events) {
	const loc = car.loc;
	for (const pad of track.pads) {
		if (pad.cork >= 0 !== car.cork >= 0) continue;
		const rel = wrapDelta(loc.s - pad.s + pad.len / 2, track.length);
		if (rel < 0 || rel > pad.len) continue;
		const off = Math.abs(loc.d - pad.d);
		if (off > pad.halfW + .6) continue;
		if (car.lastPad === pad.index && car.padTimer > 0) continue;
		const perfect = off <= .85;
		car.boostTime = Math.max(car.boostTime, perfect ? 1.6 : 1.05);
		if (perfect) car.meter = Math.min(1, car.meter + .08);
		car.lastPad = pad.index;
		car.padTimer = 2;
		car.stats.pads += 1;
		if (perfect) car.stats.perfectPads += 1;
		events.push({
			type: "pad",
			car: car.id,
			value: perfect ? 1 : 0
		});
	}
}
var cf = newCorkFrame();
/**
* Corkscrew rail: the car follows the rolling ribbon. Speed along the path is driven by
* throttle, boost and gravity; the road can only push, so the normal force
* N = v²·κn + g·n_y must stay positive — too slow at the top and the car drops off.
*/
function stepCork(car, track, events, steer, throttle, brake, boosting, nitroAcc) {
	const C = CONFIG.car;
	const dt = DT;
	const ck = track.corks[car.cork];
	const L = track.length;
	car.drift = false;
	car.driftCharge = 0;
	car.driftTier = 0;
	car.trick = 0;
	car.slip = 0;
	car.airTime = 0;
	car.grounded = true;
	car.driftHeld = 0;
	const loc = car.loc;
	let s = loc.s;
	let d = loc.d;
	track.corkFrame(ck, s, d, cf);
	let v = car.vF;
	const cap = boosting ? C.boostSpeed : C.maxSpeed;
	if (throttle > .05) {
		const target = cap * throttle;
		if (v < target) v = Math.min(target, v + (C.accel * (1 - .55 * clamp(v / C.maxSpeed, 0, 1)) + (boosting ? C.boostAccel : 0) + nitroAcc) * dt);
	} else if (brake > .05) v = Math.max(0, v - C.brake * brake * dt);
	else v = approach(v, 0, C.coastDrag * dt);
	if (v > cap) v = Math.max(cap, v - 8 * dt);
	v -= C.gravity * cf.fy * dt;
	const hw = track.corkHalfW(ck, s);
	d = clamp(d + steer * C.corkSteer * clamp(v / 20, .3, 1) * dt, -hw + 1.3, hw - 1.3);
	const prevS = s;
	s = mod(s + Math.max(0, v) * dt / cf.stretch, L);
	const rel = wrapDelta(s - ck.s0, L);
	track.corkFrame(ck, s, d, cf);
	car.x = cf.x;
	car.y = cf.y;
	car.z = cf.z;
	car.yaw = Math.atan2(cf.fx, cf.fz);
	car.vx = cf.fx * v;
	car.vz = cf.fz * v;
	car.vy = cf.fy * v;
	car.vF = v;
	const N = v * v * cf.kn + C.gravity * cf.ny;
	car.anchor = N / C.gravity;
	car.steerVis = approach(car.steerVis, steer, dt * 6);
	track.locate(car.x, car.y, car.z, track.sampleIndex(s), loc);
	loc.s = s;
	loc.i = track.sampleIndex(s);
	loc.d = d;
	loc.roadY = car.y;
	loc.onRoad = true;
	loc.onSurface = true;
	loc.rampIndex = -1;
	loc.rampH = 0;
	loc.bank = 0;
	const ds = wrapDelta(s - prevS, L);
	car.lastDs = ds;
	car.prevS = prevS;
	car.odo += ds;
	car.stats.topSpeed = Math.max(car.stats.topSpeed, v);
	car.wrongWay = 0;
	car.stuck = 0;
	checkPads(car, track, events);
	if (rel >= ck.len - 1e-6 || rel < 0) {
		car.cork = -1;
		const h = Math.hypot(cf.fx, cf.fz) || 1;
		car.vx = cf.fx / h * v;
		car.vz = cf.fz / h * v;
		car.vy = 0;
		car.stats.corks += 1;
		events.push({
			type: "corkExit",
			car: car.id,
			value: v
		});
		return;
	}
	if (cf.ny < .25 && N < -.1 * C.gravity || v < 5) {
		car.cork = -1;
		car.grounded = false;
		car.corkFall = .9;
		car.vx += cf.nx * 1.5;
		car.vy += cf.ny * 1.5;
		car.vz += cf.nz * 1.5;
		events.push({
			type: "corkFall",
			car: car.id,
			value: v
		});
	}
}
/**
* Banked-road anchoring (per unit mass, bank angle θ leaning into a corner of curvature k):
* normal force N = g·cosθ + a_c·sinθ and down-slope pull P = g·sinθ − a_c·cosθ with
* a_c = v²·|k|. Tyres hold while P ≤ μ·N; below the anchor speed the car slides down the bank.
*/
function bankForces(bank, k, vAlong) {
	const g = CONFIG.car.gravity;
	const cos = 1 / Math.sqrt(1 + bank * bank);
	const sin = Math.abs(bank) * cos;
	const ac = vAlong * vAlong * Math.abs(k);
	return {
		normal: g * cos + ac * sin,
		pull: g * sin - ac * cos,
		cos,
		sin
	};
}
/** True when the crest ahead curves down harder than gravity: the car leaves the road. */
function crestLaunch(car, track, fx, fz, vF) {
	const loc = car.loc;
	const vAl = vF * (fx * loc.tx + fz * loc.tz);
	if (vAl < 18 || loc.rampIndex >= 0) return false;
	return track.vcurv[loc.i] * vAl * vAl < -CONFIG.car.gravity * 1.05;
}
/** Vertical speed of the road surface under the car's horizontal motion. */
function landRoadVy(car) {
	const loc = car.loc;
	return loc.slope * (car.vx * loc.tx + car.vz * loc.tz);
}
//#endregion
//#region src/sim/race.ts
var GRID_LANES = [
	-5,
	0,
	5
];
var SEEKER_HIT_WIDTH = 2.6;
var MINE_RADIUS = 2.3;
var RaceSim = class {
	track;
	cars;
	items;
	boxes = [];
	seekers = [];
	mines = [];
	events = [];
	phase = "countdown";
	/** Race clock: negative during the countdown, 0 at GO. */
	clock = -3;
	tick = 0;
	order = [];
	rand;
	nextId = 1;
	constructor(opts) {
		this.track = opts.track;
		this.items = opts.items;
		this.rand = rng(opts.seed);
		this.cars = [];
		for (let i = 0; i < opts.cars; i += 1) {
			const slot = opts.slots?.[i] ?? i;
			this.cars.push(createCar(i, this.track, GRID_LANES[slot % GRID_LANES.length] * clamp(this.track.halfW[0] / 10, .8, 1.2), -14 - Math.floor(slot / 3) * 10));
		}
		this.order = this.cars.map((c) => c.id);
		if (opts.items) {
			const f = {
				x: 0,
				y: 0,
				z: 0,
				tx: 0,
				tz: 1,
				rx: -1,
				rz: 0,
				halfW: 10,
				bank: 0
			};
			for (const row of this.track.items) {
				this.track.frameAt(row.s, f);
				for (const lane of row.lanes) this.boxes.push({
					row: row.index,
					lane,
					x: f.x + f.rx * lane,
					y: f.y + f.bank * lane + 1.3,
					z: f.z + f.rz * lane,
					respawn: 0
				});
			}
		}
	}
	/** Remaining countdown seconds (0 once racing). */
	get countdown() {
		return this.phase === "countdown" ? -this.clock : 0;
	}
	drainEvents() {
		return this.events.splice(0, this.events.length);
	}
	exportState() {
		return {
			tick: this.tick,
			clock: this.clock,
			phase: this.phase,
			cars: structuredClone(this.cars)
		};
	}
	importState(s) {
		this.tick = s.tick;
		this.clock = s.clock;
		this.phase = s.phase;
		for (let i = 0; i < this.cars.length && i < s.cars.length; i += 1) Object.assign(this.cars[i], structuredClone(s.cars[i]));
	}
	step(inputs) {
		if (this.phase === "finished") return;
		this.tick += 1;
		if (this.phase === "countdown") {
			this.clock += DT;
			for (const car of this.cars) countdownStep(car, inputs[car.id], -this.clock);
			if (this.clock >= -1e-9) {
				this.clock = 0;
				this.phase = "racing";
				this.events.push({
					type: "go",
					car: -1
				});
				for (const car of this.cars) applyLaunch(car, this.events);
			}
			return;
		}
		this.clock += DT;
		for (const car of this.cars) stepCar(car, inputs[car.id], this.track, this.events);
		this.collide();
		this.draft();
		this.gates();
		if (this.items) this.stepItems();
		this.standings();
		for (const car of this.cars) if (applyTimeLimit(car.progress, this.clock)) this.events.push({
			type: "dnf",
			car: car.id
		});
		if (this.cars.every((c) => c.progress.finished || c.progress.dnf)) {
			this.phase = "finished";
			this.events.push({
				type: "raceOver",
				car: -1
			});
		}
	}
	collide() {
		const cars = this.cars;
		for (let i = 0; i < cars.length; i += 1) {
			const a = cars[i];
			if (inactive(a) || a.ghostT > 0) continue;
			for (let j = i + 1; j < cars.length; j += 1) {
				const b = cars[j];
				if (inactive(b) || b.ghostT > 0) continue;
				if (Math.abs(a.y - b.y) > 1.6) continue;
				const dx = b.x - a.x;
				const dz = b.z - a.z;
				const d2 = dx * dx + dz * dz;
				const min = CAR_RADIUS * 2;
				if (d2 >= min * min || d2 < 1e-8) continue;
				const dist = Math.sqrt(d2);
				const nx = dx / dist;
				const nz = dz / dist;
				const push = (min - dist) / 2;
				a.x -= nx * push;
				a.z -= nz * push;
				b.x += nx * push;
				b.z += nz * push;
				const vrel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
				if (vrel < 0) {
					const j2 = -vrel * 1.3 / 2;
					a.vx -= nx * j2;
					a.vz -= nz * j2;
					b.vx += nx * j2;
					b.vz += nz * j2;
					if (-vrel > 3) this.events.push({
						type: "bump",
						car: a.id,
						other: b.id,
						value: -vrel
					});
					if (-vrel > 14) {
						const dmg = (-vrel - 14) / 40;
						applyDamage(a, dmg, this.events, DAMAGE_CAUSE.car);
						applyDamage(b, dmg, this.events, DAMAGE_CAUSE.car);
					}
				}
			}
		}
	}
	draft() {
		for (const a of this.cars) {
			let wake = false;
			if (a.grounded && a.vF > 25 && !inactive(a)) {
				const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
				for (const b of this.cars) {
					if (b === a || inactive(b) || b.vF < 20) continue;
					const rx = b.x - a.x, rz = b.z - a.z;
					const along = rx * fx + rz * fz;
					const lat = Math.abs(rx * -fz + rz * fx);
					if (along > 5 && along < 32 && lat < 3.5 && Math.abs(b.y - a.y) < 3) {
						wake = true;
						break;
					}
				}
			}
			a.draftCharge = wake ? Math.min(1.2, a.draftCharge + DT) : Math.max(0, a.draftCharge - DT * 2);
			const was = a.drafting;
			a.drafting = a.draftCharge >= .8;
			if (a.drafting) {
				a.meter = Math.min(1, a.meter + .08 * DT);
				a.stats.draftTime += DT;
			}
			if (a.drafting && !was) this.events.push({
				type: "draft",
				car: a.id
			});
		}
	}
	gates() {
		const L = this.track.length;
		for (const car of this.cars) {
			const p = car.progress;
			if (p.finished || p.dnf || inactive(car) || car.lastDs <= 0) continue;
			const gate = this.track.gates[nextGateIndex(p)];
			if (!crossesForward(car.prevS, car.lastDs, gate.s, L)) continue;
			if (Math.abs(car.loc.d) > car.loc.barrier + 1.5) continue;
			const result = passGate(p, this.clock);
			this.events.push({
				type: result,
				car: car.id,
				value: p.gates
			});
		}
	}
	standings() {
		const L = this.track.length;
		const list = this.cars.map((c) => ({
			id: c.id,
			progress: c.progress,
			toNext: mod(this.track.gates[nextGateIndex(c.progress)].s - c.loc.s, L)
		}));
		list.sort(compareStandings);
		this.order = list.map((s) => s.id);
		list.forEach((s, i) => this.cars[s.id].place = i + 1);
	}
	rollItem(car) {
		const r = this.rand();
		if (car.place === 1) return r < .4 ? "mine" : r < .7 ? "shield" : "canister";
		return r < .32 ? "seeker" : r < .6 ? "mine" : r < .8 ? "shield" : "canister";
	}
	stepItems() {
		const respawn = CONFIG.race.itemRespawn;
		for (const box of this.boxes) {
			if (box.respawn > 0) {
				box.respawn = Math.max(0, box.respawn - DT);
				continue;
			}
			for (const car of this.cars) {
				if (inactive(car)) continue;
				const dx = car.x - box.x, dz = car.z - box.z;
				if (dx * dx + dz * dz > 2.7 * 2.7 || Math.abs(car.y + .8 - box.y) > 3) continue;
				box.respawn = respawn;
				this.events.push({
					type: "box",
					car: car.id,
					value: this.boxes.indexOf(box)
				});
				if (!car.item) {
					car.item = this.rollItem(car);
					this.events.push({
						type: "item",
						car: car.id,
						value: [
							"seeker",
							"mine",
							"shield",
							"canister"
						].indexOf(car.item)
					});
				}
				break;
			}
		}
		for (const car of this.cars) {
			if (!car.itemRequest) continue;
			car.itemRequest = false;
			const item = car.item;
			if (!item) continue;
			car.item = null;
			car.stats.itemsUsed += 1;
			if (item === "shield") {
				car.shield = 8;
				this.events.push({
					type: "useShield",
					car: car.id
				});
			} else if (item === "canister") {
				car.meter = 1;
				this.events.push({
					type: "useCanister",
					car: car.id
				});
			} else if (item === "mine") {
				const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
				const x = car.x - fx * 4.5, z = car.z - fz * 4.5;
				const mloc = { ...car.loc };
				this.track.locate(x, car.y, z, car.loc.i, mloc);
				this.mines.push({
					id: this.nextId++,
					owner: car.id,
					x,
					y: mloc.onSurface ? mloc.roadY : car.y,
					z,
					s: mloc.s,
					d: mloc.d,
					arm: .6,
					life: 30
				});
				if (this.mines.length > 8) this.mines.shift();
				this.events.push({
					type: "useMine",
					car: car.id
				});
			} else {
				const idx = this.order.indexOf(car.id);
				const target = idx > 0 ? this.order[idx - 1] : -1;
				const tgt = target >= 0 ? this.cars[target] : null;
				const gap = tgt ? mod(tgt.loc.s - car.loc.s, this.track.length) : 0;
				const odo = tgt ? tgt.odo - Math.max(4, gap) : car.odo + 3;
				this.seekers.push({
					id: this.nextId++,
					owner: car.id,
					target,
					odo,
					d: car.loc.d,
					speed: 85,
					locked: false,
					lockD: 0,
					life: tgt ? 14 : 3
				});
				this.events.push({
					type: "useSeeker",
					car: car.id,
					other: target
				});
			}
		}
		for (const car of this.cars) {
			car.warnSeeker = -1;
			car.warnLocked = false;
			car.warnMine = -1;
		}
		for (let i = this.seekers.length - 1; i >= 0; i -= 1) {
			const p = this.seekers[i];
			p.life -= DT;
			const tgt = p.target >= 0 ? this.cars[p.target] : null;
			if (!tgt) {
				p.odo += p.speed * DT;
				if (p.life <= 0) {
					this.seekers.splice(i, 1);
					this.events.push({
						type: "fizzle",
						car: p.owner
					});
				}
				continue;
			}
			if (inactive(tgt) || tgt.progress.finished || p.life <= 0) {
				this.seekers.splice(i, 1);
				this.events.push({
					type: "fizzle",
					car: p.owner
				});
				continue;
			}
			p.speed = Math.max(80, tgt.vF + 42);
			const closing = p.speed - tgt.vF;
			p.odo += p.speed * DT;
			const gap = tgt.odo - p.odo;
			if (!p.locked) {
				p.d += clamp(tgt.loc.d - p.d, -10 * DT, 10 * DT);
				if (gap < closing * .8) {
					p.locked = true;
					p.lockD = tgt.loc.d;
					this.events.push({
						type: "seekerLock",
						car: tgt.id,
						other: p.owner
					});
				}
			} else p.d += clamp(p.lockD - p.d, -20 * DT, 20 * DT);
			tgt.warnSeeker = tgt.warnSeeker < 0 ? Math.max(0, gap) : Math.min(tgt.warnSeeker, Math.max(0, gap));
			if (p.locked) {
				tgt.warnLocked = true;
				tgt.warnLockD = p.lockD;
			}
			if (gap <= 0) {
				this.seekers.splice(i, 1);
				const inLane = Math.abs(tgt.loc.d - p.lockD) < SEEKER_HIT_WIDTH;
				const low = tgt.y - tgt.loc.roadY < 2;
				if (inLane && low && tgt.immune <= 0) this.hit(tgt, p.owner, "seeker");
				else {
					tgt.stats.dodges += 1;
					this.events.push({
						type: "dodged",
						car: tgt.id,
						other: p.owner
					});
				}
			}
		}
		const L = this.track.length;
		for (let i = this.mines.length - 1; i >= 0; i -= 1) {
			const m = this.mines[i];
			m.life -= DT;
			m.arm = Math.max(0, m.arm - DT);
			if (m.life <= 0) {
				this.mines.splice(i, 1);
				continue;
			}
			let hitCar = null;
			for (const car of this.cars) {
				if (inactive(car)) continue;
				const ahead = wrapDelta(m.s - car.loc.s, L);
				if (ahead > 0 && ahead < 90 && Math.abs(m.d - car.loc.d) < 6) car.warnMine = car.warnMine < 0 ? ahead : Math.min(car.warnMine, ahead);
				if (m.arm > 0 || car.immune > 0) continue;
				const dx = car.x - m.x, dz = car.z - m.z;
				if (dx * dx + dz * dz < MINE_RADIUS * MINE_RADIUS && car.y - m.y < 1.8) {
					hitCar = car;
					break;
				}
			}
			if (hitCar) {
				this.mines.splice(i, 1);
				this.hit(hitCar, m.owner, "mine");
			}
		}
	}
	hit(car, owner, _kind) {
		if (car.shield > 0) {
			car.shield = 0;
			car.immune = .8;
			car.stats.blocks += 1;
			this.events.push({
				type: "blocked",
				car: car.id,
				other: owner
			});
			return;
		}
		car.spin = 1;
		car.vx *= .45;
		car.vz *= .45;
		car.drift = false;
		car.driftCharge = 0;
		car.trick = 0;
		car.immune = 2;
		car.stats.hits += 1;
		this.events.push({
			type: "hit",
			car: car.id,
			other: owner
		});
		applyDamage(car, .3, this.events, DAMAGE_CAUSE.item);
	}
	/** Canonical digest of simulation state for determinism checks. */
	digest() {
		const parts = [
			this.phase,
			this.tick.toString(),
			this.clock.toFixed(6)
		];
		for (const c of this.cars) parts.push([
			c.x,
			c.y,
			c.z,
			c.yaw,
			c.vx,
			c.vz,
			c.vy,
			c.meter,
			c.boostTime,
			c.damage,
			c.wreck,
			c.hold
		].map((v) => v.toFixed(6)).join(","), String(c.progress.gates), String(c.item), c.progress.penalty.toFixed(3));
		parts.push(String(this.seekers.length), String(this.mines.length), this.boxes.map((b) => b.respawn.toFixed(3)).join(","));
		return parts.join("|");
	}
};
//#endregion
//#region src/sim/tracks.ts
var P = (x, z, y, w, kind) => ({
	x,
	y,
	z,
	w,
	kind
});
/**
* The signature circuit: a desert start straight, a winding sandstone canyon with switchbacks,
* a climb onto an exposed ridge, a bridge over the gorge, a plunging descent back into the
* canyon and a fast open-desert return.
*/
var CANYON_CIRCUIT = {
	id: "canyon-circuit",
	name: "Canyon Circuit",
	seed: 1977,
	start: .5,
	points: [
		P(0, 380, 3, 22, "open"),
		P(0, 200, 3, 22, "open"),
		P(15, 60, 6, 20, "canyon"),
		P(80, -50, 12, 18, "canyon"),
		P(95, -190, 20, 18, "canyon"),
		P(45, -300, 28, 18, "canyon"),
		P(-55, -320, 36, 22, "canyon"),
		P(-110, -240, 44, 24, "canyon"),
		P(-80, -150, 51, 22, "canyon"),
		P(-150, -80, 58, 18, "canyon"),
		P(-270, -110, 70, 18, "ridge"),
		P(-380, -210, 82, 18, "ridge"),
		P(-500, -230, 88, 19, "ridge"),
		P(-600, -150, 87, 20, "bridge"),
		P(-640, -30, 85, 20, "bridge"),
		P(-615, 90, 79, 20, "ridge"),
		P(-535, 190, 62, 20, "ridge"),
		P(-420, 250, 40, 20, "canyon"),
		P(-300, 320, 21, 20, "canyon"),
		P(-190, 440, 8, 24, "open"),
		P(-100, 520, 4, 26, "open"),
		P(-25, 490, 3, 22, "open")
	],
	features: [
		{
			type: "corkscrew",
			at: 170,
			len: 110,
			radius: 8,
			dir: 1,
			width: 6
		},
		{
			type: "items",
			at: 334
		},
		{
			type: "ramp",
			at: 300
		},
		{
			type: "bank",
			at: 356,
			len: 80,
			deg: 32
		},
		{
			type: "twist",
			at: 488,
			len: 190,
			amp: 8,
			cycles: 1.5
		},
		{
			type: "hill",
			at: 405,
			amp: 5,
			len: 80
		},
		{
			type: "hill",
			at: 468,
			amp: -6,
			len: 80
		},
		{
			type: "hill",
			at: 528,
			amp: 5,
			len: 80
		},
		{
			type: "boost",
			at: 580,
			lane: 0
		},
		{
			type: "bank",
			at: 682,
			len: 210,
			deg: 58
		},
		{
			type: "bank",
			at: 968,
			len: 196,
			deg: 64
		},
		{
			type: "items",
			at: 1080
		},
		{
			type: "boost",
			at: 1112,
			lane: 4
		},
		{
			type: "twist",
			at: 1118,
			len: 140,
			amp: 8
		},
		{
			type: "hill",
			at: 1150,
			amp: -6,
			len: 90
		},
		{
			type: "hill",
			at: 1240,
			amp: 14,
			len: 150
		},
		{
			type: "bank",
			at: 1365,
			len: 200,
			deg: 52
		},
		{
			type: "boost",
			at: 1480,
			lane: -4
		},
		{
			type: "boost",
			at: 1600,
			lane: 0
		},
		{
			type: "ramp",
			at: 1662
		},
		{
			type: "boost",
			at: 1745,
			lane: 0
		},
		{
			type: "twist",
			at: 1772,
			len: 146,
			amp: 9
		},
		{
			type: "items",
			at: 1862
		},
		{
			type: "hill",
			at: 1900,
			amp: 13,
			len: 156
		},
		{
			type: "mega",
			at: 2012
		},
		{
			type: "corkscrew",
			at: 2330,
			len: 120,
			radius: 9,
			dir: -1,
			width: 7
		},
		{
			type: "bank",
			at: 2556,
			len: 196,
			deg: 62
		},
		{
			type: "boost",
			at: 2544,
			lane: -3
		},
		{
			type: "mega",
			at: 2702
		}
	]
};
var DEFAULT_LAB = {
	name: "Mesa Sprint",
	seed: 4242,
	size: 1,
	twist: .55,
	hills: .5,
	width: 20,
	canyon: .5,
	ramps: 2,
	pads: 5,
	items: 2
};
function sanitizeLab(p) {
	const num = (v, lo, hi, def) => typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : def;
	return {
		name: typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 24) : DEFAULT_LAB.name,
		seed: Math.floor(num(p.seed, 0, 999999, DEFAULT_LAB.seed)),
		size: num(p.size, .7, 1.3, DEFAULT_LAB.size),
		twist: num(p.twist, 0, 1, DEFAULT_LAB.twist),
		hills: num(p.hills, 0, 1, DEFAULT_LAB.hills),
		width: num(p.width, 16, 24, DEFAULT_LAB.width),
		canyon: num(p.canyon, 0, 1, DEFAULT_LAB.canyon),
		ramps: Math.round(num(p.ramps, 0, 4, DEFAULT_LAB.ramps)),
		pads: Math.round(num(p.pads, 0, 10, DEFAULT_LAB.pads)),
		items: Math.round(num(p.items, 0, 4, DEFAULT_LAB.items))
	};
}
function labId(p) {
	return `lab-${hashString(JSON.stringify({
		...p,
		name: ""
	})).toString(36)}`;
}
function decodeLab(code) {
	const m = /^CC1-([0-9a-z.]+)-(.*)$/i.exec(code.trim());
	if (!m) return null;
	const v = m[1].split(".").map((x) => parseInt(x, 36));
	if (v.length !== 9 || v.some((x) => !Number.isFinite(x))) return null;
	let name = DEFAULT_LAB.name;
	try {
		name = decodeURIComponent(m[2]);
	} catch {}
	return sanitizeLab({
		name,
		seed: v[0],
		size: v[1] / 100,
		twist: v[2] / 100,
		hills: v[3] / 100,
		width: v[4],
		canyon: v[5] / 100,
		ramps: v[6],
		pads: v[7],
		items: v[8]
	});
}
function buildLabSpec(p, twist) {
	const r = rng(p.seed * 7919 + 17);
	const N = 12 + Math.round(twist * 4);
	const R = 380 * p.size;
	const phase = r() * TAU;
	const squash = .72 + r() * .26;
	const points = [];
	for (let k = 0; k < N; k += 1) {
		const theta = TAU * k / N + (r() - .5) * .3 * (TAU / N);
		let radius = R * (1 + (r() - .5) * .8 * twist);
		if (k % 3 === 1) radius -= R * .22 * twist;
		const x = radius * Math.cos(theta);
		const z = radius * Math.sin(theta) * squash;
		const y = Math.max(2, 3 + p.hills * (22 + 22 * Math.sin(theta * 2 + phase)) + p.hills * 10 * (r() - .5));
		points.push({
			x,
			y,
			z,
			w: p.width,
			kind: "open"
		});
	}
	for (let k = 0; k < N; k += 1) {
		const roll = r();
		points[k].kind = roll < p.canyon ? "canyon" : points[k].y > 20 ? "ridge" : "open";
	}
	if (p.hills > .35) {
		let hi = 0;
		for (let k = 1; k < N; k += 1) if (points[k].y > points[hi].y) hi = k;
		points[hi].kind = "bridge";
		points[(hi + 1) % N].kind = "bridge";
		points[(hi + N - 1) % N].kind = points[(hi + N - 1) % N].kind === "canyon" ? "ridge" : points[(hi + N - 1) % N].kind;
	}
	const features = [];
	for (let j = 0; j < p.ramps; j += 1) features.push({
		type: j % 2 === 1 ? "mega" : "ramp",
		u: (j + .5) / p.ramps * N + .55
	});
	if (p.hills > .05) {
		const count = 2 + Math.round(p.hills * 4);
		for (let j = 0; j < count; j += 1) {
			const crest = j % 3 !== 2;
			const amp = 4 + p.hills * 8 + r() * 2;
			features.push({
				type: "hill",
				u: (j + .8) / count * N + .1,
				amp: (crest ? 1 : -1) * amp,
				len: Math.max(70 + r() * 40, amp * 11)
			});
		}
	}
	const rampU = features.filter((f) => f.type === "ramp" || f.type === "mega").map((f) => f.u ?? 0);
	const clearOfRamps = (u) => rampU.every((ru) => Math.abs((u - ru + N * 1.5) % N - N / 2) > 1.1);
	for (let k = 1; k < N; k += 3) {
		if (points[k].kind === "bridge") continue;
		features.push({
			type: "bank",
			u: k,
			deg: 34 + 28 * twist + r() * 6,
			len: 110 + 50 * p.size
		});
	}
	if (twist > .25) {
		let placed = 0;
		for (let k = 2; k < N && placed < (twist > .6 ? 2 : 1); k += 3) {
			const u = k + .5;
			if (!clearOfRamps(u) || points[k].kind === "bridge" || points[(k + 1) % N].kind === "bridge") continue;
			features.push({
				type: "twist",
				u,
				amp: 5 + 5 * twist,
				len: 130 + r() * 20
			});
			placed += 1;
		}
	}
	for (let j = 0; j < p.pads; j += 1) features.push({
		type: "boost",
		u: (j + .3) / p.pads * N + .35,
		lane: [
			-4,
			0,
			4
		][j % 3]
	});
	for (let j = 0; j < p.items; j += 1) features.push({
		type: "items",
		u: (j + .15) / p.items * N + .2
	});
	return {
		id: labId(p),
		name: p.name,
		seed: p.seed,
		points,
		features
	};
}
/** Geometric sanity: drivable corner radii, no overlapping sections, sane grades. */
function checkTrack(track) {
	let maxK = 0;
	let maxSlope = 0;
	for (let i = 0; i < track.n; i += 1) {
		maxK = Math.max(maxK, Math.abs(track.curv[i]));
		maxSlope = Math.max(maxSlope, Math.abs(track.slope[i]));
	}
	let minGap = Infinity;
	const step = 3;
	const sep = Math.round(90 / track.ds);
	for (let i = 0; i < track.n; i += step) for (let j = i + sep; j < track.n; j += step) {
		if (track.n - (j - i) < sep) continue;
		if (Math.abs(track.y[i] - track.y[j]) > 16) continue;
		const gap = Math.hypot(track.x[i] - track.x[j], track.z[i] - track.z[j]) - (track.halfW[i] + track.halfW[j] + 6);
		minGap = Math.min(minGap, gap);
	}
	const minRadius = maxK > 0 ? 1 / maxK : Infinity;
	return {
		ok: minRadius >= 24 && minGap >= 22 && maxSlope <= .46 && track.length >= 1400,
		length: track.length,
		minRadius,
		minGap,
		maxSlope
	};
}
/** Build a drivable Track Lab layout, relaxing the corner intensity until it validates. */
function generateLabTrack(params) {
	const p = sanitizeLab(params);
	let twist = p.twist;
	let last = null;
	for (let attempt = 0; attempt < 10; attempt += 1) {
		const spec = buildLabSpec(p, twist);
		const track = new Track(spec);
		const check = checkTrack(track);
		last = {
			spec,
			track,
			check
		};
		if (check.ok) return last;
		twist *= .8;
	}
	return last;
}
//#endregion
//#region src/sim/netcodec.ts
/**
* Online ghost protocol helpers shared by the browser client and the Node service (bundled into
* server/sim.mjs). Inputs are quantized before the local simulation uses them so the service can
* re-simulate exactly the same numbers.
*/
var PROTOCOL = "canyon-ghost-v1";
var MAX_SEATS = 3;
var INPUTS_PER_MESSAGE = 240;
var GHOST_HZ = 10;
var STEER_STEPS = 63;
var PEDAL_STEPS = 15;
/** 19-bit packing: throttle 4, brake 4, steer 7 (offset 63), flags 4. */
function packInput(inp) {
	const t = Math.round(inp.throttle * PEDAL_STEPS);
	const b = Math.round(inp.brake * PEDAL_STEPS);
	const s = Math.round(inp.steer * STEER_STEPS) + STEER_STEPS;
	const f = (inp.drift ? 1 : 0) | (inp.boost ? 2 : 0) | (inp.item ? 4 : 0) | (inp.recover ? 8 : 0);
	return t | b << 4 | s << 8 | f << 15;
}
function isPackedInput(v) {
	return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1 << 19 && (v >> 8 & 127) <= 126;
}
function unpackInput(v, out) {
	out.throttle = (v & 15) / PEDAL_STEPS;
	out.brake = (v >> 4 & 15) / PEDAL_STEPS;
	out.steer = ((v >> 8 & 127) - STEER_STEPS) / STEER_STEPS;
	const f = v >> 15;
	out.drift = (f & 1) !== 0;
	out.boost = (f & 2) !== 0;
	out.item = (f & 4) !== 0;
	out.recover = (f & 8) !== 0;
	return out;
}
var r2 = (v) => Math.round(v * 100) / 100;
function ghostFrame(seat, tick, car, lagging) {
	const f = (car.drift ? 1 : 0) | (car.boostTime > 0 || car.meterBoosting ? 2 : 0) | (!car.grounded ? 4 : 0) | (car.progress.finished ? 8 : 0) | (car.recovering > 0 ? 16 : 0) | (lagging ? 32 : 0) | (car.progress.dnf ? 64 : 0);
	return {
		seat,
		tick,
		x: r2(car.x),
		y: r2(car.y),
		z: r2(car.z),
		yaw: Math.round(car.yaw * 1e3) / 1e3,
		v: r2(car.vF),
		gates: car.progress.gates,
		f,
		trick: car.trick
	};
}
/** Compact position checksum used to detect client/service divergence. */
function carCheck(car) {
	return [
		r2(car.x),
		r2(car.y),
		r2(car.z)
	];
}
/** Room codes: 4–6 uppercase letters/digits without ambiguous characters. */
var ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function isRoomCode(v) {
	return typeof v === "string" && /^[A-HJ-NP-Z2-9]{4,6}$/.test(v);
}
function randomRoomCode(rand = Math.random) {
	let s = "";
	for (let k = 0; k < 5; k += 1) s += ROOM_ALPHABET[Math.floor(rand() * 32)];
	return s;
}
function sanitizeName(v) {
	return (typeof v === "string" ? v.replace(/[^\w .-]/g, "").trim().slice(0, 14) : "") || "Racer";
}
//#endregion
export { CANYON_CIRCUIT, COUNTDOWN, DT, GHOST_HZ, INPUTS_PER_MESSAGE, MAX_RACE_TIME, MAX_SEATS, PROTOCOL, RaceSim, TOTAL_GATES, Track, bestLap, carCheck, decodeLab, generateLabTrack, ghostFrame, idleInput, isPackedInput, isRoomCode, packInput, randomRoomCode, sanitizeName, unpackInput };
