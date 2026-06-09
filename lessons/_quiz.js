(function () {
  // ── Match: shuffle and render chips from data-explanations ────
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function initMatchBlock(block) {
    const pool = block.querySelector(".quiz-match-pool");
    const explanations = JSON.parse(block.dataset.explanations || "[]");
    const indices = shuffle([...Array(explanations.length).keys()]);
    pool.innerHTML = "";
    for (const i of indices) {
      const chip = document.createElement("div");
      chip.className = "quiz-match-chip";
      chip.dataset.idx = String(i);
      chip.draggable = true;
      chip.textContent = explanations[i];
      pool.appendChild(chip);
    }
  }

  // ── Drag & drop ────────────────────────────────────────────────
  let dragged = null;

  document.addEventListener("dragstart", e => {
    const chip = e.target.closest(".quiz-match-chip");
    if (!chip) return;
    dragged = chip;
    chip.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });

  document.addEventListener("dragend", () => {
    if (dragged) { dragged.classList.remove("dragging"); dragged = null; }
  });

  document.addEventListener("dragover", e => {
    const target = e.target.closest(".quiz-match-dropzone, .quiz-match-pool");
    if (target && dragged) { e.preventDefault(); target.classList.add("drag-over"); }
  });

  document.addEventListener("dragleave", e => {
    const target = e.target.closest(".quiz-match-dropzone, .quiz-match-pool");
    if (target && !target.contains(e.relatedTarget)) target.classList.remove("drag-over");
  });

  document.addEventListener("drop", e => {
    const target = e.target.closest(".quiz-match-dropzone, .quiz-match-pool");
    if (!target || !dragged) return;
    e.preventDefault();
    target.classList.remove("drag-over");
    if (target.classList.contains("quiz-match-dropzone")) {
      const current = target.querySelector(".quiz-match-chip");
      if (current) dragged.parentElement.appendChild(current);
      target.appendChild(dragged);
    } else {
      target.appendChild(dragged);
    }
  });

  // ── MC: click to select ────────────────────────────────────────
  document.addEventListener("click", e => {
    const opt = e.target.closest(".quiz-option");
    if (!opt) return;
    const block = opt.closest(".quiz-mc");
    if (!block || block.classList.contains("evaluated")) return;
    block.querySelectorAll(".quiz-option").forEach(o => o.classList.remove("selected"));
    opt.classList.add("selected");
  });

  // ── Evaluate button ────────────────────────────────────────────
  document.addEventListener("click", e => {
    const btn = e.target.closest(".quiz-evaluate-btn");
    if (!btn || btn.disabled) return;
    const ids = btn.dataset.quizIds.split(",").filter(Boolean);
    let correct = 0, total = 0;
    for (const id of ids) {
      const block = document.querySelector(`[data-quiz-id="${id}"]`);
      if (!block) continue;
      const r = evaluateBlock(block);
      correct += r.correct;
      total += r.total;
    }
    const summary = btn.nextElementSibling;
    if (summary && total > 0) {
      summary.textContent = `${correct} von ${total} ${total === 1 ? "Punkt" : "Punkten"} erreicht`;
      summary.className = "quiz-evaluate-summary " + (correct === total ? "quiz-summary-ok" : "quiz-summary-err");
    }
    btn.disabled = true;
  });

  function evaluateBlock(block) {
    block.classList.add("evaluated");
    switch (block.dataset.type) {
      case "short": return evalShort(block);
      case "mc":    return evalMC(block);
      case "fill":  return evalFill(block);
      case "match": return evalMatch(block);
      default:      return { correct: 0, total: 0 };
    }
  }

  function markFeedback(input, fb, ok) {
    input.classList.toggle("quiz-correct", ok);
    input.classList.toggle("quiz-incorrect", !ok);
    input.disabled = true;
    if (fb) {
      fb.textContent = ok ? "✓" : "✗";
      fb.className = "quiz-feedback " + (ok ? "quiz-ok" : "quiz-err");
    }
  }

  function evalShort(block) {
    const input = block.querySelector(".quiz-input");
    const fb = block.querySelector(".quiz-feedback");
    const answers = JSON.parse(block.dataset.answers || "[]");
    const ok = answers.includes(input.value.trim().toLowerCase());
    markFeedback(input, fb, ok);
    return { correct: ok ? 1 : 0, total: 1 };
  }

  function evalMC(block) {
    let correct = false;
    block.querySelectorAll(".quiz-option").forEach(opt => {
      opt.disabled = true;
      if (opt.dataset.correct === "true") opt.classList.add("quiz-correct");
      if (opt.classList.contains("selected")) {
        correct = opt.dataset.correct === "true";
        if (!correct) opt.classList.add("quiz-incorrect");
      }
    });
    return { correct: correct ? 1 : 0, total: 1 };
  }

  function evalFill(block) {
    let correct = 0;
    block.querySelectorAll(".quiz-gap-input").forEach(input => {
      const answers = JSON.parse(input.dataset.answers || "[]");
      const ok = answers.includes(input.value.trim().toLowerCase());
      markFeedback(input, input.nextElementSibling, ok);
      if (ok) correct++;
    });
    const inputs = block.querySelectorAll(".quiz-gap-input");
    return { correct, total: inputs.length };
  }

  function evalMatch(block) {
    let correct = 0;
    block.querySelectorAll(".quiz-match-chip").forEach(c => { c.draggable = false; });
    block.querySelectorAll(".quiz-match-dropzone").forEach(zone => {
      const chip = zone.querySelector(".quiz-match-chip");
      const ok = chip && Number(chip.dataset.idx) === Number(zone.dataset.correctIdx);
      zone.classList.toggle("quiz-correct", !!ok);
      zone.classList.toggle("quiz-incorrect", !!chip && !ok);
      zone.classList.toggle("quiz-missing", !chip);
      if (ok) correct++;
    });
    return { correct, total: block.querySelectorAll(".quiz-match-dropzone").length };
  }

  // Init all match blocks on load
  document.querySelectorAll(".quiz-match").forEach(initMatchBlock);
})();
