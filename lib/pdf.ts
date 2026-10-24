import type { ExamParams, MCQ } from "./types";
import { toBn } from "./utils";

/**
 * Bangla needs proper glyph shaping (juktakkhor, kar, etc.), which jsPDF's text
 * engine cannot do. So we lay the paper out as real HTML (the browser shapes the
 * Bangla font correctly) and capture each A4 page as a high-resolution image.
 */

// A4 at 96 dpi
const PAGE_W = 794;
const PAGE_H = 1123;
const PAD = 38;
const GAP = 12;
const FOOTER = 16;
const BODY_W = PAGE_W - PAD * 2;
const COL_W = Math.floor((BODY_W - GAP * 2 - 1) / 2);
const LABELS = ["ক", "খ", "গ", "ঘ"];
const FONT_SIZES = [9, 8.75, 8.5, 8.25, 8, 7.75, 7.5]; // pt

function el(tag: string, css = "", text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

function makeHeader(exam: ExamParams): HTMLElement {
  const h = el("div", "text-align:center;padding-bottom:10px;border-bottom:2px solid #111;margin-bottom:12px;");
  h.append(el("div", "font-size:22px;font-weight:700;line-height:1.4;", exam.examName || "পরীক্ষা"));
  const meta = [
    exam.className && `শ্রেণি: ${exam.className}`,
    exam.subject && `বিষয়: ${exam.subject}`,
    exam.totalTime && `সময়: ${toBn(exam.totalTime)} মিনিট`,
    exam.totalMarks && `পূর্ণমান: ${toBn(exam.totalMarks)}`,
  ]
    .filter(Boolean)
    .join("   |   ");
  h.append(el("div", "font-size:13px;font-weight:500;margin-top:4px;line-height:1.5;", meta));
  h.append(el("div", "font-size:11px;color:#444;margin-top:3px;", "সঠিক উত্তরটি বেছে নাও। প্রতিটি প্রশ্নের মান সমান।"));
  return h;
}

function makeBlock(q: MCQ, i: number): HTMLElement {
  const wrap = el("div", "padding-bottom:0.85em;box-sizing:border-box;");
  const row = el("div", "display:flex;gap:0.3em;font-weight:700;");
  row.append(el("span", "flex:none;min-width:1.75em;", `${toBn(i + 1)}।`), el("span", "flex:1;min-width:0;", q.question));
  wrap.append(row);

  const short = q.options.every((o) => o.length <= 16);
  const grid = el(
    "div",
    `display:grid;grid-template-columns:${short ? "1fr 1fr" : "1fr"};gap:0.15em 0.6em;padding-left:2.05em;margin-top:0.2em;`
  );
  q.options.forEach((o, oi) => {
    const r = el("div", "display:flex;gap:0.3em;");
    r.append(el("span", "flex:none;", `(${LABELS[oi]})`), el("span", "flex:1;min-width:0;", o));
    grid.append(r);
  });
  wrap.append(grid);
  return wrap;
}

/** Greedy flow of blocks into [page][column] lists of block indices. */
function flow(heights: number[], firstH: number, nextH: number): number[][][] {
  const pages: number[][][] = [[[], []]];
  let col = 0;
  let used = 0;
  let cap = firstH;
  heights.forEach((h, i) => {
    const current = pages[pages.length - 1][col];
    if (used + h > cap && current.length > 0) {
      if (col === 0) col = 1;
      else {
        pages.push([[], []]);
        col = 0;
        cap = nextH;
      }
      used = 0;
    }
    pages[pages.length - 1][col].push(i);
    used += h;
  });
  return pages;
}

function pageShell(): HTMLElement {
  const p = el(
    "div",
    `width:${PAGE_W}px;height:${PAGE_H}px;box-sizing:border-box;padding:${PAD}px;background:#fff;color:#000;position:relative;overflow:hidden;`
  );
  return p;
}

function addFooter(page: HTMLElement, text: string) {
  page.append(
    el(
      "div",
      `position:absolute;left:0;right:0;bottom:14px;text-align:center;font-size:10px;color:#777;`,
      text
    )
  );
}

function makeAnswerPage(exam: ExamParams, questions: MCQ[], pageLabel: string): HTMLElement {
  const page = pageShell();
  page.append(el("div", "text-align:center;font-size:24px;font-weight:700;margin-top:6px;", "উত্তরমালা"));
  const sub = [exam.examName, exam.className && `শ্রেণি: ${exam.className}`, exam.subject && `বিষয়: ${exam.subject}`]
    .filter(Boolean)
    .join("  |  ");
  page.append(el("div", "text-align:center;font-size:13px;color:#333;margin:6px 0 22px;", sub));
  const grid = el("div", "display:grid;grid-template-columns:repeat(5,1fr);gap:8px;");
  questions.forEach((q, i) => {
    grid.append(
      el(
        "div",
        "border:1px solid #bbb;border-radius:6px;padding:9px 4px;text-align:center;font-size:16px;font-weight:600;",
        `${toBn(i + 1)}।  ${LABELS[q.correctIndex]}`
      )
    );
  });
  page.append(grid);
  addFooter(page, pageLabel);
  return page;
}

export async function generateQuestionPaperPdf(exam: ExamParams, questions: MCQ[]): Promise<void> {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas")]);

  const family = getComputedStyle(document.body).fontFamily;
  const stage = el(
    "div",
    `position:absolute;left:-10000px;top:0;width:${PAGE_W}px;font-family:${family};color:#000;background:#fff;`
  );
  stage.setAttribute("data-pdf-stage", "1");
  document.body.append(stage);

  try {
    // 1) measure header
    const measureBox = el("div", `width:${BODY_W}px;`);
    stage.append(measureBox);
    const probe = makeHeader(exam);
    measureBox.append(probe);
    await document.fonts.ready;
    const headerH = Math.ceil(probe.getBoundingClientRect().height) + 12;
    measureBox.remove();

    const firstH = PAGE_H - PAD * 2 - headerH - FOOTER;
    const nextH = PAGE_H - PAD * 2 - FOOTER;

    // 2) find the largest font size (9pt → 7.5pt) that fits on one page
    let chosen = FONT_SIZES[FONT_SIZES.length - 1];
    let blocks: HTMLElement[] = [];
    let plan: number[][][] = [];
    for (const pt of FONT_SIZES) {
      const m = el("div", `width:${COL_W}px;font-size:${pt}pt;line-height:1.45;`);
      stage.append(m);
      const bs = questions.map((q, i) => makeBlock(q, i));
      bs.forEach((b) => m.append(b));
      await document.fonts.ready;
      const heights = bs.map((b) => b.getBoundingClientRect().height);
      const p = flow(heights, firstH, nextH);
      chosen = pt;
      blocks = bs;
      plan = p;
      if (p.length === 1) break; // fits on a single page
    }

    // 3) build the final pages
    const pages: HTMLElement[] = plan.map((cols, pi) => {
      const page = pageShell();
      if (pi === 0) page.append(makeHeader(exam));
      const bodyH = pi === 0 ? firstH : nextH;
      const body = el("div", `display:flex;gap:${GAP}px;height:${bodyH}px;font-size:${chosen}pt;line-height:1.45;`);
      const mkCol = (idx: number[]) => {
        const c = el("div", `width:${COL_W}px;flex:none;`);
        idx.forEach((bi) => c.append(blocks[bi]));
        return c;
      };
      body.append(mkCol(cols[0]), el("div", "width:1px;background:#bbb;flex:none;"), mkCol(cols[1]));
      page.append(body);
      addFooter(page, `${exam.examName || "প্রশ্নপত্র"}  •  পৃষ্ঠা ${toBn(pi + 1)}`);
      return page;
    });
    pages.push(makeAnswerPage(exam, questions, `${exam.examName || "প্রশ্নপত্র"}  •  উত্তরমালা`));

    pages.forEach((p) => stage.append(p));
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    // 4) capture each page and put it on an A4 PDF page
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], {
        scale: 3,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
        onclone: (doc) => {
          const s = doc.querySelector("[data-pdf-stage]") as HTMLElement | null;
          if (s) {
            s.style.left = "0";
            s.style.top = "0";
          }
        },
      });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 210, 297, undefined, "FAST");
    }

    const safe = (exam.examName || "প্রশ্নপত্র").replace(/[\\/:*?"<>|]+/g, "_").trim() || "question-paper";
    pdf.save(`${safe}.pdf`);
  } finally {
    stage.remove();
  }
}
