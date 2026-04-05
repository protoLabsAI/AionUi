/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider } from '@/common/config/storage';
import { infisicalService } from './InfisicalService';

/**
 * Resolve the effective API key for a provider.
 *
 * When `apiKeySource` is `'infisical'`, the key is fetched from Infisical
 * using the provider's `infisicalConfig`. Otherwise the inline `apiKey` field
 * is returned as-is (the default 'inline' behaviour).
 */
export async function resolveApiKey(
  provider: Pick<IProvider, 'apiKey' | 'apiKeySource' | 'infisicalConfig'>
): Promise<string> {
  if (provider.apiKeySource === 'infisical') {
    if (!provider.infisicalConfig) {
      throw new Error('infisicalConfig is required when apiKeySource is "infisical"');
    }
    return infisicalService.fetchSecret(provider.infisicalConfig);
  }
  return provider.apiKey ?? '';
}
