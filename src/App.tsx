import { Canvas } from "@react-three/fiber";
import { useState } from "react";
import { CombatScene } from "./components/CombatScene";
import { enterFullscreen, FullscreenButton } from "./components/FullscreenButton";
import { Hud } from "./components/Hud";
import { combatAudio } from "./game/fx/audio";
import { useGameStore } from "./game/core/store";

export function App() {
  const started = useGameStore((state) => state.started);
  const patch = useGameStore((state) => state.patch);
  const [quality] = useState(() => window.matchMedia("(pointer: coarse)").matches ? 1.35 : 1.75);

  const begin = () => {
    combatAudio.unlock();
    enterFullscreen();
    patch({ started: true, message: "THE HOLLOW WARDEN" });
  };

  return (
    <main className="game-shell">
      <Canvas
        shadows
        dpr={[1, quality]}
        camera={{ fov: 48, near: 0.1, far: 70, position: [0, 3.5, 10] }}
        gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = "srgb";
          gl.shadowMap.type = 2;
        }}
      >
        <CombatScene />
      </Canvas>
      <Hud />
      {!started && (
        <section className="title-screen">
          <div className="title-rule" />
          <p>AN ECCTRL COMBAT PROTOTYPE</p>
          <h1>ASHEN RING</h1>
          <p className="subtitle">One knight. One blade. One lesson.</p>
          <button onClick={begin}>ENTER THE ARENA</button>
          <FullscreenButton className="fullscreen-entry" />
          <small>Desktop · touch · GameSir X2s</small>
        </section>
      )}
    </main>
  );
}
