import { describe, expect, it } from 'vitest';
import { META_STORAGE_KEY, MetaProgression } from '../../src/meta/MetaProgression';
import { COSMETICS, SHOP_SKUS, Shop, cosmeticDef, cosmeticLookFor } from '../../src/meta/Shop';
import { FakePlatform } from '../../src/platform/FakePlatform';
import { Sim } from '../../src/sim/Sim';

/** Task 23.2: cosmetic shop unit tests (Req 29.2–29.5). */
function setup(payments: boolean) {
  const platform = new FakePlatform({ paymentsSupported: payments });
  const meta = new MetaProgression(platform);
  const shop = new Shop(platform, meta);
  return { platform, meta, shop };
}

describe('shop catalogue typing', () => {
  it('every SKU references a cosmetic, and cosmetics carry only visual fields', () => {
    const cosmeticIds = new Set(COSMETICS.map((c) => c.id));
    expect(cosmeticIds.size).toBe(COSMETICS.length);
    for (const sku of SHOP_SKUS) {
      expect(cosmeticIds.has(sku.cosmeticId)).toBe(true);
      expect(sku.sku.length).toBeGreaterThan(0);
    }
    for (const def of COSMETICS) {
      expect(Object.keys(def.look).every((k) => ['bodyTint', 'rimColor'].includes(k))).toBe(true);
      if (def.premium) expect(def.bonesCost).toBeNull();
      else expect(def.bonesCost ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('payment purchases', () => {
  it('success grants the cosmetic, equips it, and saves ownership', async () => {
    const { platform, meta, shop } = setup(true);
    await meta.load();
    await expect(shop.buyWithPayment('cosmetic_skin_pumpkin')).resolves.toBe('ok');
    expect(meta.state.cosmetics).toEqual(['skin_pumpkin']);
    expect(meta.state.equipped).toBe('skin_pumpkin');
    await expect(platform.load(META_STORAGE_KEY)).resolves.toMatchObject({ cosmetics: ['skin_pumpkin'] });
  });

  it('failed and cancelled purchases leave ownership unchanged', async () => {
    const { platform, meta, shop } = setup(true);
    await meta.load();
    platform.purchaseResult = 'failed';
    await expect(shop.buyWithPayment('cosmetic_skin_ghost')).resolves.toBe('failed');
    platform.purchaseResult = 'cancelled';
    await expect(shop.buyWithPayment('cosmetic_skin_ghost')).resolves.toBe('cancelled');
    expect(meta.state.cosmetics).toEqual([]);
    expect(meta.state.equipped).toBeNull();
  });

  it('buying an owned cosmetic does not charge again', async () => {
    const { platform, meta, shop } = setup(true);
    await meta.load();
    await shop.buyWithPayment('cosmetic_rim_gold');
    await expect(shop.buyWithPayment('cosmetic_rim_gold')).resolves.toBe('ok');
    expect(platform.purchases).toHaveLength(1);
    expect(meta.state.cosmetics).toEqual(['rim_gold']);
  });

  it('unknown SKUs fail without touching the platform', async () => {
    const { platform, shop } = setup(true);
    await expect(shop.buyWithPayment('not_a_sku')).resolves.toBe('failed');
    expect(platform.purchases).toHaveLength(0);
  });

  it('payments unsupported: paymentsEnabled is false and purchases fail closed', async () => {
    const { meta, shop } = setup(false);
    await meta.load();
    expect(shop.paymentsEnabled()).toBe(false);
    await expect(shop.buyWithPayment('cosmetic_skin_pumpkin')).resolves.toBe('failed');
    expect(meta.state.cosmetics).toEqual([]);
  });
});

describe('Bones purchases and equipping', () => {
  it('cosmetics stay unlockable with Bones when payments are unsupported', async () => {
    const { meta, shop } = setup(false);
    await meta.load();
    meta.grantCurrency(200);
    const def = cosmeticDef('skin_ghost')!;
    expect(shop.buyWithBones('skin_ghost')).toBe(true);
    expect(meta.state.currency).toBe(200 - def.bonesCost);
    expect(meta.state.cosmetics).toEqual(['skin_ghost']);
    expect(meta.state.equipped).toBe('skin_ghost');
    expect(shop.buyWithBones('skin_ghost')).toBe(false); // already owned
  });

  it('insufficient Bones cannot buy', async () => {
    const { meta, shop } = setup(false);
    await meta.load();
    meta.grantCurrency(10);
    expect(shop.buyWithBones('skin_ghost')).toBe(false);
    expect(meta.state.cosmetics).toEqual([]);
  });

  it('equip/unequip only affects owned cosmetics', async () => {
    const { meta } = setup(false);
    await meta.load();
    expect(meta.equipCosmetic('skin_ghost')).toBe(false);
    meta.grantCosmetic('skin_ghost');
    meta.grantCosmetic('rim_gold');
    expect(meta.state.equipped).toBe('skin_ghost'); // first grant auto-equips
    expect(meta.equipCosmetic('rim_gold')).toBe(true);
    expect(meta.state.equipped).toBe('rim_gold');
    expect(meta.equipCosmetic(null)).toBe(true);
    expect(meta.state.equipped).toBeNull();
    expect(cosmeticLookFor(meta.state)).toBeNull();
  });

  it('equipping a cosmetic leaves a fixed-seed sim snapshot unchanged', () => {
    const run = () => {
      const sim = new Sim({ seed: 777 });
      sim.setInput(1, 0);
      for (let i = 0; i < 600; i++) sim.stepOnce(1 / 60);
      return sim.snapshot();
    };
    const before = run();
    const { meta } = setup(false);
    meta.grantCosmetic('rim_ember');
    meta.equipCosmetic('rim_ember');
    expect(cosmeticLookFor(meta.state)).not.toBeNull();
    expect(run()).toEqual(before);
  });
});

describe('premium shop-only cosmetics', () => {
  it('exactly two premium looks exist, each combining a body tint and rim color', () => {
    const premium = COSMETICS.filter((c) => c.premium);
    expect(premium.map((c) => c.id)).toEqual(['premium_royal', 'premium_void']);
    for (const def of premium) {
      expect(def.look.bodyTint).toBeTypeOf('number');
      expect(def.look.rimColor).toBeTypeOf('number');
      expect(def.bucksPrice).toBeGreaterThan(100);
    }
  });

  it('premium looks cannot be bought with Bones, however rich the player is', async () => {
    const { meta, shop } = setup(false);
    await meta.load();
    meta.grantCurrency(100_000);
    expect(shop.buyWithBones('premium_royal')).toBe(false);
    expect(shop.buyWithBones('premium_void')).toBe(false);
    expect(meta.state.cosmetics).toEqual([]);
    expect(meta.state.currency).toBe(100_000);
  });

  it('premium looks can be bought with payment and then equipped like any look', async () => {
    const { meta, shop } = setup(true);
    await meta.load();
    await expect(shop.buyWithPayment('cosmetic_premium_royal')).resolves.toBe('ok');
    expect(meta.ownsCosmetic('premium_royal')).toBe(true);
    expect(meta.equipCosmetic('premium_royal')).toBe(true);
    const look = cosmeticLookFor(meta.state);
    expect(look?.bodyTint).toBeTypeOf('number');
    expect(look?.rimColor).toBeTypeOf('number');
  });
});
