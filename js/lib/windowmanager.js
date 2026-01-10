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
 * @param {HTMLElement} el
 * @param {{
 *   baseZ?: number,
 *   resizable?: boolean,
 *   minWidth?: number,
 *   minHeight?: number,
 *   onResize?: (w: number, h: number) => void
 * }=} options
 * @returns {() => void} cleanup
 */
export function makeWindow(el, options = {}) {
  const handler = () => bringToFront(el, options);
  el.addEventListener("pointerdown", handler, { capture: true });

  let cleanupResize = null;

  if (options.resizable) {
    cleanupResize = makeResizable(el, options);
  }

  return () => {
    el.removeEventListener("pointerdown", handler, { capture: true });
    cleanupResize?.();
  };
}


function makeResizable(el, options) {
  const handle = document.createElement("div");
  handle.className = "window-resize-handle";
  el.appendChild(handle);

  let startX = 0, startY = 0;
  let startW = 0, startH = 0;

  const minW = options.minWidth ?? 200;
  const minH = options.minHeight ?? 120;

  function onPointerDown(ev) {
    ev.preventDefault();
    ev.stopPropagation();

    bringToFront(el, options);

    const r = el.getBoundingClientRect();
    startX = ev.clientX;
    startY = ev.clientY;
    startW = r.width;
    startH = r.height;

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  }

  function onPointerMove(ev) {
    const w = Math.max(minW, startW + (ev.clientX - startX));
    const h = Math.max(minH, startH + (ev.clientY - startY));

    el.style.width = `${w}px`;
    el.style.height = `${h}px`;

    options.onResize?.(Math.round(w), Math.round(h));
  }

  function onPointerUp() {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
  }

  handle.addEventListener("pointerdown", onPointerDown);

  return () => {
    handle.removeEventListener("pointerdown", onPointerDown);
    handle.remove();
  };
}
