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
  // only allow: right, bottom, bottom-right
  const handles = [
    { dir: "r", cursor: "ew-resize" },
    { dir: "b", cursor: "ns-resize" },
    { dir: "br", cursor: "nwse-resize" },
  ];

  const minW = options.minWidth ?? 200;
  const minH = options.minHeight ?? 120;

  /** @type {Array<HTMLElement>} */
  const handleEls = [];

  for (const h of handles) {
    const handle = document.createElement("div");
    handle.className = `window-resize-handle ${h.dir}`;
    handle.style.cursor = h.cursor;
    el.appendChild(handle);
    handleEls.push(handle);

    let startX = 0, startY = 0;
    let startW = 0, startH = 0;
    let active = false;

    function onPointerDown(ev) {
      ev.preventDefault();
      ev.stopPropagation();

      bringToFront(el, options);

      const r = el.getBoundingClientRect();
      startX = ev.clientX;
      startY = ev.clientY;
      startW = r.width;
      startH = r.height;
      active = true;

      // capture so we still resize even if pointer leaves handle
      handle.setPointerCapture(ev.pointerId);

      document.addEventListener("pointermove", onPointerMove, { passive: false });
      document.addEventListener("pointerup", onPointerUp, { passive: false });
      document.addEventListener("pointercancel", onPointerUp, { passive: false });
    }

    function onPointerMove(ev) {
      if (!active) return;

      let w = startW;
      let hgt = startH;

      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      if (h.dir === "r" || h.dir === "br") w = startW + dx;
      if (h.dir === "b" || h.dir === "br") hgt = startH + dy;

      w = Math.max(minW, w);
      hgt = Math.max(minH, hgt);

      el.style.width = `${Math.round(w)}px`;
      el.style.height = `${Math.round(hgt)}px`;

      options.onResize?.(Math.round(w), Math.round(hgt));
    }

    function onPointerUp(ev) {
      if (!active) return;
      active = false;

      try { handle.releasePointerCapture(ev.pointerId); } catch {}

      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
    }

    handle.addEventListener("pointerdown", onPointerDown, { passive: false });
  }

  return () => {
    for (const h of handleEls) h.remove();
  };
}
