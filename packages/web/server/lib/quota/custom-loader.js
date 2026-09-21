import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

// Directories where custom quota providers can be placed:
// 1. ~/.config/openchamber/quota-providers (user config directory)
// 2. OPENCHAMBER_CUSTOM_QUOTA_DIR (optional environment variable override)
const USER_CONFIG_DIR = path.join(os.homedir(), '.config', 'openchamber', 'quota-providers');
const ENV_DIR = process.env.OPENCHAMBER_CUSTOM_QUOTA_DIR;

export async function loadCustomQuotaProviders() {
  const customProviders = {};
  const dirs = [ENV_DIR, USER_CONFIG_DIR].filter(Boolean);

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;

    let files = [];
    try {
      files = fs.readdirSync(dir).filter((file) => file.endsWith('.js') || file.endsWith('.mjs'));
    } catch (err) {
      console.warn(`[Quota Hook] Failed to read directory ${dir}:`, err.message);
      continue;
    }

    for (const file of files) {
      const fullPath = path.join(dir, file);
      try {
        const mod = await import(pathToFileURL(fullPath).href);
        if (mod.providerId && typeof mod.fetchQuota === 'function') {
          customProviders[mod.providerId] = {
            providerId: mod.providerId,
            providerName: mod.providerName || mod.providerId,
            isConfigured: typeof mod.isConfigured === 'function' ? mod.isConfigured : () => true,
            fetchQuota: mod.fetchQuota,
          };
          console.log(`[Quota Hook] Successfully registered custom quota provider: ${mod.providerId}`);
        }
      } catch (err) {
        console.warn(`[Quota Hook] Failed to load custom provider from ${file}:`, err);
      }
    }
  }

  return customProviders;
}

let loadedPromise = null;
export function ensureCustomQuotaProvidersLoaded(registry) {
  if (!loadedPromise) {
    loadedPromise = loadCustomQuotaProviders()
      .then((custom) => {
        Object.assign(registry, custom);
        return custom;
      })
      .catch((err) => {
        console.warn('[Quota Hook] Error during custom provider loading:', err);
        return {};
      });
  }
  return loadedPromise;
}
