const TILE = 64;

class Menu extends Phaser.Scene {
  constructor() { super('Menu'); }

  preload() {
    this.load.json('levels', 'levels/index.json');
  }

  create() {
    this.add.text(260, 180, 'GOOFY PLATFORMER', { fontSize: '32px' });
    this.add.text(280, 240, 'CLICK TO START', { fontSize: '20px' });

    this.input.once('pointerdown', () => {
      const levels = this.cache.json.get('levels').levels;
      this.scene.start('Game', { level: levels[0] });
    });
  }
}

class Game extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) {
    this.levelName = data.level;
    this.spawn = { x: 100, y: 100 };
  }

  preload() {
    this.load.image('bg', 'assets/bg.png');
    this.load.image('tile', 'assets/tile.png');
    this.load.image('player', 'assets/player.png');
    this.load.image('enemy', 'assets/enemy.png');
    this.load.image('checkpoint', 'assets/checkpoint.png');

    this.load.audio('jump', 'assets/jump.wav');
    this.load.audio('bonk', 'assets/bonk.wav');
    this.load.audio('checkpointSound', 'assets/checkpoint.wav');

    this.load.json('level', `levels/${this.levelName}`);
  }

  create() {
    this.add.image(400, 225, 'bg');

    this.platforms = this.physics.add.staticGroup();
    this.enemies = this.physics.add.group();
    this.movers = this.physics.add.group({ allowGravity: false, immovable: true });
    this.checkpoints = this.physics.add.staticGroup();

    const level = this.cache.json.get('level');

    level.tiles.forEach(t =>
      this.platforms.create(t.x * TILE, t.y * TILE, 'tile')
        .setOrigin(0).refreshBody()
    );

    level.enemies?.forEach(e => {
      const enemy = this.enemies.create(e.x * TILE, e.y * TILE, 'enemy');
      enemy.setVelocityX(100).setBounce(1).setCollideWorldBounds(true);
    });

    level.checkpoints?.forEach(c =>
      this.checkpoints.create(c.x * TILE, c.y * TILE, 'checkpoint')
    );

    this.player = this.physics.add.sprite(this.spawn.x, this.spawn.y, 'player');
    this.player.setBounce(0.35);
    this.player.setDragX(800);
    this.player.setMaxVelocity(300, 900);
    this.player.setCollideWorldBounds(true);

    this.jumpSound = this.sound.add('jump');
    this.bonkSound = this.sound.add('bonk');
    this.checkSound = this.sound.add('checkpointSound');

    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.enemies, this.platforms);
    this.physics.add.collider(this.player, this.movers);

    this.physics.add.collider(this.player, this.enemies, (p, e) => {
      if (p.body.velocity.y > 0) {
        e.destroy();
        this.bonkSound.play();
        p.setVelocityY(-400);
      } else {
        this.respawn();
      }
    });

    this.physics.add.overlap(this.player, this.checkpoints, (_, c) => {
      this.spawn = { x: c.x, y: c.y };
      this.checkSound.play();
    });

    this.cursors = this.input.keyboard.createCursorKeys();
  }

  update() {
    if (this.cursors.left.isDown) this.player.setVelocityX(-220);
    else if (this.cursors.right.isDown) this.player.setVelocityX(220);
    else this.player.setVelocityX(0);

    if (this.cursors.up.isDown && this.player.body.touching.down) {
      this.player.setVelocityY(-600);
      this.jumpSound.play();
    }
  }

  respawn() {
    this.player.setPosition(this.spawn.x, this.spawn.y);
    this.player.setVelocity(0);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 450,
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 900 } }
  },
  scene: [Menu, Game]
});
