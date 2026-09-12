import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Controller } from './controller';
import './styles.css';
import { installTitlebarInsets } from './titlebar';
const disposeTitlebarInsets = installTitlebarInsets();
import.meta.hot?.dispose(disposeTitlebarInsets);
const controller = new Controller();
// Kept for regression tests and local playback diagnostics.
window.karaoke = controller;
createRoot(document.getElementById('root')!).render(<App controller={controller} />);
