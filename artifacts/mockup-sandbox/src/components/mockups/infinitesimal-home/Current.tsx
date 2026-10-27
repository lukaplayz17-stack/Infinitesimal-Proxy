import "./_group.css";

const safe = (value: unknown = "") =>
  String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] as string);

const state = {
  preferences: {
    city: "",
    firstName: "",
    schoolMode: false,
    studyDurationMinutes: 45,
    restrictionMode: "light",
    studySession: null as null | { endsAt: string },
  },
  tasks: [] as Array<{ id: string; title: string; completed: boolean; dueAt?: string; focusToday?: boolean }>,
  events: [] as Array<{ title: string; startAt: string }>,
  notes: [] as Array<{ id: string; title: string; body: string; updatedAt: string }>,
  shortcuts: [] as Array<{ order?: number; url: string; title: string; id: string }>,
  tabs: [{ id: "home", title: "Home", url: "infinitesimal://home", view: "home" }],
  activeTab: "home",
  currentView: "home",
};

const proxyReady = true;
const proxyBootError = "";
const quoteOffset = 0;
const weatherState = { loading: false, data: null as null, error: "" };
const quotations = [
  ["There is nothing either good or bad, but thinking makes it so.", "Hamlet"],
  ["We know what we are, but know not what we may be.", "Hamlet"],
  ["Brevity is the soul of wit.", "Hamlet"],
  ["This above all: to thine own self be true.", "Hamlet"],
  ["The readiness is all.", "Hamlet"],
  ["Our doubts are traitors, and make us lose the good we oft might win, by fearing to attempt.", "Measure for Measure"],
  ["Wisely and slow; they stumble that run fast.", "Romeo and Juliet"],
  ["What’s done is done.", "Macbeth"],
  ["All the world’s a stage, and all the men and women merely players.", "As You Like It"],
  ["The fool doth think he is wise, but the wise man knows himself to be a fool.", "As You Like It"],
  ["Love all, trust a few, do wrong to none.", "All’s Well That Ends Well"],
  ["No legacy is so rich as honesty.", "All’s Well That Ends Well"],
  ["How far that little candle throws his beams! So shines a good deed in a naughty world.", "The Merchant of Venice"],
  ["The quality of mercy is not strained.", "The Merchant of Venice"],
  ["The better part of valour is discretion.", "Henry IV, Part 1"],
  ["Uneasy lies the head that wears a crown.", "Henry IV, Part 2"],
  ["Nothing will come of nothing.", "King Lear"],
  ["The worst is not, so long as we can say “This is the worst.”", "King Lear"],
  ["Love looks not with the eyes, but with the mind.", "A Midsummer Night’s Dream"],
  ["The course of true love never did run smooth.", "A Midsummer Night’s Dream"],
  ["Though she be but little, she is fierce.", "A Midsummer Night’s Dream"],
  ["One touch of nature makes the whole world kin.", "Troilus and Cressida"],
  ["Some are born great, some achieve greatness, and some have greatness thrust upon them.", "Twelfth Night"],
  ["I can no other answer make but thanks, and thanks, and ever thanks.", "Twelfth Night"],
  ["The evil that men do lives after them; the good is oft interred with their bones.", "Julius Caesar"],
  ["The fault, dear Brutus, is not in our stars, but in ourselves.", "Julius Caesar"],
  ["Cowards die many times before their deaths; the valiant never taste of death but once.", "Julius Caesar"],
  ["Love is not love which alters when it alteration finds.", "Sonnet 116"],
  ["Let me not to the marriage of true minds admit impediments.", "Sonnet 116"],
  ["Shall I compare thee to a summer’s day?", "Sonnet 18"],
  ["Now is the winter of our discontent.", "Richard III"],
];

function activeTab() {
  return state.tabs.find((tab) => tab.id === state.activeTab) || state.tabs[0];
}

function activeStudySession() {
  const session = state.preferences.studySession;
  return Boolean(state.preferences.schoolMode && session?.endsAt && Date.parse(session.endsAt) > Date.now());
}

function studySecondsRemaining() {
  const endsAt = Date.parse(state.preferences.studySession?.endsAt || "");
  return Number.isFinite(endsAt) ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : 0;
}

function formattedDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

const pages = [
  ["home", "⌂", "Home"],
  ["school", "▤", "School"],
  ["notes", "▧", "Notes"],
  ["tasks", "☷", "Tasks"],
  ["calendar", "▦", "Calendar"],
  ["translate", "文", "Translate"],
  ["bookmarks", "☆", "Bookmarks"],
  ["history", "◷", "History"],
  ["downloads", "↓", "Downloads"],
  ["music", "♫", "Music"],
  ["extensions", "⬡", "Extensions"],
  ["ai", "✳", "AI"],
];

function navLink(id: string, icon: string, label: string) {
  return `<button class="nav-link ${state.currentView === id ? "active" : ""}" data-view="${id}"><span class="nav-icon" aria-hidden="true">${icon}</span>${label}</button>`;
}

function sidebar() {
  const mainNav = pages.slice(0, 5).map(([id, icon, label]) => navLink(id, icon, label)).join("");
  const libraryNav = pages.slice(5).map(([id, icon, label]) => navLink(id, icon, label)).join("");
  return `<aside class="sidebar" id="sidebar">
    <a class="brand" href="#" data-view="home"><span class="brand-mark"><svg width="21" height="20" viewBox="0 0 24 22" fill="none"><path d="M1 20 9.3 5l4.1 7 2.4-3.7L23 20H1Z" fill="currentColor"/><path d="m9.3 5 2.1 3.7 2 3.3" stroke="#192b3e" stroke-width=".6"/></svg></span><span><span class="brand-name">infinitesimal</span><span class="brand-caption">quiet by design</span></span></a>
    <div class="section-label">Workspace</div><nav class="nav-list">${mainNav}</nav>
    <div class="section-label" style="margin-top:13px">Library</div><nav class="nav-list">${libraryNav}</nav>
    <div class="nav-spacer"></div><nav class="nav-list">${navLink("settings", "⚙", "Settings")}${navLink("diagnostics", "⌘", "Diagnostics")}</nav>
    <div class="sidebar-bottom"><div class="privacy-note"><strong><i class="privacy-dot"></i>Quiet mode, by default</strong><p>No ad network. No tracking pixels. Your workspace stays in this browser.</p></div></div>
  </aside>`;
}

function chrome() {
  const tab = activeTab();
  const urlValue = tab.view === "browser" ? tab.url : tab.url || `infinitesimal://${tab.view || "home"}`;
  return `<header class="chrome">
    <div class="tabbar">${state.tabs.map((currentTab) => `<button class="tab ${currentTab.id === state.activeTab ? "active" : ""}" data-tab="${currentTab.id}"><span class="nav-icon">${currentTab.view === "browser" ? "◉" : "⌂"}</span><span class="tab-label">${safe(currentTab.title)}</span>${state.tabs.length > 1 ? `<span class="tab-close" role="button" data-close-tab="${currentTab.id}" aria-label="Close tab">×</span>` : ""}</button>`).join("")}<button class="add-tab" data-action="new-tab" aria-label="New tab" title="New tab">+</button></div>
    <div class="toolbar">
      <button class="tool-btn mobile-menu" data-action="menu" title="Open navigation" aria-label="Open navigation">☰</button>
      <button class="tool-btn" data-action="back" title="Back" aria-label="Back">‹</button><button class="tool-btn" data-action="forward" title="Forward" aria-label="Forward">›</button>
      <button class="tool-btn" data-action="reload" title="Reload" aria-label="Reload">↻</button>
      <div class="omnibox-wrap"><form class="omnibox" id="omnibox-form"><span class="omnibox-icon">⌕</span><input id="omnibox" autocomplete="off" spellcheck="false" aria-label="Address or search" value="${safe(urlValue)}"><span class="omnibox-icon">↵</span></form><div class="suggestions" id="suggestions" hidden></div></div>
      <span class="toolbar-status">${proxyReady ? "Proxy ready" : "Local workspace"}</span><button class="tool-btn" data-action="bookmark-current" title="Bookmark current page" aria-label="Bookmark current page">☆</button>
    </div>
  </header>`;
}

function mountain() {
  return `<svg class="mountain-art" viewBox="0 0 730 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#708895" stop-opacity=".54"/><stop offset="1" stop-color="#20374b" stop-opacity="0"/></linearGradient><linearGradient id="ridge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#aeb9b5"/><stop offset=".45" stop-color="#627a82"/><stop offset="1" stop-color="#294052"/></linearGradient><linearGradient id="shadowRidge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#77909a"/><stop offset="1" stop-color="#263b4d"/></linearGradient></defs>
    <rect width="730" height="400" fill="url(#sky)"/><circle cx="534" cy="88" r="30" fill="#d7b98e" opacity=".48"/>
    <path d="M229 279 425 56l61 80 47-46 205 213z" fill="url(#ridge)" opacity=".88"/><path d="m425 56 35 101 26-21z" fill="#d5d7c9" opacity=".6"/><path d="m486 136 36 53 11-99z" fill="#425d6b"/><path d="m533 90 62 127-43-35-30-46z" fill="#87999b" opacity=".6"/>
    <path d="m0 328 155-150 104 97 122-103 130 147 98-98 121 98v81H0z" fill="url(#shadowRidge)" opacity=".95"/><path d="m155 178 37 65 67 32z" fill="#aab9b2" opacity=".35"/>
    <path d="M0 354q130-25 258 13t251-8 221 5v36H0z" fill="#1d3548"/><path d="M0 375q141-34 264 0t242 1 224-4v28H0z" fill="#162b3e"/>
    <g fill="#162838" opacity=".78"><path d="m559 313 18-52 20 52h-11v33h-17v-33z"/><path d="m632 332 13-39 16 39h-9v25h-13v-25z"/><path d="m494 333 14-42 17 42h-10v26h-13v-26z"/></g>
  </svg>`;
}

function emptyState(title: string, description: string, action = "") {
  return `<div class="empty-state"><span class="empty-glyph">◇</span><strong>${safe(title)}</strong><span>${safe(description)}</span>${action}</div>`;
}

function dateLabel(value: string | undefined, options = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } as Intl.DateTimeFormatOptions) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Date not set" : new Intl.DateTimeFormat(undefined, options).format(date);
}

function faviconMarkup(url: string) {
  try {
    const host = new URL(url).host;
    return `<img class="favicon" src="/api/favicon?host=${encodeURIComponent(host)}" alt="" loading="lazy" onerror="this.hidden=true">`;
  } catch {
    return '<span class="nav-icon" style="color:var(--sand)">☆</span>';
  }
}

function serviceWorkerHelp(_message: string) {
  return "";
}

function homeView() {
  const upcoming = [
    ...state.events.map((event) => ({ title: event.title, at: event.startAt, type: "Event" })),
    ...state.tasks.filter((task) => !task.completed && task.dueAt).map((task) => ({ title: task.title, at: task.dueAt || "", type: "Task" })),
  ].filter((item) => item.at && new Date(item.at) >= new Date()).sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()).slice(0, 5);
  const focusTasks = state.tasks.filter((task) => task.focusToday && !task.completed);
  const recentNotes = [...state.notes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 3);
  const shortcuts = [...state.shortcuts].sort((a, b) => (a.order || 0) - (b.order || 0));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const hello = state.preferences.firstName ? `${greeting}, ${safe(state.preferences.firstName)}.` : `${greeting}.`;
  const quote = quotations[(Math.floor(Date.now() / 86_400_000) + quoteOffset) % quotations.length];
  return `<section class="home-grid"><div>
    ${serviceWorkerHelp(proxyBootError)}
    <section class="hero">${mountain()}<div class="hero-copy"><div class="eyebrow" id="live-date">${safe(new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date()))}</div><h1>${hello}<br>Find your way through the work.</h1><p>A browser for looking things up, keeping your schoolwork close, and tuning out the noise.</p><div class="live-clock" id="live-clock">${safe(new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date()))}</div><form class="hero-search" id="hero-search"><span class="omnibox-icon">⌕</span><input name="query" aria-label="Search the web or enter an address"></form></div></section>
    <section class="quote-card"><blockquote>“${safe(quote[0])}”</blockquote><div class="quote-credit"><cite>— William Shakespeare, ${safe(quote[1])}</cite><button class="text-action" data-action="next-quote">Another quote →</button></div></section>
    <div class="home-lower"><section><div class="section-head"><h2>Today's focus</h2><button class="text-action" data-view="tasks">Open tasks →</button></div>${focusTasks.length ? `<div class="table-list">${focusTasks.map((task) => `<div class="row-item"><input type="checkbox" data-complete-task="${task.id}" aria-label="Complete ${safe(task.title)}"><div class="row-body"><strong>${safe(task.title)}</strong><small>${task.dueAt ? `Due ${dateLabel(task.dueAt)}` : "No due date"}</small></div></div>`).join("")}</div>` : emptyState("Nothing in focus today", "Mark a task “Keep in focus today” when you create or edit it.")}</section>
    <section><div class="section-head"><h2>Recent notes</h2><button class="text-action" data-view="notes">Open notes →</button></div>${recentNotes.length ? `<div class="table-list">${recentNotes.map((note) => `<button class="row-item" data-edit-note="${note.id}" style="text-align:left"><span class="nav-icon">▧</span><span class="row-body"><strong>${safe(note.title || "Untitled note")}</strong><small>${safe(note.body.slice(0, 75) || "No note text yet")}</small></span></button>`).join("")}</div>` : emptyState("No notes yet", "Create a note to keep a thought, class note or question.")}</section></div>
    <section class="home-shortcuts"><div class="section-head"><h2>Shortcuts</h2><button class="text-action" data-action="create-shortcut">Add shortcut +</button></div>${shortcuts.length ? `<div class="shortcut-list">${shortcuts.map((item, index) => `<div class="shortcut-item">${faviconMarkup(item.url)}<button class="shortcut-open" data-open-url="${safe(item.url)}">${safe(item.title)}</button><div class="shortcut-actions"><button data-edit-shortcut="${item.id}" aria-label="Edit ${safe(item.title)}">Edit</button><button data-move-shortcut="${item.id}" data-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="Move ${safe(item.title)} up">↑</button><button data-move-shortcut="${item.id}" data-direction="1" ${index === shortcuts.length - 1 ? "disabled" : ""} aria-label="Move ${safe(item.title)} down">↓</button><button data-delete-shortcut="${item.id}" aria-label="Remove ${safe(item.title)}">×</button></div></div>`).join("")}</div>` : emptyState("No shortcuts added", "Add a real website you open often; it will stay in this browser.")}</section>
    <section class="form-card calculator-card"><div class="section-head"><h2>Calculator</h2></div><form id="calculator-form" class="calculator-form"><label class="field"><span>Expression</span><input name="expression" id="calculator-expression" inputmode="decimal" aria-label="Calculator expression"></label><button class="secondary-btn">Calculate</button></form><output id="calculator-result" class="subtle" aria-live="polite"></output></section>
  </div><aside class="side-panels">
    <section class="panel"><div class="panel-head"><h2>School Mode</h2><span class="pill">${activeStudySession() ? "On" : "Off"}</span></div>${activeStudySession() ? `<div class="study-clock" id="study-clock">${formattedDuration(studySecondsRemaining())}</div><p class="panel-copy">${safe(state.preferences.restrictionMode)} session · HTTP/HTTPS requests are filtered. Existing WebSocket connections are not stopped.</p><button class="panel-link" data-action="school-end">End session →</button>` : `<p class="panel-copy">Start a timed session to filter proxied HTTP/HTTPS requests. Existing WebSocket connections and other apps are not restricted.</p><button class="panel-link" data-action="school-start">Start a ${Number(state.preferences.studyDurationMinutes) || 45}-minute session →</button>`}<button class="panel-link" data-view="school">Customize restrictions →</button></section>
    <section class="panel"><div class="panel-head"><h2>Upcoming</h2><button class="text-action" data-view="calendar">Calendar →</button></div>${upcoming.length ? `<div class="upcoming-list">${upcoming.map((event) => `<div class="upcoming-item"><b>${safe(event.title)}</b><span>${event.type} · ${dateLabel(event.at)}</span></div>`).join("")}</div>` : `<div class="mini-empty">Add an event or a task with a due date to see it here.</div>`}</section>
    <section class="panel"><div class="panel-head"><h2>Outside, briefly</h2><span class="pill">${state.preferences.city ? "Weather" : "Optional"}</span></div>${weatherPanel()}</section>
    <section class="panel"><div class="panel-head"><h2>Local by default</h2><span class="pill">Private</span></div><p class="panel-copy">Notes, tasks, courses, events and bookmarks are stored in this browser. They are not sent to a tracking service.</p></section>
  </aside></section>`;
}

function weatherPanel() {
  if (!state.preferences.city) return `<p class="panel-copy">Add a city in Settings → Search to request current conditions from the weather service.</p><button class="panel-link" data-view="settings">Open settings →</button>`;
  if (weatherState.loading) return `<p class="panel-copy">Checking conditions for ${safe(state.preferences.city)}…</p>`;
  if (weatherState.error) return `<p class="panel-copy">${safe(weatherState.error)}</p><button class="panel-link" data-action="weather-retry">Try again →</button>`;
  if (!weatherState.data) return `<p class="panel-copy">Weather has not been requested yet.</p><button class="panel-link" data-action="weather-retry">Check conditions →</button>`;
  return "";
}

export function Current() {
  const markup = `<div class="shell">${sidebar()}<main class="main">${chrome()}<div class="content">${homeView()}</div></main></div>`;
  return <div className="current-extract" dangerouslySetInnerHTML={{ __html: markup }} />;
}
