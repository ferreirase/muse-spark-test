export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(iso: string | Date): Clock {
  const fixed = typeof iso === "string" ? new Date(iso) : iso;
  return { now: () => new Date(fixed.getTime()) };
}

export function toIso(date: Date): string {
  return date.toISOString();
}

export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));
