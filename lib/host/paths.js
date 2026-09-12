// src/host/core/paths.ts
import { join } from "node:path";
function logsDirOf(launcherDir) {
  return join(launcherDir, "logs");
}
export {
  logsDirOf
};
