// src/host/core/moduleRegistry.ts
import { createNotificationModule, manifest as notificationManifest } from "./modules/notification/index.js";

// src/modules/registry.ts
var CORE_API_VERSION = 2;

// src/host/core/moduleRegistry.ts
var BUILTIN_MODULES = [
  { ...notificationManifest, create: createNotificationModule }
];
export {
  BUILTIN_MODULES,
  CORE_API_VERSION
};
