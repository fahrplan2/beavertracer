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
 * @property {(() => boolean)=} canDrag
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


let suppressNextClick = false;

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
 * IMPORTANT: clamps only TOP/LEFT (west/north) like you wanted.
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

  /** @type {{left:number, top:number, right:number, bottom:number} | null} */
  let box = null;

  const boundary = resolveBoundary(boundaryLike);

  if (boundary instanceof HTMLElement) {
    const b = boundary.getBoundingClientRect();

    // If boundary has no size yet (e.g. freshly mounted), do NOT clamp.
    if (b.width < 2 || b.height < 2) return proposed;

    // clientLeft/Top include border; clientWidth/Height exclude scrollbars.
    box = {
      left: b.left + boundary.clientLeft,
      top: b.top + boundary.clientTop,
      right: b.left + boundary.clientLeft + boundary.clientWidth,
      bottom: b.top + boundary.clientTop + boundary.clientHeight,
    };
  } else if (clampToViewport) {
    box = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  } else {
    return proposed;
  }

  let clampedX = proposed.x;
  let clampedY = proposed.y;

  // only prevent leaving west/north (left/top)
  if (nextLeft < box.left) clampedX += (box.left - nextLeft);
  if (nextTop < box.top) clampedY += (box.top - nextTop);

  return { x: clampedX, y: clampedY };
}


/**
 * @param {HTMLElement} targetEl
 * @param {PointerEvent} e
 * @param {number} sizePx
 */
function isOnResizeHandle(targetEl, e, sizePx = 16) {
  const cs = getComputedStyle(targetEl);
  if (!cs || cs.resize === "none") return false;

  const r = targetEl.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;

  if (r.width < 2 || r.height < 2) return false;

  return x >= r.width - sizePx && y >= r.height - sizePx;
}


/**
 * @param {HTMLElement} el
 * @param {DraggableOptions=} options
 * @returns {DraggableController}
 */

export function makeDraggable(el, options = {}) {
  const autoScrollMargin = 40; // px from edge to start scrolling
  const autoScrollStep = 18;   // px per frame (tune)
  let autoScrollRaf = /** @type {number|null} */ (null);

  /** @type {{x:number, y:number, event: PointerEvent} | null} */
  let lastPointer = null;

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
    canDrag = () => true,
  } = options;

  if (!(handle instanceof HTMLElement)) {
    throw new TypeError("makeDraggable: options.handle must be an HTMLElement");
  }

  /** @type {HTMLElement|null} */
  let activeBoundaryEl = null;
  let startScrollLeft = 0;
  let startScrollTop = 0;

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
  let dragEnabledForPointer = true;

  function clearLongPressTimer() {
    if (longPressTimer != null) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function stopAutoScrollLoop() {
    if (autoScrollRaf != null) cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = null;
  }

  function startAutoScrollLoop() {
    if (autoScrollRaf != null) return;

    const tick = () => {
      autoScrollRaf = requestAnimationFrame(tick);

      if (!dragging || !dragStarted || !activeBoundaryEl || !lastPointer) return;

      // 1) Scroll container (if pointer near edge)
      const r = activeBoundaryEl.getBoundingClientRect();
      let sx = 0, sy = 0;

      if (lastPointer.x < r.left + autoScrollMargin) sx = -1;
      else if (lastPointer.x > r.right - autoScrollMargin) sx = 1;

      if (lastPointer.y < r.top + autoScrollMargin) sy = -1;
      else if (lastPointer.y > r.bottom - autoScrollMargin) sy = 1;

      if (sx) activeBoundaryEl.scrollLeft += sx * autoScrollStep;
      if (sy) activeBoundaryEl.scrollTop  += sy * autoScrollStep;

      // 2) IMPORTANT: keep element under cursor even if mouse doesn't move
      updatePositionFromClientXY(lastPointer.x, lastPointer.y, lastPointer.event);
    };

    autoScrollRaf = requestAnimationFrame(tick);
  }

  /**
   * Compute & apply translate from a client-space pointer position.
   * This is the single source of truth used by both pointermove and RAF auto-scroll.
   * @param {number} clientX
   * @param {number} clientY
   * @param {PointerEvent} ev
   */
  function updatePositionFromClientXY(clientX, clientY, ev) {
    if (!dragging || !dragStarted) return;

    const dxPointer = clientX - startPointerX;
    const dyPointer = clientY - startPointerY;

    const scrollDx = activeBoundaryEl ? (activeBoundaryEl.scrollLeft - startScrollLeft) : 0;
    const scrollDy = activeBoundaryEl ? (activeBoundaryEl.scrollTop - startScrollTop) : 0;

    const dx = dxPointer + scrollDx;
    const dy = dyPointer + scrollDy;

    let proposed = { x: startTranslate.x + dx, y: startTranslate.y + dy };
    proposed = clampTranslate(el, proposed, currentTranslate, boundary, clampToViewport);

    currentTranslate = proposed;
    applyTranslate(el, currentTranslate.x, currentTranslate.y);

    if (typeof onMove === "function") {
      onMove({ dragging: true, x: currentTranslate.x, y: currentTranslate.y, event: ev });
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

    // If canDrag says no, we still want click handling, but no drag.
    try {
      dragEnabledForPointer = (typeof canDrag === "function") ? !!canDrag() : true;
    } catch {
      dragEnabledForPointer = true;
    }

    // Ignore resize handle drag start
    if (isOnResizeHandle(el, e, 18)) {
      suppressNextClick = true;
      e.stopPropagation();
      return;
    }

    activePointerId = e.pointerId;
    handle.setPointerCapture(activePointerId);

    dragging = true;
    dragStarted = false;

    startPointerX = e.clientX;
    startPointerY = e.clientY;

    activeBoundaryEl = resolveBoundary(boundary);
    startScrollLeft = activeBoundaryEl ? activeBoundaryEl.scrollLeft : 0;
    startScrollTop  = activeBoundaryEl ? activeBoundaryEl.scrollTop  : 0;

    startTranslate = getCurrentTranslate(el);
    currentTranslate = { ...startTranslate };

    lastPointer = { x: e.clientX, y: e.clientY, event: e };

    // click-only mode
    if (!dragEnabledForPointer) {
      dragAllowed = false;
      clearLongPressTimer();
      return;
    }

    dragAllowed = !longPressToDrag || e.pointerType === "mouse";
    clearLongPressTimer();

    if (!dragAllowed) {
      //@ts-ignore
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
    if (!dragEnabledForPointer) return;

    lastPointer = { x: e.clientX, y: e.clientY, event: e };

    // threshold check based only on pointer delta
    const dx0 = e.clientX - startPointerX;
    const dy0 = e.clientY - startPointerY;

    if (!dragAllowed) {
      if (Math.hypot(dx0, dy0) > dragThreshold) clearLongPressTimer();
      return;
    }

    if (!dragStarted) {
      if (Math.hypot(dx0, dy0) < dragThreshold) return;

      dragStarted = true;
      clearLongPressTimer();
      setDraggingStyles(true);

      if (typeof onDragStart === "function") {
        onDragStart({ x: currentTranslate.x, y: currentTranslate.y, event: e });
      }

      // start edge auto-scroll once real dragging begins
      startAutoScrollLoop();
    }

    // update element immediately for responsiveness
    updatePositionFromClientXY(e.clientX, e.clientY, e);
  }

  /**
   * @param {PointerEvent} e
   */
  function endDragOrClick(e) {
    if (!dragging) return;
    if (activePointerId == null) return;
    if (e.pointerId !== activePointerId) return;

    clearLongPressTimer();
    stopAutoScrollLoop();

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
    activeBoundaryEl = null;
    lastPointer = null;

    dragEnabledForPointer = true;

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
      stopAutoScrollLoop();
      lastPointer = null;

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
