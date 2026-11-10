// Tray geometry in CSS px (the 176 × 403 design box). Shared by the render and the page CSS.
export const TRAY = { W: 176, H: 403, rim: 12, wallTop: 10, wallBottom: 26, wallSide: 16 };
export const PANEL = {
  left: TRAY.rim + TRAY.wallSide,
  right: TRAY.W - TRAY.rim - TRAY.wallSide,
  top: TRAY.rim + TRAY.wallTop,
  bottom: TRAY.H - TRAY.rim - TRAY.wallBottom,
};
export const OPENING = {
  left: TRAY.rim,
  right: TRAY.W - TRAY.rim,
  top: TRAY.rim,
  bottom: TRAY.H - TRAY.rim,
};
export const STRIP_REST = { widthPx: 84, bottomPx: 379.3, rotateDeg: -2.2 };
export const pct = (px, of) => +(px / of * 100).toFixed(3);
