/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, Play, RotateCcw, Trophy, Maximize, Minimize, Zap } from 'lucide-react';

// --- Constants ---
const CANVAS_WIDTH = 540;
const CANVAS_HEIGHT = 960;
const PLAYER_WIDTH = 40;
const PLAYER_HEIGHT = 40;
const ENEMY_RADIUS = 15;
const PLAYER_BULLET_WIDTH = 4;
const PLAYER_BULLET_HEIGHT = 15;
const ENEMY_BULLET_RADIUS = 4;
const ENEMY_COUNT_BASE = 10;
const PLAYER_SPEED = 5;
const PLAYER_BULLET_SPEED = 7;
const ENEMY_BULLET_SPEED_BASE = 4;
const ENEMY_MIN_SPEED = 1;
const ENEMY_MAX_SPEED_BASE = 3;
const SHOOT_COOLDOWN = 250; // ms
const KILLS_PER_STAGE = 10;

// --- Types ---
type GameState = 'START' | 'PLAYING' | 'GAMEOVER' | 'STAGE_CLEAR';
type EnemyType = 'BASIC' | 'WAVE' | 'DIVER' | 'BOSS' | 'VENOM' | 'RAIDER' | 'DRONE' | 'WASPER' | 'MICRO';
type DiverState = 'NORMAL' | 'DIVING' | 'RETURNING';
type BossState = 'ENTERING' | 'IDLE' | 'SPREAD' | 'CIRCLE';

// --- Audio Engine ---
class SoundEngine {
  ctx: AudioContext | null = null;
  bgmInterval: number | null = null;
  isPlayingBgm = false;

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  playShoot() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(600, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }

  playExplosion() {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 0.2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.2);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start();
  }

  playHit() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(50, this.ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  }

  playStageClear() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [440, 554, 659, 880].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      gain.gain.setValueAtTime(0.1, now + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.3);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.3);
    });
  }

  playBonus() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      gain.gain.setValueAtTime(0.1, now + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.2);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.2);
    });
  }

  playBGM() {
    if (!this.ctx || this.isPlayingBgm) return;
    this.isPlayingBgm = true;
    
    // Fast-paced arcade bassline (16th notes)
    const bassNotes = [
      110, 110, 220, 110, 130.81, 130.81, 261.63, 130.81,
      146.83, 146.83, 293.66, 146.83, 164.81, 164.81, 329.63, 164.81
    ];
    
    // Melody (8th notes)
    const melodyNotes = [
      440, 0, 523.25, 0, 659.25, 0, 523.25, 0,
      587.33, 0, 698.46, 0, 880, 0, 698.46, 0
    ];
    
    let step = 0;
    const tempo = 130; // BPM
    const stepDuration = 60 / tempo / 4; // 16th note duration in seconds
    
    const playStep = () => {
      if (!this.isPlayingBgm || !this.ctx) return;
      
      const now = this.ctx.currentTime;
      
      // Play Bass
      const bassFreq = bassNotes[step % bassNotes.length];
      const bassOsc = this.ctx.createOscillator();
      const bassGain = this.ctx.createGain();
      bassOsc.type = 'sawtooth';
      bassOsc.frequency.setValueAtTime(bassFreq, now);
      
      bassGain.gain.setValueAtTime(0.04, now);
      bassGain.gain.exponentialRampToValueAtTime(0.001, now + stepDuration * 0.9);
      
      bassOsc.connect(bassGain);
      bassGain.connect(this.ctx.destination);
      bassOsc.start(now);
      bassOsc.stop(now + stepDuration);
      
      // Play Melody (every other step for 8th notes)
      if (step % 2 === 0) {
        const melodyFreq = melodyNotes[(step / 2) % melodyNotes.length];
        if (melodyFreq > 0) {
          const melodyOsc = this.ctx.createOscillator();
          const melodyGain = this.ctx.createGain();
          melodyOsc.type = 'square';
          melodyOsc.frequency.setValueAtTime(melodyFreq, now);
          
          melodyGain.gain.setValueAtTime(0.02, now);
          melodyGain.gain.exponentialRampToValueAtTime(0.001, now + stepDuration * 1.8);
          
          melodyOsc.connect(melodyGain);
          melodyGain.connect(this.ctx.destination);
          melodyOsc.start(now);
          melodyOsc.stop(now + stepDuration * 2);
        }
      }
      
      // Play Drum (Kick on beats, Hi-hat on off-beats)
      if (step % 4 === 0) {
        // Kick
        const kickOsc = this.ctx.createOscillator();
        const kickGain = this.ctx.createGain();
        kickOsc.type = 'sine';
        kickOsc.frequency.setValueAtTime(150, now);
        kickOsc.frequency.exponentialRampToValueAtTime(0.01, now + 0.1);
        kickGain.gain.setValueAtTime(0.1, now);
        kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        kickOsc.connect(kickGain);
        kickGain.connect(this.ctx.destination);
        kickOsc.start(now);
        kickOsc.stop(now + 0.1);
      } else if (step % 2 === 0) {
        // Hi-hat (noise)
        const bufferSize = this.ctx.sampleRate * 0.05;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.value = 7000;
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.02, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);
        noise.start(now);
      }
      
      step++;
      this.bgmInterval = window.setTimeout(playStep, stepDuration * 1000);
    };
    
    playStep();
  }

  stopBGM() {
    this.isPlayingBgm = false;
    if (this.bgmInterval) clearTimeout(this.bgmInterval);
  }
}

const sound = new SoundEngine();

interface Entity {
  x: number;
  y: number;
}

interface Player extends Entity {
  weaponType: 'DEFAULT' | 'RAPID' | 'SPREAD';
  weaponTimer: number;
  shield: boolean;
}

type PowerUpType = 'RAPID' | 'SPREAD' | 'SHIELD' | 'LIFE';

interface PowerUp extends Entity {
  type: PowerUpType;
  vy: number;
  width: number;
  height: number;
}

interface Enemy extends Entity {
  type: EnemyType;
  vx: number;
  vy: number;
  lastShot: number;
  shootInterval: number;
  // Wave properties
  originalX: number;
  phase: number;
  // Diver properties
  diverState: DiverState;
  diveTargetX: number;
  diveTargetY: number;
  lastDiveTime: number;
  // Boss properties
  hp: number;
  maxHp: number;
  bossState?: BossState;
  bossTimer?: number;
  bossAngle?: number;
  active: boolean;
}

interface Bullet extends Entity {
  active: boolean;
  vx?: number;
  vy?: number;
  radius?: number;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  life: number;
  maxLife: number;
  color: string;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [gameState, setGameState] = useState<GameState>('START');
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [stage, setStage] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentPage, setCurrentPage] = useState<'home' | 'privacy' | 'terms' | 'contact'>('home');
  const [highScore, setHighScore] = useState(() => {
    const saved = localStorage.getItem('galactic_defender_highscore');
    return saved ? parseInt(saved, 10) : 0;
  });
  
  // Game Refs for mutable state to avoid re-renders and stale closures in game loop
  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const stageRef = useRef(1);
  const killsInStageRef = useRef(0);
  
  const playerRef = useRef<Player>({ 
    x: CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2, 
    y: CANVAS_HEIGHT - 60,
    weaponType: 'DEFAULT',
    weaponTimer: 0,
    shield: false
  });
  const powerUpsRef = useRef<PowerUp[]>([]);
  const enemiesRef = useRef<Enemy[]>([]);
  const playerBulletsRef = useRef<Bullet[]>([]);
  const enemyBulletsRef = useRef<Bullet[]>([]);
  const floatingTextsRef = useRef<FloatingText[]>([]);
  const keysRef = useRef<Record<string, boolean>>({});
  const lastShotRef = useRef(0);
  const requestRef = useRef<number>(null);

  // Sync refs to state for UI rendering
  const syncState = () => {
    setScore(scoreRef.current);
    setLives(livesRef.current);
    setStage(stageRef.current);
  };

  // Initialize Enemies
  const createEnemy = (yOffset: number = 0, isBoss: boolean = false): Enemy => {
    const currentStage = stageRef.current;

    if (isBoss) {
      const maxHp = 50 + currentStage * 10;
      return {
        x: CANVAS_WIDTH / 2,
        y: -100,
        type: 'BOSS',
        vx: 2,
        vy: 1,
        lastShot: Date.now(),
        shootInterval: 2000,
        originalX: CANVAS_WIDTH / 2,
        phase: 0,
        diverState: 'NORMAL',
        diveTargetX: 0,
        diveTargetY: 0,
        lastDiveTime: 0,
        hp: maxHp,
        maxHp: maxHp,
        bossState: 'ENTERING',
        bossTimer: Date.now(),
        bossAngle: 0,
        active: true
      };
    }

    const types: EnemyType[] = ['BASIC', 'WAVE', 'DIVER', 'VENOM', 'RAIDER', 'DRONE', 'WASPER', 'MICRO'];
    const type = types[Math.floor(Math.random() * types.length)];
    const x = Math.random() * (CANVAS_WIDTH - ENEMY_RADIUS * 2) + ENEMY_RADIUS;
    const y = yOffset || Math.random() * (CANVAS_HEIGHT / 2);
    
    const stageSpeedMult = 1 + (currentStage - 1) * 0.1;
    
    let typeSpeedMult = 1;
    if (type === 'WAVE') typeSpeedMult = 1.5;
    if (type === 'DIVER') typeSpeedMult = 2.0;
    if (type === 'VENOM') typeSpeedMult = 0.8;
    if (type === 'RAIDER') typeSpeedMult = 1.2;
    if (type === 'DRONE') typeSpeedMult = 1.8;
    if (type === 'WASPER') typeSpeedMult = 2.0;
    if (type === 'MICRO') typeSpeedMult = 1.5;

    const finalSpeedMult = stageSpeedMult * typeSpeedMult;
    
    let hp = 1;
    if (type === 'VENOM' || type === 'RAIDER') hp = 3;
    if (type === 'DRONE') hp = 2;

    return {
      x,
      y,
      type,
      vx: (Math.random() > 0.5 ? 1 : -1) * (ENEMY_MIN_SPEED + Math.random() * (ENEMY_MAX_SPEED_BASE - ENEMY_MIN_SPEED)) * finalSpeedMult,
      vy: (Math.random() > 0.5 ? 1 : -1) * (ENEMY_MIN_SPEED + Math.random() * (ENEMY_MAX_SPEED_BASE - ENEMY_MIN_SPEED)) * finalSpeedMult,
      lastShot: Date.now() + Math.random() * 2000,
      shootInterval: Math.max(300, 1500 - (currentStage * 200)) + Math.random() * Math.max(500, 3000 - (currentStage * 300)),
      originalX: x,
      phase: Math.random() * Math.PI * 2,
      diverState: 'NORMAL',
      diveTargetX: 0,
      diveTargetY: 0,
      lastDiveTime: Date.now() + Math.random() * 5000,
      hp,
      maxHp: hp,
      active: true
    };
  };

  const initEnemies = () => {
    const enemies: Enemy[] = [];
    const currentStage = stageRef.current;
    
    if (currentStage % 5 === 0) {
      enemies.push(createEnemy(0, true));
    } else {
      const count = ENEMY_COUNT_BASE + Math.floor(currentStage / 2);
      for (let i = 0; i < count; i++) {
        enemies.push(createEnemy());
      }
    }
    enemiesRef.current = enemies;
  };

  const startGame = () => {
    sound.init();
    sound.playBGM();
    scoreRef.current = 0;
    livesRef.current = 3;
    stageRef.current = 1;
    killsInStageRef.current = 0;
    syncState();
    
    setGameState('PLAYING');
    playerRef.current = { 
      x: CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2, 
      y: CANVAS_HEIGHT - 60,
      weaponType: 'DEFAULT',
      weaponTimer: 0,
      shield: false
    };
    playerBulletsRef.current = [];
    enemyBulletsRef.current = [];
    powerUpsRef.current = [];
    initEnemies();
  };

  const startNextStage = () => {
    killsInStageRef.current = 0;
    syncState();
    setGameState('PLAYING');
    playerBulletsRef.current = [];
    enemyBulletsRef.current = [];
    powerUpsRef.current = [];
    initEnemies();
  };

  const gameOver = () => {
    setGameState('GAMEOVER');
    sound.stopBGM();
    if (scoreRef.current > highScore) {
      setHighScore(scoreRef.current);
      localStorage.setItem('galactic_defender_highscore', scoreRef.current.toString());
    }
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Input Handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { 
      keysRef.current[e.key] = true; 
      if (e.key === ' ') e.preventDefault();
    };
    const handleKeyUp = (e: KeyboardEvent) => { keysRef.current[e.key] = false; };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Game Loop
  const update = () => {
    if (gameState !== 'PLAYING') return;

    // Update floating texts
    floatingTextsRef.current.forEach(ft => {
      ft.y -= 1;
      ft.life -= 1;
    });
    floatingTextsRef.current = floatingTextsRef.current.filter(ft => ft.life > 0);

    // 1. Player Movement
    if (keysRef.current['ArrowLeft'] || keysRef.current['a']) {
      playerRef.current.x = Math.max(0, playerRef.current.x - PLAYER_SPEED);
    }
    if (keysRef.current['ArrowRight'] || keysRef.current['d']) {
      playerRef.current.x = Math.min(CANVAS_WIDTH - PLAYER_WIDTH, playerRef.current.x + PLAYER_SPEED);
    }
    if (keysRef.current['ArrowUp'] || keysRef.current['w']) {
      playerRef.current.y = Math.max(0, playerRef.current.y - PLAYER_SPEED);
    }
    if (keysRef.current['ArrowDown'] || keysRef.current['s']) {
      playerRef.current.y = Math.min(CANVAS_HEIGHT - PLAYER_HEIGHT, playerRef.current.y + PLAYER_SPEED);
    }
    
    // 2. Player Shooting
    if (keysRef.current[' '] || keysRef.current['Control']) {
      const now = Date.now();
      const cooldown = playerRef.current.weaponType === 'RAPID' ? SHOOT_COOLDOWN / 2 : SHOOT_COOLDOWN;
      
      if (now - lastShotRef.current > cooldown) {
        if (playerRef.current.weaponType === 'SPREAD') {
          playerBulletsRef.current.push(
            { x: playerRef.current.x + PLAYER_WIDTH / 2 - PLAYER_BULLET_WIDTH / 2, y: playerRef.current.y, active: true, vx: 0, vy: -PLAYER_BULLET_SPEED },
            { x: playerRef.current.x + PLAYER_WIDTH / 2 - PLAYER_BULLET_WIDTH / 2, y: playerRef.current.y, active: true, vx: -2, vy: -PLAYER_BULLET_SPEED },
            { x: playerRef.current.x + PLAYER_WIDTH / 2 - PLAYER_BULLET_WIDTH / 2, y: playerRef.current.y, active: true, vx: 2, vy: -PLAYER_BULLET_SPEED }
          );
        } else {
          playerBulletsRef.current.push({
            x: playerRef.current.x + PLAYER_WIDTH / 2 - PLAYER_BULLET_WIDTH / 2,
            y: playerRef.current.y,
            active: true,
            vx: 0,
            vy: -PLAYER_BULLET_SPEED
          });
        }
        lastShotRef.current = now;
        sound.playShoot();
      }
    }

    // 3. Update Player Bullets
    playerBulletsRef.current.forEach(bullet => {
      bullet.x += bullet.vx || 0;
      bullet.y += bullet.vy || -PLAYER_BULLET_SPEED;
      if (bullet.y < -20 || bullet.x < -20 || bullet.x > CANVAS_WIDTH + 20) bullet.active = false;
    });
    playerBulletsRef.current = playerBulletsRef.current.filter(b => b.active);

    // 4. Update Enemies
    enemiesRef.current.forEach(enemy => {
      if (enemy.type === 'BASIC') {
        enemy.x += enemy.vx;
        enemy.y += enemy.vy;
        if (enemy.x < ENEMY_RADIUS || enemy.x > CANVAS_WIDTH - ENEMY_RADIUS) enemy.vx *= -1;
        if (enemy.y < ENEMY_RADIUS || enemy.y > CANVAS_HEIGHT / 2) enemy.vy *= -1;
      } else if (enemy.type === 'WAVE') {
        enemy.phase += 0.05 * (stageRef.current * 0.1 + 1) * 1.5;
        enemy.y += enemy.vy * 0.5;
        enemy.x = enemy.originalX + Math.sin(enemy.phase) * 50;
        if (enemy.y < ENEMY_RADIUS || enemy.y > CANVAS_HEIGHT / 2) enemy.vy *= -1;
      } else if (enemy.type === 'DIVER') {
        const now = Date.now();
        if (enemy.diverState === 'NORMAL') {
          enemy.x += enemy.vx;
          enemy.y += enemy.vy;
          if (enemy.x < ENEMY_RADIUS || enemy.x > CANVAS_WIDTH - ENEMY_RADIUS) enemy.vx *= -1;
          if (enemy.y < ENEMY_RADIUS || enemy.y > CANVAS_HEIGHT / 2) enemy.vy *= -1;

          // Start dive occasionally
          if (now - enemy.lastDiveTime > 5000 && Math.random() < 0.01) {
            enemy.diverState = 'DIVING';
            enemy.diveTargetX = playerRef.current.x + PLAYER_WIDTH / 2;
            enemy.diveTargetY = playerRef.current.y + PLAYER_HEIGHT / 2;
          }
        } else if (enemy.diverState === 'DIVING') {
          const dx = enemy.diveTargetX - enemy.x;
          const dy = enemy.diveTargetY - enemy.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 5) {
            enemy.diverState = 'RETURNING';
            enemy.diveTargetY = Math.random() * (CANVAS_HEIGHT / 2);
          } else {
            enemy.x += (dx / dist) * 8;
            enemy.y += (dy / dist) * 8;
          }
        } else if (enemy.diverState === 'RETURNING') {
          const dy = enemy.diveTargetY - enemy.y;
          if (Math.abs(dy) < 5) {
            enemy.diverState = 'NORMAL';
            enemy.lastDiveTime = now;
          } else {
            enemy.y += (dy / Math.abs(dy)) * 4;
          }
        }
      } else if (enemy.type === 'VENOM') {
        enemy.x += enemy.vx * 0.5;
        enemy.y += enemy.vy * 0.2;
        if (enemy.x < ENEMY_RADIUS || enemy.x > CANVAS_WIDTH - ENEMY_RADIUS) enemy.vx *= -1;
        if (enemy.y < ENEMY_RADIUS || enemy.y > CANVAS_HEIGHT / 3) enemy.vy *= -1;
      } else if (enemy.type === 'RAIDER') {
        enemy.y += Math.max(0.5, enemy.vy * 0.5);
        if (enemy.y > CANVAS_HEIGHT + ENEMY_RADIUS) {
          enemy.y = -ENEMY_RADIUS;
          enemy.x = Math.random() * (CANVAS_WIDTH - ENEMY_RADIUS * 2) + ENEMY_RADIUS;
        }
      } else if (enemy.type === 'DRONE') {
        enemy.phase += 0.1;
        enemy.y += Math.abs(enemy.vy) * 0.8;
        enemy.x += Math.sin(enemy.phase) * 3;
        if (enemy.x < ENEMY_RADIUS || enemy.x > CANVAS_WIDTH - ENEMY_RADIUS) enemy.phase += Math.PI;
        if (enemy.y > CANVAS_HEIGHT + ENEMY_RADIUS) {
          enemy.y = -ENEMY_RADIUS;
          enemy.x = Math.random() * (CANVAS_WIDTH - ENEMY_RADIUS * 2) + ENEMY_RADIUS;
        }
      } else if (enemy.type === 'WASPER') {
        enemy.phase += 0.15;
        enemy.y += Math.abs(enemy.vy) * 1.2;
        enemy.x = enemy.originalX + Math.sin(enemy.phase) * 80;
        if (enemy.y > CANVAS_HEIGHT + ENEMY_RADIUS) {
          enemy.y = -ENEMY_RADIUS;
          enemy.x = Math.random() * (CANVAS_WIDTH - ENEMY_RADIUS * 2) + ENEMY_RADIUS;
          enemy.originalX = enemy.x;
        }
      } else if (enemy.type === 'MICRO') {
        enemy.y += Math.abs(enemy.vy) * 0.8;
        enemy.x += enemy.vx * 1.2;
        if (enemy.x < ENEMY_RADIUS || enemy.x > CANVAS_WIDTH - ENEMY_RADIUS) enemy.vx *= -1;
        if (enemy.y > CANVAS_HEIGHT + ENEMY_RADIUS) {
          enemy.y = -ENEMY_RADIUS;
          enemy.x = Math.random() * (CANVAS_WIDTH - ENEMY_RADIUS * 2) + ENEMY_RADIUS;
        }
      } else if (enemy.type === 'BOSS') {
        const now = Date.now();
        if (enemy.bossState === 'ENTERING') {
          enemy.y += 1;
          if (enemy.y >= 100) {
            enemy.bossState = 'IDLE';
            enemy.bossTimer = now;
          }
        } else {
          // Hover left and right
          enemy.x += enemy.vx;
          if (enemy.x < 50 || enemy.x > CANVAS_WIDTH - 50) {
            enemy.vx *= -1;
          }

          // State machine for attacks
          if (now - (enemy.bossTimer || 0) > 3000) {
            const states: BossState[] = ['SPREAD', 'CIRCLE'];
            enemy.bossState = states[Math.floor(Math.random() * states.length)];
            enemy.bossTimer = now;
            enemy.bossAngle = 0;
          }

          // Execute attacks
          if (enemy.bossState === 'SPREAD' && now - enemy.lastShot > 800) {
            for (let i = -2; i <= 2; i++) {
              enemyBulletsRef.current.push({
                x: enemy.x,
                y: enemy.y + 40,
                vx: i * 2,
                vy: 4,
                active: true
              });
            }
            enemy.lastShot = now;
          } else if (enemy.bossState === 'CIRCLE' && now - enemy.lastShot > 400) {
            for (let i = 0; i < 12; i++) {
              const angle = (Math.PI * 2 / 12) * i + (enemy.bossAngle || 0);
              enemyBulletsRef.current.push({
                x: enemy.x,
                y: enemy.y + 40,
                vx: Math.cos(angle) * 3,
                vy: Math.sin(angle) * 3,
                active: true
              });
            }
            enemy.bossAngle = (enemy.bossAngle || 0) + 0.2;
            enemy.lastShot = now;
          }
        }
      }

      // Enemy Shooting (for non-boss)
      if (enemy.type !== 'BOSS') {
        const now = Date.now();
        if (now - enemy.lastShot > enemy.shootInterval) {
          if (enemy.type === 'VENOM') {
            for (let i = -1; i <= 1; i++) {
              enemyBulletsRef.current.push({
                x: enemy.x,
                y: enemy.y + ENEMY_RADIUS,
                vx: i * 2,
                vy: ENEMY_BULLET_SPEED_BASE + (stageRef.current * 0.2),
                active: true
              });
            }
          } else if (enemy.type === 'RAIDER') {
            enemyBulletsRef.current.push({
              x: enemy.x - 10,
              y: enemy.y + ENEMY_RADIUS,
              vx: 0,
              vy: ENEMY_BULLET_SPEED_BASE + (stageRef.current * 0.2),
              active: true
            });
            enemyBulletsRef.current.push({
              x: enemy.x + 10,
              y: enemy.y + ENEMY_RADIUS,
              vx: 0,
              vy: ENEMY_BULLET_SPEED_BASE + (stageRef.current * 0.2),
              active: true
            });
            enemyBulletsRef.current.push({
              x: enemy.x,
              y: enemy.y + ENEMY_RADIUS,
              vx: 0,
              vy: (ENEMY_BULLET_SPEED_BASE + (stageRef.current * 0.2)) * 0.6,
              active: true,
              radius: 6
            });
          } else if (enemy.type === 'DRONE') {
            for (let i = 0; i < 3; i++) {
              enemyBulletsRef.current.push({
                x: enemy.x + (Math.random() - 0.5) * 20,
                y: enemy.y + ENEMY_RADIUS + (Math.random() * 10),
                vx: (Math.random() - 0.5) * 3,
                vy: ENEMY_BULLET_SPEED_BASE + (stageRef.current * 0.2) + Math.random() * 2,
                active: true
              });
            }
          } else if (enemy.type === 'WASPER') {
            const speed = ENEMY_BULLET_SPEED_BASE + (stageRef.current * 0.2);
            enemyBulletsRef.current.push({
              x: enemy.x - 5,
              y: enemy.y + ENEMY_RADIUS,
              vx: -1.5,
              vy: speed,
              active: true,
              radius: 3
            });
            enemyBulletsRef.current.push({
              x: enemy.x + 5,
              y: enemy.y + ENEMY_RADIUS,
              vx: 1.5,
              vy: speed,
              active: true,
              radius: 3
            });
          } else if (enemy.type === 'MICRO') {
            const speed = ENEMY_BULLET_SPEED_BASE + (stageRef.current * 0.2) - 1;
            for (let i = -1; i <= 1; i++) {
              enemyBulletsRef.current.push({
                x: enemy.x,
                y: enemy.y + ENEMY_RADIUS,
                vx: i * 2.5 + (Math.random() - 0.5),
                vy: speed + Math.random(),
                active: true,
                radius: 2
              });
            }
          } else {
            enemyBulletsRef.current.push({
              x: enemy.x,
              y: enemy.y + ENEMY_RADIUS,
              active: true
            });
          }
          enemy.lastShot = now;
        }
      }
    });

    // 5. Update Enemy Bullets
    enemyBulletsRef.current.forEach(bullet => {
      if (bullet.vx !== undefined && bullet.vy !== undefined) {
        bullet.x += bullet.vx;
        bullet.y += bullet.vy;
      } else {
        bullet.y += ENEMY_BULLET_SPEED_BASE + (stageRef.current * 0.2);
      }
      if (bullet.y > CANVAS_HEIGHT + 20 || bullet.x < -20 || bullet.x > CANVAS_WIDTH + 20) bullet.active = false;
    });
    enemyBulletsRef.current = enemyBulletsRef.current.filter(b => b.active);

    // 6. Collision Detection: Player Bullets vs Enemies
    playerBulletsRef.current.forEach(bullet => {
      if (!bullet.active) return;
      enemiesRef.current.forEach(enemy => {
        if (!enemy.active) return;
        const hitRadius = (enemy.type === 'BOSS' ? 40 : ENEMY_RADIUS) * 1.5; // Made enemy hitbox 50% larger
        const dx = bullet.x - enemy.x;
        const dy = bullet.y - enemy.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < hitRadius) {
          bullet.active = false;
          
          enemy.hp -= 1;
          if (enemy.hp <= 0) {
            enemy.active = false;
            
            // Drop power-up (15% chance, or 100% for boss)
            if (Math.random() < 0.15 || enemy.type === 'BOSS') {
              const types: PowerUpType[] = ['RAPID', 'SPREAD', 'SHIELD', 'LIFE'];
              const type = types[Math.floor(Math.random() * types.length)];
              powerUpsRef.current.push({
                x: enemy.x,
                y: enemy.y,
                type,
                vy: 2,
                width: 20,
                height: 20
              });
            }
            
            let points = 10;
            if (enemy.type === 'WAVE') points = 20;
            if (enemy.type === 'DIVER') points = 30;
            if (enemy.type === 'VENOM') points = 40;
            if (enemy.type === 'RAIDER') points = 50;
            if (enemy.type === 'DRONE') points = 35;
            if (enemy.type === 'WASPER') points = 20;
            if (enemy.type === 'MICRO') points = 15;
            if (enemy.type === 'BOSS') points = 500;
            
            scoreRef.current += points;
            
            floatingTextsRef.current.push({
              x: enemy.x,
              y: enemy.y,
              text: `+${points}`,
              life: 30,
              maxLife: 30,
              color: '#fff'
            });
            
            if (scoreRef.current % 1000 < points && scoreRef.current >= 1000) {
              livesRef.current += 1;
              sound.playBonus();
              floatingTextsRef.current.push({
                x: playerRef.current.x + PLAYER_WIDTH / 2,
                y: playerRef.current.y - 20,
                text: 'BONUS LIFE!',
                life: 60,
                maxLife: 60,
                color: '#fbbf24'
              });
            }
            
            sound.playExplosion();
            syncState();
          } else {
            sound.playHit();
          }
        }
      });
    });

    // 7. Collision Detection: Enemy Bullets vs Player
    enemyBulletsRef.current.forEach(bullet => {
      if (!bullet.active) return;
      const paddingX = PLAYER_WIDTH * 0.3; // Reduce player hitbox width by 60%
      const paddingY = PLAYER_HEIGHT * 0.3; // Reduce player hitbox height by 60%
      if (
        bullet.x > playerRef.current.x + paddingX &&
        bullet.x < playerRef.current.x + PLAYER_WIDTH - paddingX &&
        bullet.y > playerRef.current.y + paddingY &&
        bullet.y < playerRef.current.y + PLAYER_HEIGHT - paddingY
      ) {
        bullet.active = false;
        if (playerRef.current.shield) {
          playerRef.current.shield = false;
          sound.playHit(); // Or a specific shield break sound
        } else {
          sound.playHit();
          livesRef.current -= 1;
          if (livesRef.current <= 0) {
            gameOver();
          }
          syncState();
        }
      }
    });

    // 8. Collision Detection: Enemy vs Player
    enemiesRef.current.forEach(enemy => {
      if (!enemy.active) return;
      const hitRadius = enemy.type === 'BOSS' ? 40 : ENEMY_RADIUS;
      const paddingX = PLAYER_WIDTH * 0.2; // Reduce player collision box
      const paddingY = PLAYER_HEIGHT * 0.2;
      if (
        enemy.x + hitRadius > playerRef.current.x + paddingX &&
        enemy.x - hitRadius < playerRef.current.x + PLAYER_WIDTH - paddingX &&
        enemy.y + hitRadius > playerRef.current.y + paddingY &&
        enemy.y - hitRadius < playerRef.current.y + PLAYER_HEIGHT - paddingY
      ) {
        if (playerRef.current.shield) {
          playerRef.current.shield = false;
          sound.playHit();
        } else {
          sound.playHit();
          livesRef.current -= 1;
          if (livesRef.current <= 0) {
            gameOver();
          }
          syncState();
        }
        if (enemy.type !== 'BOSS') {
          enemy.active = false;
        }
      }
    });

    // 9. Power-ups Update and Collision
    powerUpsRef.current.forEach(pu => {
      pu.y += pu.vy;
      
      // Collision with player
      if (
        pu.x < playerRef.current.x + PLAYER_WIDTH &&
        pu.x + pu.width > playerRef.current.x &&
        pu.y < playerRef.current.y + PLAYER_HEIGHT &&
        pu.y + pu.height > playerRef.current.y
      ) {
        pu.y = CANVAS_HEIGHT + 100; // Move off-screen to be filtered out
        sound.playBonus();
        
        let text = '';
        let color = '#fff';
        
        switch (pu.type) {
          case 'RAPID':
            playerRef.current.weaponType = 'RAPID';
            playerRef.current.weaponTimer = 300; // 5 seconds at 60fps
            text = 'RAPID FIRE!';
            color = '#f59e0b';
            break;
          case 'SPREAD':
            playerRef.current.weaponType = 'SPREAD';
            playerRef.current.weaponTimer = 300;
            text = 'SPREAD SHOT!';
            color = '#ef4444';
            break;
          case 'SHIELD':
            playerRef.current.shield = true;
            text = 'SHIELD ACTIVE!';
            color = '#3b82f6';
            break;
          case 'LIFE':
            livesRef.current += 1;
            syncState();
            text = '1UP!';
            color = '#10b981';
            break;
        }
        
        floatingTextsRef.current.push({
          x: playerRef.current.x + PLAYER_WIDTH / 2,
          y: playerRef.current.y - 20,
          text,
          life: 60,
          maxLife: 60,
          color
        });
      }
    });
    
    // Filter out off-screen power-ups
    powerUpsRef.current = powerUpsRef.current.filter(pu => pu.y < CANVAS_HEIGHT);

    // Update player weapon timer
    if (playerRef.current.weaponTimer > 0) {
      playerRef.current.weaponTimer -= 1;
      if (playerRef.current.weaponTimer <= 0) {
        playerRef.current.weaponType = 'DEFAULT';
      }
    }

    // 10. Filter out dead enemies and check for stage clear
    enemiesRef.current = enemiesRef.current.filter(e => e.active);
    
    if (enemiesRef.current.length === 0 && gameState === 'PLAYING') {
      setGameState('STAGE_CLEAR');
      stageRef.current += 1;
      sound.playStageClear();
      syncState();
    }
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw Stars (Scrolling Background)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    for (let i = 0; i < 50; i++) {
      const x = (Math.sin(i * 123.45) * 0.5 + 0.5) * CANVAS_WIDTH;
      const y = ((Date.now() * 0.1 + i * 100) % CANVAS_HEIGHT);
      ctx.fillRect(x, y, 2, 2);
    }

    if (gameState === 'PLAYING') {
      // Draw Player (Blue/Gold Fighter)
      ctx.save();
      ctx.translate(playerRef.current.x + PLAYER_WIDTH / 2, playerRef.current.y + PLAYER_HEIGHT / 2);
      // Wings
      ctx.fillStyle = '#eab308'; // Gold
      ctx.beginPath();
      ctx.moveTo(-20, 5);
      ctx.lineTo(20, 5);
      ctx.lineTo(15, 15);
      ctx.lineTo(-15, 15);
      ctx.fill();
      // Body
      ctx.fillStyle = '#2563eb'; // Blue
      ctx.beginPath();
      ctx.moveTo(0, -20);
      ctx.lineTo(8, 0);
      ctx.lineTo(5, 20);
      ctx.lineTo(-5, 20);
      ctx.lineTo(-8, 0);
      ctx.fill();
      // Cockpit
      ctx.fillStyle = '#93c5fd'; // Light blue
      ctx.beginPath();
      ctx.ellipse(0, -5, 3, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      
      // Shield
      if (playerRef.current.shield) {
        ctx.strokeStyle = '#3b82f6'; // Blue shield
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 25, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
        ctx.fill();
      }
      
      ctx.restore();

      // Draw Enemies
      enemiesRef.current.forEach(enemy => {
        ctx.save();
        ctx.translate(enemy.x, enemy.y);
        
        if (enemy.type === 'BASIC') {
          // Red Scout
          ctx.fillStyle = '#991b1b'; // Dark Red Wings
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(15, -10);
          ctx.lineTo(15, -15);
          ctx.lineTo(0, -5);
          ctx.lineTo(-15, -15);
          ctx.lineTo(-15, -10);
          ctx.fill();
          
          ctx.fillStyle = '#ef4444'; // Red Body
          ctx.beginPath();
          ctx.moveTo(0, 15);
          ctx.lineTo(8, -10);
          ctx.lineTo(0, -15);
          ctx.lineTo(-8, -10);
          ctx.fill();
          
          ctx.fillStyle = '#fca5a5'; // Cockpit
          ctx.beginPath();
          ctx.arc(0, 2, 3, 0, Math.PI * 2);
          ctx.fill();
        } else if (enemy.type === 'WAVE') {
          // Green Bomber
          ctx.fillStyle = '#14532d'; // Dark Green Wings
          ctx.fillRect(-20, -5, 40, 10);
          
          ctx.fillStyle = '#166534'; // Green Body
          ctx.beginPath();
          ctx.moveTo(0, 15);
          ctx.lineTo(10, -15);
          ctx.lineTo(0, -20);
          ctx.lineTo(-10, -15);
          ctx.fill();
          
          ctx.fillStyle = '#86efac'; // Cockpit
          ctx.fillRect(-4, -2, 8, 8);
        } else if (enemy.type === 'DIVER') {
          // Purple Elite
          ctx.fillStyle = '#7e22ce'; // Purple Wings
          ctx.beginPath();
          ctx.moveTo(0, 5);
          ctx.lineTo(20, -15);
          ctx.lineTo(10, -15);
          ctx.lineTo(0, -5);
          ctx.lineTo(-10, -15);
          ctx.lineTo(-20, -15);
          ctx.fill();
          
          ctx.fillStyle = '#a855f7'; // Light Purple Body
          ctx.beginPath();
          ctx.moveTo(0, 20);
          ctx.lineTo(6, -10);
          ctx.lineTo(0, -15);
          ctx.lineTo(-6, -10);
          ctx.fill();
          
          ctx.fillStyle = '#f3e8ff'; // Cockpit
          ctx.beginPath();
          ctx.moveTo(0, 10);
          ctx.lineTo(3, 0);
          ctx.lineTo(-3, 0);
          ctx.fill();
        } else if (enemy.type === 'VENOM') {
          // Venom-Striker (Olive Green Helicopter)
          ctx.fillStyle = '#3f6212'; // Olive Green Body
          ctx.beginPath();
          ctx.ellipse(0, 0, 12, 20, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#1a2e05'; // Dark Green Tail
          ctx.fillRect(-2, -30, 4, 15);
          ctx.fillStyle = '#84cc16'; // Cockpit
          ctx.beginPath();
          ctx.arc(0, 10, 5, 0, Math.PI * 2);
          ctx.fill();
          // Rotor
          ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.save();
          ctx.rotate(Date.now() / 50);
          ctx.fillRect(-25, -2, 50, 4);
          ctx.fillRect(-2, -25, 4, 50);
          ctx.restore();
        } else if (enemy.type === 'RAIDER') {
          // Raider-Flyer (Brown/Grey Helicopter)
          ctx.fillStyle = '#78716c'; // Grey-Brown Body
          ctx.beginPath();
          ctx.moveTo(0, 20);
          ctx.lineTo(15, -10);
          ctx.lineTo(5, -20);
          ctx.lineTo(-5, -20);
          ctx.lineTo(-15, -10);
          ctx.fill();
          ctx.fillStyle = '#44403c'; // Darker parts
          ctx.fillRect(-12, 0, 6, 15);
          ctx.fillRect(6, 0, 6, 15);
          ctx.fillStyle = '#fde047'; // Cockpit
          ctx.beginPath();
          ctx.moveTo(0, 15);
          ctx.lineTo(8, -5);
          ctx.lineTo(-8, -5);
          ctx.fill();
          // Rotor
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.save();
          ctx.rotate(-Date.now() / 40);
          ctx.fillRect(-30, -1.5, 60, 3);
          ctx.fillRect(-1.5, -30, 3, 60);
          ctx.restore();
        } else if (enemy.type === 'DRONE') {
          // Scout-Drone (Dark Blue/Grey Quadcopter)
          ctx.fillStyle = '#1e3a8a'; // Dark Blue Center
          ctx.beginPath();
          ctx.arc(0, 0, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#94a3b8'; // Grey Arms
          ctx.fillRect(-15, -2, 30, 4);
          ctx.fillRect(-2, -15, 4, 30);
          // Rotors
          ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
          const drawRotor = (x: number, y: number) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(Date.now() / 30);
            ctx.beginPath();
            ctx.arc(0, 0, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          };
          drawRotor(-15, 0);
          drawRotor(15, 0);
          drawRotor(0, -15);
          drawRotor(0, 15);
          ctx.fillStyle = '#38bdf8'; // Light Blue Eye
          ctx.beginPath();
          ctx.arc(0, 0, 4, 0, Math.PI * 2);
          ctx.fill();
        } else if (enemy.type === 'WASPER') {
          // Mini-Wasper (Small Red Helicopter)
          ctx.scale(0.6, 0.6);
          ctx.fillStyle = '#ef4444'; // Red Body
          ctx.beginPath();
          ctx.moveTo(0, 15);
          ctx.lineTo(10, -5);
          ctx.lineTo(-10, -5);
          ctx.fill();
          ctx.fillStyle = '#991b1b'; // Dark Red Tail
          ctx.fillRect(-2, -20, 4, 15);
          ctx.fillStyle = '#fde047'; // Cockpit
          ctx.beginPath();
          ctx.arc(0, 5, 4, 0, Math.PI * 2);
          ctx.fill();
          // Rotor
          ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.save();
          ctx.rotate(-Date.now() / 25);
          ctx.fillRect(-18, -1.5, 36, 3);
          ctx.fillRect(-1.5, -18, 3, 36);
          ctx.restore();
        } else if (enemy.type === 'MICRO') {
          // Micro-Drone (Small Blue Quadcopter)
          ctx.scale(0.5, 0.5);
          ctx.fillStyle = '#3b82f6'; // Blue Center
          ctx.beginPath();
          ctx.arc(0, 0, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#cbd5e1'; // Light Grey Arms
          ctx.fillRect(-12, -1.5, 24, 3);
          ctx.fillRect(-1.5, -12, 3, 24);
          // Rotors
          ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
          const drawRotor = (x: number, y: number) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(Date.now() / 20);
            ctx.beginPath();
            ctx.arc(0, 0, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          };
          drawRotor(-12, 0);
          drawRotor(12, 0);
          drawRotor(0, -12);
          drawRotor(0, 12);
          ctx.fillStyle = '#facc15'; // Yellow Eye
          ctx.beginPath();
          ctx.arc(0, 0, 3, 0, Math.PI * 2);
          ctx.fill();
        } else if (enemy.type === 'BOSS') {
          // Draw Boss: GIGA-MECHANICUS
          const scale = 1.5;
          ctx.scale(scale, scale);
          
          // Shoulders
          ctx.fillStyle = '#1f2937'; // Darker grey
          ctx.beginPath();
          ctx.arc(-35, -10, 15, 0, Math.PI * 2);
          ctx.arc(35, -10, 15, 0, Math.PI * 2);
          ctx.fill();

          // Arms
          ctx.fillStyle = '#374151'; // Dark grey
          ctx.fillRect(-45, -5, 20, 30);
          ctx.fillRect(25, -5, 20, 30);
          
          // Claws
          ctx.fillStyle = '#4b5563'; // Lighter grey
          ctx.beginPath();
          ctx.moveTo(-45, 25);
          ctx.lineTo(-25, 25);
          ctx.lineTo(-30, 45);
          ctx.lineTo(-40, 45);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(25, 25);
          ctx.lineTo(45, 25);
          ctx.lineTo(40, 45);
          ctx.lineTo(30, 45);
          ctx.fill();

          // Main Body
          ctx.fillStyle = '#374151'; // Dark grey
          ctx.beginPath();
          ctx.moveTo(-30, -20);
          ctx.lineTo(30, -20);
          ctx.lineTo(35, 10);
          ctx.lineTo(20, 30);
          ctx.lineTo(-20, 30);
          ctx.lineTo(-35, 10);
          ctx.closePath();
          ctx.fill();

          // Body Accents
          ctx.fillStyle = '#1f2937';
          ctx.fillRect(-20, -10, 40, 5);
          ctx.fillRect(-20, 0, 40, 5);

          // Lower Propulsion Unit
          ctx.fillStyle = '#1f2937';
          ctx.fillRect(-15, 30, 30, 10);
          // Flames
          ctx.fillStyle = '#f59e0b'; // Orange
          ctx.beginPath();
          ctx.moveTo(-10, 40);
          ctx.lineTo(0, 55 + Math.random() * 10);
          ctx.lineTo(10, 40);
          ctx.fill();

          // Head
          ctx.fillStyle = '#1f2937';
          ctx.fillRect(-15, -35, 30, 20);
          // Red Eye
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(0, -25, 5, 0, Math.PI * 2);
          ctx.fill();
          // Eye Glow
          ctx.fillStyle = 'rgba(239, 68, 68, 0.5)';
          ctx.beginPath();
          ctx.arc(0, -25, 8, 0, Math.PI * 2);
          ctx.fill();

          // Central Core
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(0, 15, 12, 0, Math.PI * 2);
          ctx.fill();
          // Core Inner
          ctx.fillStyle = '#fca5a5';
          ctx.beginPath();
          ctx.arc(0, 15, 6, 0, Math.PI * 2);
          ctx.fill();
          // Core Glow
          ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
          ctx.beginPath();
          ctx.arc(0, 15, 18 + Math.sin(Date.now() / 200) * 2, 0, Math.PI * 2);
          ctx.fill();

          ctx.scale(1/scale, 1/scale);
        }
        ctx.restore();
      });

      // Draw Player Bullets
      ctx.fillStyle = '#60a5fa';
      playerBulletsRef.current.forEach(bullet => {
        ctx.fillRect(bullet.x, bullet.y, PLAYER_BULLET_WIDTH, PLAYER_BULLET_HEIGHT);
      });

      // Draw Enemy Bullets
      ctx.fillStyle = '#f87171';
      enemyBulletsRef.current.forEach(bullet => {
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, bullet.radius || ENEMY_BULLET_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      });
      
      // Draw Power-ups
      powerUpsRef.current.forEach(pu => {
        ctx.save();
        ctx.translate(pu.x + pu.width / 2, pu.y + pu.height / 2);
        
        // Pulsing effect
        const scale = 1 + Math.sin(Date.now() / 150) * 0.1;
        ctx.scale(scale, scale);
        
        ctx.beginPath();
        ctx.arc(0, 0, pu.width / 2, 0, Math.PI * 2);
        
        switch (pu.type) {
          case 'RAPID':
            ctx.fillStyle = '#f59e0b'; // Amber
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('R', 0, 0);
            break;
          case 'SPREAD':
            ctx.fillStyle = '#ef4444'; // Red
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('S', 0, 0);
            break;
          case 'SHIELD':
            ctx.fillStyle = '#3b82f6'; // Blue
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('O', 0, 0);
            break;
          case 'LIFE':
            ctx.fillStyle = '#10b981'; // Emerald
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('+', 0, 0);
            break;
        }
        
        // Glow
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 10;
        ctx.stroke();
        
        ctx.restore();
      });
      
      // Draw Boss HP Bar
      const boss = enemiesRef.current.find(e => e.type === 'BOSS');
      if (boss) {
        ctx.fillStyle = '#333';
        ctx.fillRect(50, 20, CANVAS_WIDTH - 100, 10);
        ctx.fillStyle = '#ef4444';
        const hpPercent = Math.max(0, boss.hp / boss.maxHp);
        ctx.fillRect(50, 20, (CANVAS_WIDTH - 100) * hpPercent, 10);
        
        ctx.fillStyle = '#fff';
        ctx.font = '12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('WARNING: BOSS APPROACHING', CANVAS_WIDTH / 2, 15);
      }
      
      // Draw Floating Texts
      floatingTextsRef.current.forEach(ft => {
        ctx.fillStyle = ft.color;
        ctx.globalAlpha = ft.life / ft.maxLife;
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.globalAlpha = 1.0;
      });
    }

    requestRef.current = requestAnimationFrame(() => {
      update();
      draw();
    });
  };

  useEffect(() => {
    draw();
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState]);

  return (
    <div className="h-screen w-screen bg-neutral-950 font-sans text-white flex flex-col lg:flex-row overflow-hidden">
      {/* Left Game Area (70%) */}
      <div className={`relative h-[60vh] lg:h-full bg-black flex-col items-center justify-center overflow-hidden shrink-0 border-b lg:border-b-0 lg:border-r border-neutral-800 ${currentPage === 'home' ? 'flex w-full lg:w-[70%]' : 'hidden lg:flex lg:w-[70%]'}`}>
        <div ref={containerRef} className="relative w-full h-full flex flex-col items-center justify-center">
          <div className="relative w-full h-full bg-black overflow-hidden shadow-2xl">
            
            {/* Overlay Header */}
            <div className="absolute top-0 left-0 w-full flex justify-between items-start p-4 sm:p-6 z-10 pointer-events-none">
              <div className="flex flex-col gap-2 pointer-events-auto">
                <div className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-500 drop-shadow-md" />
                  <span className="font-mono text-xl sm:text-2xl font-bold drop-shadow-md">{score.toString().padStart(6, '0')}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] sm:text-xs text-neutral-300 font-bold leading-none drop-shadow-md">HIGH SCORE</span>
                  <span className="font-mono text-sm sm:text-base font-bold text-yellow-500 leading-none drop-shadow-md">{highScore.toString().padStart(6, '0')}</span>
                </div>
                <div className="flex items-center gap-1.5 bg-blue-900/50 px-3 py-1 rounded-full border border-blue-500/30 w-fit backdrop-blur-sm mt-1">
                  <Zap className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-bold text-blue-400">STAGE {stage}</span>
                </div>
              </div>
              
              <div className="flex flex-col items-end gap-3 pointer-events-auto">
                <button 
                  onClick={(e) => { toggleFullscreen(); e.currentTarget.blur(); }}
                  className="p-2 hover:bg-white/20 bg-black/20 rounded-full transition-colors backdrop-blur-sm"
                  title="Toggle Fullscreen"
                >
                  {isFullscreen ? <Minimize className="w-5 h-5 sm:w-6 sm:h-6" /> : <Maximize className="w-5 h-5 sm:w-6 sm:h-6" />}
                </button>
                <div className="flex items-center gap-1.5 bg-black/20 p-2 sm:p-3 rounded-full backdrop-blur-sm">
                  {[...Array(3)].map((_, i) => (
                    <Heart 
                      key={i} 
                      className={`w-5 h-5 sm:w-6 sm:h-6 transition-colors duration-300 ${i < lives ? 'text-red-500 fill-red-500' : 'text-neutral-800'}`} 
                    />
                  ))}
                </div>
              </div>
            </div>

            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              className="block h-full w-full object-contain"
            />

            {/* Overlay Screens */}
            <AnimatePresence>
              {gameState === 'START' && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-8 text-center"
                >
                  <motion.h1 
                    initial={{ y: -20 }}
                    animate={{ y: 0 }}
                    className="text-4xl sm:text-5xl font-black mb-1 tracking-tighter italic text-blue-400 drop-shadow-[0_0_10px_rgba(96,165,250,0.8)]"
                  >
                    SPACE
                  </motion.h1>
                  <motion.h2 
                    initial={{ y: -20 }}
                    animate={{ y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-4xl sm:text-5xl font-black mb-2 tracking-tighter italic text-orange-500 drop-shadow-[0_0_10px_rgba(249,115,22,0.8)]"
                  >
                    SHIP
                  </motion.h2>
                  <motion.h3 
                    initial={{ y: -20 }}
                    animate={{ y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="text-lg sm:text-xl font-black mb-8 tracking-widest italic text-cyan-300 drop-shadow-[0_0_8px_rgba(103,232,249,0.8)]"
                  >
                    ARCADE SHOOTER
                  </motion.h3>
                  <p className="text-neutral-400 mb-8 text-sm max-w-[250px]">
                    Move with <span className="text-white font-bold">Arrow Keys</span> or <span className="text-white font-bold">WASD</span>. 
                    Shoot with <span className="text-white font-bold">SPACE</span>.
                  </p>
                  <button
                    onClick={(e) => { startGame(); e.currentTarget.blur(); }}
                    className="group relative px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-full font-bold text-lg transition-all flex items-center gap-2 overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                    <Play className="w-5 h-5 fill-current" />
                    START MISSION
                  </button>
                </motion.div>
              )}

              {gameState === 'STAGE_CLEAR' && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-blue-950/90 flex flex-col items-center justify-center p-8 text-center"
                >
                  <motion.div
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    className="mb-6"
                  >
                    <Zap className="w-16 h-16 text-blue-400 mx-auto mb-4" />
                    <h2 className="text-3xl sm:text-4xl font-black tracking-tighter italic text-white">STAGE CLEAR!</h2>
                  </motion.div>
                  <p className="text-blue-200 text-base sm:text-lg mb-8">PREPARING FOR STAGE {stage}...</p>
                  <button
                    onClick={(e) => { startNextStage(); e.currentTarget.blur(); }}
                    className="px-6 py-3 bg-blue-500 text-white hover:bg-blue-400 rounded-full font-bold text-lg transition-all flex items-center gap-2"
                  >
                    <Play className="w-5 h-5 fill-current" />
                    NEXT STAGE
                  </button>
                </motion.div>
              )}

              {gameState === 'GAMEOVER' && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-red-950/90 flex flex-col items-center justify-center p-8 text-center"
                >
                  <h2 className="text-4xl sm:text-5xl font-black mb-4 tracking-tighter italic text-white">MISSION FAILED</h2>
                  <div className="mb-8">
                    <p className="text-red-200 text-base mb-1">FINAL SCORE</p>
                    <p className="text-3xl sm:text-4xl font-mono font-black text-white">{score.toLocaleString()}</p>
                    <p className="text-red-300 mt-2">REACHED STAGE {stage}</p>
                  </div>
                  <button
                    onClick={(e) => { startGame(); e.currentTarget.blur(); }}
                    className="px-6 py-3 bg-white text-red-950 hover:bg-red-100 rounded-full font-bold text-lg transition-all flex items-center gap-2"
                  >
                    <RotateCcw className="w-5 h-5" />
                    RETRY MISSION
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Right Content Area (30%) */}
      <div className={`w-full lg:w-[30%] flex flex-col overflow-y-auto ${currentPage === 'home' ? 'hidden lg:flex' : 'flex'}`}>
        {/* Header */}
        <header className="bg-neutral-900 border-b border-neutral-800 p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 z-50 shrink-0 sticky top-0">
          <h1 
            className="text-xl font-black italic text-blue-400 cursor-pointer hover:text-blue-300 transition-colors" 
            onClick={() => setCurrentPage('home')}
          >
            SPACE SHIP
          </h1>
          <nav className="flex flex-wrap gap-3 sm:gap-4 text-sm font-medium text-neutral-400">
            <button onClick={() => setCurrentPage('home')} className={`hover:text-white transition-colors ${currentPage === 'home' ? 'text-white' : ''}`}>Play</button>
            <button onClick={() => setCurrentPage('privacy')} className={`hover:text-white transition-colors ${currentPage === 'privacy' ? 'text-white' : ''}`}>Privacy</button>
            <button onClick={() => setCurrentPage('terms')} className={`hover:text-white transition-colors ${currentPage === 'terms' ? 'text-white' : ''}`}>Terms</button>
            <button onClick={() => setCurrentPage('contact')} className={`hover:text-white transition-colors ${currentPage === 'contact' ? 'text-white' : ''}`}>Contact</button>
          </nav>
        </header>

        {/* Main Content */}
        <main className="flex-1 flex flex-col">
          {currentPage === 'home' && (
            <div className="max-w-4xl mx-auto p-6 lg:p-8 text-neutral-300 space-y-12 my-8">
              <section>
                <h2 className="text-3xl font-bold text-white mb-4">About Space Ship Arcade Shooter</h2>
                <p className="leading-relaxed mb-4 text-lg">
                  Welcome to <strong>Space Ship Arcade Shooter</strong>, the ultimate retro-inspired vertical scrolling space shooter. 
                  Defend the galaxy against endless waves of alien invaders, dodge intricate bullet patterns, and face off against 
                  massive mechanical bosses. Experience the nostalgia of classic arcade games directly in your browser!
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-white mb-4">How to Play</h2>
                <div className="grid grid-cols-1 gap-6">
                  <div className="bg-neutral-900 p-6 rounded-xl border border-neutral-800">
                    <h3 className="text-xl font-bold text-blue-400 mb-2">Controls</h3>
                    <ul className="list-disc pl-5 space-y-2">
                      <li><strong>Movement:</strong> Use the <kbd className="bg-neutral-800 px-1 rounded">Arrow Keys</kbd> or <kbd className="bg-neutral-800 px-1 rounded">W, A, S, D</kbd> to navigate your starfighter.</li>
                      <li><strong>Combat:</strong> Press the <kbd className="bg-neutral-800 px-1 rounded">SPACEBAR</kbd> to fire your primary weapons.</li>
                      <li><strong>Fullscreen:</strong> Click the maximize icon in the top right corner of the game screen.</li>
                    </ul>
                  </div>
                  <div className="bg-neutral-900 p-6 rounded-xl border border-neutral-800">
                    <h3 className="text-xl font-bold text-red-400 mb-2">Gameplay Tips</h3>
                    <ul className="list-disc pl-5 space-y-2">
                      <li><strong>Boss Battles:</strong> Every 5 stages, you will encounter a massive boss. Watch out for its spread and circle attacks!</li>
                      <li><strong>Survival:</strong> You have 3 lives. Avoid enemy ships and their red projectiles.</li>
                      <li><strong>Scoring:</strong> Defeat enemies to increase your score. Try to beat your high score!</li>
                    </ul>
                  </div>
                </div>
              </section>
            </div>
          )}

        {currentPage === 'privacy' && (
          <div className="max-w-4xl mx-auto p-6 lg:p-8 text-neutral-300 space-y-6 my-8 flex-1">
            <h1 className="text-4xl font-bold text-white mb-8">Privacy Policy</h1>
            <p>Last updated: {new Date().toLocaleDateString()}</p>
            <p>This Privacy Policy describes Our policies and procedures on the collection, use and disclosure of Your information when You use the Service and tells You about Your privacy rights and how the law protects You.</p>
            
            <h2 className="text-2xl font-bold text-white mt-8">Google AdSense & Cookies</h2>
            <p>Third party vendors, including Google, use cookies to serve ads based on a user's prior visits to your website or other websites.</p>
            <p>Google's use of advertising cookies enables it and its partners to serve ads to your users based on their visit to your sites and/or other sites on the Internet.</p>
            <p>Users may opt out of personalized advertising by visiting <a href="https://myadcenter.google.com/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">Ads Settings</a>.</p>
            
            <h2 className="text-2xl font-bold text-white mt-8">Contact Us</h2>
            <p>If you have any questions about this Privacy Policy, You can contact us:</p>
            <ul className="list-disc pl-6">
              <li>By email: <a href="mailto:weseok@gmail.com" className="text-blue-400 hover:underline">weseok@gmail.com</a></li>
            </ul>
          </div>
        )}

        {currentPage === 'terms' && (
          <div className="max-w-4xl mx-auto p-6 lg:p-8 text-neutral-300 space-y-6 my-8 flex-1">
            <h1 className="text-4xl font-bold text-white mb-8">Terms of Service</h1>
            <p>Last updated: {new Date().toLocaleDateString()}</p>
            <p>Please read these terms and conditions carefully before using Our Service.</p>
            
            <h2 className="text-2xl font-bold text-white mt-8">Acknowledgment</h2>
            <p>These are the Terms and Conditions governing the use of this Service and the agreement that operates between You and the Company. These Terms and Conditions set out the rights and obligations of all users regarding the use of the Service.</p>
            <p>Your access to and use of the Service is conditioned on Your acceptance of and compliance with these Terms and Conditions. These Terms and Conditions apply to all visitors, users and others who access or use the Service.</p>
            
            <h2 className="text-2xl font-bold text-white mt-8">Contact Us</h2>
            <p>If you have any questions about these Terms and Conditions, You can contact us:</p>
            <ul className="list-disc pl-6">
              <li>By email: <a href="mailto:weseok@gmail.com" className="text-blue-400 hover:underline">weseok@gmail.com</a></li>
            </ul>
          </div>
        )}

        {currentPage === 'contact' && (
          <div className="max-w-4xl mx-auto p-6 lg:p-8 text-neutral-300 space-y-6 my-8 flex-1">
            <h1 className="text-4xl font-bold text-white mb-8">Contact Us</h1>
            <p className="text-lg">We'd love to hear from you! Whether you have a question about the game, need support, or want to discuss business opportunities, feel free to reach out.</p>
            
            <div className="bg-neutral-900 p-8 rounded-xl border border-neutral-800 mt-8">
              <h2 className="text-2xl font-bold text-white mb-6">Get in Touch</h2>
              <div className="space-y-4">
                <p className="flex items-center gap-3">
                  <span className="text-neutral-500">Email:</span> 
                  <a href="mailto:weseok@gmail.com" className="text-blue-400 hover:underline text-lg font-medium">weseok@gmail.com</a>
                </p>
                <p className="text-neutral-400">We aim to respond to all inquiries within 24-48 hours.</p>
              </div>
            </div>
          </div>
        )}
        </main>

        {/* Footer */}
        <footer className="bg-neutral-900 border-t border-neutral-800 p-8 text-center text-neutral-500 text-sm shrink-0">
          <p className="mb-4">&copy; {new Date().getFullYear()} Space Ship Arcade Shooter. All rights reserved.</p>
          <div className="flex flex-wrap justify-center gap-4 sm:gap-6">
            <button onClick={() => setCurrentPage('privacy')} className="hover:text-white transition-colors">Privacy Policy</button>
            <button onClick={() => setCurrentPage('terms')} className="hover:text-white transition-colors">Terms of Service</button>
            <button onClick={() => setCurrentPage('contact')} className="hover:text-white transition-colors">Contact Us</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
