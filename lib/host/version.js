// src/host/core/version.ts
function parseDshVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?/.exec(String(v || "").trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], rc: m[4] === void 0 ? Infinity : +m[4] };
}
function dshVersionGte(v, target) {
  const a = parseDshVersion(v);
  const b = parseDshVersion(target);
  if (!a || !b) return false;
  const keys = ["major", "minor", "patch", "rc"];
  for (const key of keys) {
    if (a[key] !== b[key]) return a[key] > b[key];
  }
  return true;
}
export {
  dshVersionGte,
  parseDshVersion
};
