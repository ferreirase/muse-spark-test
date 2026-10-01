export type Clock = () => Date;

export const defaultClock: Clock = () => new Date();
