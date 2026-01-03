// @ts-check

/**
 * @typedef {HTMLElement | Document | Window} EventTargetLike
 */

/**
 * boundary can be:
 * - HTMLElement (static)
 * - null/undefined (no boundary)
 * - () => HTMLElement|null (dynamic / late-bound boundary)
 * @typedef {HTMLElement | null | undefined | (() => HTMLElement | null)} BoundaryLike
 */

/**
 * @typedef {Object} DraggableOptions
 * @property {HTMLElement=} handle
 * @property {BoundaryLike=} boundary
 * @property {boolean=} clampToViewport
 * @property {boolean=} preventTextSelection
 * @property {boolean=} setCursor
 * @property {(state: { dragging: boolean, x: number, y: number, event: PointerEvent }) => void=} onMove
 * @property {(info: { x:number, y:number, event: PointerEvent }) => void=} onClick
 * @property {(info: { x:number, y:number, event: PointerEvent }) => void=} onDragStart
 * @property {(info: { x:number, y:number, event: PointerEvent }) => void=} onDragEnd
 * @property {EventTargetLike=} moveTarget
 * @property {string=} cancelSelector
 * @property {number=} dragThreshold
 * @property {boolean=} longPressToDrag
 * @property {number=} longPressDelay
 */

/**
 * @typedef {Object} DraggableController
 * @property {() => void} destroy
 * @property {() => {x:number, y:number}} getPosition
 * @property {(pos:{x?:number, y?:number}) => void} setPosition
 * @property {() => boolean} isDragging
 */

/**
 * Minimal interface so @ts-check doesn't freak out on unions.
 * @typedef {Object} ListenerTarget
 * @property {(type: string, listener: EventListenerOrEventListenerObject, options?: any) => void} addEventListener
 * @property {(type: string, listener: EventListenerOrEventListenerObject, options?: any) => void} removeEventListener
 */

/**
 * @param {EventTargetLike} t
 * @returns {ListenerTarget}
 */
function asListenerTarget(t) {
  //@ts-ignore
  return t;
}

/**
 * Resolve BoundaryLike to an actual HTMLElement|null (dynamic supported).
 * @param {BoundaryLike} boundaryLike
 * @returns {HTMLElement|null}
 */
function resolveBoundary(boundaryLike) {
  try {
    if (typeof boundaryLike === "function") return boundaryLike() ?? null;
    return boundaryLike instanceof HTMLElement ? boundaryLike : null;
  } catch {
    return null;
  }
}

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
 * Compute clamped translate (x,y) so the element stays within boundary/viewport.
 * Coordinates are in viewport space using getBoundingClientRect.
 *
 * @param {HTMLElement} el
 * @param {{x:number, y:number}} proposed
 * @param {{x:number, y:number}} current
 * @param {BoundaryLike} boundaryLike
 * @param {boolean} clampToViewport
 * @returns {{x:number, y:number}}
 */
function clampTranslate(el, proposed, current, boundaryLike, clampToViewport) {
  const elRectNow = el.getBoundingClientRect();

  const dx = proposed.x - current.x;
  const dy = proposed.y - current.y;

  const nextLeft = elRectNow.left + dx;
  const nextTop = elRectNow.top + dy;
  const nextRight = elRectNow.right + dx;
  const nextBottom = elRectNow.bottom + dy;

  /** @type {{left:number, top:number, right:number, bottom:number} | null} */
  let box = null;

  const boundary = resolveBoundary(boundaryLike);

  if (boundary instanceof HTMLElement) {
    const b = boundary.getBoundingClientRect();

    // If boundary has no size yet (e.g. freshly re-rendered), do NOT clamp.
    // Clamping to a 0×0 box makes everything snap to the box edge (looks like 0,0).
    if (b.width < 2 || b.height < 2) return proposed;

    const cs = getComputedStyle(boundary);
    const bl = parseFloat(cs.borderLeftWidth) || 0;
    const bt = parseFloat(cs.borderTopWidth) || 0;
    const br = parseFloat(cs.borderRightWidth) || 0;
    const bb = parseFloat(cs.borderBottomWidth) || 0;

    box = { left: b.left + bl, top: b.top + bt, right: b.right - br, bottom: b.bottom - bb };
  } else if (clampToViewport) {
    box = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
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
 * @param {HTMLElement} el
 * @param {DraggableOptions=} options
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
    onClick,
    onDragStart,
    onDragEnd,
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
    dragThreshold = 6,
    longPressToDrag = false,
    longPressDelay = 350,
  } = options;

  if (!(handle instanceof HTMLElement)) {
    throw new TypeError("makeDraggable: options.handle must be an HTMLElement");
  }

  const mt = asListenerTarget(moveTarget);

  const prev = {
    userSelect: document.documentElement.style.userSelect,
    cursor: handle.style.cursor,
    touchAction: handle.style.touchAction,
  };

  if (!handle.style.touchAction) handle.style.touchAction = "none";
  if (setCursor && !handle.style.cursor) handle.style.cursor = "grab";

  let dragging = false;
  let dragStarted = false;

  /** @type {number | null} */
  let activePointerId = null;

  let startPointerX = 0;
  let startPointerY = 0;

  let startTranslate = getCurrentTranslate(el);
  let currentTranslate = { ...startTranslate };

  /** @type {ReturnType<typeof window.setTimeout> | null} */
  let longPressTimer = null;

  let dragAllowed = false;

  function clearLongPressTimer() {
    if (longPressTimer != null) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  /**
   * @param {PointerEvent} e
   * @returns {boolean}
   */
  function isCanceledBySelector(e) {
    const tgt = e.target;
    if (!(tgt instanceof Element)) return false;
    if (!handle.contains(tgt)) return false;
    if (!cancelSelector) return false;
    try {
      return Boolean(tgt.closest(cancelSelector));
    } catch {
      return false;
    }
  }

  /**
   * @param {boolean} on
   */
  function setDraggingStyles(on) {
    if (setCursor) handle.style.cursor = on ? "grabbing" : (prev.cursor || "grab");
    if (preventTextSelection) document.documentElement.style.userSelect = on ? "none" : prev.userSelect;
  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (isCanceledBySelector(e)) return;

    activePointerId = e.pointerId;
    handle.setPointerCapture(activePointerId);

    dragging = true;
    dragStarted = false;

    startPointerX = e.clientX;
    startPointerY = e.clientY;

    startTranslate = getCurrentTranslate(el);
    currentTranslate = { ...startTranslate };

    dragAllowed = !longPressToDrag || e.pointerType === "mouse";
    clearLongPressTimer();

    if (!dragAllowed) {
      longPressTimer = window.setTimeout(() => {
        dragAllowed = true;
      }, longPressDelay);
    }
  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerMove(e) {
    if (!dragging) return;
    if (activePointerId == null) return;
    if (e.pointerId !== activePointerId) return;

    const dx = e.clientX - startPointerX;
    const dy = e.clientY - startPointerY;

    if (!dragAllowed) {
      if (Math.hypot(dx, dy) > dragThreshold) clearLongPressTimer();
      return;
    }

    if (!dragStarted) {
      if (Math.hypot(dx, dy) < dragThreshold) return;
      dragStarted = true;
      clearLongPressTimer();
      setDraggingStyles(true);

      if (typeof onDragStart === "function") {
        onDragStart({ x: currentTranslate.x, y: currentTranslate.y, event: e });
      }
    }

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
  function endDragOrClick(e) {
    if (!dragging) return;
    if (activePointerId == null) return;
    if (e.pointerId !== activePointerId) return;

    clearLongPressTimer();

    const didDrag = dragStarted;

    dragging = false;
    dragStarted = false;

    setDraggingStyles(false);

    try {
      handle.releasePointerCapture(activePointerId);
    } catch {
      // ignore
    }
    activePointerId = null;

    if (didDrag) {
      if (typeof onMove === "function") {
        onMove({ dragging: false, x: currentTranslate.x, y: currentTranslate.y, event: e });
      }
      if (typeof onDragEnd === "function") {
        onDragEnd({ x: currentTranslate.x, y: currentTranslate.y, event: e });
      }
    } else {
      if (typeof onClick === "function") {
        onClick({ x: currentTranslate.x, y: currentTranslate.y, event: e });
      }
    }
  }

  handle.addEventListener("pointerdown", onPointerDown);
  mt.addEventListener("pointermove", /** @type {EventListener} */ (onPointerMove));
  mt.addEventListener("pointerup", /** @type {EventListener} */ (endDragOrClick));
  mt.addEventListener("pointercancel", /** @type {EventListener} */ (endDragOrClick));

  return {
    destroy() {
      clearLongPressTimer();

      handle.removeEventListener("pointerdown", onPointerDown);
      mt.removeEventListener("pointermove", /** @type {EventListener} */ (onPointerMove));
      mt.removeEventListener("pointerup", /** @type {EventListener} */ (endDragOrClick));
      mt.removeEventListener("pointercancel", /** @type {EventListener} */ (endDragOrClick));

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
      return dragging && dragStarted;
    },
  };
}
