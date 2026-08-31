// Read-only integrity scan of dsh session logs.
// Replicates the exact startup validation of @deepseek-ai/dsh-session-persistence-jsonl 0.1.1-rc.2:
// listArtifacts -> readFirstZstdLine -> scanZstdFrames(first frame) -> decompress -> assertZstdHeaderFrame.
// It never writes, moves or deletes anything.
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { zstdDecompress } from "node:zlib";

const zstdDecompressAsync = promisify(zstdDecompress);
const ZSTD_MAGIC = 4247762216;
const ROOT = process.argv[2] ?? "E:\\dsh\\sessions";

function scanZstdFrames(buffer, maxFrames = Number.POSITIVE_INFINITY) {
	const frames = [];
	let offset = 0;
	while (offset < buffer.length) {
		const start = offset;
		if (buffer.length - offset < 4) return { frames, tornStart: start };
		if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid frame magic at byte ${offset}`);
		offset += 4;
		if (offset === buffer.length) return { frames, tornStart: start };
		const descriptor = buffer.readUInt8(offset);
		offset += 1;
		if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`);
		const contentSizeFlag = descriptor >>> 6;
		const singleSegment = (descriptor & 32) !== 0;
		const checksum = (descriptor & 4) !== 0;
		const dictionaryFlag = descriptor & 3;
		const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
		const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
		const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
		if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
		offset += remainingHeaderBytes;
		for (;;) {
			if (buffer.length - offset < 3) return { frames, tornStart: start };
			const blockHeader = buffer.readUIntLE(offset, 3);
			offset += 3;
			const lastBlock = (blockHeader & 1) !== 0;
			const blockType = (blockHeader >>> 1) & 3;
			const blockSize = blockHeader >>> 3;
			if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`);
			const payloadBytes = blockType === 1 ? 1 : blockSize;
			if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
			offset += payloadBytes;
			if (lastBlock) break;
		}
		if (checksum) {
			if (buffer.length - offset < 4) return { frames, tornStart: start };
			offset += 4;
		}
		frames.push({ start, end: offset });
		if (frames.length === maxFrames) return { frames };
	}
	return { frames };
}

function assertZstdHeaderFrame(plaintext) {
	if (plaintext.length === 0 || plaintext.indexOf(10) !== plaintext.length - 1)
		throw new Error("first frame is not exactly one header line");
}

function classifyHeader(line) {
	try {
		const meta = JSON.parse(line);
		const id = meta.id ?? meta.sessionId ?? "?";
		const cwd = meta.cwd ?? "?";
		return { id, cwd };
	} catch {
		return { id: "(unparseable)", cwd: "?" };
	}
}

const problems = [];
const duplicates = new Map();
let okCount = 0, skippedCount = 0;

for (const project of readdirSync(ROOT)) {
	const projectPath = join(ROOT, project);
	if (!statSync(projectPath).isDirectory()) continue;
	for (const dir of readdirSync(projectPath)) {
		const dirPath = join(projectPath, dir);
		if (!statSync(dirPath).isDirectory()) continue;
		const zstdPath = join(dirPath, "session.jsonl.zstd");
		const plainPath = join(dirPath, "session.jsonl");
		if (existsSync(zstdPath) && existsSync(plainPath)) {
			problems.push({ path: zstdPath, kind: "ENCODING_MISMATCH", detail: "both session.jsonl and session.jsonl.zstd exist" });
			continue;
		}
		if (existsSync(plainPath) && !existsSync(zstdPath)) {
			problems.push({ path: plainPath, kind: "OPPOSITE_ENCODING", detail: "uncompressed session.jsonl exists (loader for zstd throws encodingMismatch)" });
			continue;
		}
		if (!existsSync(zstdPath)) continue;
		let content;
		try {
			content = (await import("node:fs")).readFileSync(zstdPath);
		} catch (e) {
			problems.push({ path: zstdPath, kind: "UNREADABLE", detail: e.message });
			continue;
		}
		if (content.length === 0) {
			problems.push({ path: zstdPath, kind: "EMPTY_FILE", detail: "0 bytes" });
			continue;
		}
		let first;
		try {
			({ frames: [first] } = scanZstdFrames(content, 1));
		} catch (e) {
			problems.push({ path: zstdPath, kind: "STRUCTURE", detail: e.message });
			continue;
		}
		if (first === undefined) {
			skippedCount++;
			problems.push({ path: zstdPath, kind: "TORN_FIRST_FRAME", detail: "no complete first frame (loader skips silently at EOF; session invisible)" });
			continue;
		}
		let plaintext;
		try {
			plaintext = await zstdDecompressAsync(content.subarray(first.start, first.end));
		} catch (e) {
			problems.push({ path: zstdPath, kind: "DECODE_FAILED", detail: `header frame failed validation: ${e.message}` });
			continue;
		}
		try {
			assertZstdHeaderFrame(plaintext);
		} catch (e) {
			const preview = JSON.stringify(plaintext.subarray(0, 200).toString("utf8"));
			problems.push({ path: zstdPath, kind: "HEADER_FRAME", detail: `${e.message}; frameBytes=${first.end - first.start} plainBytes=${plaintext.length} newlines=${countNl(plaintext)} preview=${preview}` });
			continue;
		}
		const headerLine = plaintext.subarray(0, -1).toString("utf8");
		const { id, cwd } = classifyHeader(headerLine);
		okCount++;
		const key = id;
		if (!duplicates.has(key)) duplicates.set(key, []);
		duplicates.get(key).push(zstdPath);
	}
}

function countNl(buf) {
	let n = 0;
	for (const b of buf) if (b === 10) n++;
	return n;
}

for (const [id, paths] of duplicates) {
	if (paths.length > 1) problems.push({ path: paths.join(" | "), kind: "DUPLICATE_ID", detail: `session id "${id}" appears in multiple project directories (loader throws)` });
}

console.log(`scanned root: ${ROOT}`);
console.log(`OK first-frame headers: ${okCount}, torn-first-frame (skipped by loader): ${skippedCount}`);
console.log(`problems: ${problems.length}`);
for (const p of problems) {
	console.log(`\n[${p.kind}] ${p.path}`);
	console.log(`  ${p.detail}`);
}
if (problems.length === 0) console.log("\nAll session logs pass the exact startup validation.");
