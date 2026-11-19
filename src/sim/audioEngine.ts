export class ProceduralFlightAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private turbineOsc: OscillatorNode | null = null;
  private turbineHarmonic: OscillatorNode | null = null;
  private turbineGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private scrapeGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private initialized = false;
  private warnCooldown = 0;

  public unlock() {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.35;
      master.connect(ctx.destination);
      this.masterGain = master;

      // Turbine whine
      const tOsc = ctx.createOscillator();
      tOsc.type = 'sawtooth';
      tOsc.frequency.value = 180;

      const tHarm = ctx.createOscillator();
      tHarm.type = 'triangle';
      tHarm.frequency.value = 92;

      const tFilter = ctx.createBiquadFilter();
      tFilter.type = 'lowpass';
      tFilter.frequency.value = 680;

      const tGain = ctx.createGain();
      tGain.gain.value = 0.05;

      tOsc.connect(tFilter);
      tHarm.connect(tFilter);
      tFilter.connect(tGain);
      tGain.connect(master);
      tOsc.start();
      tHarm.start();

      this.turbineOsc = tOsc;
      this.turbineHarmonic = tHarm;
      this.turbineGain = tGain;

      // White noise buffer for jet roar, wind, metal scrape, and storm rain/thunder
      const bufferSize = ctx.sampleRate * 2;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = noiseBuffer;

      const windSrc = ctx.createBufferSource();
      windSrc.buffer = noiseBuffer;
      windSrc.loop = true;
      const wFilter = ctx.createBiquadFilter();
      wFilter.type = 'bandpass';
      wFilter.frequency.value = 420;
      wFilter.Q.value = 0.7;
      const wGain = ctx.createGain();
      wGain.gain.value = 0.01;
      windSrc.connect(wFilter);
      wFilter.connect(wGain);
      wGain.connect(master);
      windSrc.start();

      this.windFilter = wFilter;
      this.windGain = wGain;

      const scrapeSrc = ctx.createBufferSource();
      scrapeSrc.buffer = noiseBuffer;
      scrapeSrc.loop = true;
      const sFilter = ctx.createBiquadFilter();
      sFilter.type = 'bandpass';
      sFilter.frequency.value = 1150;
      sFilter.Q.value = 2.2;
      const sGain = ctx.createGain();
      sGain.gain.value = 0;
      scrapeSrc.connect(sFilter);
      sFilter.connect(sGain);
      sGain.connect(master);
      scrapeSrc.start();
      this.scrapeGain = sGain;

      const rainSrc = ctx.createBufferSource();
      rainSrc.buffer = noiseBuffer;
      rainSrc.loop = true;
      const rFilter = ctx.createBiquadFilter();
      rFilter.type = 'bandpass';
      rFilter.frequency.value = 1650;
      rFilter.Q.value = 0.55;
      const rGain = ctx.createGain();
      rGain.gain.value = 0;
      rainSrc.connect(rFilter);
      rFilter.connect(rGain);
      rGain.connect(master);
      rainSrc.start();
      this.rainGain = rGain;

      this.initialized = true;
    } catch {
      // Audio unavailable
    }
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.35, this.ctx.currentTime, 0.05);
    }
  }

  private fireBellCooldown = 0;

  public update(
    dt: number,
    n1Percent: number,
    iasKnots: number,
    scrapeIntensity: number,
    crashed: boolean,
    gpwsOrStall: boolean,
    profile: 'trijet' | 'widebody' | 'supersonic' | 'turboprop' | 'piston' | 'fighter' = 'trijet',
    afterburnerActive = false,
    stormIntensity = 0,
    fireActive = false,
    electricalFailure = false,
  ) {
    if (!this.initialized || !this.ctx || !this.turbineOsc || !this.turbineHarmonic || !this.turbineGain || !this.windGain || !this.windFilter || !this.scrapeGain) {
      return;
    }
    const now = this.ctx.currentTime;
    const n1 = Math.max(0, Math.min(1.1, n1Percent / 100));

    if (crashed) {
      this.turbineGain.gain.setTargetAtTime(0, now, 0.15);
    } else {
      let baseF = 140;
      let spanF = 420;
      let harmF = 55;
      let harmSpan = 135;
      let gainScale = 1.0;

      if (profile === 'widebody') {
        baseF = 95;
        spanF = 290;
        harmF = 44;
        harmSpan = 95;
      } else if (profile === 'supersonic' || profile === 'fighter') {
        baseF = 115;
        spanF = 380;
        harmF = 62;
        harmSpan = afterburnerActive ? 220 : 140;
        gainScale = afterburnerActive ? 1.45 : 1.05;
      } else if (profile === 'turboprop') {
        baseF = 68;
        spanF = 110;
        harmF = 34;
        harmSpan = 58;
        gainScale = 1.15;
      } else if (profile === 'piston') {
        baseF = 38;
        spanF = 72;
        harmF = 76;
        harmSpan = 90;
        gainScale = 0.95;
      }

      this.turbineOsc.frequency.setTargetAtTime(baseF + n1 * spanF, now, 0.08);
      this.turbineHarmonic.frequency.setTargetAtTime(harmF + n1 * harmSpan, now, 0.08);
      this.turbineGain.gain.setTargetAtTime((0.03 + n1 * 0.12) * gainScale, now, 0.08);
    }

    const windAmt = Math.min(1, iasKnots / 480);
    this.windFilter.frequency.setTargetAtTime(280 + windAmt * 1150, now, 0.1);
    this.windGain.gain.setTargetAtTime(0.015 + windAmt * (afterburnerActive ? 0.34 : 0.24) + stormIntensity * 0.05, now, 0.1);

    this.scrapeGain.gain.setTargetAtTime(scrapeIntensity * 0.45, now, 0.04);
    if (this.rainGain) {
      this.rainGain.gain.setTargetAtTime(stormIntensity * 0.14, now, 0.15);
    }

    if (fireActive && !crashed && !electricalFailure) {
      this.fireBellCooldown -= dt;
      if (this.fireBellCooldown <= 0) {
        this.fireBellCooldown = 1.25;
        this.playFireBell();
      }
    } else if (gpwsOrStall && !crashed && !electricalFailure) {
      this.warnCooldown -= dt;
      if (this.warnCooldown <= 0) {
        this.warnCooldown = 0.85;
        this.playWarningBeep();
      }
    }
  }

  public playBirdStrike() {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.16);
    gain.gain.setValueAtTime(0.65, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  public playFireBell() {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    for (let ring = 0; ring < 3; ring++) {
      const t = now + ring * 0.14;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1480, t);
      gain.gain.setValueAtTime(0.11, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.1);
    }
  }

  public playCautionChime() {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(740, now);
    osc.frequency.setValueAtTime(523, now + 0.15);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.38);
  }

  public playThunder(intensity = 0.8) {
    if (!this.initialized || !this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(160, now);
    filter.frequency.exponentialRampToValueAtTime(52, now + 2.2);

    const gain = this.ctx.createGain();
    const peak = Math.min(0.65, Math.max(0.2, intensity * 0.55));
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 2.4);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 2.45);
  }

  public playTouchdown(intensity: number) {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.18);
    gain.gain.setValueAtTime(Math.min(0.5, 0.15 + intensity * 0.06), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  public playCrashImpact(intensity = 1.0) {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const clamped = Math.max(0.15, Math.min(1.2, intensity));

    // 1. Deep sub-bass explosion thump
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(98, now);
    subOsc.frequency.exponentialRampToValueAtTime(22, now + 0.55);
    subGain.gain.setValueAtTime(clamped * 0.82, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(now);
    subOsc.stop(now + 0.68);

    // 2. Concussive fireball & debris roar from noise buffer
    if (this.noiseBuffer) {
      const blastSrc = this.ctx.createBufferSource();
      blastSrc.buffer = this.noiseBuffer;
      blastSrc.loop = true;

      const blastFilter = this.ctx.createBiquadFilter();
      blastFilter.type = 'lowpass';
      blastFilter.frequency.setValueAtTime(1250 * (0.65 + clamped * 0.45), now);
      blastFilter.frequency.exponentialRampToValueAtTime(75, now + 1.35);

      const blastGain = this.ctx.createGain();
      blastGain.gain.setValueAtTime(0.001, now);
      blastGain.gain.linearRampToValueAtTime(clamped * 0.72, now + 0.02);
      blastGain.gain.exponentialRampToValueAtTime(0.001, now + 1.45);

      blastSrc.connect(blastFilter);
      blastFilter.connect(blastGain);
      blastGain.connect(this.masterGain);
      blastSrc.start(now);
      blastSrc.stop(now + 1.5);

      // 3. Sharp metallic structural tear / crackle
      const crunchSrc = this.ctx.createBufferSource();
      crunchSrc.buffer = this.noiseBuffer;
      const crunchFilter = this.ctx.createBiquadFilter();
      crunchFilter.type = 'bandpass';
      crunchFilter.frequency.setValueAtTime(1900, now);
      crunchFilter.Q.value = 1.4;
      const crunchGain = this.ctx.createGain();
      crunchGain.gain.setValueAtTime(clamped * 0.35, now);
      crunchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      crunchSrc.connect(crunchFilter);
      crunchFilter.connect(crunchGain);
      crunchGain.connect(this.masterGain);
      crunchSrc.start(now);
      crunchSrc.stop(now + 0.32);
    }
  }

  private playWarningBeep() {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(660, now + 0.12);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.28);
  }

  public dispose() {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.initialized = false;
  }
}
