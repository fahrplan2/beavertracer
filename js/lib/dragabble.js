// @ts-check

//
//DISCLAIMER: The code in this file was completly written by AI
//



/**
 * @typedef {HTMLElement | Document | Window} EventTargetLike
 */

/**
 * @typedef {Object} DraggableOptions
 * @property {HTMLElement=} handle
 *   Element that starts the drag (e.g. title bar). Defaults to `el`.
 * @property {HTMLElement | null=} boundary
 *   Optional boundary element. If provided, `el` is clamped inside its padding box.
 *   If omitted/null, no boundary clamping is applied by default.
 * @property {boolean=} clampToViewport
 *   If true and `boundary` is null/undefined, clamps to the viewport. Default: false.
 * @property {boolean=} preventTextSelection
 *   If true, temporarily disables text selection during drag. Default: true.
 * @property {boolean=} setCursor
 *   If true, sets cursor on handle to grab/grabbing. Default: true.
 * @property {(state: { dragging: boolean, x: number, y: number, event: PointerEvent }) => void=} onMove
 *   Called after each move with the current translate (x,y) in pixels.
 * @property {EventTargetLike=} moveTarget
 *   Where to listen for pointermove/pointerup. Default: window.
 * @property {string=} cancelSelector
 *   If the pointerdown originates within an element matching this selector (via closest()),
 *   the drag will NOT start. Useful for buttons/links/inputs inside the handle.
 *   Default includes common interactive elements + `[data-no-drag]`.
 */

/**
 * @typedef {Object} DraggableController
 * @property {() => void} destroy Remove all listeners and restore temporary styles.
 * @property {() => {x:number, y:number}} getPosition Current translate position in px.
 * @property {(pos:{x?:number, y?:number}) => void} setPosition Set translate position in px.
 * @property {() => boolean} isDragging Whether a drag is currently active.
 */

/**
 * Parse current translate from computed transform (matrix).
 * @param {HTMLElement} el
 * @returns {{x:number, y:number}}
 */
function getCurrentTranslate(el) {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return { x: 0, y: 0 };
  try {
    const m = new DOMMatrixReadOnly(t);
    return { x: m.m41, y: m.m42 };
  } catch {
    return { x: 0, y: 0 };
  }
}

/**
 * Apply translate (overwrites transform for predictability).
 * @param {HTMLElement} el
 * @param {number} x
 * @param {number} y
 */
function applyTranslate(el, x, y) {
  el.style.transform = `translate(${x}px, ${y}px)`;
}

/**
 * Clamp value.
 * @param {number} v
 * @param {number} min
 * @param {number} max
 */
function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Compute clamped translate (x,y) so the element stays within boundary/viewport.
 * Coordinates are in viewport space using getBoundingClientRect.
 *
 * @param {HTMLElement} el
 * @param {{x:number, y:number}} proposed
 * @param {{x:number, y:number}} current
 * @param {HTMLElement | null | undefined} boundary
 * @param {boolean} clampToViewport
 * @returns {{x:number, y:number}}
 */
function clampTranslate(el, proposed, current, boundary, clampToViewport) {
  const elRectNow = el.getBoundingClientRect();

  const dx = proposed.x - current.x;
  const dy = proposed.y - current.y;

  const nextLeft = elRectNow.left + dx;
  const nextTop = elRectNow.top + dy;
  const nextRight = elRectNow.right + dx;
  const nextBottom = elRectNow.bottom + dy;

  /** @type {{left:number, top:number, right:number, bottom:number} | null} */
  let box = null;

  if (boundary instanceof HTMLElement) {
    const b = boundary.getBoundingClientRect();
    const cs = getComputedStyle(boundary);
    const bl = parseFloat(cs.borderLeftWidth) || 0;
    const bt = parseFloat(cs.borderTopWidth) || 0;
    const br = parseFloat(cs.borderRightWidth) || 0;
    const bb = parseFloat(cs.borderBottomWidth) || 0;

    box = {
      left: b.left + bl,
      top: b.top + bt,
      right: b.right - br,
      bottom: b.bottom - bb,
    };
  } else if (clampToViewport) {
    box = {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };
  } else {
    return proposed;
  }

  let clampedX = proposed.x;
  let clampedY = proposed.y;

  const boxW = box.right - box.left;
  const boxH = box.bottom - box.top;

  if (elRectNow.width <= boxW) {
    if (nextLeft < box.left) clampedX += (box.left - nextLeft);
    if (nextRight > box.right) clampedX -= (nextRight - box.right);
  } else {
    if (nextLeft !== box.left) clampedX += (box.left - nextLeft);
  }

  if (elRectNow.height <= boxH) {
    if (nextTop < box.top) clampedY += (box.top - nextTop);
    if (nextBottom > box.bottom) clampedY -= (nextBottom - box.bottom);
  } else {
    if (nextTop !== box.top) clampedY += (box.top - nextTop);
  }

  return { x: clampedX, y: clampedY };
}

/**
 * Make an element draggable (transform-based) with optional cancelSelector.
 *
 * @param {HTMLElement} el The element that should move.
 * @param {DraggableOptions=} options Options.
 * @returns {DraggableController}
 */
export function makeDraggable(el, options = {}) {
  if (!(el instanceof HTMLElement)) {
    throw new TypeError("makeDraggable: el must be an HTMLElement");
  }

  const {
    handle = el,
    boundary = null,
    clampToViewport = false,
    preventTextSelection = true,
    setCursor = true,
    onMove,
    moveTarget = window,
    cancelSelector = [
      "button",
      "a",
      "input",
      "textarea",
      "select",
      "option",
      "[role='button']",
      "[contenteditable='true']",
      "[data-no-drag]",
    ].join(","),
  } = options;

  if (!(handle instanceof HTMLElement)) {
    throw new TypeError("makeDraggable: options.handle must be an HTMLElement");
  }

  let dragging = false;
  /** @type {number | null} */
  let activePointerId = null;

  let startPointerX = 0;
  let startPointerY = 0;

  let startTranslate = getCurrentTranslate(el);
  let currentTranslate = { ...startTranslate };

  const prev = {
    userSelect: document.documentElement.style.userSelect,
    cursor: handle.style.cursor,
    touchAction: handle.style.touchAction,
  };

  if (!handle.style.touchAction) handle.style.touchAction = "none";
  if (setCursor && !handle.style.cursor) handle.style.cursor = "grab";

  /**
   * Returns true if this pointerdown should NOT start a drag due to cancelSelector.
   * @param {PointerEvent} e
   */
  function isCanceledBySelector(e) {
    const tgt = e.target;
    if (!(tgt instanceof Element)) return false;
    // Only cancel if the target is inside the handle; otherwise closest() could match outside in weird cases.
    if (!handle.contains(tgt)) return false;
    if (!cancelSelector) return false;
    try {
      return Boolean(tgt.closest(cancelSelector));
    } catch {
      // If the selector is invalid, don't block dragging.
      return false;
    }
  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerDown(e) {
    // Only primary mouse button
    if (e.pointerType === "mouse" && e.button !== 0) return;

    // Option 1: Don't start drag when clicking interactive elements inside the handle.
    if (isCanceledBySelector(e)) return;

    dragging = true;
    activePointerId = e.pointerId;

    handle.setPointerCapture(activePointerId);

    if (setCursor) handle.style.cursor = "grabbing";
    if (preventTextSelection) document.documentElement.style.userSelect = "none";

    startPointerX = e.clientX;
    startPointerY = e.clientY;

    startTranslate = getCurrentTranslate(el);
    currentTranslate = { ...startTranslate };

  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerMove(e) {
    if (!dragging || e.pointerId !== activePointerId) return;

    const dx = e.clientX - startPointerX;
    const dy = e.clientY - startPointerY;

    let proposed = { x: startTranslate.x + dx, y: startTranslate.y + dy };
    proposed = clampTranslate(el, proposed, currentTranslate, boundary, clampToViewport);

    currentTranslate = proposed;
    applyTranslate(el, currentTranslate.x, currentTranslate.y);

    if (typeof onMove === "function") {
      onMove({ dragging: true, x: currentTranslate.x, y: currentTranslate.y, event: e });
    }
  }

  /**
   * @param {PointerEvent} e
   */
  function endDrag(e) {
    if (!dragging || e.pointerId !== activePointerId) return;

    dragging = false;

    if (setCursor) handle.style.cursor = prev.cursor || "grab";
    if (preventTextSelection) document.documentElement.style.userSelect = prev.userSelect;

    try {
      if (activePointerId != null) handle.releasePointerCapture(activePointerId);
    } catch {
      // ignore
    }
    activePointerId = null;

    if (typeof onMove === "function") {
      onMove({ dragging: false, x: currentTranslate.x, y: currentTranslate.y, event: e });
    }
  }

  handle.addEventListener("pointerdown", onPointerDown);

  // @ts-ignore - EventTargetLike union; runtime supports add/removeEventListener.
  moveTarget.addEventListener("pointermove", onPointerMove);
  // @ts-ignore
  moveTarget.addEventListener("pointerup", endDrag);
  // @ts-ignore
  moveTarget.addEventListener("pointercancel", endDrag);

  return {
    destroy() {
      handle.removeEventListener("pointerdown", onPointerDown);
      // @ts-ignore
      moveTarget.removeEventListener("pointermove", onPointerMove);
      // @ts-ignore
      moveTarget.removeEventListener("pointerup", endDrag);
      // @ts-ignore
      moveTarget.removeEventListener("pointercancel", endDrag);

      if (setCursor) handle.style.cursor = prev.cursor;
      handle.style.touchAction = prev.touchAction;
      if (preventTextSelection) document.documentElement.style.userSelect = prev.userSelect;
    },

    getPosition() {
      return { ...currentTranslate };
    },

    setPosition(pos) {
      const x = Number.isFinite(pos.x) ? /** @type {number} */ (pos.x) : currentTranslate.x;
      const y = Number.isFinite(pos.y) ? /** @type {number} */ (pos.y) : currentTranslate.y;

      const proposed = { x, y };
      const clamped = clampTranslate(el, proposed, currentTranslate, boundary, clampToViewport);

      currentTranslate = clamped;
      applyTranslate(el, currentTranslate.x, currentTranslate.y);
    },

    isDragging() {
      return dragging;
    },
  };
}
