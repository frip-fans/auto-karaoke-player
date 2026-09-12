interface ControlsOverlay extends EventTarget {
  visible: boolean;
  getTitlebarAreaRect(): DOMRect;
}

/** Reserve the native caption-button area in CSS pixels, including DPI/resize changes. */
export function installTitlebarInsets() {
  const overlay = (navigator as Navigator & { windowControlsOverlay?: ControlsOverlay }).windowControlsOverlay;
  const update = () => {
    let left = 0, right = 0;
    if (overlay?.visible) {
      const area = overlay.getTitlebarAreaRect();
      if (area.width > 0) {
        left = Math.max(0, area.x);
        right = Math.max(0, window.innerWidth - area.right);
      } else if (window.desktop?.platform === 'win32') right = 154;
    } else if (!overlay && window.desktop?.platform === 'win32' && !document.fullscreenElement) {
      right = 154; // Fallback for an older runtime without the geometry API.
    }
    document.documentElement.style.setProperty('--caption-left', `${left}px`);
    document.documentElement.style.setProperty('--caption-right', `${right}px`);
  };
  update();
  overlay?.addEventListener('geometrychange', update);
  window.addEventListener('resize', update);
  document.addEventListener('fullscreenchange', update);
  return () => {
    overlay?.removeEventListener('geometrychange', update);
    window.removeEventListener('resize', update);
    document.removeEventListener('fullscreenchange', update);
  };
}
