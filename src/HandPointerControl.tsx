import { useEffect, useRef } from "react";
import { useHandTracking } from "./useHandTracking";
import { handInput } from "./handInput";

// A pointerId no real device will use, so hand-driven events are distinguishable.
const VIRTUAL_POINTER_ID = 0x7ab;

// Webcam hand → virtual pointer for every non-walkers style. The primary hand's
// palm becomes the cursor; each frame we synthesize a PointerEvent at the topmost
// element under it — exactly the element a real mouse would hit — so R3F's
// state.pointer, the canvas DOM listeners (trail/surface) and the React overlay
// handlers (ascii2/fancy) are all driven through their existing code paths.
// The raw tracked hands are also published to handInput for scene components
// that implement native gesture forces (e.g. the SDF bubbles).
export function HandPointerControl({
  hint,
  nativeGestures = false
}: {
  hint?: string;
  nativeGestures?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const { handsRef, status, modelReady, videoRef } = useHandTracking({
    enabled: true,
    viewRef: wrapRef
  });

  // PiP: adopt the tracker's <video> so you can see what the camera sees.
  useEffect(() => {
    const holder = previewRef.current;
    const video = videoRef.current;
    if (status !== "active" || !holder || !video) {
      return;
    }
    holder.appendChild(video);
    return () => {
      if (video.parentElement === holder) {
        holder.removeChild(video);
      }
    };
  }, [status, videoRef]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }

    handInput.active = true;

    let raf = 0;
    let pressed = false;
    let lastX = 0;
    let lastY = 0;

    const findTarget = (clientX: number, clientY: number) =>
      document.elementFromPoint(clientX, clientY) ??
      wrap.parentElement?.querySelector("canvas") ??
      null;

    const dispatch = (
      type: "pointermove" | "pointerdown" | "pointerup",
      clientX: number,
      clientY: number
    ) => {
      const target = findTarget(clientX, clientY);
      if (!target) {
        return;
      }
      target.dispatchEvent(
        new PointerEvent(type, {
          clientX,
          clientY,
          bubbles: true,
          cancelable: true,
          view: window,
          pointerId: VIRTUAL_POINTER_ID,
          pointerType: "mouse",
          isPrimary: true,
          button: type === "pointermove" ? -1 : 0,
          buttons: type === "pointerup" ? 0 : pressed || type === "pointerdown" ? 1 : 0
        })
      );
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const cursor = cursorRef.current;

      const hands = handsRef.current;
      const rect = wrap.getBoundingClientRect();
      handInput.hands = hands;
      handInput.width = rect.width;
      handInput.height = rect.height;

      let hand = null;
      for (let i = 0; i < hands.length; i += 1) {
        if (hands[i].active > 0.4) {
          hand = hands[i];
          break;
        }
      }

      if (!hand) {
        // Hand left the frame — release any held press so styles don't stay pressed.
        if (pressed && !nativeGestures) {
          pressed = false;
          dispatch("pointerup", lastX, lastY);
        }
        if (cursor) {
          cursor.style.opacity = "0";
        }
        pressed = false;
        return;
      }

      const clientX = rect.left + hand.x;
      const clientY = rect.top + hand.y;
      lastX = clientX;
      lastY = clientY;

      // Pinch or fist reads as "press" — drives pointerdown behaviours (elastic
      // squash etc.); an open hand just moves the pointer.
      const wantPress = hand.gesture === "pinch" || hand.gesture === "fist";
      if (nativeGestures) {
        pressed = wantPress;
      } else {
        if (wantPress && !pressed) {
          pressed = true;
          dispatch("pointerdown", clientX, clientY);
        }
        dispatch("pointermove", clientX, clientY);
        if (!wantPress && pressed) {
          pressed = false;
          dispatch("pointerup", clientX, clientY);
        }
      }

      if (cursor) {
        const x = nativeGestures
          ? hand.gesture === "pinch" ? hand.pinchX : hand.gesture === "point" ? hand.tipX : hand.x
          : hand.x;
        const y = nativeGestures
          ? hand.gesture === "pinch" ? hand.pinchY : hand.gesture === "point" ? hand.tipY : hand.y
          : hand.y;
        cursor.style.opacity = "1";
        cursor.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${
          pressed ? 0.68 : 1
        })`;
        cursor.classList.toggle("is-pressed", pressed);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      handInput.active = false;
      handInput.hands = [];
      handInput.width = 0;
      handInput.height = 0;
      if (pressed && !nativeGestures) {
        dispatch("pointerup", lastX, lastY);
      }
    };
  }, [handsRef, nativeGestures]);

  return (
    <div ref={wrapRef} className="hand-pointer-overlay" aria-hidden="true">
      <div ref={cursorRef} className="hand-pointer-cursor" />
      <div ref={previewRef} className="hand-pointer-preview" />
      <div className={`hand-pointer-status status-${status}`} role="status">
        {status === "idle" && "Hand control · starting…"}
        {status === "requesting" && "Hand control · requesting camera…"}
        {status === "active" &&
          (modelReady
            ? hint ?? "Hand control · move a hand · pinch or fist to press"
            : "Hand control · loading hand tracker…")}
        {status === "denied" && "Hand control · camera denied"}
        {status === "unsupported" && "Hand control needs HTTPS or localhost"}
        {status === "error" && "Hand control · camera unavailable"}
      </div>
    </div>
  );
}
