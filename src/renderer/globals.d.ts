import type { Controller } from './controller';
declare global {
  interface Window { karaoke: Controller; desktop?: { platform?: string; chooseLibrary(): Promise<void> } }
}
