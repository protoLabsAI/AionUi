import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InfisicalConfig } from '@/common/config/storage';

const mockLogin = vi.fn();
const mockGetSecret = vi.fn();

vi.mock('@infisical/sdk', () => {
  class MockInfisicalSDK {
    auth() {
      return { universalAuth: { login: mockLogin } };
    }
    secrets() {
      return { getSecret: mockGetSecret };
    }
  }
  return { InfisicalSDK: MockInfisicalSDK };
});

import { infisicalService } from '@process/services/InfisicalService';

const BASE_CONFIG: InfisicalConfig = {
  projectId: 'proj-123',
  environment: 'prod',
  secretPath: '/aionui/providers',
  secretName: 'ANTHROPIC_API_KEY',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('INFISICAL_CLIENT_ID', 'test-client-id');
  vi.stubEnv('INFISICAL_CLIENT_SECRET', 'test-client-secret');
});

describe('InfisicalService', () => {
  it('happy path: fetches secret and returns value', async () => {
    mockLogin.mockResolvedValue(undefined);
    mockGetSecret.mockResolvedValue({ secretValue: 'sk-my-secret-key' });

    const cfg: InfisicalConfig = { ...BASE_CONFIG, secretName: 'HAPPY_PATH_KEY' };
    const result = await infisicalService.fetchSecret(cfg);

    expect(result).toBe('sk-my-secret-key');
    expect(mockLogin).toHaveBeenCalledWith({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    });
    expect(mockGetSecret).toHaveBeenCalledWith({
      projectId: cfg.projectId,
      environment: cfg.environment,
      secretPath: cfg.secretPath,
      secretName: cfg.secretName,
    });
  });

  it('cache TTL: second call within TTL uses cache (no extra network call)', async () => {
    mockLogin.mockResolvedValue(undefined);
    mockGetSecret.mockResolvedValue({ secretValue: 'cached-secret' });

    const cfg: InfisicalConfig = { ...BASE_CONFIG, secretName: 'CACHE_TTL_KEY' };

    const first = await infisicalService.fetchSecret(cfg);
    const second = await infisicalService.fetchSecret(cfg);

    expect(first).toBe('cached-secret');
    expect(second).toBe('cached-secret');
    // getSecret must only be called once — second call served from cache
    expect(mockGetSecret).toHaveBeenCalledTimes(1);
  });

  it('fetch failure: throws and does not cache', async () => {
    mockLogin.mockResolvedValue(undefined);
    mockGetSecret.mockRejectedValueOnce(new Error('Network error'));

    const cfg: InfisicalConfig = { ...BASE_CONFIG, secretName: 'FAILURE_KEY' };

    await expect(infisicalService.fetchSecret(cfg)).rejects.toThrow('Network error');

    // On the next call the service must retry (not serve a stale/bad cache entry)
    mockGetSecret.mockResolvedValue({ secretValue: 'recovered-secret' });
    const recovered = await infisicalService.fetchSecret(cfg);
    expect(recovered).toBe('recovered-secret');
    expect(mockGetSecret).toHaveBeenCalledTimes(2);
  });
});
