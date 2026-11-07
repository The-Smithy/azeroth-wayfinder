declare module 'zzfx' {
  export const ZZFX: { volume: number; audioContext: AudioContext; [key: string]: unknown };
  export function zzfx(...parameters: (number | undefined)[]): AudioBufferSourceNode;
}
