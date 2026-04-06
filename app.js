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
    renderBook(metadata, pages);
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
    <div class="loading">
      <p class="book-kicker">Working on your book</p>
      <h2 class="book-name">Extracting text and rebuilding pages</h2>
      <div class="loading-bar"><span></span></div>
      <p class="book-meta">This keeps the layout clean while the PDF is being parsed in your browser.</p>
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
    const startsParagraph =
      !lastBlock ||
      lastBlock.type === "heading" ||
      gapAbove > line.fontSize * 1.35 ||
      /^[A-Z0-9"'(]/.test(line.text);

    if (startsParagraph) {
      blocks.push({
        type: "paragraph",
        text: line.text
      });
      continue;
    }

    lastBlock.text += shouldJoinTightly(lastBlock.text, line.text) ? line.text : ` ${line.text}`;
  }

  return blocks.filter((block) => block.text.trim().length > 0);
}

function guessPageHeading(blocks, pageNumber) {
  const heading = blocks.find((block) => block.type === "heading")?.text;
  return heading || `Page ${pageNumber}`;
}

function renderBook(metadata, pages) {
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

  bookView.className = "book-view";
  bookView.innerHTML = `
    <header class="book-header">
      <p class="book-kicker">Paperwell edition</p>
      <h1 class="book-name">${escapeHtml(metadata.title)}</h1>
      <p class="book-meta">${escapeHtml(metadata.author)} | ${pages.length} pages</p>
    </header>
    ${sections}
  `;

  currentExport = {
    title: metadata.title,
    html: buildStandaloneHtml(metadata, pages)
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

function repairHyphenation(text) {
  return text.replace(/-\s+([a-z])/g, "$1").trim();
}

function normalizeSpacing(text) {
  return text.replace(/\s+/g, " ").trim();
}

function shouldJoinTightly(previous, current) {
  return previous.endsWith("-") || /^[,.;:!?)]/.test(current);
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

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "paperwell-book";
}

function buildStandaloneHtml(metadata, pages) {
  const tocItems = pages
    .map(
      (page, index) => `
        <a class="toc-item${index === 0 ? " active" : ""}" href="#page-${page.pageNumber}">
          <span class="toc-page">${page.pageNumber}</span>
          <span>${escapeHtml(trimTitle(page.heading, 58))}</span>
        </a>
      `
    )
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
          ${content}
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
      --bg: #171412;
      --bg-soft: #211c19;
      --paper: rgba(31, 26, 22, 0.9);
      --paper-strong: rgba(23, 19, 16, 0.96);
      --ink: #eadfce;
      --muted: #9f8a72;
      --accent: #b2352f;
      --accent-soft: rgba(178, 53, 47, 0.14);
      --gold: #bb9438;
      --line: rgba(255, 244, 231, 0.09);
      --overlay: rgba(9, 7, 6, 0.68);
      --serif: "Crimson Pro", Georgia, serif;
      --display: "Playfair Display", serif;
      --caps: "Cormorant SC", serif;
    }

    body.mode-cream {
      --bg: #e6d8bf;
      --bg-soft: #d8c8ae;
      --paper: rgba(242, 233, 219, 0.92);
      --paper-strong: rgba(248, 240, 228, 0.96);
      --ink: #2f261f;
      --muted: #786652;
      --accent: #972721;
      --accent-soft: rgba(151, 39, 33, 0.11);
      --gold: #9e7621;
      --line: rgba(45, 31, 20, 0.1);
      --overlay: rgba(240, 229, 209, 0.38);
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; font-size: 17px; }
    body {
      margin: 0;
      font-family: var(--serif);
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(187, 148, 56, 0.1), transparent 24%),
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

    .topbar {
      position: fixed;
      inset: 0 0 auto;
      z-index: 20;
      height: 54px;
      display: flex;
      align-items: center;
      gap: 18px;
      padding: 0 28px;
      background: rgba(15, 12, 10, 0.74);
      backdrop-filter: blur(18px) saturate(1.2);
      border-bottom: 1px solid var(--line);
    }

    body.mode-cream .topbar {
      background: rgba(231, 221, 204, 0.82);
    }

    .brand,
    .hero-kicker,
    .toc-label,
    .meta-chip,
    .page-marker,
    .theme-toggle,
    .toc-page {
      font-family: var(--caps);
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }

    .brand {
      color: var(--muted);
      font-size: 0.82rem;
      white-space: nowrap;
    }

    .progress-track {
      flex: 1;
      max-width: 420px;
      height: 2px;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 999px;
      overflow: hidden;
      margin-left: auto;
    }

    body.mode-cream .progress-track {
      background: rgba(0, 0, 0, 0.08);
    }

    .progress-bar {
      width: 0%;
      height: 100%;
      background: linear-gradient(90deg, var(--gold), var(--accent));
      transition: width 120ms linear;
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
      min-height: 100vh;
      display: flex;
      align-items: flex-end;
      padding: 96px 7vw 8vh;
      background:
        linear-gradient(90deg, var(--overlay), rgba(0, 0, 0, 0.18)),
        radial-gradient(circle at center, rgba(178, 53, 47, 0.12), transparent 42%),
        linear-gradient(180deg, rgba(55, 38, 28, 0.6), rgba(16, 13, 11, 0.96)),
        url("https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=1800&q=80") center/cover;
    }

    .hero::after {
      content: "";
      position: absolute;
      inset: auto 0 0;
      height: 32vh;
      background: linear-gradient(180deg, rgba(23, 20, 18, 0), var(--bg));
    }

    .hero-copy {
      position: relative;
      z-index: 1;
      max-width: 760px;
    }

    .hero-kicker {
      color: var(--gold);
      font-size: 0.84rem;
    }

    .hero h1 {
      margin: 18px 0 14px;
      max-width: 10ch;
      font-family: var(--display);
      font-size: clamp(3.5rem, 8vw, 7rem);
      line-height: 0.92;
      font-style: italic;
      color: color-mix(in srgb, var(--accent) 78%, #ffffff 22%);
    }

    .hero p {
      margin: 0;
      max-width: 56ch;
      font-size: 1.06rem;
      line-height: 1.8;
      color: color-mix(in srgb, var(--ink) 82%, transparent);
    }

    .hero-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 28px;
    }

    .meta-chip {
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.03);
      color: var(--muted);
      padding: 8px 12px;
      border-radius: 999px;
      font-size: 0.72rem;
    }

    .shell {
      width: min(920px, calc(100% - 32px));
      margin: -72px auto 56px;
      position: relative;
      z-index: 1;
    }

    .reader-layout {
      display: block;
    }

    .sidebar {
      margin-bottom: 28px;
      padding: 0;
      background: transparent;
      border: 0;
      box-shadow: none;
      backdrop-filter: none;
    }

    .toc-label {
      display: block;
      margin-bottom: 14px;
      color: var(--muted);
      font-size: 0.78rem;
    }

    .toc-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px 18px;
      padding: 18px 0 0;
      border-top: 1px solid var(--line);
    }

    .toc-item {
      display: flex;
      align-items: baseline;
      gap: 10px;
      text-decoration: none;
      color: var(--muted);
      padding: 0 0 8px;
      border-bottom: 1px solid transparent;
      line-height: 1.45;
      transition: color 160ms ease, border-color 160ms ease;
    }

    .toc-item:hover,
    .toc-item.active {
      color: var(--ink);
      border-color: rgba(178, 53, 47, 0.38);
    }

    .toc-page {
      color: var(--gold);
      font-size: 0.7rem;
      flex: 0 0 auto;
    }

    .content {
      display: block;
      padding-top: 8px;
    }

    .intro {
      padding: 0 0 24px;
      margin-bottom: 12px;
      background: transparent;
      border: 0;
      border-bottom: 1px solid var(--line);
      box-shadow: none;
      backdrop-filter: none;
    }

    .intro h2,
    .page-section h2,
    .page-section h3 {
      font-family: var(--display);
      font-weight: 600;
      line-height: 1;
    }

    .intro h2 {
      margin: 10px 0 8px;
      font-size: clamp(2.4rem, 5vw, 4rem);
    }

    .intro p {
      margin: 0;
      color: var(--muted);
    }

    .page-section {
      padding: 28px 0 12px;
      border-top: 1px solid var(--line);
      scroll-margin-top: 74px;
      animation: rise 360ms ease both;
    }

    .page-section:first-of-type {
      border-top: 0;
      padding-top: 8px;
    }

    .page-marker {
      color: var(--gold);
      font-size: 0.76rem;
    }

    .page-section h3 {
      margin: 10px 0 18px;
      font-size: clamp(2rem, 4vw, 2.7rem);
      color: var(--ink);
    }

    .page-section h2 {
      margin: 24px 0 12px;
      font-size: 1.72rem;
      color: color-mix(in srgb, var(--gold) 68%, var(--ink));
    }

    p {
      margin: 0 0 18px;
      max-width: 72ch;
      line-height: 1.92;
      font-size: 1.04rem;
    }

    .dropcap::first-letter {
      float: left;
      margin: 5px 12px 0 0;
      font-family: var(--display);
      font-size: 4.8rem;
      line-height: 0.86;
      color: var(--accent);
    }

    @keyframes rise {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 720px) {
      .topbar {
        padding: 0 14px;
      }

      .progress-track {
        max-width: none;
      }

      .hero {
        min-height: 78vh;
        padding: 84px 18px 34px;
      }

      .shell {
        width: min(100% - 20px, 100%);
        margin-top: -40px;
      }

      .toc-list {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <nav class="topbar">
    <div class="brand">Paperwell Edition</div>
    <div class="progress-track"><div class="progress-bar" id="progressBar"></div></div>
    <button class="theme-toggle" id="themeToggle" type="button">Cream Mode</button>
  </nav>

  <header class="hero">
    <div class="hero-copy">
      <div class="hero-kicker">${escapeHtml(metadata.author)}</div>
      <h1>${escapeHtml(metadata.title)}</h1>
      <p>A dramatic reading export with a clearer continuous layout, while keeping the cover-style hero image and navigation.</p>
      <div class="hero-meta">
        <span class="meta-chip">${pages.length} pages</span>
        <span class="meta-chip">Standalone HTML</span>
        <span class="meta-chip">Paperwell Export</span>
      </div>
    </div>
  </header>

  <main class="shell">
    <div class="reader-layout">
      <aside class="sidebar">
        <span class="toc-label">Contents</span>
        <div class="toc-list">
          ${tocItems}
        </div>
      </aside>

      <section class="content">
        <header class="intro">
          <span class="toc-label">Book Details</span>
          <h2>${escapeHtml(metadata.title)}</h2>
          <p>${escapeHtml(metadata.author)} | ${pages.length} extracted pages</p>
        </header>
        ${article}
      </section>
    </div>
  </main>
  <script>
    const pageNodes = Array.from(document.querySelectorAll(".page-section"));
    const tocNodes = Array.from(document.querySelectorAll(".toc-item"));
    const progressBar = document.getElementById("progressBar");
    const themeToggle = document.getElementById("themeToggle");

    function syncProgress() {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const progress = maxScroll > 0 ? (window.scrollY / maxScroll) * 100 : 0;
      progressBar.style.width = Math.min(100, Math.max(0, progress)) + "%";

      let activeId = pageNodes[0]?.id;
      for (const page of pageNodes) {
        const top = page.getBoundingClientRect().top;
        if (top <= window.innerHeight * 0.34) {
          activeId = page.id;
        }
      }

      for (const item of tocNodes) {
        item.classList.toggle("active", item.getAttribute("href") === "#" + activeId);
      }
    }

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
