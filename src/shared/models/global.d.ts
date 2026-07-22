import type { TailmarkApi } from './index';

declare global {
  interface Window {
    tailmark: TailmarkApi;
  }
}

export {};
