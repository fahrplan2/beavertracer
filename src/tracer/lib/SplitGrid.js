// @ts-check

export class SplitGrid {
  /** @type {AbortController|null} */ #abort = null;
  /** @type {ResizeObserver|null} */ #ro = null;

  destroy() {
    this.#abort?.abort();
    this.#abort = null;
    this.#ro?.disconnect();
    this.#ro = null;
  }

  /**
   * @param {HTMLElement} root
   * @param {{
   *  containerSel: string;
   *  splitterSel: string;
   *  primaryPaneSel: string;
   *  splitSizePx: number;
   *  minA: number;
   *  minB: number;
   *  axis: "x"|"y";
   *  cursor: "col-resize"|"row-resize";
   *  getRatio: ()=>number|null;
   *  setRatio: (v:number|null)=>void;
   * }} cfg
   */
  wire(root, cfg) {
    const splitter = /** @type {HTMLElement|null} */ (root.querySelector(cfg.splitterSel));
    const container = /** @type {HTMLElement|null} */ (root.querySelector(cfg.containerSel));
    const paneA = /** @type {HTMLElement|null} */ (root.querySelector(cfg.primaryPaneSel));
    if (!splitter || !container || !paneA) return;

    this.destroy();
    this.#abort = new AbortController();
    const { signal } = this.#abort;

    const applyPx = (aPx) => {
      const SPLIT = cfg.splitSizePx;
      const rect = container.getBoundingClientRect();
      const total = cfg.axis === "y" ? rect.height : rect.width;

      const maxA = Math.max(cfg.minA, total - SPLIT - cfg.minB);
      const clampedA = Math.max(cfg.minA, Math.min(maxA, aPx));
      const bPx = Math.max(cfg.minB, total - SPLIT - clampedA);

      if (cfg.axis === "y") container.style.gridTemplateRows = `${clampedA}px ${SPLIT}px ${bPx}px`;
      else container.style.gridTemplateColumns = `${clampedA}px ${SPLIT}px ${bPx}px`;

      const usable = Math.max(1, total - SPLIT);
      cfg.setRatio(clampedA / usable);
    };

    const restore = () => {
      const ratio = cfg.getRatio() ?? 0.5;
      const rect = container.getBoundingClientRect();
      const total = cfg.axis === "y" ? rect.height : rect.width;
      const usable = Math.max(1, total - cfg.splitSizePx);
      applyPx(ratio * usable);
    };
    requestAnimationFrame(restore);

    let startPos = 0;
    let startAPx = 0;

    const onMove = (e) => {
      const delta = (cfg.axis === "y" ? e.clientY : e.clientX) - startPos;
      applyPx(startAPx + delta);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    splitter.addEventListener("pointerdown", (e) => {
      startPos = cfg.axis === "y" ? e.clientY : e.clientX;
      startAPx = cfg.axis === "y"
        ? paneA.getBoundingClientRect().height
        : paneA.getBoundingClientRect().width;

      splitter.setPointerCapture?.(e.pointerId);
      document.body.style.cursor = cfg.cursor;
      document.body.style.userSelect = "none";

      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
    }, { signal });

    this.#ro = new ResizeObserver(() => {
      const ratio = cfg.getRatio();
      if (ratio == null) return;
      const rect = container.getBoundingClientRect();
      const total = cfg.axis === "y" ? rect.height : rect.width;
      const usable = Math.max(1, total - cfg.splitSizePx);
      applyPx(ratio * usable);
    });
    this.#ro.observe(container);
  }
}
