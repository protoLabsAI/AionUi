/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { infisicalService } from '@process/services/InfisicalService';

export function initInfisicalBridge(): void {
  ipcBridge.providers.testInfisical.provider(async ({ infisicalConfig }) => {
    try {
      const value = await infisicalService.fetchSecret(infisicalConfig);
      return { ok: true, preview: value.slice(0, 4) + '****' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  });
}
