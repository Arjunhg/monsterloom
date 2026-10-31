import Phaser from 'phaser';
import { getSession, syncMetaBonuses, type Settings } from '../game/Session';
import { FONT, GAME_HEIGHT, GAME_WIDTH, PALETTE, SCENE, TEX } from '../game/keys';
import {
  MAX_STAT_BONUS_LEVEL,
  META_CURRENCY_NAME,
  UNLOCK_CATALOGUE,
  nextCostFor,
  startingPartIdsFor,
  type UnlockDef,
} from '../meta/MetaProgression';
import {
  DAILY_LEADERBOARD_MODE,
  DAILY_LEADERBOARD_PERIOD,
  dailySeed,
  submitPendingDailyScore,
  utcDateKey,
} from '../meta/DailyChallenge';
import { COSMETICS, SHOP_SKUS, Shop, cosmeticDef } from '../meta/Shop';
import { ACHIEVEMENTS, evaluateAchievements } from '../meta/Achievements';
import { AchievementBanner } from '../render/AchievementBanner';
import type { ScoreEntry } from '../platform/PlatformService';
import { columnLayout, onResizeSettled } from '../game/layout';
import { getAudio } from '../juice/AudioManager';

let runStartedFired = false;
let metaLoadToastShown = false;

type ToggleKey = keyof Settings;

interface ToggleDef {
  label: string;
  key: ToggleKey;
  /** settings value that means "on" for display purposes */
  isOn: (s: Settings) => boolean;
  flip: (s: Settings) => void;
}

const TOGGLES: ToggleDef[] = [
  { label: 'Music', key: 'musicMuted', isOn: (s) => !s.musicMuted, flip: (s) => (s.musicMuted = !s.musicMuted) },
  { label: 'Sound', key: 'sfxMuted', isOn: (s) => !s.sfxMuted, flip: (s) => (s.sfxMuted = !s.sfxMuted) },
  {
    label: 'Screen shake',
    key: 'shakeEnabled',
    isOn: (s) => s.shakeEnabled,
    flip: (s) => (s.shakeEnabled = !s.shakeEnabled),
  },
];

/** Title screen: start button + session settings toggles (Req 1.5, 18.6–18.7). */
export default class TitleScene extends Phaser.Scene {
  private starting = false;
  private bonesText: Phaser.GameObjects.Text | null = null;
  private badgesText: Phaser.GameObjects.Text | null = null;
  private achievementBanner: AchievementBanner | null = null;
  private unlockPanel: Phaser.GameObjects.Container | null = null;
  private dailyButtonText: Phaser.GameObjects.Text | null = null;
  /** Unlocks panel tab: power unlocks, cosmetic looks, or the real-money shop (task 23). */
  private unlockTab: 'power' | 'looks' | 'shop' = 'power';
  private shop: Shop | null = null;
  private buyingSku: string | null = null;
  private lbPanel: Phaser.GameObjects.Container | null = null;
  private lbGeneration = 0;
  private lbView: { kind: 'loading' } | { kind: 'ready'; top: ScoreEntry[]; me?: ScoreEntry } | { kind: 'error' } = {
    kind: 'loading',
  };

  constructor() {
    super(SCENE.title);
  }

  create(): void {
    this.starting = false;
    this.bonesText = null;
    this.achievementBanner = null;
    this.unlockPanel = null;
    this.dailyButtonText = null;
    this.lbPanel = null;
    this.lbGeneration++;
    // Full-screen backdrop + a GAME_WIDTH-wide content column centred in the canvas.
    const { width: W, height: H, ox, oy } = columnLayout(this);
    const cx = W / 2;

    // Night backdrop: vertical gradient + dim ground tiles + vignette.
    const bg = this.add.graphics();
    bg.fillGradientStyle(PALETTE.night, PALETTE.night, 0x2a1850, 0x2a1850, 1);
    bg.fillRect(0, 0, W, H);
    this.add.tileSprite(0, H * 0.45, W, H * 0.55, TEX.ground).setOrigin(0, 0).setAlpha(0.7);
    this.add.image(cx, H / 2, TEX.vignette).setDisplaySize(W, H);

    // Moon.
    const moon = this.add.graphics();
    moon.fillStyle(PALETTE.dawn, 0.9);
    moon.fillCircle(ox + 560, oy + 200, 70);
    moon.fillStyle(PALETTE.night, 1);
    moon.fillCircle(ox + 590, oy + 180, 62);

    // Title.
    this.add
      .text(cx, oy + 360, 'Monster Mash\nSurvivor', {
        fontFamily: FONT,
        fontSize: '84px',
        fontStyle: 'bold',
        color: PALETTE.text,
        align: 'center',
        stroke: '#0b0716',
        strokeThickness: 10,
      })
      .setOrigin(0.5);

    // Bobbing player blob.
    this.bonesText = this.add
      .text(cx, oy + 480, '', { fontFamily: FONT, fontSize: '34px', color: '#ffd166' })
      .setOrigin(0.5);
    this.badgesText = this.add
      .text(cx, oy + 522, '', { fontFamily: FONT, fontSize: '24px', color: PALETTE.textDim })
      .setOrigin(0.5);
    this.refreshBones();

    const blob = this.add.image(cx, oy + 640, TEX.playerBody).setScale(3);
    this.tweens.add({ targets: blob, y: oy + 610, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // Start button (big tap target, Req 1.5).
    this.makeButton(cx, oy + 830, 460, 120, 'Start Night', '56px', () => this.startRun());
    this.dailyButtonText = this.makeButton(cx, oy + 950, 440, 92, 'Daily Challenge', '40px', () => this.startDaily());
    this.makeButton(cx - 113, oy + 1062, 214, 84, 'Unlocks', '32px', () => this.openUnlocks());
    this.makeButton(cx + 113, oy + 1062, 214, 84, 'Leaderboard', '32px', () => this.openLeaderboard());

    // Settings toggles.
    const settings = getSession().settings;
    TOGGLES.forEach((t, i) => {
      const y = oy + 1174 + i * 104;
      const label = (): string => `${t.label}: ${t.isOn(settings) ? 'On' : 'Off'}`;
      const btn = this.makeButton(cx, y, 420, 88, label(), '36px', () => {
        t.flip(settings);
        btn.setText(label());
      });
    });

    this.add
      .text(cx, oy + GAME_HEIGHT - 80, 'Drag to move. Survive till dawn.', {
        fontFamily: FONT,
        fontSize: '30px',
        color: PALETTE.textDim,
      })
      .setOrigin(0.5);

    // First interaction unlocks audio (Req 18.7).
    this.input.once('pointerdown', () => this.unlockAudio());
    this.input.keyboard?.once('keydown', () => this.unlockAudio());
    this.input.keyboard?.on('keydown-ENTER', () => this.startRun());
    this.input.keyboard?.on('keydown-SPACE', () => this.startRun());

    // Re-layout on canvas resize (Scale.EXPAND): the scene is stateless, so just restart it.
    onResizeSettled(this, () => {
      if (!this.starting) this.scene.restart();
    });

    // Meta load lands async after boot: refresh the Bones balance, and toast
    // once if saved progress couldn't be read (non-blocking, Req 26.4/26.7).
    void getSession().dailyReady.then(() => {
      if (this.scene.isActive(SCENE.title)) this.refreshDailyLabel();
    });
    // Friend challenge (task 22): a valid launch payload auto-starts its run.
    void getSession().challengeReady.then(() => {
      if (this.scene.isActive(SCENE.title) && getSession().pendingChallenge && !this.starting) this.startChallenge();
    });
    void getSession().metaReady.then(() => {
      if (!this.scene.isActive(SCENE.title)) return;
      this.refreshBones();
      const outcome = getSession().meta.loadOutcome;
      if (!metaLoadToastShown && (outcome === 'invalid' || outcome === 'error')) {
        metaLoadToastShown = true;
        this.showToast(
          outcome === 'invalid'
            ? 'Saved progress was corrupted — starting fresh unlocks'
            : "Couldn't load saved progress — will retry saving later",
        );
      }
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // Keyboard listeners persist across restarts; drop ours so they don't stack up.
      this.input.keyboard?.off('keydown-ENTER');
      this.input.keyboard?.off('keydown-SPACE');
      this.input.keyboard?.off('keydown');
    });
  }

  private makeButton(
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    fontSize: string,
    onTap: () => void,
  ): Phaser.GameObjects.Text {
    const plate = this.add.graphics();
    const draw = (hover: boolean): void => {
      plate.clear();
      plate.fillStyle(0x0b0716, 0.9);
      plate.fillRoundedRect(x - w / 2, y - h / 2 + 6, w, h, 24);
      plate.fillStyle(hover ? 0x4a3590 : 0x3a2878, 1);
      plate.fillRoundedRect(x - w / 2, y - h / 2, w, h, 24);
      plate.lineStyle(4, PALETTE.playerRim, hover ? 1 : 0.7);
      plate.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 24);
    };
    draw(false);
    const label = this.add
      .text(x, y, text, { fontFamily: FONT, fontSize, fontStyle: 'bold', color: PALETTE.text })
      .setOrigin(0.5);
    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => draw(true));
    zone.on('pointerout', () => draw(false));
    zone.on('pointerup', () => {
      this.unlockAudio();
      onTap();
    });
    return label;
  }

  private unlockAudio(): void {
    const session = getSession();
    // Unlock directly too; the window event alone is lost if nothing is listening yet.
    getAudio().unlock();
    if (session.audioUnlocked) return;
    session.audioUnlocked = true;
    (this.sound as unknown as { unlock?: () => void }).unlock?.();
    window.dispatchEvent(new Event('mms-audio-unlock'));
  }

  private refreshBones(): void {
    this.bonesText?.setText(`${META_CURRENCY_NAME}: ${getSession().meta.state.currency}`);
    const owned = getSession().meta.state.achievements.length;
    this.badgesText?.setText(owned > 0 ? `Badges: ${owned}/${ACHIEVEMENTS.length}` : '');
    if (this.unlockPanel) {
      this.closeUnlocks();
      this.openUnlocks();
    }
  }

  /** Small non-blocking message near the top of the screen. */
  private showToast(message: string): void {
    const { width: W, oy } = columnLayout(this);
    const text = this.add
      .text(W / 2, oy + 64, message, {
        fontFamily: FONT,
        fontSize: '26px',
        color: PALETTE.text,
        backgroundColor: '#0b0716',
        padding: { x: 18, y: 10 },
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 80 },
      })
      .setOrigin(0.5)
      .setDepth(200);
    this.tweens.add({ targets: text, alpha: 0, delay: 3200, duration: 600, onComplete: () => text.destroy() });
  }

  private rowSubText(def: UnlockDef): string {
    const state = getSession().meta.state;
    if (def.kind === 'stat') return `Lv ${state.statBonuses[def.stat] ?? 0}/${MAX_STAT_BONUS_LEVEL} · ${def.description}`;
    return state.unlocks.includes(def.id) ? 'Owned — equipped at night start' : def.description;
  }

  /** Unlock screen (task 20.2): spend Bones on stat levels and starting parts. */
  private refreshDailyLabel(): void {
    const session = getSession();
    const ranked = session.daily.rankedAvailable(utcDateKey());
    this.dailyButtonText?.setText(ranked ? 'Daily · Ranked' : 'Daily · Practice');
  }

  /** Starts the pending friend-challenge run with its encoded seed (Req 28.4). */
  private startChallenge(): void {
    if (this.starting) return;
    const session = getSession();
    const payload = session.pendingChallenge;
    if (!payload) return;
    this.starting = true;
    this.unlockAudio();
    void session.platform.requestFullscreen();
    session.pendingChallenge = null;
    void session.metaReady.then(() => {
      session.runMode = 'challenge';
      session.dailyDate = null;
      session.challengeTarget = payload.score;
      syncMetaBonuses(session);
      session.sim.restart(payload.seed);
      session.platform.track('challenge_started', { target: payload.score });
      if (!runStartedFired) {
        runStartedFired = true;
        session.platform.funnel(3, 'run_started', 'boot', 1);
      }
      this.scene.start(SCENE.game);
    });
  }

  /** Starts today's seeded run: stat bonuses off, first attempt of the day is ranked. */
  private startDaily(): void {
    if (this.starting) return;
    this.starting = true;
    this.unlockAudio();
    const session = getSession();
    // Synchronous gesture chain for the host fullscreen call (see startRun).
    void session.platform.requestFullscreen();
    void Promise.all([session.dailyReady, session.metaReady]).then(() => {
      const date = utcDateKey();
      const ranked = session.daily.claimRanked(date);
      session.runMode = ranked ? 'daily-ranked' : 'daily-practice';
      session.dailyDate = date;
      session.pendingChallenge = null;
      session.challengeTarget = null;
      void session.daily.flush();
      // Fair conditions (Req 27.2): meta stat bonuses off; starting parts stay.
      session.sim.setBonuses({ startingPartIds: startingPartIdsFor(session.meta.state) });
      session.sim.restart(dailySeed(date));
      session.platform.track('daily_started', { ranked });
      if (!runStartedFired) {
        runStartedFired = true;
        session.platform.funnel(3, 'run_started', 'boot', 1);
      }
      this.scene.start(SCENE.game);
    });
  }

  private openUnlocks(): void {
    if (this.unlockPanel) return;
    this.closeLeaderboard();
    const session = getSession();
    const { width: W, height: H } = columnLayout(this);
    const cx = W / 2;
    const panelW = 640;
    const panelH = 1270;
    const top = H / 2 - panelH / 2;
    const items: Phaser.GameObjects.GameObject[] = [];

    const dim = this.add.rectangle(cx, H / 2, W, H, 0x000000, 0.72).setInteractive();
    items.push(dim);
    const plate = this.add.graphics();
    plate.fillStyle(0x241442, 1);
    plate.fillRoundedRect(cx - panelW / 2, top, panelW, panelH, 28);
    plate.lineStyle(4, PALETTE.playerRim, 0.8);
    plate.strokeRoundedRect(cx - panelW / 2, top, panelW, panelH, 28);
    items.push(plate);
    items.push(
      this.add
        .text(cx, top + 50, 'Unlocks', { fontFamily: FONT, fontSize: '48px', fontStyle: 'bold', color: PALETTE.text })
        .setOrigin(0.5),
    );
    items.push(
      this.add
        .text(cx, top + 100, `${META_CURRENCY_NAME}: ${session.meta.state.currency}`, {
          fontFamily: FONT,
          fontSize: '32px',
          color: '#ffd166',
        })
        .setOrigin(0.5),
    );
    // Tabs (task 23): Power (Bones unlocks), Looks (cosmetics via Bones +
    // equip), Shop (real payments — only where payments are supported, 29.5).
    const shop = this.getShop();
    const tabs: Array<{ id: 'power' | 'looks' | 'shop'; label: string }> = [
      { id: 'power', label: 'Power' },
      { id: 'looks', label: 'Looks' },
    ];
    if (shop.paymentsEnabled()) tabs.push({ id: 'shop', label: 'Shop' });
    if (!tabs.some((t) => t.id === this.unlockTab)) this.unlockTab = 'power';
    const tabW = 176;
    const tabGap = 12;
    const tabsTotal = tabs.length * tabW + (tabs.length - 1) * tabGap;
    tabs.forEach((tab, i) => {
      const tx = cx - tabsTotal / 2 + tabW / 2 + i * (tabW + tabGap);
      const ty = top + 152;
      const selected = this.unlockTab === tab.id;
      const g = this.add.graphics();
      g.fillStyle(selected ? 0x3a2878 : 0x241b38, 1);
      g.fillRoundedRect(tx - tabW / 2, ty - 30, tabW, 60, 16);
      g.lineStyle(3, PALETTE.playerRim, selected ? 0.9 : 0.35);
      g.strokeRoundedRect(tx - tabW / 2, ty - 30, tabW, 60, 16);
      items.push(g);
      items.push(
        this.add
          .text(tx, ty, tab.label, {
            fontFamily: FONT,
            fontSize: '30px',
            fontStyle: 'bold',
            color: selected ? PALETTE.text : PALETTE.textDim,
          })
          .setOrigin(0.5),
      );
      const z = this.add.zone(tx, ty, tabW, 60).setInteractive({ useHandCursor: true });
      z.on('pointerup', () => {
        this.unlockAudio();
        this.unlockTab = tab.id;
        this.closeUnlocks();
        this.openUnlocks();
      });
      items.push(z);
    });

    const rowW = 560;
    const rowH = 88;
    const addRow = (
      y: number,
      name: string,
      sub: string,
      status: string,
      statusColor: string,
      highlighted: boolean,
      onTap: () => void,
    ): void => {
      const row = this.add.graphics();
      row.fillStyle(highlighted ? 0x3a2878 : 0x241b38, 1);
      row.fillRoundedRect(cx - rowW / 2, y - rowH / 2, rowW, rowH, 18);
      row.lineStyle(3, PALETTE.playerRim, highlighted ? 0.8 : 0.35);
      row.strokeRoundedRect(cx - rowW / 2, y - rowH / 2, rowW, rowH, 18);
      items.push(row);
      items.push(
        this.add
          .text(cx - rowW / 2 + 22, y - 20, name, { fontFamily: FONT, fontSize: '29px', fontStyle: 'bold', color: PALETTE.text })
          .setOrigin(0, 0.5),
      );
      items.push(
        this.add.text(cx - rowW / 2 + 22, y + 20, sub, { fontFamily: FONT, fontSize: '22px', color: PALETTE.textDim }).setOrigin(0, 0.5),
      );
      items.push(
        this.add
          .text(cx + rowW / 2 - 22, y, status, { fontFamily: FONT, fontSize: '28px', fontStyle: 'bold', color: statusColor })
          .setOrigin(1, 0.5),
      );
      const zone = this.add.zone(cx, y, rowW, rowH).setInteractive({ useHandCursor: true });
      zone.on('pointerup', () => {
        this.unlockAudio();
        onTap();
      });
      items.push(zone);
    };
    const saveMeta = (): void => {
      void session.meta.flush().then((ok) => {
        if (!ok && this.scene.isActive(SCENE.title)) this.showToast("Couldn't save — will retry next run");
      });
    };

    if (this.unlockTab === 'power') {
    UNLOCK_CATALOGUE.forEach((def, i) => {
      const y = top + 242 + i * 94;
      const cost = nextCostFor(session.meta.state, def);
      const affordable = cost !== null && session.meta.state.currency >= cost;
      const row = this.add.graphics();
      row.fillStyle(cost === null ? 0x2c2340 : affordable ? 0x3a2878 : 0x241b38, 1);
      row.fillRoundedRect(cx - rowW / 2, y - rowH / 2, rowW, rowH, 18);
      row.lineStyle(3, PALETTE.playerRim, affordable ? 0.8 : 0.35);
      row.strokeRoundedRect(cx - rowW / 2, y - rowH / 2, rowW, rowH, 18);
      items.push(row);
      items.push(
        this.add
          .text(cx - rowW / 2 + 22, y - 20, def.name, {
            fontFamily: FONT,
            fontSize: '29px',
            fontStyle: 'bold',
            color: PALETTE.text,
          })
          .setOrigin(0, 0.5),
      );
      items.push(
        this.add
          .text(cx - rowW / 2 + 22, y + 20, this.rowSubText(def), {
            fontFamily: FONT,
            fontSize: '22px',
            color: PALETTE.textDim,
          })
          .setOrigin(0, 0.5),
      );
      items.push(
        this.add
          .text(cx + rowW / 2 - 22, y, cost === null ? (def.kind === 'stat' ? 'MAX' : 'Owned') : `${cost}`, {
            fontFamily: FONT,
            fontSize: '30px',
            fontStyle: 'bold',
            color: cost === null ? '#9fe8a8' : affordable ? '#ffd166' : PALETTE.textDim,
          })
          .setOrigin(1, 0.5),
      );
      const zone = this.add.zone(cx, y, rowW, rowH).setInteractive({ useHandCursor: affordable });
      zone.on('pointerup', () => {
        this.unlockAudio();
        if (!session.meta.buyUnlock(def.id)) return;
        syncMetaBonuses(session);
        this.refreshBones();
        void session.meta.flush().then((ok) => {
          if (!ok && this.scene.isActive(SCENE.title)) this.showToast("Couldn't save unlock — will retry next run");
        });
      });
      items.push(zone);
    });
    } else if (this.unlockTab === 'looks') {
      const equipped = session.meta.state.equipped;
      addRow(top + 242, 'Default Look', 'No cosmetic equipped', equipped === null ? 'On' : 'Equip', equipped === null ? '#9fe8a8' : '#ffd166', equipped === null, () => {
        if (session.meta.equipCosmetic(null)) {
          saveMeta();
          this.refreshBones();
        }
      });
      COSMETICS.forEach((def, i) => {
        const owned = session.meta.ownsCosmetic(def.id);
        const isEquipped = equipped === def.id;
        const shopOnly = def.bonesCost === null;
        const affordable = def.bonesCost !== null && session.meta.state.currency >= def.bonesCost;
        addRow(
          top + 242 + (i + 1) * 94,
          def.name,
          def.description,
          isEquipped ? 'On' : owned ? 'Equip' : shopOnly ? 'Shop' : `${def.bonesCost}`,
          isEquipped || owned ? '#9fe8a8' : affordable || shopOnly ? '#ffd166' : PALETTE.textDim,
          isEquipped || (!owned && (affordable || shopOnly)),
          () => {
            if (owned) {
              if (session.meta.equipCosmetic(isEquipped ? null : def.id)) saveMeta();
            } else if (shopOnly) {
              if (shop.paymentsEnabled()) {
                this.unlockTab = 'shop';
              } else {
                this.showToast('Premium look — only in the Shop');
                return;
              }
            } else if (shop.buyWithBones(def.id)) {
              session.meta.equipCosmetic(def.id);
              this.showToast(`Unlocked: ${def.name}`);
              this.checkShopAchievement();
            } else {
              this.showToast(`Need ${def.bonesCost} ${META_CURRENCY_NAME}`);
              return;
            }
            this.refreshBones();
          },
        );
      });
    } else {
      SHOP_SKUS.forEach((sku, i) => {
        const def = cosmeticDef(sku.cosmeticId);
        const owned = session.meta.ownsCosmetic(sku.cosmeticId);
        const buying = this.buyingSku === sku.sku;
        addRow(
          top + 242 + i * 94,
          def?.name ?? sku.sku,
          def?.description ?? '',
          owned ? 'Owned' : buying ? '…' : sku.priceLabel,
          owned ? '#9fe8a8' : '#ffd166',
          !owned && !buying,
          () => {
            if (owned || this.buyingSku !== null) return;
            this.buyingSku = sku.sku;
            this.refreshBones();
            void shop.buyWithPayment(sku.sku).then((res) => {
              this.buyingSku = null;
              if (!this.scene.isActive(SCENE.title)) return;
              if (res === 'ok') {
                session.meta.equipCosmetic(sku.cosmeticId);
                saveMeta();
                this.showToast(`Unlocked: ${def?.name ?? 'cosmetic'}`);
                this.checkShopAchievement();
              } else if (res === 'cancelled') this.showToast('Purchase cancelled');
              else this.showToast("Purchase didn't go through — try again");
              this.refreshBones();
            });
          },
        );
      });
    }

    const closeY = top + panelH - 76;
    const closePlate = this.add.graphics();
    closePlate.fillStyle(0x3a2878, 1);
    closePlate.fillRoundedRect(cx - 140, closeY - 42, 280, 84, 20);
    closePlate.lineStyle(4, PALETTE.playerRim, 0.8);
    closePlate.strokeRoundedRect(cx - 140, closeY - 42, 280, 84, 20);
    items.push(closePlate);
    items.push(
      this.add
        .text(cx, closeY, 'Close', { fontFamily: FONT, fontSize: '36px', fontStyle: 'bold', color: PALETTE.text })
        .setOrigin(0.5),
    );
    const closeZone = this.add.zone(cx, closeY, 280, 84).setInteractive({ useHandCursor: true });
    closeZone.on('pointerup', () => {
      this.unlockAudio();
      this.closeUnlocks();
    });
    items.push(closeZone);

    this.unlockPanel = this.add.container(0, 0, items).setDepth(100);
  }

  private getAchievementBanner(): AchievementBanner {
    if (!this.achievementBanner) {
      const { width: W, oy } = columnLayout(this);
      this.achievementBanner = new AchievementBanner(this, W / 2, oy + 210);
    }
    return this.achievementBanner;
  }

  /** Shopaholic check after a cosmetic grant (Req 32); plaque on unlock. */
  private checkShopAchievement(): void {
    const session = getSession();
    const unlocked = evaluateAchievements(session.meta, { cosmeticsOwned: session.meta.state.cosmetics.length });
    if (unlocked.length > 0) {
      // Delayed so the small "Unlocked: <look>" toast reads first.
      for (const a of unlocked) this.getAchievementBanner().show(a.name, a.description, 650);
      void session.meta.flush();
    }
  }

  private getShop(): Shop {
    if (!this.shop) {
      const session = getSession();
      this.shop = new Shop(session.platform, session.meta);
    }
    return this.shop;
  }

  private closeUnlocks(): void {
    this.unlockPanel?.destroy();
    this.unlockPanel = null;
  }

  /** Leaderboard screen (task 21.3): today's top scores + own rank (Req 27.5). */
  private openLeaderboard(): void {
    if (this.lbPanel) return;
    this.closeUnlocks();
    this.buildLeaderboardPanel();
    void this.loadLeaderboard();
  }

  private async loadLeaderboard(): Promise<void> {
    const gen = ++this.lbGeneration;
    this.lbView = { kind: 'loading' };
    if (this.lbPanel) this.buildLeaderboardPanel();
    try {
      const session = getSession();
      await session.dailyReady;
      const res = await session.platform.getLeaderboard(DAILY_LEADERBOARD_MODE, {
        period: DAILY_LEADERBOARD_PERIOD,
        limit: 10,
      });
      if (gen !== this.lbGeneration || !this.scene.isActive(SCENE.title)) return;
      this.lbView = { kind: 'ready', top: res.top, me: res.me };
    } catch {
      if (gen !== this.lbGeneration || !this.scene.isActive(SCENE.title)) return;
      this.lbView = { kind: 'error' };
    }
    if (this.lbPanel) this.buildLeaderboardPanel();
  }

  private buildLeaderboardPanel(): void {
    this.closeLeaderboard();
    const session = getSession();
    const { width: W, height: H } = columnLayout(this);
    const cx = W / 2;
    const panelW = 640;
    const panelH = 1270;
    const top = H / 2 - panelH / 2;
    const items: Phaser.GameObjects.GameObject[] = [];
    const today = utcDateKey();

    items.push(this.add.rectangle(cx, H / 2, W, H, 0x000000, 0.72).setInteractive());
    const plate = this.add.graphics();
    plate.fillStyle(0x241442, 1);
    plate.fillRoundedRect(cx - panelW / 2, top, panelW, panelH, 28);
    plate.lineStyle(4, PALETTE.playerRim, 0.8);
    plate.strokeRoundedRect(cx - panelW / 2, top, panelW, panelH, 28);
    items.push(plate);
    const addText = (y: number, text: string, size: string, color: string, bold = false): void => {
      items.push(
        this.add
          .text(cx, y, text, {
            fontFamily: FONT,
            fontSize: size,
            color,
            ...(bold ? { fontStyle: 'bold' } : {}),
            align: 'center',
            wordWrap: { width: panelW - 60 },
          })
          .setOrigin(0.5),
      );
    };
    addText(top + 62, 'Daily Leaderboard', '46px', PALETTE.text, true);
    addText(top + 118, today, '28px', PALETTE.textDim);
    addText(top + 158, 'Score = survival sec x10 + kills + 5000 for victory', '22px', PALETTE.textDim);

    const view = this.lbView;
    if (view.kind === 'loading') {
      addText(top + 420, 'Loading scores…', '30px', PALETTE.text);
    } else if (view.kind === 'error') {
      addText(top + 400, "Couldn't load the leaderboard.", '30px', PALETTE.text);
      addText(top + 452, 'Check your connection and try again.', '24px', PALETTE.textDim);
    } else if (view.top.length === 0) {
      addText(top + 420, 'No scores yet today. Be the first!', '28px', PALETTE.text);
    } else {
      const left = cx - panelW / 2 + 44;
      const right = cx + panelW / 2 - 44;
      view.top.forEach((entry, i) => {
        const y = top + 252 + i * 62;
        items.push(
          this.add.text(left, y, `${entry.rank}. ${entry.name}`, { fontFamily: FONT, fontSize: '30px', color: PALETTE.text }).setOrigin(0, 0.5),
        );
        items.push(
          this.add
            .text(right, y, String(entry.score), { fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: '#ffd166' })
            .setOrigin(1, 0.5),
        );
      });
    }
    if (view.kind === 'ready') {
      addText(
        top + 920,
        view.me ? `You: #${view.me.rank} · ${view.me.score}` : 'You: not ranked yet today',
        '30px',
        '#ffd166',
        true,
      );
    }

    const pending = session.daily.state.pending;
    if (pending) {
      addText(top + 985, `Unsubmitted ranked score: ${pending.score} (${pending.date})`, '24px', PALETTE.text);
      const retryY = top + 1045;
      const retryPlate = this.add.graphics();
      retryPlate.fillStyle(0x3a2878, 1);
      retryPlate.fillRoundedRect(cx - 170, retryY - 36, 340, 72, 18);
      retryPlate.lineStyle(3, PALETTE.playerRim, 0.8);
      retryPlate.strokeRoundedRect(cx - 170, retryY - 36, 340, 72, 18);
      items.push(retryPlate);
      items.push(
        this.add
          .text(cx, retryY, 'Submit score', { fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: PALETTE.text })
          .setOrigin(0.5),
      );
      const retryZone = this.add.zone(cx, retryY, 340, 72).setInteractive({ useHandCursor: true });
      retryZone.on('pointerup', () => {
        this.unlockAudio();
        void this.retryPendingSubmit();
      });
      items.push(retryZone);
    }

    const btnY = top + panelH - 76;
    const mkBtn = (x: number, label: string, onTap: () => void): void => {
      const p = this.add.graphics();
      p.fillStyle(0x3a2878, 1);
      p.fillRoundedRect(x - 128, btnY - 42, 256, 84, 20);
      p.lineStyle(4, PALETTE.playerRim, 0.8);
      p.strokeRoundedRect(x - 128, btnY - 42, 256, 84, 20);
      items.push(p);
      items.push(
        this.add.text(x, btnY, label, { fontFamily: FONT, fontSize: '34px', fontStyle: 'bold', color: PALETTE.text }).setOrigin(0.5),
      );
      const z = this.add.zone(x, btnY, 256, 84).setInteractive({ useHandCursor: true });
      z.on('pointerup', () => {
        this.unlockAudio();
        onTap();
      });
      items.push(z);
    };
    mkBtn(cx - 146, 'Refresh', () => void this.loadLeaderboard());
    mkBtn(cx + 146, 'Close', () => this.closeLeaderboard());

    this.lbPanel = this.add.container(0, 0, items).setDepth(100);
  }

  private async retryPendingSubmit(): Promise<void> {
    const session = getSession();
    try {
      const outcome = await submitPendingDailyScore(session.platform, session.daily);
      if (!this.scene.isActive(SCENE.title)) return;
      if (outcome?.accepted) {
        this.showToast(outcome.rank ? `Score submitted · Rank #${outcome.rank}` : 'Score submitted');
        void this.loadLeaderboard();
      } else {
        this.showToast(outcome?.reason ? `Not recorded: ${outcome.reason}` : "Couldn't submit score — try again");
        if (this.lbPanel) this.buildLeaderboardPanel();
      }
    } catch {
      if (this.scene.isActive(SCENE.title)) this.showToast("Couldn't submit score — try again");
    }
  }

  private closeLeaderboard(): void {
    this.lbPanel?.destroy();
    this.lbPanel = null;
  }

  private startRun(): void {
    if (this.starting) return;
    this.starting = true;
    this.unlockAudio();
    const session = getSession();
    // Fill the screen on hosts that start the game in a constrained stage.
    // Synchronous gesture chain (tap -> startRun), so the host call is allowed.
    void session.platform.requestFullscreen();
    session.runMode = 'normal';
    session.dailyDate = null;
    session.pendingChallenge = null;
    session.challengeTarget = null;
    syncMetaBonuses(session);
    session.sim.restart(session.flags.seed);
    session.platform.track('run_started');
    if (!runStartedFired) {
      runStartedFired = true;
      session.platform.funnel(3, 'run_started', 'boot', 1);
    }
    this.scene.start(SCENE.game);
  }
}
