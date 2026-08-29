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
 *   aspectRatio?: number,
 *   aspectRatioTarget?: HTMLElement | string,
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


/** @param {HTMLElement} el @param {*} options */
function makeResizable(el, options) {
  // only allow: right, bottom, bottom-right
  const handles = [
    { dir: "r", cursor: "ew-resize" },
    { dir: "b", cursor: "ns-resize" },
    { dir: "br", cursor: "nwse-resize" },
  ];

  const minW = options.minWidth ?? 200;
  const minH = options.minHeight ?? 120;

  // Optional aspect-ratio lock. `aspectRatio` is width/height of the box we
  // keep at that ratio; `aspectRatioTarget` names that box (a child of `el`,
  // e.g. the panel body) so the chrome around it — border, header — is kept
  // out of the ratio. Defaults to `el` itself (no inset).
  const aspect = typeof options.aspectRatio === "number" && options.aspectRatio > 0
    ? options.aspectRatio
    : 0;
  /** @returns {HTMLElement} */
  const aspectBox = () => {
    const t = options.aspectRatioTarget;
    if (t instanceof HTMLElement) return t;
    if (typeof t === "string") {
      const found = el.querySelector(t);
      if (found instanceof HTMLElement) return found;
    }
    return el;
  };

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
    let insetW = 0, insetH = 0; // chrome around the aspect box (px)
    let active = false;

    /** @param {PointerEvent} ev */
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

      if (aspect) {
        const box = aspectBox();
        insetW = box === el ? 0 : Math.max(0, startW - box.clientWidth);
        insetH = box === el ? 0 : Math.max(0, startH - box.clientHeight);
      }

      // capture so we still resize even if pointer leaves handle
      handle.setPointerCapture(ev.pointerId);

      document.addEventListener("pointermove", onPointerMove, { passive: false });
      document.addEventListener("pointerup", onPointerUp, { passive: false });
      document.addEventListener("pointercancel", onPointerUp, { passive: false });
    }

    /** @param {PointerEvent} ev */
    function onPointerMove(ev) {
      if (!active) return;

      let w = startW;
      let hgt = startH;

      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      if (h.dir === "r" || h.dir === "br") w = startW + dx;
      if (h.dir === "b" || h.dir === "br") hgt = startH + dy;

      if (aspect) {
        // Constrain the aspect box (el minus chrome) to `aspect`; derive both
        // panel dimensions from a single driver so the shape can't drift.
        const boxWfromX = (w - insetW);
        const boxWfromY = (hgt - insetH) * aspect;
        let boxW =
          h.dir === "r"  ? boxWfromX :
          h.dir === "b"  ? boxWfromY :
          Math.max(boxWfromX, boxWfromY); // corner: follow whichever axis pulls harder

        const boxWmin = Math.max(minW - insetW, (minH - insetH) * aspect);
        boxW = Math.max(boxWmin, boxW);

        w = boxW + insetW;
        hgt = boxW / aspect + insetH;
      } else {
        w = Math.max(minW, w);
        hgt = Math.max(minH, hgt);
      }

      el.style.width = `${Math.round(w)}px`;
      el.style.height = `${Math.round(hgt)}px`;

      options.onResize?.(Math.round(w), Math.round(hgt));
    }

    /** @param {PointerEvent} ev */
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
