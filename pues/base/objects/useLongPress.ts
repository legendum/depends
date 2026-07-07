import { useCallback, useEffect, useMemo, useRef } from "react";

/** Same affordances swipe-to-reveal skips — do not start a hold here. */
const DEFAULT_IGNORE_SELECTORS = [
  "button.row-edit",
  "button.row-delete",
  ".pues-drag-handle",
];

const DEFAULT_DURATION_MS = 600;
/** Align with swipe direction lock (~6px) so horizontal swipes cancel the press. */
const DEFAULT_MOVE_PX = 6;

type PressState = {
  pointerId: number;
  startX: number;
  startY: number;
  invalid: boolean;
  fired: boolean;
};

export type LongPressHandlers = {
  onPointerDownCapture: (e: React.PointerEvent) => void;
  onPointerMoveCapture: (e: React.PointerEvent) => void;
  onPointerUpCapture: (e: React.PointerEvent) => void;
  onPointerCancelCapture: (e: React.PointerEvent) => void;
};

export function useLongPress(options: {
  enabled?: boolean;
  durationMs?: number;
  moveThresholdPx?: number;
  ignoreSelectors?: string[];
  onLongPress: () => void;
}): LongPressHandlers {
  const {
    enabled = true,
    durationMs = DEFAULT_DURATION_MS,
    moveThresholdPx = DEFAULT_MOVE_PX,
    ignoreSelectors = [],
    onLongPress,
  } = options;

  const pressRef = useRef<PressState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;

  const allIgnore = useMemo(
    () => [...DEFAULT_IGNORE_SELECTORS, ...ignoreSelectors],
    [ignoreSelectors],
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearPress = useCallback(
    (pointerId: number) => {
      clearTimer();
      if (pressRef.current?.pointerId === pointerId) pressRef.current = null;
    },
    [clearTimer],
  );

  useEffect(() => () => clearTimer(), [clearTimer]);

  const isIgnoredTarget = useCallback(
    (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      for (const selector of allIgnore) {
        if (target.closest(selector)) return true;
      }
      return false;
    },
    [allIgnore],
  );

  const onPointerDownCapture = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || e.button !== 0) return;
      if (isIgnoredTarget(e.target)) return;

      clearTimer();
      pressRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        invalid: false,
        fired: false,
      };

      timerRef.current = setTimeout(() => {
        const press = pressRef.current;
        if (!press || press.invalid || press.fired || !enabled) return;
        press.fired = true;
        onLongPressRef.current();
      }, durationMs);
    },
    [enabled, isIgnoredTarget, durationMs, clearTimer],
  );

  const onPointerMoveCapture = useCallback(
    (e: React.PointerEvent) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== e.pointerId || press.invalid) return;
      const dx = e.clientX - press.startX;
      const dy = e.clientY - press.startY;
      if (dx * dx + dy * dy > moveThresholdPx * moveThresholdPx) {
        press.invalid = true;
        clearTimer();
      }
    },
    [moveThresholdPx, clearTimer],
  );

  const onPointerUpCapture = useCallback(
    (e: React.PointerEvent) => {
      clearPress(e.pointerId);
    },
    [clearPress],
  );

  const onPointerCancelCapture = useCallback(
    (e: React.PointerEvent) => {
      clearPress(e.pointerId);
    },
    [clearPress],
  );

  return {
    onPointerDownCapture,
    onPointerMoveCapture,
    onPointerUpCapture,
    onPointerCancelCapture,
  };
}
