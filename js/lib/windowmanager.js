// windowManager.js
// @ts-check

//
//DISCLAIMER: The code in this file was completly written by AI
//

let topZ = 1000;

/**
 * Bring an element to the front by assigning a higher z-index.
 *
 * @param {HTMLElement} el
 * @param {{ baseZ?: number }=} options
 */
export function bringToFront(el, options = {}) {
  const baseZ = options.baseZ ?? 1000;
  if (topZ < baseZ) topZ = baseZ;
  el.style.zIndex = String(++topZ);
}

/**
 * Make an element "focusable" as a window.
 * Clicking or pointer-down brings it to front.
 *
 * @param {HTMLElement} el
 * @param {{ baseZ?: number }=} options
 * @returns {() => void} cleanup
 */

export function makeWindow(el, options = {}) {
  const handler = () => bringToFront(el, options);
  el.addEventListener("pointerdown", handler, { capture: true });
  return () => el.removeEventListener("pointerdown", handler, { capture: true });
}