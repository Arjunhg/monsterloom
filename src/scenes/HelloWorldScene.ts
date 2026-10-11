import Phaser from 'phaser';
import RundotGameAPI from "@series-inc/rundot-game-sdk/api";

let bootStep2Fired = false;
let bootStep3Fired = false;
let bootStep4Fired = false;

export default class HelloWorldScene extends Phaser.Scene {
  private mainText!: Phaser.GameObjects.Text;
  private ball?: Phaser.GameObjects.Image;
  private clickButton!: Phaser.GameObjects.Text;

  constructor() {
    super("hello-world");
  }

  create(): void {
    RundotGameAPI.log("[HelloWorldScene] Create called - RundotGameAPI already initialized");

    const gameWidth = this.scale.width;
    const gameHeight = this.scale.height;
    const centerX = gameWidth / 2;
    const centerY = gameHeight / 2;

    // Simple background
    this.add.rectangle(centerX, centerY, gameWidth, gameHeight, 0x1a1a2e);

    // Add text
    this.mainText = this.add.text(centerX, centerY, "Loading asset…", {
      fontSize: "24px",
      color: "#ffffff",
      align: "center",
    });
    this.mainText.setOrigin(0.5);

    // Fetch sprite from CDN and create bouncing ball once loaded
    this.fetchAndCreateBall(centerX);

    // Update text and create button after delay
    this.time.delayedCall(1500, () => {
      this.mainText.setText("Bouncing Ball Template v.0.0.4.woof");
      this.createButton();
    });

    // Set up dialog close button listener
    const closeBtn = document.getElementById('close-dialog-btn');
    closeBtn?.addEventListener('click', () => this.hideDialog());
  }

  private async fetchAndCreateBall(centerX: number): Promise<void> {
    const blob = await RundotGameAPI.cdn.fetchAsset('circle.png');
    RundotGameAPI.analytics.recordCustomEvent('cdn_asset_loaded', { size: blob.size });
    if (!bootStep2Fired) {
      bootStep2Fired = true;
      RundotGameAPI.analytics.trackFunnelStep(2, 'cdn_asset_loaded', 'boot', 1);
    }
    const blobUrl = URL.createObjectURL(blob);
    RundotGameAPI.log(`[HelloWorldScene] Fetched CDN asset, blob size: ${blob.size}`);

    this.load.image('circle', blobUrl);
    this.load.once('complete', () => {
      URL.revokeObjectURL(blobUrl);

      this.ball = this.add.image(centerX, 200, 'circle');
      RundotGameAPI.analytics.recordCustomEvent('ball_visible');
      if (!bootStep3Fired) {
        bootStep3Fired = true;
        RundotGameAPI.analytics.trackFunnelStep(3, 'ball_visible', 'boot', 1);
      }
      this.ball.setDisplaySize(64, 64);

      this.physics.add.existing(this.ball);
      const body = this.ball.body as Phaser.Physics.Arcade.Body;
      body.setCollideWorldBounds(true);
      body.setBounce(1);
      body.setCircle(32);
      body.setVelocity(150, 200);

      // Tint-changing animation
      this.time.addEvent({
        delay: 1000,
        callback: () => {
          const tints = [0xff6666, 0x66ff66, 0x6666ff, 0xffffff, 0xff66ff, 0x66ffff];
          const randomTint = tints[Math.floor(Math.random() * tints.length)];
          this.ball?.setTint(randomTint);
        },
        loop: true,
      });
    });
    this.load.start();
  }

  update(): void {
    if (!this.ball) return;
    const body = this.ball.body as Phaser.Physics.Arcade.Body;
    const speed = Math.sqrt(body.velocity.x * body.velocity.x + body.velocity.y * body.velocity.y);
    if (speed > 0 && speed < 270) {
      const scale = 300 / speed;
      body.setVelocity(body.velocity.x * scale, body.velocity.y * scale);
    }
  }

  private createButton(): void {
    const gameWidth = this.scale.width;
    const gameHeight = this.scale.height;
    const centerX = gameWidth / 2;

    this.clickButton = this.add.text(centerX, gameHeight - 100, "Click me", {
      fontSize: "20px",
      color: "#ffffff",
      backgroundColor: "#e74c3c",
      padding: { x: 20, y: 10 },
    });
    this.clickButton.setOrigin(0.5);
    this.clickButton.setInteractive({ useHandCursor: true });

    this.clickButton.on("pointerdown", () => {
      RundotGameAPI.analytics.recordCustomEvent('button_clicked');
      if (!bootStep4Fired) {
        bootStep4Fired = true;
        RundotGameAPI.analytics.trackFunnelStep(4, 'first_button_click', 'boot', 1);
      }
      this.showDialog();
    });
  }

  private showDialog(): void {
    RundotGameAPI.analytics.recordCustomEvent('dialog_opened');
    const overlay = document.getElementById("dialog-overlay");
    if (overlay) {
      overlay.classList.remove("hidden");
    }
  }

  private hideDialog(): void {
    RundotGameAPI.analytics.recordCustomEvent('dialog_closed');
    const overlay = document.getElementById('dialog-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
    }
  }
}
