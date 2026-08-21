import { Canvas, advance } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { CombatScene } from "./components/CombatScene";
import { enterFullscreen, FullscreenButton } from "./components/FullscreenButton";
import { Hud } from "./components/Hud";
import { VisualFrameMarker } from "./components/VisualFrameMarker";
import { combatAudio } from "./game/fx/audio";
import { useGameStore } from "./game/core/store";
import { visualScenarioFromSearch } from "./game/validation/visualScenarios";
import { VISUAL_FRAME_MARKER_HEIGHT } from "./game/validation/visualFrameMarker";

/** Recorded-capture only: wall-clock dwell per 30 Hz pose, past presentation. */
const RECORDER_POSE_HOLD_MS = 90;

export function App() {
  const started = useGameStore((state) => state.started);
  const patch = useGameStore((state) => state.patch);
  const [visualScenario] = useState(() => visualScenarioFromSearch(window.location.search));
  const [visualFast] = useState(() => new URLSearchParams(window.location.search).get("fast") === "1");
  const [visualRecording] = useState(() => new URLSearchParams(window.location.search).get("recording") === "1");
  const [quality] = useState(() => visualScenario ? 1 : window.matchMedia("(pointer: coarse)").matches ? 1.35 : 1.75);
  const canvasEl = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!visualScenario) return;
    patch({
      started: true,
      enemyEnabled: visualScenario.enemy.enabled,
      enemyAiEnabled: false,
      enemyCount: 1,
      showHitboxes: new URLSearchParams(window.location.search).get("hitboxes") === "1",
      message: visualScenario.label,
    });
  }, [patch, visualScenario]);

  useEffect(() => {
    if (!visualScenario) return;
    // Software WebGL can take far longer than 16 ms to draw a frame. If the
    // validation scene used that wall-clock delta, Rapier/ecctrl could advance
    // a whole jump while the combat clock advanced only its capped 1/30 s,
    // producing footage that no real gameplay clock would produce. Manual R3F
    // advancement keeps every production useFrame subscriber—including the
    // controller, physics, combat FSM, mixer, camera, and probes—on the same
    // fixed simulation clock. Rendering may be slow; the resulting motion is
    // still the exact ordered 30 fps production path.
    let request = 0;
    let recorderPacing = 0;
    let simulationTime = 0;
    let stopped = false;
    const queue = () => {
      if (!stopped) request = window.requestAnimationFrame(step);
    };
    const step = () => {
      simulationTime += 1 / 30;
      advance(simulationTime);
      if (!visualRecording) {
        queue();
        return;
      }
      // Playwright's page video samples at 25 Hz, so a pose must stay on screen
      // across a recorder sample to keep its marker code. A hold of barely one
      // 40 ms recorder period left no margin: screencast delivery jitter alone
      // could drop a single code, and the capture then aborts on an incomplete
      // marker run. Anchor the hold to actual presentation — a rAF after
      // advance() runs at the start of the compositor frame that shows the new
      // pose, so variable software-render time is outside the budget — and hold
      // for more than two recorder periods. Normalization removes this wall
      // delay. No-video smoke runs and ordinary gameplay remain unthrottled.
      window.requestAnimationFrame(() => {
        recorderPacing = window.setTimeout(queue, RECORDER_POSE_HOLD_MS);
      });
    };
    queue();
    return () => {
      stopped = true;
      window.cancelAnimationFrame(request);
      window.clearTimeout(recorderPacing);
    };
  }, [visualRecording, visualScenario]);

  const requestMouseLook = () => {
    if (document.pointerLockElement !== canvasEl.current) canvasEl.current?.requestPointerLock?.();
  };

  const begin = () => {
    combatAudio.unlock();
    enterFullscreen();
    requestMouseLook();
    patch({ started: true, message: "THE HOLLOW WARDEN" });
  };

  return (
    <main
      className={`game-shell${visualScenario ? " visual-scenario" : ""}`}
      data-visual-scenario={visualScenario?.id}
      style={visualScenario ? {
        height: `calc(100% - ${VISUAL_FRAME_MARKER_HEIGHT}px)`,
        top: VISUAL_FRAME_MARKER_HEIGHT,
      } : undefined}
    >
      <Canvas
        frameloop={visualScenario ? "never" : "always"}
        shadows={!visualFast}
        dpr={[1, quality]}
        camera={{ fov: 48, near: 0.1, far: 70, position: [0, 3.5, 10] }}
        gl={{ antialias: !visualFast, powerPreference: "high-performance", alpha: false }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = "srgb";
          gl.shadowMap.type = 2;
          canvasEl.current = gl.domElement;
        }}
        onPointerDown={() => started && requestMouseLook()}
      >
        <CombatScene visualScenario={visualScenario} />
      </Canvas>
      <Hud visualScenario={visualScenario} />
      {visualScenario && <VisualFrameMarker />}
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
