//@ts-check

/** @type {WeakSet<HTMLElement>} elements that already have scroll hints */
const hinted = new WeakSet();

/**
 * Fades out the top/bottom edge of a scroll container while there is more
 * content in that direction — overlay scrollbars (macOS, mobile) are
 * invisible until you scroll, so without this nothing tells you a list
 * goes on. The fade itself is CSS (.scroll-hints in css/global.css); this
 * keeps the "fade-top"/"fade-bottom" classes up to date on scroll, resize
 * and content changes.
 * Calling it again for the same element is a no-op.
 * @param {HTMLElement} el the element with overflow: auto
 */
export function addScrollHints(el) {
    // idempotent: long-lived elements (e.g. an app root that gets re-framed
    // on every OS render) must not pile up listeners and observers
    if (hinted.has(el)) return;
    hinted.add(el);
    el.classList.add("scroll-hints");
    const update = () => {
        const max = el.scrollHeight - el.clientHeight;
        el.classList.toggle("fade-top", el.scrollTop > 1);
        el.classList.toggle("fade-bottom", max - el.scrollTop > 1);
    };
    el.addEventListener("scroll", update, { passive: true });
    new ResizeObserver(update).observe(el);
    new MutationObserver(() => requestAnimationFrame(update)).observe(el, { childList: true, subtree: true });
    requestAnimationFrame(update);
}
