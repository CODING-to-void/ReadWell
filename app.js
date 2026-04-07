import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const pdfInput = document.querySelector("#pdfInput");
const statusText = document.querySelector("#statusText");
const bookTitle = document.querySelector("#bookTitle");
const pageCount = document.querySelector("#pageCount");
const bookView = document.querySelector("#bookView");
const toc = document.querySelector("#toc");
const downloadHtmlButton = document.querySelector("#downloadHtmlButton");

let currentExport = null;
let tocScrollHandler = null;

const HERO_THEMES = [
  {
    id: "science",
    label: "Science and Cosmos",
    summary: "Matched from scientific language, systems, and analytical subject matter.",
    keywords: ["physics", "chemistry", "biology", "quantum", "theory", "energy", "molecule", "evolution", "experiment", "science", "cosmos", "universe", "atom", "cell"],
    image:
      "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=1800&q=80"
  },
  {
    id: "history",
    label: "History and Civilization",
    summary: "Matched from historical periods, empires, biographies, and archival language.",
    keywords: ["history", "empire", "king", "war", "revolution", "ancient", "civilization", "dynasty", "biography", "kingdom", "colonial", "historical", "century"],
    image:
      "https://images.unsplash.com/photo-1461360228754-6e81c478b882?auto=format&fit=crop&w=1800&q=80"
  },
  {
    id: "philosophy",
    label: "Philosophy and Ideas",
    summary: "Matched from abstract themes, arguments, ethics, religion, and reflective language.",
    keywords: ["philosophy", "ethics", "god", "religion", "mind", "truth", "reason", "morality", "existence", "belief", "atheism", "soul", "consciousness", "argument"],
    image:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1800&q=80"
  },
  {
    id: "business",
    label: "Business and Leadership",
    summary: "Matched from strategy, companies, management, productivity, and finance language.",
    keywords: ["business", "strategy", "management", "market", "startup", "leadership", "finance", "company", "growth", "productivity", "brand", "sales"],
    image:
      "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1800&q=80"
  },
  {
    id: "nature",
    label: "Nature and Environment",
    summary: "Matched from ecology, animals, landscapes, climate, and natural-world language.",
    keywords: ["nature", "animal", "forest", "mountain", "sea", "ocean", "earth", "climate", "ecology", "wild", "river", "environment", "planet", "tree"],
    image:
      "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1800&q=80"
  },
  {
    id: "fiction",
    label: "Fiction and Storyworlds",
    summary: "Matched from narrative cues, characters, chapters, and dramatic language.",
    keywords: ["chapter", "prologue", "story", "character", "novel", "love", "death", "shadow", "blood", "dream", "journey", "fiction", "mystery"],
    image:
      "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1800&q=80"
  },
  {
    id: "default",
    label: "Classic Library",
    summary: "Fallback theme when the PDF does not signal a strong subject cluster.",
    keywords: [],
    image:
      "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1800&q=80"
  }
];

const COMMON_WORDS = new Set([
  "about",
  "after",
  "before",
  "between",
  "could",
  "every",
  "first",
  "their",
  "there",
  "these",
  "those",
  "which",
  "while",
  "would",
  "reader",
  "pages",
  "chapter",
  "paperwell",
  "title",
  "author"
]);

pdfInput.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  setLoadingState(file.name);

  try {
    const bytes = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      statusText.textContent = `Extracting page ${pageNumber} of ${pdf.numPages}`;
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageBlocks = buildReadableBlocks(textContent.items);
      pages.push({
        pageNumber,
        heading: guessPageHeading(pageBlocks, pageNumber),
        blocks: pageBlocks
      });
    }

    const metadata = await readMetadata(pdf, file.name);
    const heroTheme = selectHeroTheme(metadata, pages);
    renderBook(metadata, pages, heroTheme);
  } catch (error) {
    renderError(error);
  }
});

downloadHtmlButton.addEventListener("click", () => {
  if (!currentExport) {
    return;
  }

  const blob = new Blob([currentExport.html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(currentExport.title)}.html`;
  link.click();
  URL.revokeObjectURL(url);
});

function setLoadingState(filename) {
  statusText.textContent = "Preparing extraction";
  bookTitle.textContent = filename;
  pageCount.textContent = "...";
  currentExport = null;
  downloadHtmlButton.disabled = true;
  toc.innerHTML = '<p class="toc-empty">Building a table of contents...</p>';
  bookView.className = "book-view";
  bookView.innerHTML = `
    <section class="book-hero" style="background-image: url('https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1800&q=80')">
      <div class="book-hero-copy">
        <span class="book-theme">Analyzing PDF</span>
        <h2 class="book-name">Extracting text and rebuilding the reading layout</h2>
        <p class="book-summary">ReadWell is parsing the PDF, reconstructing paragraphs, and scoring the content so it can choose a stronger hero image than the old static default.</p>
      </div>
    </section>
    <div class="loading">
      <div class="loading-bar"><span></span></div>
      <p class="book-meta">This runs in the browser while the pages and table of contents are prepared.</p>
    </div>
  `;
}

async function readMetadata(pdf, fallbackName) {
  try {
    const { info, metadata } = await pdf.getMetadata();
    const rawTitle = info?.Title || metadata?.get("dc:title") || stripExtension(fallbackName);
    const rawAuthor = info?.Author || metadata?.get("dc:creator") || "Unknown author";
    return {
      title: cleanText(rawTitle),
      author: cleanText(rawAuthor)
    };
  } catch {
    return {
      title: stripExtension(fallbackName),
      author: "Unknown author"
    };
  }
}

function buildReadableBlocks(items) {
  const textItems = items
    .filter((item) => item.str && item.str.trim())
    .map((item) => ({
      text: normalizeSpacing(item.str),
      x: item.transform[4],
      y: item.transform[5],
      width: item.width,
      height: item.height || Math.abs(item.transform[0]) || 12,
      fontName: item.fontName || ""
    }))
    .sort((a, b) => {
      const yDiff = b.y - a.y;
      if (Math.abs(yDiff) > 2) {
        return yDiff;
      }
      return a.x - b.x;
    });

  const lines = [];
  for (const item of textItems) {
    const lastLine = lines.at(-1);
    if (!lastLine || Math.abs(lastLine.y - item.y) > Math.max(4, item.height * 0.45)) {
      lines.push({
        y: item.y,
        items: [item]
      });
      continue;
    }

    lastLine.items.push(item);
  }

  const normalizedLines = lines
    .map((line) => {
      const sortedItems = line.items.sort((a, b) => a.x - b.x);
      let text = "";

      for (let index = 0; index < sortedItems.length; index += 1) {
        const current = sortedItems[index];
        const previous = sortedItems[index - 1];

        if (previous) {
          const previousRight = previous.x + previous.width;
          const gap = current.x - previousRight;
          const shouldAddSpace =
            gap > Math.max(1.5, previous.height * 0.18) &&
            !text.endsWith("-") &&
            !/^[,.;:!?)]/.test(current.text);

          if (shouldAddSpace) {
            text += " ";
          }
        }

        text += current.text;
      }

      return {
        y: line.y,
        text: repairHyphenation(text),
        leftX: sortedItems[0]?.x ?? 0,
        rightX: Math.max(...sortedItems.map((item) => item.x + item.width)),
        fontSize: average(sortedItems.map((item) => item.height)),
        isHeadingCandidate: sortedItems.length <= 2 || average(sortedItems.map((item) => item.height)) > 15.5
      };
    })
    .filter((line) => line.text.length > 0);

  const blocks = [];
  for (let index = 0; index < normalizedLines.length; index += 1) {
    const line = normalizedLines[index];
    const previous = normalizedLines[index - 1];
    const next = normalizedLines[index + 1];
    const gapAbove = previous ? previous.y - line.y : 0;

    const isStandaloneHeading =
      line.isHeadingCandidate &&
      line.text.length < 90 &&
      !/[.!?]$/.test(line.text) &&
      (!previous || gapAbove > line.fontSize * 1.2) &&
      (!next || Math.abs(line.fontSize - next.fontSize) > 1.2 || line.text === line.text.toUpperCase());

    if (isStandaloneHeading) {
      blocks.push({
        type: "heading",
        text: line.text
      });
      continue;
    }

    const lastBlock = blocks.at(-1);
    const indentFromPrevious = previous ? line.leftX - previous.leftX : 0;
    const endsSentence = previous ? /[.!?:"'”)]$/.test(previous.text) : false;
    const looksLikeListItem = /^(\d+\.|[IVXLC]+\.)\s/.test(line.text);
    const startsParagraph =
      !lastBlock ||
      lastBlock.type === "heading" ||
      gapAbove > line.fontSize * 1.35 ||
      indentFromPrevious > line.fontSize * 0.8 ||
      looksLikeListItem ||
      (endsSentence && /^[A-Z0-9"'(]/.test(line.text) && indentFromPrevious > line.fontSize * 0.2);

    if (startsParagraph) {
      blocks.push({
        type: "paragraph",
        text: line.text
      });
      continue;
    }

    lastBlock.text += shouldJoinTightly(lastBlock.text, line.text) ? line.text : ` ${line.text}`;
  }

  return normalizeBlocks(blocks.filter((block) => block.text.trim().length > 0));
}

function guessPageHeading(blocks, pageNumber) {
  const heading = blocks.find((block) => block.type === "heading")?.text;
  return heading || `Page ${pageNumber}`;
}

function renderBook(metadata, pages, heroTheme) {
  statusText.textContent = "Ready to read";
  bookTitle.textContent = metadata.title;
  pageCount.textContent = String(pages.length);

  toc.innerHTML = pages
    .map(
      (page) =>
        `<a href="#page-${page.pageNumber}">${escapeHtml(trimTitle(page.heading, 44))}</a>`
    )
    .join("");

  const sections = pages
    .map((page) => {
      const blocks = page.blocks
        .map((block, index) => {
          if (block.type === "heading") {
            return `<h2>${escapeHtml(block.text)}</h2>`;
          }

          const className = index === 0 ? ' class="dropcap"' : "";
          return `<p${className}>${escapeHtml(block.text)}</p>`;
        })
        .join("");

      return `
        <section id="page-${page.pageNumber}" class="page-section">
          <h2 class="page-title">${escapeHtml(page.heading)}</h2>
          <div class="page-content">${blocks || "<p>No extractable text on this page.</p>"}</div>
        </section>
      `;
    })
    .join("");

  const tags = heroTheme.matches
    .slice(0, 4)
    .map((match) => `<span class="hero-tag">${escapeHtml(match)}</span>`)
    .join("");

  bookView.className = "book-view";
  bookView.innerHTML = `
    <section class="book-hero" style="background-image: url('${escapeAttribute(heroTheme.image)}')">
      <div class="book-hero-copy">
        <span class="book-theme">${escapeHtml(heroTheme.label)}</span>
        <h1 class="book-name">${escapeHtml(metadata.title)}</h1>
        <p class="book-meta">${escapeHtml(metadata.author)} | ${pages.length} pages</p>
        <p class="book-summary">${escapeHtml(heroTheme.summary)}</p>
        <div class="hero-tags">${tags}</div>
      </div>
    </section>
    <header class="book-header">
      <p class="book-kicker">ReadWell edition</p>
      <h2 class="page-title">Extracted reading pages</h2>
      <p class="book-meta">The sidebar now carries navigation so the main canvas stays focused on reading.</p>
    </header>
    ${sections}
  `;

  activateTocTracking();
  currentExport = {
    title: metadata.title,
    html: buildStandaloneHtml(metadata, pages, heroTheme)
  };
  downloadHtmlButton.disabled = false;
}

function renderError(error) {
  statusText.textContent = "Could not process that PDF";
  pageCount.textContent = "0";
  currentExport = null;
  downloadHtmlButton.disabled = true;
  toc.innerHTML = '<p class="toc-empty">No contents available.</p>';
  bookView.className = "book-view";
  bookView.innerHTML = `
    <div class="error-panel">
      <p class="book-kicker">Processing error</p>
      <h2 class="book-name">This file could not be converted into reading pages.</h2>
      <p class="book-meta">${escapeHtml(error?.message || "Unknown PDF parsing error.")}</p>
    </div>
  `;
}

function selectHeroTheme(metadata, pages) {
  const corpus = [
    metadata.title,
    metadata.author,
    ...pages.slice(0, 18).flatMap((page) => [page.heading, ...page.blocks.slice(0, 3).map((block) => block.text)])
  ]
    .join(" ")
    .toLowerCase();

  const tokens = corpus.match(/[a-z]{3,}/g) || [];
  const frequency = new Map();
  for (const token of tokens) {
    frequency.set(token, (frequency.get(token) || 0) + 1);
  }

  let bestTheme = HERO_THEMES.at(-1);
  let bestScore = 0;
  let bestMatches = [];

  for (const theme of HERO_THEMES.slice(0, -1)) {
    const matches = theme.keywords
      .map((keyword) => ({ keyword, score: frequency.get(keyword) || 0 }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    const score = matches.reduce((sum, entry) => sum + entry.score, 0);
    if (score > bestScore) {
      bestScore = score;
      bestTheme = theme;
      bestMatches = matches.map((entry) => entry.keyword);
    }
  }

  if (!bestScore) {
    const topTerms = [...frequency.entries()]
      .filter(([token]) => token.length > 4 && !COMMON_WORDS.has(token))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([token]) => titleCase(token));

    return {
      ...bestTheme,
      matches: topTerms.length ? topTerms : ["Reader", "Book", "Pages"]
    };
  }

  return {
    ...bestTheme,
    matches: bestMatches.slice(0, 4).map((keyword) => titleCase(keyword))
  };
}

function activateTocTracking() {
  if (tocScrollHandler) {
    window.removeEventListener("scroll", tocScrollHandler);
  }

  const links = Array.from(toc.querySelectorAll("a"));
  const sections = Array.from(bookView.querySelectorAll(".page-section"));

  if (!links.length || !sections.length) {
    return;
  }

  tocScrollHandler = () => {
    let activeId = sections[0]?.id;
    for (const section of sections) {
      const top = section.getBoundingClientRect().top;
      if (top <= 160) {
        activeId = section.id;
      }
    }

    for (const link of links) {
      link.classList.toggle("active", link.getAttribute("href") === `#${activeId}`);
    }
  };

  tocScrollHandler();
  window.addEventListener("scroll", tocScrollHandler, { passive: true });
}

function repairHyphenation(text) {
  return text.replace(/-\s+([a-z])/g, "$1").trim();
}

function normalizeSpacing(text) {
  return text.replace(/\s+/g, " ").trim();
}

function shouldJoinTightly(previous, current) {
  return previous.endsWith("-") || /^[,.;:!?)]/.test(current);
}

function normalizeBlocks(blocks) {
  return blocks.flatMap((block) => {
    if (block.type !== "paragraph") {
      return block;
    }

    const text = block.text
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/([.!?])([A-Z])/g, "$1 $2")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (text.length < 1100) {
      return { ...block, text };
    }

    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const split = [];
    let current = "";

    for (const sentence of sentences) {
      const next = `${current} ${sentence}`.trim();
      if (current && next.length > 650) {
        split.push({ type: "paragraph", text: current.trim() });
        current = sentence.trim();
      } else {
        current = next;
      }
    }

    if (current) {
      split.push({ type: "paragraph", text: current.trim() });
    }

    return split;
  });
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function cleanText(value) {
  return normalizeSpacing(String(value || ""));
}

function stripExtension(filename) {
  return filename.replace(/\.[^.]+$/, "");
}

function trimTitle(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return String(value).replaceAll('"', "&quot;");
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "readwell-book";
}

function titleCase(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function buildSmartOutline(metadata, pages) {
  const chunkSize = Math.max(24, Math.min(50, Math.round(pages.length / 6) || 24));
  const sections = [];

  for (let start = 0; start < pages.length; start += chunkSize) {
    const chunkPages = pages.slice(start, start + chunkSize);
    if (!chunkPages.length) {
      continue;
    }

    sections.push({
      index: sections.length + 1,
      startPage: chunkPages[0].pageNumber,
      endPage: chunkPages.at(-1).pageNumber,
      title: deriveSectionTitle(metadata, chunkPages, sections.length + 1),
      pages: chunkPages
    });
  }

  return sections;
}

function deriveSectionTitle(metadata, pages, index) {
  const headingCandidates = pages
    .map((page) => page.heading)
    .filter((heading) => heading && !/^page\s+\d+$/i.test(heading))
    .map((heading) => cleanText(heading))
    .filter((heading) => heading.length > 4 && heading.length < 72);

  if (headingCandidates.length) {
    const bestHeading = headingCandidates
      .sort((a, b) => scoreHeadingCandidate(b) - scoreHeadingCandidate(a))[0];

    return `Part ${toRoman(index)} — ${bestHeading}`;
  }

  const tokenFrequency = new Map();
  const corpus = pages
    .flatMap((page) => [page.heading, ...page.blocks.slice(0, 6).map((block) => block.text)])
    .join(" ")
    .toLowerCase()
    .match(/[a-z]{4,}/g) || [];

  const titleTokens = new Set(
    `${metadata.title} ${metadata.author}`
      .toLowerCase()
      .match(/[a-z]{4,}/g) || []
  );

  for (const token of corpus) {
    if (COMMON_WORDS.has(token) || titleTokens.has(token)) {
      continue;
    }

    tokenFrequency.set(token, (tokenFrequency.get(token) || 0) + 1);
  }

  const label = [...tokenFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([token]) => titleCase(token))
    .join(" • ");

  return `Part ${toRoman(index)} — ${label || `Pages ${pages[0].pageNumber}-${pages.at(-1).pageNumber}`}`;
}

function scoreHeadingCandidate(text) {
  let score = 0;
  if (/part|chapter|prologue|introduction|epilogue|book/i.test(text)) {
    score += 6;
  }
  if (text.length >= 12 && text.length <= 48) {
    score += 3;
  }
  if (!/[.!?]$/.test(text)) {
    score += 2;
  }
  if (/^[A-Z0-9"'(]/.test(text)) {
    score += 1;
  }
  return score;
}

function toRoman(value) {
  const numerals = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"]
  ];

  let remainder = value;
  let result = "";
  for (const [amount, symbol] of numerals) {
    while (remainder >= amount) {
      result += symbol;
      remainder -= amount;
    }
  }
  return result;
}

function buildStandaloneHtml(metadata, pages, heroTheme) {
  const outline = buildSmartOutline(metadata, pages);
  const tocItems = outline
    .map((section, sectionIndex) => {
      const pageButtons = section.pages
        .map(
          (page, pageIndex) => `
            <button class="toc-item toc-page-item${sectionIndex === 0 && pageIndex === 0 ? " active" : ""}" data-target="page-${page.pageNumber}">
              <span>${escapeHtml(trimTitle(page.heading, 54))}</span>
            </button>
          `
        )
        .join("");

      return `
        <div class="toc-group">
          <button class="toc-part${sectionIndex === 0 ? " active" : ""}" data-section-start="${section.startPage}" data-section-end="${section.endPage}" data-target="page-${section.startPage}">
            ${escapeHtml(section.title)}
          </button>
          <div class="toc-sublist">
            ${pageButtons}
          </div>
        </div>
      `;
    })
    .join("");

  const article = pages
    .map((page) => {
      const content = page.blocks
        .map((block, index) => {
          if (block.type === "heading") {
            return `<h2>${escapeHtml(block.text)}</h2>`;
          }

          return `<p${index === 0 ? ' class="dropcap"' : ""}>${escapeHtml(block.text)}</p>`;
        })
        .join("");

      return `
        <section class="page-section" id="page-${page.pageNumber}">
          <div class="page-marker">Page ${page.pageNumber}</div>
          <h3>${escapeHtml(page.heading)}</h3>
          <div class="page-body">${content}</div>
        </section>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(metadata.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,700;1,600&family=Crimson+Pro:wght@300;400;500;600&family=Cormorant+SC:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #1a1714;
      --bg-soft: #100d0b;
      --ink: #eadfce;
      --muted: #8f8374;
      --dim: #3a342e;
      --accent: #a42e2e;
      --accent-soft: rgba(164, 46, 46, 0.14);
      --gold: #bb9438;
      --line: rgba(255, 244, 231, 0.08);
      --nav-bg: rgba(26, 23, 20, 0.86);
      --overlay: rgba(10, 8, 7, 0.78);
      --serif: "Crimson Pro", Georgia, serif;
      --display: "Playfair Display", serif;
      --caps: "Cormorant SC", serif;
    }

    body.mode-cream {
      --bg: #e6d8bf;
      --bg-soft: #d8c8ae;
      --ink: #2f261f;
      --muted: #786652;
      --dim: #c8b89a;
      --accent: #8f2620;
      --accent-soft: rgba(143, 38, 32, 0.1);
      --gold: #9e7621;
      --line: rgba(45, 31, 20, 0.1);
      --nav-bg: rgba(240, 229, 209, 0.9);
      --overlay: rgba(240, 229, 209, 0.42);
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; font-size: 17px; }
    body {
      margin: 0;
      font-family: var(--serif);
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(207, 108, 61, 0.12), transparent 24%),
        linear-gradient(180deg, var(--bg), var(--bg-soft));
      overflow-x: hidden;
      transition: background 220ms ease, color 220ms ease;
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: 0.28;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.88' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.18'/%3E%3C/svg%3E");
      mix-blend-mode: soft-light;
    }

    .brand,
    .hero-kicker,
    .toc-label,
    .meta-chip,
    .theme-toggle,
    .page-marker {
      font-family: var(--caps);
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }

    .topbar {
      position: fixed;
      inset: 0 0 auto;
      z-index: 30;
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      padding: 0 32px;
      background: var(--nav-bg);
      backdrop-filter: blur(18px) saturate(1.15);
      border-bottom: 1px solid var(--line);
    }

    .brand {
      color: var(--muted);
      font-size: 0.78rem;
      white-space: nowrap;
    }

    .theme-toggle {
      border: 1px solid var(--line);
      background: transparent;
      color: var(--muted);
      border-radius: 999px;
      padding: 8px 12px;
      cursor: pointer;
      font-size: 0.72rem;
    }

    .hero {
      position: relative;
      height: 100vh;
      min-height: 620px;
      overflow: hidden;
    }

    .hero::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, var(--overlay), rgba(10, 8, 7, 0.2) 55%, rgba(10, 8, 7, 0.66)),
        linear-gradient(180deg, rgba(10, 8, 7, 0.12), rgba(10, 8, 7, 0.95));
      z-index: 1;
    }

    .hero-image {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      background:
        url("${escapeAttribute(heroTheme.image)}") center/cover no-repeat;
      transform: scale(1.06);
    }

    .hero-content {
      position: relative;
      z-index: 2;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      padding: 0 8vw 8vh;
    }

    .hero-kicker {
      color: var(--gold);
      font-size: 0.78rem;
      margin-bottom: 16px;
    }

    .hero h1 {
      margin: 0;
      max-width: 12ch;
      font-family: var(--display);
      font-size: clamp(3.6rem, 7vw, 6.6rem);
      line-height: 0.92;
      font-style: italic;
      color: color-mix(in srgb, var(--accent) 80%, #fff 20%);
    }

    .hero p {
      margin: 16px 0 0;
      max-width: 60ch;
      line-height: 1.8;
      color: rgba(234, 223, 206, 0.84);
    }

    .hero-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin-top: 28px;
    }

    .meta-chip {
      border: 1px solid rgba(255,255,255,0.09);
      background: rgba(255,255,255,0.04);
      color: var(--muted);
      padding: 8px 12px;
      border-radius: 999px;
      font-size: 0.72rem;
    }

    .shell {
      display: grid;
      grid-template-columns: 240px minmax(0, 1fr);
      gap: 0;
      padding-top: 52px;
    }

    .sidebar {
      position: sticky;
      top: 52px;
      height: calc(100vh - 52px);
      overflow-y: auto;
      padding: 40px 0 40px 30px;
      border-right: 1px solid var(--line);
      scrollbar-width: thin;
      scrollbar-color: var(--dim) transparent;
    }

    .sidebar::-webkit-scrollbar {
      width: 3px;
    }

    .sidebar::-webkit-scrollbar-thumb {
      background: var(--dim);
      border-radius: 2px;
    }

    .toc-label {
      display: block;
      margin-bottom: 16px;
      color: var(--muted);
      font-size: 0.68rem;
    }

    .toc-group {
      margin: 0 0 16px;
    }

    .toc-part {
      width: calc(100% - 14px);
      display: block;
      border: 0;
      background: transparent;
      text-align: left;
      padding: 0 14px 12px 0;
      cursor: pointer;
      font: inherit;
      line-height: 1.35;
      color: var(--ink);
      font-family: var(--display);
      font-size: 1rem;
      border-right: 2px solid transparent;
      transition: color 160ms ease, border-color 160ms ease, transform 160ms ease;
    }

    .toc-part:hover,
    .toc-part.active {
      color: var(--accent);
      border-right-color: var(--accent);
      transform: translateX(4px);
    }

    .toc-sublist {
      display: grid;
      gap: 2px;
      margin-bottom: 6px;
    }

    .toc-item {
      width: 100%;
      display: block;
      border: 0;
      background: transparent;
      text-align: left;
      padding: 10px 18px 10px 0;
      cursor: pointer;
      font: inherit;
      line-height: 1.45;
      color: var(--muted);
      border-right: 2px solid transparent;
      transition: color 160ms ease, border-color 160ms ease, transform 160ms ease;
    }

    .toc-item:hover,
    .toc-item.active {
      color: var(--ink);
      transform: translateX(4px);
    }

    .toc-item.active {
      color: var(--accent);
      border-right-color: var(--accent);
    }

    .toc-sep {
      height: 1px;
      background: var(--line);
      margin: 12px 0;
      width: calc(100% - 18px);
    }

    .content {
      min-width: 0;
    }

    .intro {
      padding: 56px 8vw 18px;
      border-bottom: 1px solid var(--line);
    }

    .intro h2,
    .page-section h2,
    .page-section h3 {
      font-family: var(--display);
      font-weight: 600;
      line-height: 1;
    }

    .intro h2 {
      margin: 12px 0 8px;
      font-size: clamp(2.4rem, 5vw, 3.8rem);
    }

    .intro p {
      margin: 0;
      color: var(--muted);
      max-width: 60ch;
    }

    .page-section {
      width: min(860px, calc(100% - 16vw));
      margin: 0 auto;
      padding: 34px 0 10px;
      border-top: 1px solid var(--line);
      scroll-margin-top: 88px;
    }

    .page-section:first-of-type {
      border-top: 0;
      padding-top: 28px;
    }

    .page-marker {
      color: var(--gold);
      font-size: 0.72rem;
    }

    .page-section h3 {
      margin: 10px 0 18px;
      font-size: clamp(2rem, 4vw, 2.8rem);
      color: var(--ink);
    }

    .page-body h2 {
      margin: 26px 0 12px;
      font-size: 1.78rem;
      color: color-mix(in srgb, var(--gold) 72%, var(--ink));
    }

    p {
      margin: 0 0 22px;
      max-width: 72ch;
      line-height: 1.92;
      font-size: 1.04rem;
      color: rgba(234, 223, 206, 0.92);
    }

    .dropcap::first-letter {
      float: left;
      margin: 5px 12px 0 0;
      font-family: var(--display);
      font-size: 4.8rem;
      line-height: 0.86;
      color: var(--accent);
    }

    @media (max-width: 720px) {
      .topbar {
        padding: 0 16px;
      }

      .hero {
        min-height: 520px;
      }

      .hero-content {
        padding: 0 20px 34px;
      }

      .hero h1 {
        max-width: 100%;
        font-size: 3.2rem;
      }

      .shell {
        grid-template-columns: 1fr;
      }

      .sidebar {
        display: none;
      }

      .intro {
        padding: 34px 20px 18px;
      }

      .page-section {
        width: min(100% - 40px, 100%);
      }
    }
  </style>
</head>
<body>
  <nav class="topbar">
    <div class="brand">ReadWell Edition</div>
    <button class="theme-toggle" id="themeToggle" type="button">Cream Mode</button>
  </nav>

  <section class="hero">
    <div class="hero-image"></div>
    <div class="hero-content">
      <div class="hero-kicker">${escapeHtml(heroTheme.label)}</div>
      <h1>${escapeHtml(metadata.title)}</h1>
      <p>${escapeHtml(heroTheme.summary)}</p>
      <div class="hero-meta">
        <span class="meta-chip">${escapeHtml(metadata.author)}</span>
        <span class="meta-chip">${pages.length} pages</span>
        ${heroTheme.matches.map((match) => `<span class="meta-chip">${escapeHtml(match)}</span>`).join("")}
      </div>
    </div>
  </section>

  <main class="shell">
    <aside class="sidebar">
      <span class="toc-label">Contents</span>
      ${tocItems}
      <div class="toc-sep"></div>
      <span class="toc-label">Theme</span>
      <button class="toc-item" data-target="book-intro">${escapeHtml(heroTheme.label)}</button>
    </aside>

    <section class="content">
      <header class="intro" id="book-intro">
        <span class="toc-label">Book Details</span>
        <h2>${escapeHtml(metadata.title)}</h2>
        <p>${escapeHtml(metadata.author)} | ${pages.length} extracted pages</p>
      </header>
      ${article}
    </section>
  </main>
  <script>
    const pageNodes = Array.from(document.querySelectorAll(".page-section"));
    const tocNodes = Array.from(document.querySelectorAll(".toc-item"));
    const partNodes = Array.from(document.querySelectorAll(".toc-part"));
    const themeToggle = document.getElementById("themeToggle");

    function goToTarget(id) {
      const node = document.getElementById(id);
      if (node) {
        node.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    function syncProgress() {
      let activeId = pageNodes[0]?.id || "book-intro";
      for (const page of pageNodes) {
        const top = page.getBoundingClientRect().top;
        if (top <= window.innerHeight * 0.34) {
          activeId = page.id;
        }
      }

      for (const item of tocNodes) {
        item.classList.toggle("active", item.dataset.target === activeId);
      }

      const activePageNumber = Number(activeId.replace("page-", "")) || 0;
      for (const part of partNodes) {
        const start = Number(part.dataset.sectionStart || 0);
        const end = Number(part.dataset.sectionEnd || 0);
        part.classList.toggle("active", activePageNumber >= start && activePageNumber <= end);
      }
    }

    tocNodes.forEach((item) => {
      item.addEventListener("click", () => goToTarget(item.dataset.target));
    });

    partNodes.forEach((item) => {
      item.addEventListener("click", () => goToTarget(item.dataset.target));
    });

    themeToggle.addEventListener("click", () => {
      document.body.classList.toggle("mode-cream");
      themeToggle.textContent = document.body.classList.contains("mode-cream") ? "Dark Mode" : "Cream Mode";
    });

    window.addEventListener("scroll", syncProgress, { passive: true });
    window.addEventListener("load", syncProgress);
    syncProgress();
  </script>
</body>
</html>`;
}
