/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { InfisicalSDK } from '@infisical/sdk';
import type { InfisicalConfig } from '@/common/config/storage';

type CacheEntry = { value: string; expiresAt: number };

class InfisicalService {
  private cache = new Map<string, CacheEntry>();
  private readonly TTL_MS = 5 * 60 * 1000;

  /**
   * Fetch a secret from Infisical using Universal Auth machine-identity credentials.
   * Results are cached for TTL_MS milliseconds to avoid repeated network calls.
   */
  async fetchSecret(config: InfisicalConfig): Promise<string> {
    const cacheKey = `${config.projectId}:${config.environment}:${config.secretPath}:${config.secretName}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const clientId = process.env['INFISICAL_CLIENT_ID'];
    const clientSecret = process.env['INFISICAL_CLIENT_SECRET'];
    if (!clientId || !clientSecret) {
      throw new Error('INFISICAL_CLIENT_ID and INFISICAL_CLIENT_SECRET must be set to use Infisical apiKeySource');
    }

    const client = new InfisicalSDK();
    await client.auth().universalAuth.login({ clientId, clientSecret });

    const secret = await client.secrets().getSecret({
      projectId: config.projectId,
      environment: config.environment,
      secretPath: config.secretPath,
      secretName: config.secretName,
    });

    const value = secret.secretValue;
    if (!value) throw new Error(`Infisical secret '${config.secretName}' returned empty value`);

    this.cache.set(cacheKey, { value, expiresAt: Date.now() + this.TTL_MS });
    return value;
  }
}

export const infisicalService = new InfisicalService();
