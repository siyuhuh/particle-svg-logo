import type { TrackedHand } from "./useHandTracking";

// A tiny cross-tree channel: HandPointerControl (a DOM overlay) publishes the
// tracked hands here every frame, and scene components inside the R3F canvas
// (e.g. the SDF bubbles) read them to apply NATIVE gesture forces — richer than
// the synthesized pointer events, which can only express one point + one button.
export type SharedHandInput = {
  /** True while a HandPointerControl instance is mounted and publishing. */
  active: boolean;
  /** The live tracked hands (same array instance the tracker mutates). */
  hands: TrackedHand[];
  /** Size (css px) of the view element the hand coordinates are local to. */
  width: number;
  height: number;
};

export const handInput: SharedHandInput = {
  active: false,
  hands: [],
  width: 0,
  height: 0
};
