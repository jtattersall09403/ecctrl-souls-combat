import { useEffect, useRef, useState } from "react";
import { input, type InputAction } from "../game/input";
import { useGameStore } from "../game/store";

function Bar({ value, max, className, label }: { value: number; max: number; className: string; label: string }) {
  return (
    <div className={`meter ${className}`} aria-label={`${label}: ${Math.ceil(value)} of ${max}`}>
      <span style={{ transform: `scaleX(${Math.max(0, value / max)})` }} />
    </div>
  );
}

function ActionButton({ action, label, sublabel, className = "" }: { action: InputAction; label: string; sublabel?: string; className?: string }) {
  const release = () => input.setVirtual(action, false);
  return (
    <button
      className={`action-button ${className}`}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        input.setVirtual(action, true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      aria-label={sublabel ? `${label}: ${sublabel}` : label}
    >
      <strong>{label}</strong>
      {sublabel && <small>{sublabel}</small>}
    </button>
  );
}

function TouchJoystick() {
  const pad = useRef<HTMLDivElement>(null);
  const [nub, setNub] = useState({ x: 0, y: 0 });
  const pointer = useRef<number | null>(null);

  const update = (event: React.PointerEvent) => {
    const bounds = pad.current!.getBoundingClientRect();
    const radius = bounds.width * 0.36;
    let x = event.clientX - (bounds.left + bounds.width / 2);
    let y = event.clientY - (bounds.top + bounds.height / 2);
    const distance = Math.hypot(x, y);
    if (distance > radius) {
      x = (x / distance) * radius;
      y = (y / distance) * radius;
    }
    setNub({ x, y });
    input.setTouchMovement({ x: x / radius, y: -y / radius });
  };
  const end = () => {
    pointer.current = null;
    setNub({ x: 0, y: 0 });
    input.setTouchMovement({ x: 0, y: 0 });
  };
  return (
    <div
      ref={pad}
      className="touch-stick"
      onPointerDown={(event) => {
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event);
      }}
      onPointerMove={(event) => pointer.current === event.pointerId && update(event)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <span style={{ transform: `translate(${nub.x}px, ${nub.y}px)` }} />
    </div>
  );
}

function CameraZone() {
  const previous = useRef<{ id: number; x: number; y: number } | null>(null);
  return (
    <div
      className="camera-zone"
      aria-label="Drag to rotate camera"
      onPointerDown={(event) => {
        previous.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (previous.current?.id !== event.pointerId) return;
        const dx = event.clientX - previous.current.x;
        const dy = event.clientY - previous.current.y;
        previous.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        input.addTouchCamera({ x: dx * 0.18, y: dy * 0.18 });
      }}
      onPointerUp={() => { previous.current = null; }}
      onPointerCancel={() => { previous.current = null; }}
    />
  );
}

export function Hud() {
  const state = useGameStore();
  const [help, setHelp] = useState(false);
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const update = () => setTouch(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const dead = state.playerHealth <= 0;
  const won = state.enemyHealth <= 0;
  return (
    <div className="hud">
      <section className="player-vitals" aria-label="Player status">
        <div className="vital-row"><span className="level-orb">08</span><Bar value={state.playerHealth} max={100} className="health" label="Health" /></div>
        <Bar value={state.playerStamina} max={100} className="stamina" label="Stamina" />
      </section>

      <section className="enemy-vitals" aria-label="Enemy status">
        <span>THE HOLLOW WARDEN</span>
        <Bar value={state.enemyHealth} max={150} className="enemy-health" label="Enemy health" />
      </section>

      {state.lockedOn && state.enemyHealth > 0 && <div className="lock-reticle" aria-label="Target locked"><span /></div>}
      {state.message && <div className={`combat-message ${(dead || won) ? "major" : ""}`}>{state.message}</div>}

      <section className="quick-slots" aria-label="Equipment">
        <div className="slot sword-icon"><i /></div>
        <div className="slot flask-icon"><i /> <b>{state.estus}</b></div>
        <span>{state.equipped ? "Weathered Straight Sword" : "Empty right hand"}</span>
      </section>

      <div className={`connection ${state.gamepad ? "connected" : ""}`}>
        {state.gamepad ? "CONTROLLER CONNECTED" : "KEYBOARD · TOUCH · GAMEPAD"}
      </div>

      <button className="help-button" onClick={() => setHelp((value) => !value)} aria-expanded={help}>?</button>
      {!touch && state.started && <CameraZone />}
      {help && (
        <aside className="help-panel">
          <button onClick={() => setHelp(false)} aria-label="Close controls">×</button>
          <h2>Controls</h2>
          <div className="control-columns">
            <dl>
              <dt>Move / camera</dt><dd>WASD / drag</dd>
              <dt>Light / heavy</dt><dd>Mouse 1 / R</dd>
              <dt>Guard / parry</dt><dd>Mouse 2 / F</dd>
              <dt>Dodge / sprint</dt><dd>Space tap / hold</dd>
              <dt>Jump</dt><dd>J</dd>
              <dt>Lock / heal / equip</dt><dd>Q / H / E</dd>
            </dl>
            <dl>
              <dt>Move / camera</dt><dd>L stick / R stick</dd>
              <dt>Light / heavy</dt><dd>R / ZR</dd>
              <dt>Guard / parry</dt><dd>L / ZL</dd>
              <dt>Dodge / sprint</dt><dd>B tap / hold</dd>
              <dt>Jump</dt><dd>L3</dd>
              <dt>Lock / heal / equip</dt><dd>R3 / X / D-pad →</dd>
            </dl>
          </div>
          <p>GameSir mapping uses Nintendo-layout button positions. Release dodge quickly to roll; hold while moving to sprint. Chain R or ZR presses during attack recovery for light and heavy combos. Parry during the enemy windup, then light attack at close range. Circle behind the enemy and use a light attack at close range to backstab.</p>
        </aside>
      )}

      {touch && state.started && !dead && (
        <div className="touch-controls">
          <CameraZone />
          <TouchJoystick />
          <div className="touch-actions">
            <ActionButton action="lockOn" label="R3" sublabel="LOCK" className="lock" />
            <ActionButton action="guard" label="L" sublabel="GUARD" className="guard" />
            <ActionButton action="parry" label="ZL" sublabel="PARRY" className="parry" />
            <ActionButton action="light" label="R" sublabel="LIGHT" className="light" />
            <ActionButton action="heavy" label="ZR" sublabel="HEAVY" className="heavy" />
            <ActionButton action="dodge" label="B" sublabel="DODGE" className="dodge" />
            <ActionButton action="heal" label="X" sublabel="ESTUS" className="heal" />
            <ActionButton action="equip" label="→" sublabel="EQUIP" className="equip" />
            <ActionButton action="jump" label="A" sublabel="JUMP" className="jump" />
          </div>
        </div>
      )}

      {(dead || won) && <button className="retry-button" onClick={() => window.location.reload()}>RETURN TO THE ARENA</button>}
    </div>
  );
}
