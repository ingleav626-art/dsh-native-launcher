// src/host/services/modules.ts
function setupModules(deps) {
  const { createPorts, cfg, builtinModules, coreApiVersion, onNotificationModule, logMsg, logWarn, logFail } = deps;
  try {
    const moduleSwitches = cfg.modules ?? {};
    for (const mod of builtinModules) {
      const enabled = moduleSwitches[mod.id] ?? mod.defaultEnabled;
      if (!enabled) {
        logMsg(`[modules] ${mod.id}: disabled by config (modules.${mod.id}=${JSON.stringify(moduleSwitches[mod.id] ?? null)}), skip`);
        continue;
      }
      logMsg(`module ${mod.id}: enabled (modules.${mod.id}=${JSON.stringify(enabled)})`);
      const compat = typeof mod.apiVersion === "number" && mod.apiVersion === coreApiVersion;
      if (!compat) {
        logMsg(`[modules] ${mod.id}: apiVersion ${mod.apiVersion} incompatible with core ${coreApiVersion}, refuse to load`);
        continue;
      }
      logMsg(`[modules] ${mod.id}: applying (core=v${coreApiVersion})`);
      const ports = createPorts();
      const instance = mod.create(ports);
      instance.start();
      if (mod.id === "notifications") {
        onNotificationModule(instance);
      }
      logMsg(`[modules] ${mod.id}: applied`);
    }
  } catch (error) {
    logMsg(`module loading failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
}
export {
  setupModules
};
