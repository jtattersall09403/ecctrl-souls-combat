type Sound = "swing" | "hit" | "guard" | "parry" | "roll" | "heal" | "death";

class CombatAudio {
  private context?: AudioContext;

  unlock() {
    this.context ??= new AudioContext();
    void this.context.resume();
  }

  play(sound: Sound) {
    this.unlock();
    const context = this.context!;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const settings: Record<Sound, [number, number, number, OscillatorType]> = {
      swing: [170, 58, 0.16, "sawtooth"],
      hit: [95, 42, 0.22, "square"],
      guard: [540, 150, 0.14, "triangle"],
      parry: [920, 260, 0.24, "square"],
      roll: [80, 35, 0.12, "sine"],
      heal: [380, 720, 0.55, "sine"],
      death: [110, 35, 0.8, "sawtooth"],
    };
    const [from, to, duration, type] = settings[sound];
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(to, 1), now + duration);
    filter.type = "lowpass";
    filter.frequency.value = sound === "parry" ? 2400 : 900;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(sound === "parry" ? 0.14 : 0.08, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(filter).connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}

export const combatAudio = new CombatAudio();
