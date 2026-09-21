import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

console.log('🔧 Starting to apply Custom Quota Provider Hook...');

// 1. Create packages/web/server/lib/quota/custom-loader.js
const customLoaderDir = path.join(ROOT, 'packages', 'web', 'server', 'lib', 'quota');
const customLoaderPath = path.join(customLoaderDir, 'custom-loader.js');

const customLoaderCode = `import fs from 'node:fs';
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
      console.warn(\`[Quota Hook] Failed to read directory \${dir}:\`, err.message);
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
          console.log(\`[Quota Hook] Successfully registered custom quota provider: \${mod.providerId}\`);
        }
      } catch (err) {
        console.warn(\`[Quota Hook] Failed to load custom provider from \${file}:\`, err);
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
`;

fs.writeFileSync(customLoaderPath, customLoaderCode, 'utf8');
console.log('✅ Created packages/web/server/lib/quota/custom-loader.js');

// 2. Patch packages/web/server/lib/quota/providers/index.js
const providersIndexPath = path.join(ROOT, 'packages', 'web', 'server', 'lib', 'quota', 'providers', 'index.js');
let providersContent = fs.readFileSync(providersIndexPath, 'utf8');

if (!providersContent.includes('custom-loader.js')) {
  // Add import statement at the top
  providersContent = `import { ensureCustomQuotaProvidersLoaded } from '../custom-loader.js';\n` + providersContent;

  // Trigger loading right after registry definition
  const registryEndPattern = /const registry = \{[\s\S]*?\n\};/;
  const match = providersContent.match(registryEndPattern);
  if (match) {
    const replacement = `${match[0]}\n\n// Custom quota hook: register external providers dynamically\nensureCustomQuotaProvidersLoaded(registry);\n`;
    providersContent = providersContent.replace(match[0], replacement);
  }

  // Ensure custom providers are loaded before uncoalesced fetch
  providersContent = providersContent.replace(
    /const fetchQuotaForProviderUncoalesced = async \(providerId\) => \{/,
    `const fetchQuotaForProviderUncoalesced = async (providerId) => {\n  await ensureCustomQuotaProvidersLoaded(registry);`
  );

  fs.writeFileSync(providersIndexPath, providersContent, 'utf8');
  console.log('✅ Patched packages/web/server/lib/quota/providers/index.js');
} else {
  console.log('ℹ️ packages/web/server/lib/quota/providers/index.js already patched');
}

// 3. Patch packages/ui/src/types/quota.ts
const quotaTypePath = path.join(ROOT, 'packages', 'ui', 'src', 'types', 'quota.ts');
let quotaTypeContent = fs.readFileSync(quotaTypePath, 'utf8');

if (!quotaTypeContent.includes('(string & {})')) {
  quotaTypeContent = quotaTypeContent.replace(
    /export type QuotaProviderId =\s*\n/,
    `export type QuotaProviderId =\n  | (string & {})\n`
  );
  fs.writeFileSync(quotaTypePath, quotaTypeContent, 'utf8');
  console.log('✅ Patched packages/ui/src/types/quota.ts');
} else {
  console.log('ℹ️ packages/ui/src/types/quota.ts already patched');
}

console.log('🎉 Custom Quota Provider Hook applied successfully!');
