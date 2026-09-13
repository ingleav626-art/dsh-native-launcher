// src/host/io/priority.ts
import { getPriority, setPriority, constants } from "node:os";
function raiseOwnPriority() {
  const atUptimeMs = Math.round(process.uptime() * 1e3);
  const before = readPriority();
  if (before === null) return { before, after: before, raised: false, atUptimeMs };
  if (before <= constants.priority.PRIORITY_ABOVE_NORMAL) return { before, after: before, raised: false, atUptimeMs };
  try {
    setPriority(0, constants.priority.PRIORITY_ABOVE_NORMAL);
  } catch {
  }
  const after = readPriority();
  return { before, after, raised: after !== before, atUptimeMs };
}
function priorityName(value) {
  switch (value) {
    case constants.priority.PRIORITY_HIGHEST:
      return "Highest";
    case constants.priority.PRIORITY_HIGH:
      return "High";
    case constants.priority.PRIORITY_ABOVE_NORMAL:
      return "AboveNormal";
    case constants.priority.PRIORITY_NORMAL:
      return "Normal";
    case constants.priority.PRIORITY_BELOW_NORMAL:
      return "BelowNormal";
    case constants.priority.PRIORITY_LOW:
      return "Low";
    default:
      return value === null ? "(unavailable)" : String(value);
  }
}
function readPriority() {
  try {
    return getPriority(0);
  } catch {
    return null;
  }
}
export {
  priorityName,
  raiseOwnPriority
};
