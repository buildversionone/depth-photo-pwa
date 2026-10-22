import { DEFAULT_MOTION_PARAMS, type MotionParams } from '../motion/controller';

export interface Settings extends MotionParams {
  /** Background shift limit as a fraction of the image's shorter side. */
  maxOffset: number;
  motionEnabled: boolean;
  showHud: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  ...DEFAULT_MOTION_PARAMS,
  maxOffset: 0.025,
  motionEnabled: true,
  showHud: false,
};

const KEY = 'depth-photo:settings:v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const out: Settings = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const v = parsed[k];
      if (typeof v === typeof DEFAULT_SETTINGS[k]) (out as unknown as Record<string, unknown>)[k] = v;
    }
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private mode, blocked); settings just won't persist.
  }
}
