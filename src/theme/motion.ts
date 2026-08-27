/**
 * Motion tokens, and the three hooks that use them.
 *
 * The app had no animation at all. Adding some is not decoration: a number that
 * changes instantly when you page from August to July gives no sense that
 * anything moved, and a list that appears fully formed gives no sense of what
 * arrived. Motion is how an interface says "this changed, and here is what".
 *
 * Rules it follows:
 *
 *  - **Short.** 180–320ms. Anything slower is something you wait for, and this
 *    is a screen people open forty times a month.
 *  - **Native driver wherever possible.** Transforms and opacity run on the UI
 *    thread; only the count-up cannot, because text content is not animatable.
 *  - **Never blocks reading.** Everything starts from a legible state or
 *    reaches one within one frame budget. A balance you cannot read yet is
 *    worse than one that did not animate.
 *  - **Respects the OS setting.** Someone who has asked for reduced motion has
 *    asked for a reason, and gets the end state immediately.
 *
 * Uses React Native's built-in `Animated`, not Reanimated. Reanimated is a
 * dependency and its babel plugin is configured, but worklets need the native
 * side to match the JS exactly — and this app ships JS-only updates over the
 * air to a build that may be older. `Animated` has no such coupling.
 */

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

export const duration = {
  /** Press feedback: must feel immediate. */
  instant: 90,
  /** The default. Entrances, fades, bar fills. */
  base: 220,
  /** Longer moves that carry meaning, like a number counting up. */
  deliberate: 320,
} as const;

/** Decelerating: fast out of the gate, gentle into place. */
export const easing = {
  out: Easing.bezier(0.16, 1, 0.3, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
} as const;

/** Has the user asked the OS for less movement? */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => alive && setReduced(value))
      .catch(() => undefined);

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);

  return reduced;
}

/**
 * Fade and rise into place.
 *
 * `index` staggers a list so it assembles top to bottom instead of flashing in
 * as one block. The stagger is capped: past a handful of rows the delay stops
 * reading as sequence and starts reading as lag.
 */
export function useEnter(index = 0, enabled = true) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(reduced || !enabled ? 1 : 0)).current;

  useEffect(() => {
    if (reduced || !enabled) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: duration.base,
      delay: Math.min(index, 6) * 45,
      easing: easing.out,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, index, enabled, reduced]);

  return {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }),
      },
    ],
  };
}

/** Scale down slightly while held. The cheapest way to make a card feel real. */
export function usePressScale(to = 0.97) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;

  const animate = (value: number) =>
    Animated.timing(scale, {
      toValue: value,
      duration: duration.instant,
      easing: easing.out,
      useNativeDriver: true,
    }).start();

  return {
    style: { transform: [{ scale }] },
    onPressIn: () => !reduced && animate(to),
    onPressOut: () => !reduced && animate(1),
  };
}

/**
 * Count a number up to its new value.
 *
 * Deliberately not driven by `Animated` interpolation: text content cannot be
 * animated natively, so this ticks React state on a frame loop and formats each
 * step. That is fine for one or two headline figures and wasteful for a list,
 * which is why it is a hook you opt into rather than something `AmountText`
 * does everywhere.
 *
 * Jumps straight to the target on the first render — an opening balance should
 * be readable immediately, not spooled up while you wait.
 */
export function useCountUp(target: number, enabled = true): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      from.current = target;
      setValue(target);
      return;
    }

    if (reduced || !enabled) {
      from.current = target;
      setValue(target);
      return;
    }

    const start = Date.now();
    const origin = from.current;
    const distance = target - origin;
    if (distance === 0) return;

    let frame: number;
    const tick = () => {
      const elapsed = Date.now() - start;
      const t = Math.min(1, elapsed / duration.deliberate);
      // Cubic ease-out, matching `easing.out` closely enough for digits.
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(origin + distance * eased);
      setValue(next);

      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };

    frame = requestAnimationFrame(tick);

    /**
     * The animation is decoration; the number is not.
     *
     * `requestAnimationFrame` does not fire while the app is backgrounded or
     * the screen is off, so a count-up interrupted halfway leaves a figure on
     * screen that is simply wrong — and a wrong balance is the one thing this
     * app cannot do. This timer always fires, and always lands on the truth.
     */
    const settle = setTimeout(() => {
      cancelAnimationFrame(frame);
      from.current = target;
      setValue(target);
    }, duration.deliberate + 80);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
    };
  }, [target, enabled, reduced]);

  return value;
}
