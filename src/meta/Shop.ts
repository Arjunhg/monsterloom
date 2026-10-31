/**
 * Shop (task 23.1, Req 29): cosmetic-only monetization.
 *
 * The catalogue is typed so purchasable items can only reference cosmetic
 * IDs and visual look fields (tints) — there is no way to express a gameplay
 * effect here (Req 29.2). Equipped cosmetics are applied in PlayerRenderer
 * only; the Sim never reads them.
 *
 * Two ways to own a cosmetic:
 *  - Real payment via PlatformService.purchase (shop.purchase on RUN),
 *    available only where paymentsSupported() is true. Server prices live in
 *    rundot/shop.config.json — keep `bucksPrice` here in sync (display only;
 *    the server config is what actually charges).
 *  - Bones (meta currency), always available for the standard looks, so
 *    cosmetics stay unlockable where payments are unsupported (Req 29.5).
 *    Premium looks (`premium: true`, `bonesCost: null`) are Shop-only.
 *
 * On payment success the cosmetic is granted and saved (29.3); on failure or
 * cancel, ownership is left unchanged (29.4) and the caller toasts.
 */
import type { MetaProgression, MetaState } from './MetaProgression';
import type { PlatformService, PurchaseResult } from '../platform/PlatformService';

export type CosmeticId =
  | 'skin_pumpkin'
  | 'skin_ghost'
  | 'skin_toxic'
  | 'rim_gold'
  | 'rim_frost'
  | 'rim_ember'
  | 'premium_royal'
  | 'premium_void';

/** Visual-only look applied by PlayerRenderer. No gameplay fields exist here. */
export interface CosmeticLook {
  bodyTint?: number;
  rimColor?: number;
}

export interface CosmeticDef {
  id: CosmeticId;
  name: string;
  description: string;
  /** Meta-currency (Bones) price for the free unlock path; null = Shop-only. */
  bonesCost: number | null;
  /** Premium looks are sold for Bucks only and combine a tint + rim. */
  premium?: boolean;
  /** Display price in RUN Bucks; must match rundot/shop.config.json. */
  bucksPrice: number;
  look: CosmeticLook;
}

export const COSMETICS: readonly CosmeticDef[] = [
  { id: 'skin_pumpkin', name: 'Pumpkin Glow', description: 'Warm orange body tint', bonesCost: 150, bucksPrice: 100, look: { bodyTint: 0xffb37a } },
  { id: 'skin_ghost', name: 'Ghost Pale', description: 'Pale spectral body tint', bonesCost: 150, bucksPrice: 100, look: { bodyTint: 0xcfe9ff } },
  { id: 'skin_toxic', name: 'Toxic Glow', description: 'Radioactive green body tint', bonesCost: 150, bucksPrice: 100, look: { bodyTint: 0xb6ff9e } },
  { id: 'rim_gold', name: 'Golden Rim', description: 'Gold outline glow', bonesCost: 150, bucksPrice: 100, look: { rimColor: 0xffd166 } },
  { id: 'rim_frost', name: 'Frost Rim', description: 'Icy blue outline glow', bonesCost: 150, bucksPrice: 100, look: { rimColor: 0x9fe8ff } },
  { id: 'rim_ember', name: 'Ember Rim', description: 'Burning orange outline glow', bonesCost: 150, bucksPrice: 100, look: { rimColor: 0xff8a3c } },
  { id: 'premium_royal', name: 'Royal Dread', description: 'Premium: rose tint + gold rim', bonesCost: null, bucksPrice: 250, premium: true, look: { bodyTint: 0xff9ad5, rimColor: 0xffd166 } },
  { id: 'premium_void', name: 'Void Walker', description: 'Premium: teal tint + ember rim', bonesCost: null, bucksPrice: 250, premium: true, look: { bodyTint: 0x7be0d4, rimColor: 0xff8a3c } },
];

export interface SkuDef {
  sku: string;
  cosmeticId: CosmeticId;
  priceLabel: string;
}

/** Server-catalog SKUs. Typed so a SKU can only grant a cosmetic. */
export const SHOP_SKUS: readonly SkuDef[] = COSMETICS.map((c) => ({
  sku: `cosmetic_${c.id}`,
  cosmeticId: c.id,
  priceLabel: `${c.bucksPrice} Bucks`,
}));

const COSMETIC_BY_ID = new Map<string, CosmeticDef>(COSMETICS.map((c) => [c.id, c]));
const SKU_BY_ID = new Map<string, SkuDef>(SHOP_SKUS.map((s) => [s.sku, s]));

export function cosmeticDef(id: string): CosmeticDef | undefined {
  return COSMETIC_BY_ID.get(id);
}

export function skuDef(sku: string): SkuDef | undefined {
  return SKU_BY_ID.get(sku);
}

/** The equipped cosmetic's look, or null when none is equipped/known. */
export function cosmeticLookFor(state: MetaState): CosmeticLook | null {
  if (!state.equipped) return null;
  const def = COSMETIC_BY_ID.get(state.equipped);
  return def ? { ...def.look } : null;
}

function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `mms-shop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export class Shop {
  /** One stable key per SKU while a purchase outcome is ambiguous ('failed'). */
  private readonly idempotencyKeys = new Map<string, string>();

  constructor(
    private readonly platform: Pick<PlatformService, 'paymentsSupported' | 'purchase'>,
    private readonly meta: MetaProgression,
  ) {}

  /** Whether real-payment purchase controls should be shown at all (Req 29.5). */
  paymentsEnabled(): boolean {
    return this.platform.paymentsSupported();
  }

  /**
   * Buys a cosmetic by SKU through the host payment flow. Already-owned
   * items resolve 'ok' without charging again. On success the cosmetic is
   * granted and saved; on 'failed'/'cancelled' ownership is unchanged.
   */
  async buyWithPayment(sku: string): Promise<PurchaseResult> {
    const def = SKU_BY_ID.get(sku);
    if (!def) return 'failed';
    if (this.meta.ownsCosmetic(def.cosmeticId)) return 'ok';
    let key = this.idempotencyKeys.get(sku);
    if (!key) {
      key = newIdempotencyKey();
      this.idempotencyKeys.set(sku, key);
    }
    let result: PurchaseResult;
    try {
      result = await this.platform.purchase(sku, key);
    } catch {
      return 'failed'; // keep the idempotency key for a safe retry
    }
    if (result === 'ok') {
      this.idempotencyKeys.delete(sku);
      this.meta.grantCosmetic(def.cosmeticId);
      await this.meta.flush();
    } else if (result === 'cancelled') {
      this.idempotencyKeys.delete(sku);
    }
    return result;
  }

  /** Buys a cosmetic with Bones (always available). False when owned/unaffordable. */
  buyWithBones(cosmeticId: string): boolean {
    const def = COSMETIC_BY_ID.get(cosmeticId);
    if (!def || def.bonesCost === null || this.meta.ownsCosmetic(def.id)) return false;
    if (!this.meta.spendCurrency(def.bonesCost)) return false;
    this.meta.grantCosmetic(def.id);
    void this.meta.flush();
    return true;
  }
}
