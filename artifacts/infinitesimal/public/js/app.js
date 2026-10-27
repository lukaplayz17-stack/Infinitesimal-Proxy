import { expandRecurringEvent, parseRecurrenceRule } from './ics-recurrence.js';

const root = document.querySelector('#app');
const KEY = 'infinitesimal.workspace.v1';
const ENGINE_RETRY_KEY = `${KEY}.engineRetry`;
const BLANK_SHELL_MODE = new URLSearchParams(location.search).get('infinitesimalBlankShell') === '1';
const BLANK_SHELL_KEY = `${KEY}.blankShell`;
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const now = () => new Date().toISOString();
const safe = (value = '') => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const decodeText = value => { const el = document.createElement('textarea'); el.innerHTML = value; return el.value; };
const initial = {
  preferences: {
    searchEngine: 'https://duckduckgo.com/?q=',
    city: '',
    firstName: '',
    onboardingComplete: false,
    schoolMode: false,
    studyDurationMinutes: 45,
    restrictionMode: 'light',
    blocklist: [],
    allowlist: [],
    siteRules: {},
    extensions: { darkMode: false, readerView: false, textSize: 100, customCss: '', customJs: '' },
  },
  tasks: [], courses: [], notes: [], events: [], bookmarks: [], history: [], studySessions: [], shortcuts: [], recentlyClosedTabs: [], aiMessages: [],
  tabs: [{ id: uid(), title: 'Home', url: 'infinitesimal://home', view: 'home' }], activeTab: null,
  currentView: 'home'
};
let state;
try {
  state = { ...initial, ...JSON.parse((BLANK_SHELL_MODE ? sessionStorage.getItem(BLANK_SHELL_KEY) : null) || localStorage.getItem(KEY) || '{}') };
} catch {
  state = { ...initial };
}
if (!Array.isArray(state.tabs) || !state.tabs.length) state.tabs = initial.tabs;
state.tabs = state.tabs.map(tab => ({ ...tab, id: tab.id || uid() }));
state.tabs = state.tabs.map(tab => ({ ...tab, visitStack: Array.isArray(tab.visitStack) ? tab.visitStack : (tab.view === 'browser' && /^https?:/.test(tab.url || '') ? [tab.url] : []), visitIndex: Number.isInteger(tab.visitIndex) ? tab.visitIndex : (tab.view === 'browser' && /^https?:/.test(tab.url || '') ? 0 : -1) }));
state.activeTab ||= state.tabs[0].id;
state.currentView ||= 'home';
state.preferences = { ...initial.preferences, ...(state.preferences || {}) };
for (const collection of ['tasks','courses','notes','events','bookmarks','history','studySessions','shortcuts']) if (!Array.isArray(state[collection])) state[collection] = [];
if(!Array.isArray(state.recentlyClosedTabs)) state.recentlyClosedTabs=[];
if(!Array.isArray(state.aiMessages)) state.aiMessages=[];
state.aiMessages=state.aiMessages.filter(message=>message&&['user','assistant'].includes(message.role)&&typeof message.content==='string'&&!message.pending).slice(-30);
state.preferences.extensions = { ...initial.preferences.extensions, ...(state.preferences.extensions || {}) };
state.preferences.blocklist = Array.isArray(state.preferences.blocklist) ? state.preferences.blocklist : [];
state.preferences.allowlist = Array.isArray(state.preferences.allowlist) ? state.preferences.allowlist : [];
state.preferences.siteRules = state.preferences.siteRules && typeof state.preferences.siteRules === 'object' ? state.preferences.siteRules : {};
if(!['https://duckduckgo.com/?q=','https://www.bing.com/search?q=','https://search.brave.com/search?q=','https://www.startpage.com/sp/search?query=','https://www.google.com/search?q='].includes(state.preferences.searchEngine)) state.preferences.searchEngine=initial.preferences.searchEngine;
if(!['uv','scramjet'].includes(state.preferences.proxyEngine)) delete state.preferences.proxyEngine;
if(!['light','strict'].includes(state.preferences.restrictionMode)) state.preferences.restrictionMode='light';
if(!/^#[0-9a-f]{6}$/i.test(state.preferences.accentColor||'')) delete state.preferences.accentColor;
state.preferences.studyDurationMinutes=Math.max(5,Math.min(180,Number(state.preferences.studyDurationMinutes)||45));

let apiConfig = null;
let configError = '';
let proxyReady = false;
let proxyBootError = '';
let activeSettings = 'General';
let suggestionTimer;
let toastTimer;
let modalState = null;
let musicUrl = '';
let audioFiles = [];
let downloadRecords = [];
let audioFilesLoaded = false;
let audioContext = null;
let noiseSource = null;
let noiseGain = null;
let aiMessages = state.aiMessages;
let currentBrowserError = '';
let activeFrame = null;
const tabFrames = new Map();
let weatherState = { loading: false, data: null, error: '' };
let diagnosticResults = null;
let diagnosticsRunning = false;
let translationState = { loading: false, result: '', error: '' };
let calendarCursor = new Date();
let calendarSelectedDate = '';
let calendarMode = 'month';
let historyQuery = '';
let quoteOffset = 0;

function persist() {
  if (BLANK_SHELL_MODE) sessionStorage.setItem(BLANK_SHELL_KEY, JSON.stringify(state));
  else localStorage.setItem(KEY, JSON.stringify(state));
}
function persistAiMessages() {
  const saved=[];
  let total=0;
  for(const message of [...aiMessages].reverse()) {
    if(message.pending||!['user','assistant'].includes(message.role)||typeof message.content!=='string') continue;
    const content=message.content.slice(0,8_000);
    if(total+content.length>30_000) break;
    saved.unshift({role:message.role,content});
    total+=content.length;
    if(saved.length>=30) break;
  }
  aiMessages=saved;
  state.aiMessages=saved;
  persist();
}
function flash(message) {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.append(toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.remove(), 3200);
}
function setView(view) {
  state.currentView = view;
  persist();
  render();
}
function activeTab() {
  return state.tabs.find(tab => tab.id === state.activeTab) || state.tabs[0];
}
function currentBrowserTab() {
  if(activeTab().view==='browser') return activeTab();
  return state.tabs.find(tab=>tab.id===state.preferences.lastBrowserTabId&&tab.view==='browser')
    || [...state.tabs].reverse().find(tab=>tab.view==='browser')
    || null;
}
function activeProxyEngine() {
  const saved = localStorage.getItem(`${KEY}.proxyEngine`);
  return ['uv','scramjet'].includes(saved) ? saved
    : ['uv','scramjet'].includes(state.preferences.proxyEngine) ? state.preferences.proxyEngine
    : apiConfig?.proxyEngine || 'uv';
}
function otherProxyEngine(engine = activeProxyEngine()) {
  return engine === 'uv' ? 'scramjet' : 'uv';
}
function engineLabel(engine) {
  return engine === 'uv' ? 'Ultraviolet' : 'Scramjet';
}
function readEngineRetry() {
  try { return JSON.parse(sessionStorage.getItem(ENGINE_RETRY_KEY) || 'null'); }
  catch { return null; }
}
function matchesEngineRetry(tab, engine = activeProxyEngine()) {
  const retry = readEngineRetry();
  return Boolean(retry && tab && retry.tabId === tab.id && retry.url === tab.url && retry.to === engine);
}
function finishEngineRetry(tab, success, detail = '') {
  if (!matchesEngineRetry(tab)) return;
  const retry = readEngineRetry();
  sessionStorage.removeItem(ENGINE_RETRY_KEY);
  if (success) {
    flash(`Opened with ${engineLabel(retry.to)}.`);
    return;
  }
  currentBrowserError = `Could not open this page with ${engineLabel(retry.to)}. ${detail || 'The alternate proxy engine could not load the page.'} Your URL and tab are unchanged; you can retry with ${engineLabel(retry.from)}.`;
  activeFrame = null;
  tabFrames.delete(tab.id);
  render();
}
function retryWithOtherEngine() {
  const tab = activeTab().view === 'browser' ? activeTab() : currentBrowserTab();
  if (!tab || !/^https?:\/\//i.test(tab.url || '')) {
    flash('Open a web page before retrying with another proxy engine.');
    return;
  }
  const from = activeProxyEngine();
  const to = otherProxyEngine(from);
  state.activeTab = tab.id;
  state.currentView = 'browser';
  state.preferences.proxyEngine = to;
  localStorage.setItem(`${KEY}.proxyEngine`, to);
  sessionStorage.setItem(ENGINE_RETRY_KEY, JSON.stringify({ tabId: tab.id, url: tab.url, from, to }));
  persist();
  location.reload();
}
const restrictionPresets = {
  social: ['facebook.com','instagram.com','tiktok.com','snapchat.com','x.com'],
  games: ['roblox.com','steampowered.com','epicgames.com','minecraft.net','leagueoflegends.com'],
  streaming: ['youtube.com','netflix.com','disneyplus.com','hulu.com','twitch.tv'],
};
const quotations = [
  ['There is nothing either good or bad, but thinking makes it so.','Hamlet'],
  ['We know what we are, but know not what we may be.','Hamlet'],
  ['Brevity is the soul of wit.','Hamlet'],
  ['This above all: to thine own self be true.','Hamlet'],
  ['The readiness is all.','Hamlet'],
  ['Our doubts are traitors, and make us lose the good we oft might win, by fearing to attempt.','Measure for Measure'],
  ['Wisely and slow; they stumble that run fast.','Romeo and Juliet'],
  ['What’s done is done.','Macbeth'],
  ['All the world’s a stage, and all the men and women merely players.','As You Like It'],
  ['The fool doth think he is wise, but the wise man knows himself to be a fool.','As You Like It'],
  ['Love all, trust a few, do wrong to none.','All’s Well That Ends Well'],
  ['No legacy is so rich as honesty.','All’s Well That Ends Well'],
  ['How far that little candle throws his beams! So shines a good deed in a naughty world.','The Merchant of Venice'],
  ['The quality of mercy is not strained.','The Merchant of Venice'],
  ['The better part of valour is discretion.','Henry IV, Part 1'],
  ['Uneasy lies the head that wears a crown.','Henry IV, Part 2'],
  ['Nothing will come of nothing.','King Lear'],
  ['The worst is not, so long as we can say “This is the worst.”','King Lear'],
  ['Love looks not with the eyes, but with the mind.','A Midsummer Night’s Dream'],
  ['The course of true love never did run smooth.','A Midsummer Night’s Dream'],
  ['Though she be but little, she is fierce.','A Midsummer Night’s Dream'],
  ['One touch of nature makes the whole world kin.','Troilus and Cressida'],
  ['Some are born great, some achieve greatness, and some have greatness thrust upon them.','Twelfth Night'],
  ['I can no other answer make but thanks, and thanks, and ever thanks.','Twelfth Night'],
  ['The evil that men do lives after them; the good is oft interred with their bones.','Julius Caesar'],
  ['The fault, dear Brutus, is not in our stars, but in ourselves.','Julius Caesar'],
  ['Cowards die many times before their deaths; the valiant never taste of death but once.','Julius Caesar'],
  ['Love is not love which alters when it alteration finds.','Sonnet 116'],
  ['Let me not to the marriage of true minds admit impediments.','Sonnet 116'],
  ['Shall I compare thee to a summer’s day?','Sonnet 18'],
  ['Now is the winter of our discontent.','Richard III'],
];
function activeStudySession() {
  const session = state.preferences.studySession;
  return Boolean(state.preferences.schoolMode && session?.endsAt && Date.parse(session.endsAt) > Date.now());
}
function studySecondsRemaining() {
  const endsAt = Date.parse(state.preferences.studySession?.endsAt || '');
  return Number.isFinite(endsAt) ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : 0;
}
function formattedDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
}
function studyPolicy() {
  const session = state.preferences.studySession;
  const until = Date.parse(session?.endsAt || '');
  const active = activeStudySession();
  return {
    active,
    sessionUntil: active ? until : null,
    mode: state.preferences.restrictionMode === 'strict' ? 'strict' : 'light',
    blocklist: state.preferences.blocklist,
    allowlist: state.preferences.allowlist,
  };
}
async function saveStudyPolicy() {
  if (!window.InfinitesimalPolicy?.save) return;
  await window.InfinitesimalPolicy.save(studyPolicy());
}
async function digestPin(pin,saltHex) {
  const salt=Uint8Array.from(String(saltHex||'').match(/.{2}/g)||[],pair=>parseInt(pair,16));
  if(salt.length<16) throw new Error('The saved PIN salt is invalid.');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
  const digest=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:150_000,hash:'SHA-256'},key,256);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
async function startStudySession() {
  const requested = Number(document.querySelector('#study-duration')?.value || state.preferences.studyDurationMinutes || 45);
  const minutes = Math.max(5, Math.min(180, Math.round(requested)));
  state.preferences.studyDurationMinutes = minutes;
  state.preferences.studySession = {
    id: uid(),
    startedAt: now(),
    endsAt: new Date(Date.now() + minutes * 60_000).toISOString(),
    durationMinutes: minutes,
  };
  state.preferences.schoolMode = true;
  persist();
  await saveStudyPolicy();
  render();
  flash(`Study session started · ${minutes} minutes`);
}
async function endStudySession(completed = false) {
  if (!state.preferences.schoolMode || !state.preferences.studySession) return;
  if (Date.parse(state.preferences.studySession.endsAt) <= Date.now()) completed = true;
  const pinHash = state.preferences.schoolPinHash;
  if (pinHash && !completed) {
    const entered = prompt('Enter the School Mode PIN to end this session.');
    if (entered === null) return;
    if (await digestPin(entered,state.preferences.schoolPinSalt) !== pinHash) {
      flash('That PIN did not match.');
      return;
    }
  }
  const session = state.preferences.studySession;
  const startedAt = Date.parse(session.startedAt) || Date.now();
  const elapsedMinutes = Math.max(1, Math.floor((Date.now() - startedAt) / 60_000));
  state.studySessions.unshift({
    id: session.id,
    startedAt: session.startedAt,
    finishedAt: now(),
    durationMinutes: completed ? session.durationMinutes : elapsedMinutes,
    completed,
  });
  if(state.studySessions.length>500) state.studySessions.length=500;
  state.preferences.schoolMode = false;
  state.preferences.studySession = null;
  persist();
  await saveStudyPolicy();
  render();
  flash(completed ? 'Study session completed and recorded.' : 'Study session ended and recorded.');
}
function updateStudyClock() {
  if (!activeStudySession()) {
    if (state.preferences.schoolMode && state.preferences.studySession?.endsAt) {
      void endStudySession(true);
    }
    return;
  }
  const clock = document.querySelector('#study-clock');
  if (clock) clock.textContent = formattedDuration(studySecondsRemaining());
  if (studySecondsRemaining() === 0) void endStudySession(true);
}
function onboardingForm() {
  if (state.preferences.onboardingComplete || modalState) return;
  modal('Set up your quiet workspace',`<form id="onboarding-form"><label class="field"><span>What should we call you?</span><input name="firstName" maxlength="50" value="${safe(state.preferences.firstName||'')}"></label><label class="field"><span>Search engine</span><select name="searchEngine"><option value="https://duckduckgo.com/?q=">DuckDuckGo</option><option value="https://www.bing.com/search?q=">Bing</option><option value="https://search.brave.com/search?q=">Brave</option><option value="https://www.startpage.com/sp/search?query=">Startpage</option><option value="https://www.google.com/search?q=">Google — may block proxied traffic</option></select></label><div class="dialog-actions"><button class="primary-btn">Save preferences</button></div></form>`);
}
const pages = [
  ['home','⌂','Home'],['ai','✳','AI'],['school','▤','School'],['notes','▧','Notes'],['tasks','☷','Tasks'],['calendar','▦','Calendar'],
  ['bookmarks','☆','Bookmarks'],['history','◷','History'],['downloads','↓','Downloads'],['music','♫','Music'],
  ['extensions','⬡','Extensions'],['translate','文','Translate']
];
function sidebar() {
  const mainNav = pages.slice(0,6).map(([id,icon,label]) => navLink(id,icon,label)).join('');
  const libraryNav = pages.slice(6).map(([id,icon,label]) => navLink(id,icon,label)).join('');
  return `<aside class="sidebar" id="sidebar">
    <a class="brand" href="#" data-view="home"><span class="brand-mark"><svg width="21" height="20" viewBox="0 0 24 22" fill="none"><path d="M1 20 9.3 5l4.1 7 2.4-3.7L23 20H1Z" fill="currentColor"/><path d="m9.3 5 2.1 3.7 2 3.3" stroke="#192b3e" stroke-width=".6"/></svg></span><span><span class="brand-name">infinitesimal</span><span class="brand-caption">quiet by design</span></span></a>
    <div class="section-label">Workspace</div><nav class="nav-list">${mainNav}</nav>
    <div class="section-label" style="margin-top:13px">Library</div><nav class="nav-list">${libraryNav}</nav>
    <div class="nav-spacer"></div><nav class="nav-list">${navLink('settings','⚙','Settings')}${navLink('diagnostics','⌘','Diagnostics')}</nav>
    <div class="sidebar-bottom"><div class="privacy-note"><strong><i class="privacy-dot"></i>Quiet mode, by default</strong><p>No ad network. No tracking pixels. Your workspace stays in this browser.</p></div></div>
  </aside>`;
}
function navLink(id, icon, label) {
  return `<button class="nav-link ${state.currentView === id ? 'active' : ''}" data-view="${id}"><span class="nav-icon" aria-hidden="true">${icon}</span>${label}</button>`;
}
function chrome() {
  const tab = activeTab();
  const urlValue = tab.view === 'browser' ? tab.url : tab.url || `infinitesimal://${tab.view || 'home'}`;
  const retryEngine = engineLabel(otherProxyEngine());
  return `<header class="chrome">
    <div class="tabbar">${state.tabs.map(t => `<button class="tab ${t.id===state.activeTab?'active':''}" data-tab="${t.id}"><span class="nav-icon">${t.view==='browser'?'◉':'⌂'}</span><span class="tab-label">${safe(t.title)}</span>${state.tabs.length>1?`<span class="tab-close" role="button" data-close-tab="${t.id}" aria-label="Close tab">×</span>`:''}</button>`).join('')}<button class="add-tab" data-action="new-tab" aria-label="New tab" title="New tab">+</button><button class="blank-tab" data-action="new-blank-tab" aria-label="Open about:blank" title="Open about:blank">about:blank</button></div>
    <div class="toolbar">
      <button class="tool-btn mobile-menu" data-action="menu" title="Open navigation" aria-label="Open navigation">☰</button>
      <button class="tool-btn" data-action="back" title="Back" aria-label="Back">‹</button><button class="tool-btn" data-action="forward" title="Forward" aria-label="Forward">›</button>
      <button class="tool-btn" data-action="reload" title="Reload" aria-label="Reload">↻</button>
      <div class="omnibox-wrap"><form class="omnibox" id="omnibox-form"><span class="omnibox-icon">⌕</span><input id="omnibox" autocomplete="off" spellcheck="false" aria-label="Address or search" value="${safe(urlValue)}"><span class="omnibox-icon">↵</span></form><div class="suggestions" id="suggestions" hidden></div></div>
      <span class="toolbar-status">${proxyReady?'Proxy ready':'Local workspace'}</span>${tab.view==='browser'&&/^https?:\/\//i.test(tab.url||'')?`<button class="tool-btn" data-action="retry-other-engine" title="Retry this page with ${retryEngine}" aria-label="Retry this page with ${retryEngine}">⇄</button>`:''}<button class="tool-btn" data-action="bookmark-current" title="Bookmark current page" aria-label="Bookmark current page">☆</button>
    </div>
  </header>`;
}
function mountain() {
  return `<svg class="mountain-art" viewBox="0 0 1000 430" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#b76878"/><stop offset=".42" stop-color="#8c526d"/><stop offset=".72" stop-color="#4d4767"/><stop offset="1" stop-color="#1b2940"/></linearGradient>
      <linearGradient id="peak" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#68596f"/><stop offset=".48" stop-color="#363d59"/><stop offset="1" stop-color="#202d45"/></linearGradient>
      <linearGradient id="front" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#303b56"/><stop offset="1" stop-color="#101d32"/></linearGradient>
      <radialGradient id="glow"><stop stop-color="#f1ac8a" stop-opacity=".74"/><stop offset="1" stop-color="#d4777d" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1000" height="430" fill="url(#sky)"/>
    <ellipse cx="740" cy="185" rx="260" ry="150" fill="url(#glow)"/>
    <circle cx="744" cy="186" r="26" fill="#f5c49b" opacity=".82"/>
    <path d="M0 300 136 223l86 45 186-199 94 115 76-70 150 153 105-86 167 111v138H0z" fill="#3c405d" opacity=".82"/>
    <path d="m408 69 55 106 45-34z" fill="#d1a6a0" opacity=".36"/>
    <path d="M0 336 138 244l110 91 141-119 105 101 127-134 116 121 123-97 140 105v118H0z" fill="url(#peak)"/>
    <path d="m389 216 58 82 47-82 61 67 44-56 79 91H211z" fill="#586078" opacity=".36"/>
    <path d="m0 365 123-39 104 18 129-49 107 50 141-54 120 48 132-44 144 49v86H0z" fill="url(#front)"/>
    <path d="M0 393q160-38 298 4t265-1 244-4 193 7v31H0z" fill="#111d31"/>
    <g fill="#142139" opacity=".92"><path d="m690 365 22-67 25 67h-13v40h-22v-40z"/><path d="m774 376 16-49 20 49h-11v31h-17v-31z"/><path d="m845 370 19-57 21 57h-12v38h-18v-38z"/></g>
  </svg>`;
}
function emptyState(title, description, action = '') {
  return `<div class="empty-state"><span class="empty-glyph">◇</span><strong>${safe(title)}</strong><span>${safe(description)}</span>${action}</div>`;
}
function markdownHtml(value='') {
  const escaped=safe(value);
  return escaped.split(/\n{2,}/).map(block=>{
    const lines=block.split('\n');
    if(lines.every(line=>/^\s*[-*]\s+/.test(line))) {
      return `<ul>${lines.map(line=>`<li>${inlineMarkdown(line.replace(/^\s*[-*]\s+/,''))}</li>`).join('')}</ul>`;
    }
    const heading=block.match(/^(#{1,3})\s+([\s\S]*)$/);
    if(heading) return `<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`;
    return `<p>${lines.map(inlineMarkdown).join('<br>')}</p>`;
  }).join('');
}
function inlineMarkdown(value) {
  return value.replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>').replace(/\[([^\]]+)\]\((https?:\/\/[^ )]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
function dateLabel(value, options = { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Date not set' : new Intl.DateTimeFormat(undefined, options).format(date);
}
function faviconMarkup(url) {
  try {
    const host=new URL(url).host;
    return `<img class="favicon" src="/api/favicon?host=${encodeURIComponent(host)}" alt="" loading="lazy" onerror="this.hidden=true">`;
  } catch { return '<span class="nav-icon" style="color:var(--sand)">☆</span>'; }
}
function homeView() {
  const upcoming = [
    ...state.events.map(event => ({ title:event.title, at:event.startAt, type:'Event' })),
    ...state.tasks.filter(task => !task.completed && task.dueAt).map(task => ({ title:task.title, at:task.dueAt, type:'Task' })),
  ].filter(item => new Date(item.at) >= new Date()).sort((a,b)=>new Date(a.at)-new Date(b.at)).slice(0,5);
  const focusTasks = state.tasks.filter(task => task.focusToday && !task.completed);
  const recentNotes = [...state.notes].sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,3);
  const shortcuts = [...state.shortcuts].sort((a,b)=>(a.order||0)-(b.order||0));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const hello = state.preferences.firstName ? `${greeting}, ${safe(state.preferences.firstName)}.` : `${greeting}.`;
  const quote=quotations[(Math.floor(Date.now()/86_400_000)+quoteOffset)%quotations.length];
  const quickLinks = [['ai','AI Chat','✳'],['school','School','▤'],['notes','Notes','▧'],['tasks','Tasks','☷'],['calendar','Calendar','▦'],['translate','Translate','文']];
  return `<section class="home-grid home-dashboard">
    ${serviceWorkerHelp(proxyBootError)}
    <div class="home-primary">
      <section class="hero home-hero">${mountain()}<div class="hero-veil"></div><div class="home-hero-top"><div><span class="eyebrow" id="live-date">${safe(new Intl.DateTimeFormat(undefined,{weekday:'long',month:'short',day:'numeric'}).format(new Date()))}</span><h1>${hello}<br><span>Let’s make progress.</span></h1><p>A browser for looking things up, keeping your schoolwork close, and tuning out the noise.</p></div><div class="hero-time"><strong id="live-clock">${safe(new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date()))}</strong><span>${safe(new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric'}).format(new Date()))}</span></div></div><form class="hero-search" id="hero-search"><span class="omnibox-icon" aria-hidden="true">⌕</span><input name="query" aria-label="Search the web or enter an address" placeholder="Search the web or enter an address"><button type="submit" aria-label="Search">↵</button></form></section>
      <nav class="home-quicklinks" aria-label="Workspace shortcuts"><button class="quicklink" data-action="focus-search"><span aria-hidden="true">⌕</span>Search<i aria-hidden="true">↗</i></button>${quickLinks.map(([id,label,icon])=>`<button class="quicklink" data-view="${id}"><span aria-hidden="true">${icon}</span>${label}<i aria-hidden="true">↗</i></button>`).join('')}<button class="quicklink" data-action="focus-calculator"><span aria-hidden="true">∑</span>Calculator<i aria-hidden="true">↗</i></button></nav>
      <section class="home-shortcuts home-shortcut-section"><div class="section-head"><div><span class="eyebrow">Your corner of the web</span><h2>Shortcuts</h2></div><button class="text-action" data-action="create-shortcut">Add shortcut <span aria-hidden="true">+</span></button></div><div class="shortcut-tiles">${shortcuts.map((item,index)=>`<div class="shortcut-tile"><button class="shortcut-tile-open" data-open-url="${safe(item.url)}" aria-label="Open ${safe(item.title)}">${faviconMarkup(item.url)}<span>${safe(item.title)}</span></button><button class="shortcut-tile-menu" data-edit-shortcut="${item.id}" aria-label="Edit ${safe(item.title)}">···</button><button class="shortcut-move shortcut-move-up" data-move-shortcut="${item.id}" data-direction="-1" ${index===0?'disabled':''} aria-label="Move ${safe(item.title)} up">↑</button><button class="shortcut-move shortcut-move-down" data-move-shortcut="${item.id}" data-direction="1" ${index===shortcuts.length-1?'disabled':''} aria-label="Move ${safe(item.title)} down">↓</button><button class="shortcut-remove" data-delete-shortcut="${item.id}" aria-label="Remove ${safe(item.title)}">×</button></div>`).join('')}<button class="shortcut-tile shortcut-add" data-action="create-shortcut"><span class="shortcut-plus" aria-hidden="true">+</span><span>Add shortcut</span></button></div></section>
      <div class="home-lower home-workspace-panels">
        <section class="home-widget focus-widget"><div class="section-head"><div><span class="eyebrow">A little at a time</span><h2>Today’s focus</h2></div><button class="text-action" data-view="tasks">View all <span aria-hidden="true">→</span></button></div>${focusTasks.length?`<div class="table-list">${focusTasks.map(t=>`<div class="row-item"><input type="checkbox" data-complete-task="${t.id}" aria-label="Complete ${safe(t.title)}"><div class="row-body"><strong>${safe(t.title)}</strong><small>${t.dueAt?`Due ${dateLabel(t.dueAt)}`:'No due date'}</small></div></div>`).join('')}</div>`:`<div class="home-empty"><span class="empty-glyph" aria-hidden="true">✓</span><strong>Nothing in focus just yet</strong><p>Choose a task to keep close when you create or edit it.</p><button data-view="tasks">Open your task list <span aria-hidden="true">→</span></button></div>`}</section>
        <section class="home-widget notes-widget"><div class="section-head"><div><span class="eyebrow">Keep what matters</span><h2>Notes</h2></div><button class="text-action" data-view="notes">Recent <span aria-hidden="true">→</span></button></div>${recentNotes.length?`<div class="table-list">${recentNotes.map(n=>`<button class="row-item" data-edit-note="${n.id}" style="text-align:left"><span class="nav-icon" aria-hidden="true">▧</span><span class="row-body"><strong>${safe(n.title||'Untitled note')}</strong><small>${safe((n.body||'').slice(0,75)||'No note text yet')}</small></span></button>`).join('')}</div><button class="notes-new" data-action="create-note">+ New note</button>`:`<div class="home-empty"><span class="empty-glyph" aria-hidden="true">▧</span><strong>A page with nothing on it yet</strong><p>Create a note for a class, a question, or a thought worth keeping.</p><button data-action="create-note">Create a note <span aria-hidden="true">→</span></button></div>`}</section>
      </div>
      <section class="home-quote"><span class="quote-spark" aria-hidden="true">✳</span><blockquote>“${safe(quote[0])}”</blockquote><span class="quote-credit">— William Shakespeare, ${safe(quote[1])}</span><button class="text-action" data-action="next-quote" aria-label="Show another quote">Another thought <span aria-hidden="true">↗</span></button></section>
    </div>
    <aside class="side-panels home-rail">
      <section class="panel school-panel"><div class="panel-head"><div class="panel-title-group"><span class="school-mark" aria-hidden="true">◈</span><h2>School Mode</h2></div><span class="pill ${activeStudySession()?'pill-active':''}">${activeStudySession()?'Active':'Ready'}</span></div><div class="school-mode-label">${safe(state.preferences.restrictionMode)} mode ${activeStudySession()?'in progress':'ready'}</div><div class="study-ring"><div class="study-clock" id="study-clock">${activeStudySession()?formattedDuration(studySecondsRemaining()):formattedDuration((Number(state.preferences.studyDurationMinutes)||45)*60)}</div><span>${activeStudySession()?'remaining':'session length'}</span></div>${activeStudySession()?`<p class="panel-copy">HTTP/HTTPS requests are filtered. Existing WebSocket connections are not stopped.</p><button class="school-primary" data-action="school-end">End session</button>`:`<p class="panel-copy">A timed session to help keep your attention on what matters. Your restrictions stay in your control.</p><button class="school-primary" data-action="school-start">Start ${Number(state.preferences.studyDurationMinutes)||45}-minute session <span aria-hidden="true">→</span></button>`}<button class="panel-link" data-view="school">Customize restrictions <span aria-hidden="true">→</span></button></section>
      <section class="panel upcoming-panel"><div class="panel-head"><h2>Coming up</h2><button class="text-action" data-view="calendar">See all <span aria-hidden="true">→</span></button></div>${upcoming.length?`<div class="upcoming-list">${upcoming.map((e,index)=>`<div class="upcoming-item"><i class="upcoming-marker marker-${index%4}" aria-hidden="true"></i><div><b>${safe(e.title)}</b><span>${e.type} · ${dateLabel(e.at)}</span></div></div>`).join('')}</div>`:`<div class="rail-empty"><span class="empty-glyph" aria-hidden="true">□</span><p>Your upcoming events and due dates will find a home here.</p><button class="panel-link" data-view="calendar">Open calendar <span aria-hidden="true">→</span></button></div>`}</section>
      <section class="panel weather-panel"><div class="panel-head"><h2>Outside, briefly</h2><span class="pill">${state.preferences.city?'Weather':'Optional'}</span></div>${weatherPanel()}</section>
      <section class="panel local-panel"><div class="panel-head"><h2>Yours, by default</h2><span class="pill">Private</span></div><p class="panel-copy">Your notes, tasks, courses, events and bookmarks stay in this browser. No ad network, no tracking pixels.</p></section>
      <section class="calculator-card panel"><div class="panel-head"><div class="panel-title-group"><span class="calculator-mark" aria-hidden="true">∑</span><h2>Calculator</h2></div><button class="text-action" data-action="focus-calculator">Open <span aria-hidden="true">↗</span></button></div><form id="calculator-form" class="calculator-form"><label class="sr-only" for="calculator-expression">Expression</label><input name="expression" id="calculator-expression" inputmode="decimal" placeholder="Try 18 × 4" aria-label="Calculator expression"><button class="calculator-submit" aria-label="Calculate">=</button></form><output id="calculator-result" class="subtle" aria-live="polite"></output></section>
    </aside>
  </section>`;
}
function weatherPanel() {
  if (!state.preferences.city) return `<p class="panel-copy">Add a city in Settings → Search to request current conditions from the weather service.</p><button class="panel-link" data-view="settings">Open settings →</button>`;
  if (weatherState.loading) return `<p class="panel-copy">Checking conditions for ${safe(state.preferences.city)}…</p>`;
  if (weatherState.error) return `<p class="panel-copy">${safe(weatherState.error)}</p><button class="panel-link" data-action="weather-retry">Try again →</button>`;
  if (!weatherState.data) return `<p class="panel-copy">Weather has not been requested yet.</p><button class="panel-link" data-action="weather-retry">Check conditions →</button>`;
  const data=weatherState.data && typeof weatherState.data === 'object' ? weatherState.data : {};
  const temperature=data.temperature ?? data.temp ?? (data.tempC!==undefined?`${data.tempC}°C`:null) ?? (data.tempF!==undefined?`${data.tempF}°F`:null);
  const condition=data.condition ?? data.summary ?? data.description ?? '';
  return `<p class="panel-copy">${safe(data.city||data.location||state.preferences.city)}${temperature!==null?` · ${safe(temperature)}`:''}${condition?`<br>${safe(condition)}`:''}${temperature===null&&!condition?'<br>Weather service returned no displayable current conditions.':''}</p><button class="panel-link" data-action="weather-retry">Refresh →</button>`;
}
function header(title, description, button = '') {
  return `<div class="view-header"><div><h1>${safe(title)}</h1><p>${safe(description)}</p></div>${button}</div>`;
}
function taskView() {
  const sorted = [...state.tasks].sort((a,b)=>(a.completed-b.completed)||new Date(a.dueAt||'9999')-new Date(b.dueAt||'9999'));
  return `${header('Tasks','A personal list, saved only in this browser.','<button class="primary-btn" data-action="create-task">New task</button>')}${sorted.length?`<div class="table-list">${sorted.map(t=>`<div class="row-item"><input type="checkbox" ${t.completed?'checked':''} data-complete-task="${t.id}" aria-label="Mark ${safe(t.title)} ${t.completed?'incomplete':'complete'}"><div class="row-body"><strong style="${t.completed?'text-decoration:line-through;opacity:.65':''}">${safe(t.title)}</strong><small>${t.dueAt?`Due ${dateLabel(t.dueAt)}`:'No due date'}${t.courseId?` · ${safe(state.courses.find(c=>c.id===t.courseId)?.name||'Course')}`:''}${t.focusToday?' · Focus today':''}</small></div><button data-edit-task="${t.id}">Edit</button><button data-delete-task="${t.id}">Delete</button></div>`).join('')}</div>`:emptyState('No tasks yet','Add a real task when coursework needs a place on your list. Nothing has been prefilled.')}`;
}
function notesView() {
  const notes = [...state.notes].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||new Date(b.updatedAt)-new Date(a.updatedAt));
  return `${header('Notes','A private scratchpad for ideas, class notes and things to remember.','<button class="primary-btn" data-action="create-note">New note</button>')}${notes.length?`<div class="card-grid">${notes.map(n=>`<article class="data-card"><div class="section-head"><h3>${safe(n.title||'Untitled note')}</h3>${n.pinned?'<span class="tag">Pinned</span>':''}</div><div class="markdown-preview">${markdownHtml(n.body||'')}</div><span class="data-meta">Edited ${dateLabel(n.updatedAt,{month:'short',day:'numeric'})}</span><div class="card-actions"><button data-edit-note="${n.id}">Edit</button><button data-pin-note="${n.id}">${n.pinned?'Unpin':'Pin'}</button><button data-delete-note="${n.id}">Delete</button></div></article>`).join('')}</div>`:emptyState('A page with nothing on it yet','Create a note to start a study guide, collect questions, or keep a thought from disappearing.')}`;
}
function schoolView() {
  const session = activeStudySession();
  const weekStart = new Date();
  weekStart.setHours(0,0,0,0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekSessions = state.studySessions.filter(item => new Date(item.finishedAt) >= weekStart);
  const weeklyMinutes = weekSessions.reduce((sum,item)=>sum + (Number(item.durationMinutes)||0),0);
  const assigned = state.tasks.filter(item => item.courseId || item.dueAt).sort((a,b)=>new Date(a.dueAt||'9999')-new Date(b.dueAt||'9999'));
  return `${header('School','Courses, assignments and study time, saved on this device.','<button class="primary-btn" data-action="create-course">Add course</button>')}
    <section class="panel study-session-panel"><div class="panel-head"><h2>School Mode</h2><span class="pill">${session?'Active':'Ready'}</span></div>
      ${session?`<div class="study-clock" id="study-clock">${formattedDuration(studySecondsRemaining())}</div><p class="panel-copy">${safe(state.preferences.restrictionMode)} restrictions filter proxied HTTP/HTTPS requests until the timer ends. They do not stop existing WebSocket connections.</p><button class="danger-btn" data-action="school-end">End session</button>`:`<p class="panel-copy">A timed session applies your saved blocklist and allowlist to proxied HTTP/HTTPS requests. Strict mode permits only allowlisted sites. It does not restrict other apps or existing WebSocket connections.</p><div class="field-row"><label class="field"><span>Duration (minutes)</span><input id="study-duration" type="number" min="5" max="180" step="5" value="${Number(state.preferences.studyDurationMinutes)||45}"></label><label class="field"><span>Enforcement</span><select id="restriction-mode"><option value="light" ${state.preferences.restrictionMode==='light'?'selected':''}>Light — block listed sites</option><option value="strict" ${state.preferences.restrictionMode==='strict'?'selected':''}>Strict — allow listed sites only</option></select></label></div><button class="primary-btn" data-action="school-start">Start study session</button>`}
      <button class="panel-link" data-action="customize-restrictions">Customize restrictions →</button>
    </section>
    <div class="section-head"><h2>Your courses</h2><button class="text-action" data-action="create-course">Add course +</button></div>${state.courses.length?`<div class="card-grid">${state.courses.map(c=>`<article class="data-card"><div class="section-head"><h3>${safe(c.name)}</h3><span class="color-dot" style="background:${safe(c.color)}"></span></div><p>${c.lmsUrl?`<button class="text-action" data-open-url="${safe(c.lmsUrl)}">${safe(c.lmsUrl)}</button>`:'No course link added.'}</p><div class="card-actions"><button data-edit-course="${c.id}">Edit</button><button data-delete-course="${c.id}">Delete</button></div></article>`).join('')}</div>`:emptyState('No courses added','Add a course you actually take. Courses can be attached to tasks and calendar events.')}
    <section class="school-stats"><div class="panel"><strong>${weeklyMinutes}</strong><span>study minutes this week</span></div><div class="panel"><strong>${weekSessions.length}</strong><span>finished sessions this week</span></div></section>
    <div class="section-head"><h2>Assignments</h2><button class="text-action" data-view="tasks">Manage tasks →</button></div>${assigned.length?`<div class="table-list">${assigned.map(task=>`<div class="row-item"><div class="row-body"><strong>${safe(task.title)}</strong><small>${task.dueAt?`Due ${dateLabel(task.dueAt)}`:'No due date'}${task.courseId?` · ${safe(state.courses.find(c=>c.id===task.courseId)?.name||'Course')}`:''}</small></div><button data-edit-task="${task.id}">Edit</button></div>`).join('')}</div>`:emptyState('No assignments yet','Add a task and optionally attach a course and due date.')}
    <div class="section-head"><h2>Study history</h2></div>${state.studySessions.length?`<div class="table-list">${state.studySessions.slice(0,12).map(item=>`<div class="row-item"><div class="row-body"><strong>${item.completed?'Completed study session':'Ended study session'}</strong><small>${dateLabel(item.startedAt)} · ${Number(item.durationMinutes)||0} minutes</small></div></div>`).join('')}</div>`:emptyState('No study sessions yet','Finished study sessions will be recorded here.')}`;
}
function calendarView() {
  const periodStart = new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),1);
  const gridStart = new Date(periodStart);
  gridStart.setDate(gridStart.getDate()-gridStart.getDay());
  const weekStart = new Date(calendarCursor);
  weekStart.setHours(0,0,0,0);
  weekStart.setDate(weekStart.getDate()-weekStart.getDay());
  const start = calendarMode==='month'?gridStart:weekStart;
  const dayCount = calendarMode==='month'?42:7;
  const rangeEnd = new Date(start);
  rangeEnd.setDate(rangeEnd.getDate()+dayCount);
  const items = [
    ...state.events.flatMap(event=>expandRecurringEvent(event,start,rangeEnd).map(occurrence=>({...occurrence,kind:'Event',at:occurrence.startAt}))),
    ...state.tasks.filter(task=>task.dueAt).map(task=>({...task,kind:'Task',at:task.dueAt})),
  ].filter(item=>Number.isFinite(Date.parse(item.at))).sort((a,b)=>new Date(a.at)-new Date(b.at));
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const byDay = new Map();
  for (const item of items) {
    const key = dateKey(new Date(item.at));
    byDay.set(key,[...(byDay.get(key)||[]),item]);
  }
  const days = Array.from({length:dayCount},(_,index)=>{
    const date=new Date(start); date.setDate(start.getDate()+index);
    const key=dateKey(date), dayItems=byDay.get(key)||[];
    return `<button class="calendar-day ${date.getMonth()!==calendarCursor.getMonth()&&calendarMode==='month'?'outside':''} ${calendarSelectedDate===key?'selected':''}" data-calendar-date="${key}"><span>${date.getDate()}</span>${dayItems.slice(0,2).map(item=>`<small class="${item.kind==='Task'?'calendar-task':''}">${safe(item.title)}</small>`).join('')}${dayItems.length>2?`<small>+${dayItems.length-2} more</small>`:''}</button>`;
  }).join('');
  const selectedKey=calendarSelectedDate||dateKey(new Date());
  const selectedItems=byDay.get(selectedKey)||[];
  const periodLabel=calendarMode==='month'?new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(calendarCursor):`${dateLabel(weekStart,{month:'short',day:'numeric'})} – ${dateLabel(new Date(weekStart.getFullYear(),weekStart.getMonth(),weekStart.getDate()+6),{month:'short',day:'numeric',year:'numeric'})}`;
  return `${header('Calendar','Month and week views combine your events with task due dates.','<div class="calendar-actions"><button class="secondary-btn" data-action="import-ics">Import .ics</button><input id="ics-file" type="file" accept=".ics,text/calendar" hidden><button class="primary-btn" data-action="create-event">Add event</button></div>')}<section class="form-card calendar-panel"><div class="calendar-toolbar"><div><button class="secondary-btn" data-calendar-shift="-1" aria-label="Previous period">‹</button><button class="secondary-btn" data-calendar-shift="1" aria-label="Next period">›</button><strong>${safe(periodLabel)}</strong></div><div><button class="secondary-btn ${calendarMode==='month'?'active':''}" data-calendar-mode="month">Month</button><button class="secondary-btn ${calendarMode==='week'?'active':''}" data-calendar-mode="week">Week</button></div></div><div class="calendar-grid">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=>`<div class="calendar-weekday">${day}</div>`).join('')}${days}</div></section><section class="form-card selected-day"><div class="section-head"><h2>${safe(new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(new Date(`${selectedKey}T12:00:00`)))}</h2><button class="text-action" data-action="create-event">Add event +</button></div>${selectedItems.length?`<div class="table-list">${selectedItems.map(item=>`<div class="row-item"><span class="pill">${item.kind}</span><div class="row-body"><strong>${safe(item.title)}</strong><small>${dateLabel(item.at)}${item.kind==='Event'&&item.endAt?` — ${dateLabel(item.endAt)}`:''}${item.courseId?` · ${safe(state.courses.find(c=>c.id===item.courseId)?.name||'Course')}`:''}</small></div>${item.kind==='Event'?`<button data-edit-event="${item.id}">Edit</button><button data-delete-event="${item.id}">Delete</button>`:`<button data-edit-task="${item.id}">Edit task</button>`}</div>`).join('')}</div>`:emptyState('Nothing scheduled for this day','Add a calendar event or set a due date on a task.')}</section>`;
}
function bookmarksView() {
  const items = [...state.bookmarks].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  return `${header('Bookmarks','Useful pages, saved without an account.','<button class="primary-btn" data-action="create-bookmark">Add bookmark</button>')}${items.length?`<div class="table-list">${items.map(b=>`<div class="row-item">${faviconMarkup(b.url)}<div class="row-body"><strong>${safe(b.title)}</strong><small>${safe(b.url)}${b.folder?` · ${safe(b.folder)}`:''}</small></div><button data-open-url="${safe(b.url)}">Open</button><button data-edit-bookmark="${b.id}">Edit</button><button data-delete-bookmark="${b.id}">Remove</button></div>`).join('')}</div>`:emptyState('No saved pages','Save a page from the address bar or add a bookmark here.')}`;
}
function historyView() {
  return `${header('History','Search and revisit navigation entries saved on this device.','<button class="secondary-btn" data-action="clear-history">Clear history</button>')}<label class="field"><span>Search history</span><input id="history-search" value="${safe(historyQuery)}"></label><div id="history-results">${historyResultsMarkup()}</div>`;
}
function historyResultsMarkup() {
  const query=historyQuery.trim().toLowerCase();
  const rows=[...state.history].filter(item=>!query||`${item.title||''} ${item.url||''}`.toLowerCase().includes(query)).sort((a,b)=>new Date(b.visitedAt)-new Date(a.visitedAt));
  if(!rows.length) return emptyState(state.history.length?'No matching entries':'No browsing history',state.history.length?'Try a different site name or address.':'When you navigate to a web address, that navigation will appear here. Internal workspace pages are not recorded.');
  const groups=new Map();
  for(const row of rows) {
    const date=new Date(row.visitedAt);
    const key=Number.isNaN(date.valueOf())?'Unknown date':new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(date);
    groups.set(key,[...(groups.get(key)||[]),row]);
  }
  return [...groups].map(([date,items])=>`<section class="history-day"><h2>${safe(date)}</h2><div class="table-list">${items.map(item=>`<div class="row-item"><span class="nav-icon">◷</span><div class="row-body"><strong>${safe(item.title||item.url)}</strong><small>${safe(item.url)} · ${dateLabel(item.visitedAt)}</small></div><button data-open-url="${safe(item.url)}">Open</button></div>`).join('')}</div></section>`).join('');
}
function downloadsView() {
  const sorted=[...downloadRecords].sort((a,b)=>new Date(b.at||0)-new Date(a.at||0));
  const actions=downloadRecords.length?'<button class="secondary-btn" data-action="clear-downloads">Clear list</button>':'';
  return `${header('Downloads','Recent download responses observed by this browser. Files are still saved by your host browser.',actions)}${sorted.length?`<div class="table-list">${sorted.map(d=>`<div class="row-item"><span class="nav-icon">↓</span><div class="row-body"><strong>${safe(d.filename||d.url||'Download')}</strong><small>${safe(d.status||'Detected')}${d.size!==null&&d.size!==undefined&&Number.isFinite(Number(d.size))?` · ${(Number(d.size)/1048576).toFixed(2)} MB`:''} · ${d.at?dateLabel(d.at):'Time not reported'}${d.url?` · ${safe(d.url)}`:''}</small></div>${d.url?`<button class="text-action" data-open-url="${safe(d.url)}">Open source</button>`:''}<button class="secondary-btn" data-remove-download="${safe(d.id||'')}" aria-label="Remove ${safe(d.filename||'download')} from list">Remove</button></div>`).join('')}</div>`:emptyState('No downloads to show','Real download responses appear here when the proxy service worker detects them. The host browser handles the actual file download.')}`;
}
function musicView() {
  const current = audioFiles.find(file=>file.id===state.preferences.currentMusicId);
  const actions='<div class="calendar-actions"><button class="secondary-btn" data-action="toggle-noise">'+(noiseSource?'Stop focus noise':'Play focus noise')+'</button><button class="primary-btn" data-action="choose-audio">Add audio files</button></div>';
  return `${header('Music','Play local audio or generate low-key focus noise.',actions)}<input id="audio-picker" type="file" accept="audio/*" multiple hidden><section class="form-card"><h2>Local audio</h2><p class="subtle">Audio files are stored in this browser’s IndexedDB and are not uploaded. Browser storage may be cleared by the device or browser.</p><div class="music-now">${current&&musicUrl?`<strong>Now selected: ${safe(current.name)}</strong><audio id="audio-player" controls src="${musicUrl}"></audio><label class="field"><span>Volume</span><input id="audio-volume" type="range" min="0" max="1" step="0.05" value="0.8"></label>`:emptyState(audioFilesLoaded?'No audio files saved':'Loading local audio','Choose files from this device to build a local listening list.')}</div><div class="section-head"><h2>Listening list</h2><button class="secondary-btn" data-action="shuffle-audio" ${audioFiles.length<2?'disabled':''}>${state.preferences.musicShuffle?'Shuffle on':'Shuffle'}</button></div>${audioFiles.length?`<div class="table-list">${audioFiles.map((file,index)=>`<div class="row-item"><button class="music-play" data-play-track="${file.id}" aria-label="Play ${safe(file.name)}">${state.preferences.currentMusicId===file.id?'▶':'▷'}</button><div class="row-body"><strong>${safe(file.name)}</strong><small>${(file.size/1048576).toFixed(1)} MB · ${safe(file.type||'Audio')}</small></div><button data-move-audio="${file.id}" data-direction="-1" ${index===0?'disabled':''} aria-label="Move track up">↑</button><button data-move-audio="${file.id}" data-direction="1" ${index===audioFiles.length-1?'disabled':''} aria-label="Move track down">↓</button><button data-delete-audio="${file.id}" aria-label="Remove ${safe(file.name)}">Remove</button></div>`).join('')}</div>`:emptyState('No audio added','Add a local audio file to start a playlist.')}</section>`;
}
function extensionsView() {
  const extensions = state.preferences.extensions;
  const browserTab=currentBrowserTab();
  let hostname = '';
  try { if(browserTab) hostname = new URL(browserTab.url).hostname; } catch {}
  const rule = hostname ? state.preferences.siteRules[hostname] || {} : {};
  const action='<button class="secondary-btn" data-action="reload-browser" '+(browserTab?'':'disabled')+'>Reload current page</button>';
  return `${header('Extensions','Built-in tools for changing how proxied pages look.',action)}<div class="card-grid"><section class="form-card"><h2>Page appearance</h2><label class="check-row"><input type="checkbox" data-extension-toggle="darkMode" ${extensions.darkMode?'checked':''}> Dark Mode</label><label class="check-row"><input type="checkbox" data-extension-toggle="readerView" ${extensions.readerView?'checked':''}> Reader View</label><label class="field"><span>Text size</span><input type="range" min="80" max="180" step="5" value="${Number(extensions.textSize)||100}" data-extension-size><output id="extension-size">${Number(extensions.textSize)||100}%</output></label><p class="subtle">Changes apply to the active proxied page and future pages.</p></section><section class="form-card"><h2>Per-site rules</h2><p class="subtle">${hostname?`Rules saved for <strong>${safe(hostname)}</strong>.`:'Open a website to create site-specific rules.'}</p><form id="site-rule-form"><label class="field"><span>Custom CSS</span><textarea name="css" ${hostname?'':'disabled'}>${safe(rule.css||'')}</textarea></label><label class="field"><span>Custom JavaScript</span><textarea name="js" ${hostname?'':'disabled'}>${safe(rule.js||'')}</textarea></label><div class="card-actions"><button class="primary-btn" ${hostname?'':'disabled'}>Save site rules</button><button type="button" class="secondary-btn" data-action="remove-site-rule" ${hostname?'':'disabled'}>Remove site rules</button></div></form><p class="subtle">Custom JavaScript runs inside the proxied page. Use code you trust.</p></section></div>`;
}
function translateView() {
  const languages = [['es','Spanish'],['fr','French'],['de','German'],['it','Italian'],['pt','Portuguese'],['ja','Japanese'],['ko','Korean'],['zh-CN','Chinese (simplified)'],['ar','Arabic'],['hi','Hindi'],['ru','Russian'],['uk','Ukrainian'],['nl','Dutch'],['sv','Swedish'],['pl','Polish'],['tr','Turkish']];
  return `${header('Translate','Translate English text into another language.','')}<section class="form-card"><p class="subtle">The text you submit is sent to the MyMemory translation service. Do not include sensitive material.</p><form id="translate-form"><label class="field"><span>English text</span><textarea name="text" maxlength="5000" required></textarea></label><label class="field"><span>Translate to</span><select name="target">${languages.map(([code,name])=>`<option value="${code}">${name}</option>`).join('')}</select></label><button class="primary-btn" ${translationState.loading?'disabled':''}>${translationState.loading?'Translating…':'Translate'}</button></form>${translationState.error?`<p class="error-copy" role="alert">${safe(translationState.error)}</p>`:''}${translationState.result?`<section class="translation-result"><h2>Translation</h2><p>${safe(translationState.result)}</p></section>`:''}</section>`;
}
function aiView() {
  const action=aiMessages.length?'<button class="secondary-btn" data-action="clear-ai-chat">Clear chat</button>':'';
  return `${header('AI','Chat history is saved locally in this browser. Requests go to the configured assistant service.',action)}<div class="ai-thread" id="ai-thread">${aiMessages.length?aiMessages.map(m=>`<div class="ai-message ${m.role}">${safe(m.content)}</div>`).join(''):emptyState('Start with a question','Write a real question below. The assistant service may be unavailable; errors will be shown rather than replaced with a made-up answer.')}</div><form class="ai-compose" id="ai-form"><textarea name="prompt" required aria-label="Message the assistant"></textarea><button class="primary-btn" type="submit">Send</button></form><p class="subtle" style="margin-top:12px">Assistant requests are sent to /api/ai. Do not include sensitive information.</p>`;
}
async function translateText(form) {
  const data = new FormData(form);
  const text = String(data.get('text')||'').trim();
  const target = String(data.get('target')||'es');
  if (!text) return;
  translationState = { loading:true, result:'', error:'' };
  render();
  try {
    const response = await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,target})});
    const payload = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(payload.error||`Translation request failed (${response.status}).`);
    translationState = { loading:false, result:String(payload.translatedText||''), error:'' };
  } catch (error) {
    translationState = { loading:false, result:'', error:error?.message||'Translation is unavailable.' };
  }
  render();
}
async function persistAudioFiles() {
  if (!window.InfinitesimalPolicy?.saveFiles) throw new Error('IndexedDB storage is not available.');
  await window.InfinitesimalPolicy.saveFiles(audioFiles);
}
async function playAudioTrack(id) {
  const track = audioFiles.find(file=>file.id===id);
  if (!track?.blob) {
    flash('The saved audio file is missing from local storage.');
    return;
  }
  if (musicUrl) URL.revokeObjectURL(musicUrl);
  musicUrl = URL.createObjectURL(track.blob);
  state.preferences.currentMusicId = track.id;
  persist();
  render();
  const player = document.querySelector('#audio-player');
  if (player) {
    try { await player.play(); }
    catch { flash('Playback was paused by the browser. Press play to start the track.'); }
  }
}
async function addAudioFiles(files) {
  const selected = [...files];
  const oversized = selected.find(file=>file.size > 200 * 1024 * 1024);
  if (oversized) {
    flash(`${oversized.name} exceeds the 200 MB per-file limit.`);
    return;
  }
  const additions = selected.filter(file=>file.type.startsWith('audio/')).map(file=>({
    id:uid(), name:file.name, type:file.type, size:file.size, lastModified:file.lastModified, blob:file,
  }));
  if (!additions.length) {
    flash('Choose one or more audio files.');
    return;
  }
  audioFiles = [...audioFiles,...additions];
  try {
    await persistAudioFiles();
    if (!state.preferences.currentMusicId) await playAudioTrack(additions[0].id);
    else { render(); flash(`${additions.length} audio file${additions.length===1?'':'s'} saved locally.`); }
  } catch (error) {
    audioFiles = audioFiles.filter(file=>!additions.some(addition=>addition.id===file.id));
    flash(error?.message||'The audio files could not be saved.');
  }
}
async function playNextAudio() {
  if (!audioFiles.length) return;
  const currentIndex = audioFiles.findIndex(file=>file.id===state.preferences.currentMusicId);
  const nextIndex = state.preferences.musicShuffle ? Math.floor(Math.random()*audioFiles.length) : (currentIndex+1)%audioFiles.length;
  await playAudioTrack(audioFiles[nextIndex].id);
}
async function deleteAudioFile(id) {
  const track = audioFiles.find(file=>file.id===id);
  if (!track || !confirm(`Remove ${track.name} from this browser?`)) return;
  audioFiles = audioFiles.filter(file=>file.id!==id);
  if (state.preferences.currentMusicId===id) {
    if (musicUrl) URL.revokeObjectURL(musicUrl);
    musicUrl = '';
    state.preferences.currentMusicId = '';
  }
  try {
    await persistAudioFiles();
    render();
    flash('Audio file removed from local storage.');
  } catch (error) {
    flash(error?.message||'The audio file could not be removed.');
  }
}
function toggleFocusNoise() {
  if (noiseSource) {
    noiseSource.stop();
    noiseSource.disconnect();
    noiseGain?.disconnect();
    noiseSource = null;
    noiseGain = null;
    render();
    return;
  }
  try {
    audioContext ||= new AudioContext();
    if (audioContext.state==='suspended') void audioContext.resume();
    const buffer = audioContext.createBuffer(1,audioContext.sampleRate*3,audioContext.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index=0; index<channel.length; index++) channel[index]=Math.random()*2-1;
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    source.buffer=buffer;
    source.loop=true;
    filter.type='lowpass';
    filter.frequency.value=380;
    gain.gain.value=0.07;
    source.connect(filter).connect(gain).connect(audioContext.destination);
    source.start();
    noiseSource=source;
    noiseGain=gain;
    render();
  } catch (error) {
    flash(error?.message||'Focus noise could not be started in this browser.');
  }
}
function calculateExpression(source) {
  const tokens = source.match(/\d+(?:\.\d+)?|[()+*/-]/g) || [];
  if (!tokens.length || tokens.join('') !== source.replace(/\s+/g,'')) throw new Error('Use numbers and +, −, ×, ÷, and parentheses.');
  let position=0;
  function factor() {
    if(tokens[position]==='-') { position++; return -factor(); }
    if(tokens[position]==='+') { position++; return factor(); }
    if(tokens[position]==='(') {
      position++;
      const value=expression();
      if(tokens[position++]!==')') throw new Error('Check the parentheses.');
      return value;
    }
    const value=Number(tokens[position++]);
    if(!Number.isFinite(value)) throw new Error('Enter a valid number.');
    return value;
  }
  function term() {
    let value=factor();
    while(tokens[position]==='*'||tokens[position]==='/') {
      const operator=tokens[position++];
      const right=factor();
      value=operator==='*'?value*right:value/right;
    }
    return value;
  }
  function expression() {
    let value=term();
    while(tokens[position]==='+'||tokens[position]==='-') {
      const operator=tokens[position++];
      const right=term();
      value=operator==='+'?value+right:value-right;
    }
    return value;
  }
  const result=expression();
  if(position!==tokens.length||!Number.isFinite(result)) throw new Error('Check the expression.');
  return Number(result.toPrecision(12)).toString();
}
function settingsView() {
  const sections = ['General','Search','Privacy','School'];
  let panel = '';
  if (activeSettings==='General') panel = `<h2>General</h2><p>Choose how this workspace greets you and set its accent color.</p><form id="general-form"><label class="field"><span>Your name</span><input name="firstName" maxlength="50" value="${safe(state.preferences.firstName||'')}"></label><label class="field"><span>Accent color</span><input name="accentColor" type="color" value="${safe(state.preferences.accentColor||'#d7b98e')}" style="height:42px;padding:3px"></label><button class="primary-btn">Save general settings</button></form><div class="setting-row"><div><strong>Language and time</strong><small>Dates and times use your browser locale and timezone.</small></div><span class="tag">Automatic</span></div>`;
  if (activeSettings==='Search') panel = `<h2>Search and browser</h2><p>Choose a search provider and proxy engine. The proxy engine change takes effect after restarting this tab.</p><label class="field"><span>Search engine</span><select id="search-engine"><option value="https://duckduckgo.com/?q=" ${state.preferences.searchEngine.includes('duckduckgo')?'selected':''}>DuckDuckGo</option><option value="https://www.bing.com/search?q=" ${state.preferences.searchEngine.includes('bing')?'selected':''}>Bing</option><option value="https://search.brave.com/search?q=" ${state.preferences.searchEngine.includes('brave')?'selected':''}>Brave</option><option value="https://www.startpage.com/sp/search?query=" ${state.preferences.searchEngine.includes('startpage')?'selected':''}>Startpage</option><option value="https://www.google.com/search?q=" ${state.preferences.searchEngine.includes('google')?'selected':''}>Google — may block proxied traffic</option></select></label><label class="field"><span>Proxy engine</span><select id="proxy-engine"><option value="uv" ${(state.preferences.proxyEngine||apiConfig?.proxyEngine)==='uv'?'selected':''}>Ultraviolet</option><option value="scramjet" ${(state.preferences.proxyEngine||apiConfig?.proxyEngine)==='scramjet'?'selected':''}>Scramjet</option></select></label><label class="field"><span>Wisp server URL</span><input value="${safe(apiConfig?.wispUrl||'Not available')}" readonly></label><label class="field"><span>Weather city (optional)</span><input id="weather-city" value="${safe(state.preferences.city)}"></label><button class="primary-btn" data-action="save-search-settings">Save search settings</button>`;
  if (activeSettings==='Privacy') panel = `<h2>Privacy and data</h2><p>Workspace records and AI chat history are stored in localStorage in this browser. JSON exports include them and download metadata; local audio files stay in IndexedDB and are not included.</p><div class="setting-row"><div><strong>Local workspace data</strong><small>${state.notes.length} notes · ${state.tasks.length} tasks · ${state.bookmarks.length} bookmarks · ${state.history.length} history entries</small></div><button class="secondary-btn" data-action="export-data">Export JSON</button></div><div class="setting-row"><div><strong>Import workspace</strong><small>Import replaces workspace records after validating the file. Existing audio files stay on this device.</small></div><button class="secondary-btn" data-action="choose-import">Choose JSON file</button></div><input id="import-workspace-file" type="file" accept=".json,application/json" hidden><div class="setting-row"><div><strong>Browsing history</strong><small>Remove locally stored navigation entries.</small></div><button class="secondary-btn" data-action="clear-history">Clear history</button></div><div class="setting-row"><div><strong>Erase all Infinitesimal data</strong><small>Deletes local workspace data, saved restrictions, audio and browser records from this device.</small></div><button class="danger-btn" data-action="erase-all-data">Erase all data</button></div>`;
  if (activeSettings==='School') panel = `<h2>School Mode</h2><p>Set an optional PIN to prevent ending an active session from this screen. The PIN is stored locally as a one-way hash.</p><form id="pin-form"><label class="field"><span>${state.preferences.schoolPinHash?'Change PIN':'Set a PIN'}</span><input name="pin" type="password" minlength="4" maxlength="32" autocomplete="new-password"></label><div class="card-actions"><button class="primary-btn">Save PIN</button><button type="button" class="secondary-btn" data-action="remove-school-pin" ${state.preferences.schoolPinHash?'':'disabled'}>Remove PIN</button></div></form><p class="subtle">${state.preferences.schoolPinHash?'A PIN is set.':'No PIN is set.'}</p><button class="text-action" data-view="school">Open School Mode →</button>`;
  return `${header('Settings','Preferences for a quieter way to browse.','')}<div class="settings-grid"><nav class="settings-nav">${sections.map(s=>`<button class="${s===activeSettings?'active':''}" data-settings="${s}">${s}</button>`).join('')}</nav><section class="settings-section">${panel}</section></div>`;
}
function diagnosticsView() {
  const checks = [
    ['Secure context',diagnosticResults?.secureContext],
    ['Service worker registered',diagnosticResults?.worker],
    ['Wisp WebSocket',diagnosticResults?.wisp],
    ['Transport configured',diagnosticResults?.transport],
    ['Fetch through proxy',diagnosticResults?.proxiedFetch],
  ];
  const action=`<button class="secondary-btn" data-action="run-diagnostics">${diagnosticsRunning?'Checking…':'Run checks'}</button>`;
  return `${header('Diagnostics','Live checks for secure context, the worker, transport and proxy path.',action)}<section class="form-card"><h2 style="font:600 15px Manrope;margin-bottom:14px">Connection status</h2><div class="setting-row"><div><strong>Application configuration</strong><small>${configError?safe(configError):apiConfig?'Loaded from /config.json':'Checking /config.json'}</small></div><span class="tag">${apiConfig?'Available':configError?'Unavailable':'Checking'}</span></div><div class="setting-row"><div><strong>Proxy adapter</strong><small>${proxyBootError?safe(proxyBootError):proxyReady?'Adapter booted':'Waiting for the adapter'}</small></div><span class="tag">${proxyReady?'Ready':'Unavailable'}</span></div><div class="setting-row"><div><strong>Proxy engine</strong><small>${safe(state.preferences.proxyEngine||apiConfig?.proxyEngine||'Not reported')}</small></div></div><div class="setting-row"><div><strong>Wisp endpoint</strong><small>${safe(apiConfig?.wispUrl||'Not reported')}</small></div></div>${checks.map(([title,result])=>`<div class="setting-row"><div><strong>${title}</strong><small>${result?safe(result.detail||result.contentType||'Check completed'):diagnosticsRunning?'Checking…':'Run checks to test this connection.'}</small></div><span class="tag">${result?(result.ok?'Pass':'Fix needed'):diagnosticsRunning?'Checking':'Not run'}</span></div>`).join('')}<p class="subtle" style="margin:14px 0 0">A failed check includes a specific browser or connection error. It is not replaced with a simulated success.</p></section>`;
}
function standaloneAppUrl() {
  const url = new URL(location.href);
  if (url.pathname === '/__replco/workspace_iframe.html') {
    const initialPath = url.searchParams.get('initialPath');
    const appPath = initialPath?.startsWith('/') ? initialPath : '/';
    return new URL(appPath, url.origin).href;
  }
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
    url.protocol = "https:";
  }
  return url.href;
}
function serviceWorkerHelp(message) {
  if (!/service worker|https|secure context/i.test(message || "")) return "";
  const secure = window.isSecureContext === true ||
    (typeof window.isSecureContext !== "boolean" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(location.hostname));
  const embedded = window.top !== window.self;
  const apiAvailable = "serviceWorker" in navigator;
  const explanation = !secure
    ? "Service workers need a secure HTTPS page. Open the secure app address in its own tab."
    : !apiAvailable
      ? "This browser context is not exposing service workers. Opening the app in its own tab may enable browsing."
      : "The service worker API is available, but registration failed. Open the app in its own tab and retry.";
  const context = `${secure ? "secure" : "not secure"} · ${embedded ? "embedded frame" : "standalone page"} · Service Worker API ${apiAvailable ? "available" : "missing"}`;
  return `<div class="connection-help"><strong>Web browsing needs service workers</strong><p>${explanation}</p><small>Current context: ${safe(context)}</small><br><a href="${safe(standaloneAppUrl())}" target="_blank" rel="noopener noreferrer">Open app in a new tab</a></div>`;
}
function browserView() {
  if (activeFrame) return `${activeTab().url==='about:blank'?'':`<div class="browser-safety-banner">Proxy pages share Infinitesimal’s browser origin and may access local app storage. Do not sign in or enter sensitive information.</div>`}<div id="browser-mount"></div>`;
  const tab = activeTab();
  const alternateAction = /^https?:\/\//i.test(tab.url||'')
    ? `<button class="secondary-btn" data-action="retry-other-engine">Retry with ${engineLabel(otherProxyEngine())}</button>`
    : '';
  return `<div class="browser-error"><div class="browser-error-inner"><div class="error-mark">!</div><h2>${currentBrowserError?'Page could not be opened':'Connecting to the web'}</h2><p>${safe(currentBrowserError||'Waiting for the browser proxy adapter. No page content will be fabricated.')}</p>${serviceWorkerHelp(currentBrowserError)}<button class="secondary-btn" data-action="retry-navigation">Try again</button>${alternateAction}</div></div>`;
}
function viewContent() {
  if (activeTab().view === 'browser') return browserView();
  switch (state.currentView) {
    case 'home': return homeView();
    case 'school': return schoolView();
    case 'notes': return notesView();
    case 'tasks': return taskView();
    case 'calendar': return calendarView();
    case 'translate': return translateView();
    case 'bookmarks': return bookmarksView();
    case 'history': return historyView();
    case 'downloads': return downloadsView();
    case 'music': return musicView();
    case 'extensions': return extensionsView();
    case 'ai': return aiView();
    case 'settings': return settingsView();
    case 'diagnostics': return diagnosticsView();
    default: return homeView();
  }
}
function render() {
  persist();
  root.innerHTML = `<div class="shell">${sidebar()}<main class="main">${chrome()}<div class="content">${viewContent()}</div></main></div>`;
  if (state.preferences.accentColor) document.documentElement.style.setProperty('--sand', state.preferences.accentColor);
  if (activeFrame) {
    const mount = document.querySelector('#browser-mount');
    if (mount) mount.append(activeFrame);
  }
  const player = document.querySelector('#audio-player');
  if (player) {
    player.volume = Number(document.querySelector('#audio-volume')?.value ?? 0.8);
    player.onended = () => { void playNextAudio(); };
  }
}
function applyExtensionsToPage(frame,url) {
  try {
    const doc=frame.contentDocument;
    if(!doc?.documentElement) return;
    let hostname='';
    try { hostname=new URL(url).hostname; } catch {}
    const site=state.preferences.siteRules[hostname]||{};
    const appearance=state.preferences.extensions;
    const styles=[
      appearance.darkMode?'html{color-scheme:dark!important}body{background:#111820!important;color:#e8edf1!important}body *{border-color:#384553!important}a{color:#9fc5e8!important}img,video,canvas{filter:none!important}':'',
      appearance.readerView?'body{max-width:760px!important;margin:4rem auto!important;padding:0 2rem!important;line-height:1.75!important;font-size:1.08em!important}body>header,body>nav,body>aside,[role="navigation"],[aria-label*="advert" i],[class*="advert" i],[id*="advert" i]{display:none!important}':'',
      `html{font-size:${Math.max(80,Math.min(180,Number(appearance.textSize)||100))}%!important}`,
      String(site.css||''),
    ].join('\n');
    let style=doc.getElementById('infinitesimal-page-tools');
    if(!style) { style=doc.createElement('style'); style.id='infinitesimal-page-tools'; (doc.head||doc.documentElement).append(style); }
    style.textContent=styles;
    const js=String(site.js||'').trim();
    doc.getElementById('infinitesimal-page-script')?.remove();
    if(js) {
      const script=doc.createElement('script');
      script.id='infinitesimal-page-script';
      script.textContent=js;
      (doc.head||doc.documentElement).append(script);
    }
  } catch (error) {
    flash(`Page tools could not be applied: ${error?.message||'document access denied'}`);
  }
}
function focusOmnibox() {
  const input = document.querySelector('#omnibox');
  input?.focus();
  input?.select();
}
function openInternal(view) {
  const existing = state.tabs.find(t => t.view === view && t.url === `infinitesimal://${view}`);
  if (existing) state.activeTab = existing.id;
  else {
    const tab = { id: uid(), title: view[0].toUpperCase()+view.slice(1), url: `infinitesimal://${view}`, view };
    state.tabs.push(tab);
    state.activeTab = tab.id;
  }
  state.currentView = view;
  activeFrame = null;
  currentBrowserError = '';
  render();
}
function newTab() {
  const tab = { id: uid(), title:'Home', url:'infinitesimal://home', view:'home' };
  state.tabs.push(tab); state.activeTab = tab.id; state.currentView = 'home'; activeFrame = null; currentBrowserError = ''; render();
}
function openInNewTab(url) {
  newTab();
  void navigate(url);
}
function openBlankInTab(tab) {
  tab.title = 'about:blank';
  tab.url = 'about:blank';
  tab.view = 'browser';
  tab.visitStack = [];
  tab.visitIndex = -1;
  state.activeTab = tab.id;
  state.currentView = 'browser';
  state.preferences.lastBrowserTabId = tab.id;
  currentBrowserError = '';
  const frame = document.createElement('iframe');
  frame.className = 'browser-frame';
  frame.title = 'Infinitesimal browser in about:blank';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-downloads');
  const shellUrl = new URL(location.href);
  shellUrl.searchParams.set('infinitesimalBlankShell', '1');
  frame.src = 'about:blank';
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Infinitesimal</title><style>html,body{width:100%;height:100%;margin:0;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe title="Infinitesimal browser" src="${safe(shellUrl.href)}"></iframe></body></html>`;
  tabFrames.set(tab.id, frame);
  activeFrame = frame;
  render();
}
function newBlankTab() {
  const blankWindow = window.open('about:blank', '_blank');
  if (!blankWindow) {
    flash('The browser blocked the new tab. Allow pop-ups for Infinitesimal and try again.');
    return;
  }
  const shellUrl = new URL(location.href);
  shellUrl.searchParams.set('infinitesimalBlankShell', '1');
  const style = blankWindow.document.createElement('style');
  style.textContent = 'html,body{width:100%;height:100%;margin:0;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}';
  blankWindow.document.title = 'about:blank';
  blankWindow.document.head.append(style);
  const shellFrame = blankWindow.document.createElement('iframe');
  shellFrame.title = 'Infinitesimal browser';
  shellFrame.src = shellUrl.href;
  blankWindow.document.body.append(shellFrame);
}
function closeTab(id) {
  if (state.tabs.length <= 1) return;
  const idx = state.tabs.findIndex(t=>t.id===id);
  const closed=state.tabs[idx];
  if(closed) state.recentlyClosedTabs=[closed,...state.recentlyClosedTabs].slice(0,10);
    state.tabs = state.tabs.filter(t=>t.id!==id);
  tabFrames.delete(id);
  if (state.activeTab===id) {
    const next = state.tabs[Math.max(0,idx-1)];
    state.activeTab = next.id; state.currentView = next.view==='browser'?'browser':next.view;
    activeFrame = next.view==='browser' ? tabFrames.get(next.id) || null : null;
    if(next.view==='browser'&&!activeFrame&&next.url==='about:blank') {openBlankInTab(next);return;}
    if(next.view==='browser'&&!activeFrame&&/^https?:/i.test(next.url||'')) {void navigate(next.url,false);return;}
  }
  render();
}
function reopenClosedTab() {
  const tab=state.recentlyClosedTabs.shift();
  if(!tab) {flash('There is no recently closed tab to reopen.');return;}
  const restored={...tab,id:uid()};
  state.tabs.push(restored);
  state.activeTab=restored.id;
  state.currentView=restored.view==='browser'?'browser':restored.view;
  activeFrame=null;
  if(restored.view==='browser'&&restored.url==='about:blank') openBlankInTab(restored);
  else if(restored.view==='browser'&&/^https?:/i.test(restored.url||'')) void navigate(restored.url,false);
  else render();
}
function cleanAddress(value) {
  const text = value.trim();
  if (!text) return '';
  if (/^infinitesimal:\/\//i.test(text)) return { internal: text.slice('infinitesimal://'.length).split(/[/?#]/)[0] || 'home' };
  if (/^(https?:\/\/)/i.test(text)) return text;
  if (/^localhost(?::\d+)?(?:\/.*)?$/i.test(text) || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:\/.*)?$/.test(text) || /^\[[0-9a-f:]+\](?::\d+)?(?:\/.*)?$/i.test(text)) return `http://${text}`;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(text) && !text.includes(' ')) return `https://${text}`;
  return `${state.preferences.searchEngine}${encodeURIComponent(text)}`;
}
async function navigate(raw, addHistory = true) {
  if (String(raw || '').trim().toLowerCase() === 'about:blank') {
    openBlankInTab(activeTab());
    return;
  }
  const target = cleanAddress(raw);
  if (!target) return;
  if (typeof target === 'object' && target.internal) {
    openInternal(pages.some(p=>p[0]===target.internal)||['settings','diagnostics'].includes(target.internal)?target.internal:'home');
    return;
  }
  const tab = activeTab();
  state.currentView = 'browser';
  tab.view = 'browser';
  state.preferences.lastBrowserTabId=tab.id;
  tab.url = target;
  try { tab.title = new URL(target).hostname; } catch { tab.title = target; }
  activeFrame = null;
  tabFrames.delete(tab.id);
  currentBrowserError = '';
  if (addHistory) {
    tab.visitStack ||= [];
    tab.visitStack = tab.visitStack.slice(0,(tab.visitIndex ?? -1)+1);
    tab.visitStack.push(target);
    tab.visitIndex = tab.visitStack.length-1;
    state.history.push({ id:uid(), title:tab.title, url:target, visitedAt:now() });
    if (state.history.length > 500) state.history.splice(0,state.history.length-500);
  }
  render();
  try {
    const adapter = window.InfinitesimalProxy;
    if (!adapter || typeof adapter.createFrame !== 'function') throw new Error('The browser proxy adapter is unavailable. The requested page was not loaded.');
    if (!proxyReady && typeof adapter.boot === 'function') {
      await adapter.boot();
      proxyReady = true;
    }
    const encoded = typeof adapter.encode === 'function' ? await adapter.encode(target) : target;
    const decoded = typeof adapter.decode === 'function' ? await adapter.decode(encoded) : target;
    if (typeof decoded === 'string' && /^https?:\/\//i.test(decoded)) tab.title = new URL(decoded).hostname;
    const frameResult = await adapter.createFrame(encoded);
    let frame;
    if (frameResult instanceof HTMLElement) frame = frameResult;
    else if (frameResult?.element instanceof HTMLElement) frame = frameResult.element;
    else if (frameResult?.iframe instanceof HTMLElement) frame = frameResult.iframe;
    else if (typeof frameResult === 'string' && /^https?:\/\//.test(frameResult)) {
      frame = document.createElement('iframe');
      frame.src = frameResult;
    }
    if (!frame) throw new Error('The proxy did not provide a displayable page frame. No page was loaded.');
    frame.classList.add('browser-frame');
    frame.title = `Web page: ${tab.title}`;
    frame.scrolling = 'auto';
    frame.allow = 'autoplay; fullscreen; picture-in-picture; clipboard-read; clipboard-write';
    frame.allowFullscreen = true;
    tabFrames.set(tab.id, frame);
    frame.addEventListener('load', () => {
      try {
        if (frame.contentWindow?.location.href === 'about:blank') return;
      } catch {
        // Sandboxed opaque-origin frames intentionally deny parent access.
      }
      applyExtensionsToPage(frame,tab.url);
      let loadedDocument = null;
      try {
        loadedDocument = frame.contentDocument;
        const title = loadedDocument?.title?.trim();
        if (title) {
          tab.title = title;
          persist();
          if (state.activeTab === tab.id) {
            const tabButton = [...document.querySelectorAll("[data-tab]")].find(item => item.dataset.tab === tab.id);
            const label = tabButton?.querySelector(".tab-label");
            if (label) label.textContent = title;
          }
        }
      } catch {
        // Some pages intentionally prevent reading their document title.
      }
      if(loadedDocument) {
        loadedDocument.addEventListener('click',event=>{
          const anchor=event.target?.closest?.('a[href]');
          if(!anchor||anchor.target?.toLowerCase()!=='_blank'||event.defaultPrevented) return;
          let destination='';
          try { destination=adapter.decode(anchor.href); } catch {}
          if(typeof destination!=='string'||!/^https?:\/\//i.test(destination)) return;
          event.preventDefault();
          event.stopPropagation();
          openInNewTab(destination);
        },true);
      }
      if (matchesEngineRetry(tab)) {
        const pageTitle = loadedDocument?.title || '';
        const pageText = loadedDocument?.body?.innerText || '';
        if (/there was an error loading|scramjet proxy error|uh oh!/i.test(`${pageTitle}\n${pageText}`)) {
          finishEngineRetry(tab, false, 'The proxy returned an error page.');
        } else if (loadedDocument?.body) {
          finishEngineRetry(tab, true);
        }
      }
    });
    if (state.activeTab === tab.id) {
      activeFrame = frame;
      render();
    }
    if (typeof adapter.navigateFrame === 'function') adapter.navigateFrame(frame);
    if (matchesEngineRetry(tab)) {
      setTimeout(() => {
        if (matchesEngineRetry(tab) && tabFrames.get(tab.id) === frame) {
          finishEngineRetry(tab, false, 'The alternate engine timed out while loading the page.');
        }
      }, 25_000);
    }
  } catch (error) {
    if (matchesEngineRetry(tab)) {
      finishEngineRetry(tab, false, error?.message || 'The alternate engine could not start.');
      return;
    }
    currentBrowserError = error?.message || 'The proxy could not open this page.';
    activeFrame = null;
    render();
  }
}
function modal(title, content) {
  modalState = { title, content };
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true"><button class="modal-close" data-action="close-modal" aria-label="Close">×</button><h2>${safe(title)}</h2>${content}</section>`;
  document.body.append(backdrop);
}
function closeModal() {
  document.querySelector('.modal-backdrop')?.remove();
  modalState = null;
}
function courseOptions(selected='') {
  return `<option value="">No course</option>${state.courses.map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${safe(c.name)}</option>`).join('')}`;
}
function taskForm(task={}) {
  modal(task.id?'Edit task':'New task',`<form id="task-form"><input type="hidden" name="id" value="${safe(task.id||'')}"><label class="field"><span>Task</span><input name="title" required maxlength="180" value="${safe(task.title||'')}"></label><div class="field-row"><label class="field"><span>Due</span><input type="datetime-local" name="dueAt" value="${task.dueAt?safe(new Date(task.dueAt).toISOString().slice(0,16)):''}"></label><label class="field"><span>Course</span><select name="courseId">${courseOptions(task.courseId)}</select></label></div><label class="check-row"><input type="checkbox" name="focusToday" ${task.focusToday?'checked':''}> Keep in focus today</label><div class="dialog-actions"><button type="button" class="secondary-btn" data-action="close-modal">Cancel</button><button class="primary-btn">Save task</button></div></form>`);
}
function noteForm(note={}) {
  modal(note.id?'Edit note':'New note',`<form id="note-form"><input type="hidden" name="id" value="${safe(note.id||'')}"><label class="field"><span>Title</span><input name="title" maxlength="180" value="${safe(note.title||'')}"></label><div class="note-editor-grid"><label class="field"><span>Markdown note</span><textarea id="note-body" name="body">${safe(note.body||'')}</textarea></label><section><strong>Preview</strong><div class="markdown-preview" id="note-preview">${markdownHtml(note.body||'')}</div></section></div><label class="check-row"><input type="checkbox" name="pinned" ${note.pinned?'checked':''}> Pin this note</label><div class="dialog-actions"><button type="button" class="secondary-btn" data-action="close-modal">Cancel</button><button class="primary-btn">Save note</button></div></form>`);
}
function courseForm(course={}) {
  modal(course.id?'Edit course':'Add course',`<form id="course-form"><input type="hidden" name="id" value="${safe(course.id||'')}"><label class="field"><span>Course name</span><input name="name" required maxlength="120" value="${safe(course.name||'')}"></label><label class="field"><span>Learning platform link (optional)</span><input name="lmsUrl" type="url" value="${safe(course.lmsUrl||'')}"></label><label class="field"><span>Course color</span><input name="color" type="color" value="${safe(course.color||'#d7b98e')}" style="height:39px;padding:3px"></label><div class="dialog-actions"><button type="button" class="secondary-btn" data-action="close-modal">Cancel</button><button class="primary-btn">Save course</button></div></form>`);
}
function eventForm(event={}) {
  modal(event.id?'Edit event':'Add event',`<form id="event-form"><input type="hidden" name="id" value="${safe(event.id||'')}"><label class="field"><span>Event</span><input name="title" required maxlength="180" value="${safe(event.title||'')}"></label><div class="field-row"><label class="field"><span>Starts</span><input name="startAt" type="datetime-local" required value="${event.startAt?safe(new Date(event.startAt).toISOString().slice(0,16)):''}"></label><label class="field"><span>Ends (optional)</span><input name="endAt" type="datetime-local" value="${event.endAt?safe(new Date(event.endAt).toISOString().slice(0,16)):''}"></label></div><label class="field"><span>Course</span><select name="courseId">${courseOptions(event.courseId)}</select></label><div class="dialog-actions"><button type="button" class="secondary-btn" data-action="close-modal">Cancel</button><button class="primary-btn">Save event</button></div></form>`);
}
function bookmarkForm(bookmark={}) {
  modal(bookmark.id?'Edit bookmark':'Add bookmark',`<form id="bookmark-form"><input type="hidden" name="id" value="${safe(bookmark.id||'')}"><label class="field"><span>Title</span><input name="title" required maxlength="180" value="${safe(bookmark.title||'')}"></label><label class="field"><span>Address</span><input name="url" type="url" required value="${safe(bookmark.url||'')}"></label><label class="field"><span>Folder (optional)</span><input name="folder" maxlength="80" value="${safe(bookmark.folder||'')}"></label><div class="dialog-actions"><button type="button" class="secondary-btn" data-action="close-modal">Cancel</button><button class="primary-btn">Save bookmark</button></div></form>`);
}
function shortcutForm(shortcut={}) {
  modal(shortcut.id?'Edit shortcut':'Add shortcut',`<form id="shortcut-form"><input type="hidden" name="id" value="${safe(shortcut.id||'')}"><label class="field"><span>Shortcut name</span><input name="title" required maxlength="80" value="${safe(shortcut.title||'')}"></label><label class="field"><span>Website address</span><input name="url" type="url" required value="${safe(shortcut.url||'')}"></label><div class="dialog-actions"><button type="button" class="secondary-btn" data-action="close-modal">Cancel</button><button class="primary-btn">Save shortcut</button></div></form>`);
}
function restrictionsForm() {
  const blocked = state.preferences.blocklist.join('\n');
  const allowed = state.preferences.allowlist.join('\n');
  const selected = (domains) => domains.some(domain => state.preferences.blocklist.includes(domain));
  modal('Customize restrictions',`<form id="restrictions-form"><label class="field"><span>Enforcement</span><select name="mode"><option value="light" ${state.preferences.restrictionMode==='light'?'selected':''}>Light — block sites in the blocklist</option><option value="strict" ${state.preferences.restrictionMode==='strict'?'selected':''}>Strict — allow only sites in the allowlist</option></select></label><label class="field"><span>Blocked domains, one per line</span><textarea name="blocklist" rows="5">${safe(blocked)}</textarea></label><label class="field"><span>Allowed domains, one per line</span><textarea name="allowlist" rows="5">${safe(allowed)}</textarea></label><fieldset class="preset-field"><legend>Blocklist presets</legend><label class="check-row"><input type="checkbox" name="presets" value="social" ${selected(restrictionPresets.social)?'checked':''}> Social media</label><label class="check-row"><input type="checkbox" name="presets" value="games" ${selected(restrictionPresets.games)?'checked':''}> Games</label><label class="check-row"><input type="checkbox" name="presets" value="streaming" ${selected(restrictionPresets.streaming)?'checked':''}> Streaming</label></fieldset><div class="dialog-actions"><button type="button" class="secondary-btn" data-action="close-modal">Cancel</button><button class="primary-btn">Save restrictions</button></div></form>`);
}
function recordForm(form) {
  const data = new FormData(form);
  const id = data.get('id');
  const toLocalIso = value => value ? new Date(value).toISOString() : '';
  if (form.id==='task-form') {
    const existing = state.tasks.find(x=>x.id===id);
    const record = { id:id||uid(), title:String(data.get('title')).trim(), dueAt:toLocalIso(data.get('dueAt')), courseId:data.get('courseId')||'', focusToday:data.has('focusToday'), completed:existing?.completed||false, createdAt:existing?.createdAt||now(), updatedAt:now() };
    state.tasks = existing?state.tasks.map(x=>x.id===id?record:x):[record,...state.tasks]; flash(existing?'Task updated':'Task added');
  }
  if (form.id==='note-form') {
    const existing = state.notes.find(x=>x.id===id);
    const record = { id:id||uid(), title:String(data.get('title')).trim(), body:String(data.get('body')), pinned:data.has('pinned'), createdAt:existing?.createdAt||now(), updatedAt:now() };
    state.notes = existing?state.notes.map(x=>x.id===id?record:x):[record,...state.notes]; flash(existing?'Note updated':'Note saved');
  }
  if (form.id==='course-form') {
    const existing = state.courses.find(x=>x.id===id);
    const record = { id:id||uid(), name:String(data.get('name')).trim(), color:String(data.get('color')), lmsUrl:String(data.get('lmsUrl')).trim() };
    state.courses = existing?state.courses.map(x=>x.id===id?record:x):[record,...state.courses]; flash(existing?'Course updated':'Course added');
  }
  if (form.id==='event-form') {
    const existing = state.events.find(x=>x.id===id);
    const record = { id:id||uid(), title:String(data.get('title')).trim(), startAt:toLocalIso(data.get('startAt')), endAt:toLocalIso(data.get('endAt')), courseId:data.get('courseId')||'' };
    state.events = existing?state.events.map(x=>x.id===id?record:x):[record,...state.events]; flash(existing?'Event updated':'Event added');
  }
  if (form.id==='bookmark-form') {
    const existing = state.bookmarks.find(x=>x.id===id);
    const record = { id:id||uid(), title:String(data.get('title')).trim(), url:String(data.get('url')).trim(), folder:String(data.get('folder')).trim(), createdAt:existing?.createdAt||now() };
    state.bookmarks = existing?state.bookmarks.map(x=>x.id===id?record:x):[record,...state.bookmarks]; flash(existing?'Bookmark updated':'Bookmark saved');
  }
  if (form.id==='shortcut-form') {
    const existing = state.shortcuts.find(x=>x.id===id);
    const record = { id:id||uid(), title:String(data.get('title')).trim(), url:String(data.get('url')).trim(), order:existing?.order ?? state.shortcuts.length };
    state.shortcuts = existing?state.shortcuts.map(x=>x.id===id?record:x):[...state.shortcuts,record];
    flash(existing?'Shortcut updated':'Shortcut added');
  }
  closeModal(); render();
}
async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error(`Configuration service returned ${response.status}.`);
    apiConfig = await response.json();
    configError = '';
    // The service's configured search choice is used only if the user has not selected one.
    if (apiConfig.searchEngine && !localStorage.getItem(`${KEY}.searchConfigured`)) {
      const engine = apiConfig.searchEngine;
      if (/^https?:\/\//i.test(engine)) state.preferences.searchEngine = engine;
    }
    state.preferences.proxyEngine ||= localStorage.getItem(`${KEY}.proxyEngine`) || apiConfig.proxyEngine;
  } catch (error) {
    apiConfig = null;
    configError = error?.message || 'Configuration service unavailable.';
  }
  const adapter = window.InfinitesimalProxy;
  if (adapter && typeof adapter.boot === 'function') {
    try { await adapter.boot(); proxyReady = true; proxyBootError = ''; }
    catch (error) { proxyReady = false; proxyBootError = error?.message || 'Proxy adapter boot failed.'; }
  } else proxyBootError = 'window.InfinitesimalProxy is not available.';
  try {
    await saveStudyPolicy();
    downloadRecords=await window.InfinitesimalPolicy.downloads();
    audioFiles=await window.InfinitesimalPolicy.files();
    audioFilesLoaded=true;
    const current=audioFiles.find(file=>file.id===state.preferences.currentMusicId);
    if(current?.blob) musicUrl=URL.createObjectURL(current.blob);
  } catch(error) {
    audioFilesLoaded=true;
    flash(error?.message||'IndexedDB could not be opened. Local media and restrictions may not persist.');
  }
  if(state.preferences.schoolMode&&state.preferences.studySession&&Date.parse(state.preferences.studySession.endsAt)<=Date.now()) {
    await endStudySession(true);
  }
  render();
  onboardingForm();
  updateStudyClock();
  if(activeTab().view==='browser'&&!tabFrames.has(activeTab().id)&&/^https?:/i.test(activeTab().url||'')) void navigate(activeTab().url,false);
  if (state.preferences.city) loadWeather();
}
async function loadWeather() {
  const city=state.preferences.city.trim();
  if(!city) {weatherState={loading:false,data:null,error:''};return;}
  weatherState={loading:true,data:null,error:''};
  if(state.currentView==='home') render();
  try {
    const response=await fetch(`/api/weather?city=${encodeURIComponent(city)}`);
    if(!response.ok) throw new Error(`Weather service returned ${response.status}.`);
    weatherState={loading:false,data:await response.json(),error:''};
  } catch(error) {
    weatherState={loading:false,data:null,error:error?.message||'Weather service is unavailable.'};
  }
  if(state.currentView==='home') render();
}
async function loadSuggestions(query) {
  const box = document.querySelector('#suggestions');
  if (!box || !query.trim()) { if(box) box.hidden=true; return; }
  try {
    const response = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error('Suggestion service unavailable');
    const result = await response.json();
    const suggestions = Array.isArray(result) ? result : result.suggestions || [];
    if (!suggestions.length) { box.hidden=true; return; }
    box.innerHTML = suggestions.slice(0,6).map(item=>`<button type="button" data-suggestion="${safe(typeof item==='string'?item:item.value||item.text||'')}">${safe(typeof item==='string'?item:item.value||item.text||'')}</button>`).join('');
    box.hidden = false;
  } catch { box.hidden=true; }
}
async function sendAi(prompt) {
  aiMessages.push({role:'user',content:prompt});
  persistAiMessages();
  aiMessages.push({role:'assistant',content:'Connecting to the assistant…',pending:true});
  render();
  const pending = aiMessages[aiMessages.length-1];
  try {
    const response = await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:aiMessages.filter(m=>!m.pending).map(({role,content})=>({role,content}))})});
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Assistant request failed (${response.status}).`);
    }
    if (!response.body) throw new Error('Assistant returned no response stream.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let output = '';
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      output += decoder.decode(value,{stream:true});
      pending.content = parseStreamText(output);
      render();
    }
    pending.content = parseStreamText(output) || 'The assistant returned an empty response.';
    delete pending.pending;
  } catch (error) {
    pending.content = `Assistant unavailable: ${error?.message||'Request failed.'}`;
    delete pending.pending;
  }
  persistAiMessages();
  render();
}
function clearAiChat() {
  if(!confirm('Clear this AI conversation from this browser?')) return;
  aiMessages=[];
  state.aiMessages=[];
  persist();
  render();
  flash('AI chat history cleared.');
}
function parseStreamText(text) {
  if (!text.includes('data:')) return text;
  return text.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).filter(line=>line&&line!=='[DONE]').map(line=>{
    try { const obj=JSON.parse(line); return obj.delta?.content||obj.content||obj.text||''; } catch { return line; }
  }).join('');
}
function normalizeDomainList(value) {
  const output=[];
  for(const raw of String(value||'').split(/[\n,]+/)) {
    let host=raw.trim().toLowerCase().replace(/^https?:\/\//,'').split(/[/?#:]/)[0].replace(/^\*\./,'');
    if(!host) continue;
    if(!/^(localhost|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?))+)$/.test(host)) throw new Error(`Invalid domain: ${raw.trim()}`);
    output.push(host);
  }
  return [...new Set(output)];
}
async function runDiagnostics() {
  diagnosticsRunning=true;
  diagnosticResults=null;
  render();
  try {
    const adapter=window.InfinitesimalProxy;
    if(!adapter?.diagnostics) throw new Error('The proxy diagnostics adapter is unavailable.');
    diagnosticResults=await adapter.diagnostics();
  } catch(error) {
    diagnosticResults={secureContext:{ok:Boolean(window.isSecureContext),detail:error?.message||'Diagnostics could not run.'}};
  }
  diagnosticsRunning=false;
  render();
}
function downloadJsonFile(filename, data) {
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=filename;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportWorkspace() {
  const exported=JSON.parse(JSON.stringify(state));
  delete exported.preferences.schoolPinHash;
  delete exported.preferences.schoolPinSalt;
  exported.preferences.schoolMode=false;
  exported.preferences.studySession=null;
  delete exported.preferences.lastBrowserTabId;
  exported.downloads=downloadRecords;
  exported.exportedAt=now();
  exported.schemaVersion=1;
  downloadJsonFile(`infinitesimal-${new Date().toISOString().slice(0,10)}.json`,exported);
  flash('Workspace JSON exported. The School Mode PIN is excluded.');
}
async function importWorkspaceFile(file) {
  const parsed=JSON.parse(await file.text());
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)) throw new Error('The selected file is not a workspace JSON export.');
  const importedRules=parsed.preferences?.siteRules;
  const containsCustomJavascript=importedRules&&typeof importedRules==='object'&&!Array.isArray(importedRules)&&Object.values(importedRules).some(rule=>typeof rule?.js==='string'&&rule.js.trim());
  if(containsCustomJavascript&&!confirm('This file contains custom JavaScript that will run inside proxied pages. Import these site rules?')) return;
  for(const collection of ['tasks','courses','notes','events','bookmarks','history','studySessions','shortcuts']) {
    if(!Array.isArray(parsed[collection])||parsed[collection].length>5000) throw new Error(`The JSON file has an invalid ${collection} list.`);
  }
  const priorPin=state.preferences.schoolPinHash;
  const priorSalt=state.preferences.schoolPinSalt;
  state.preferences={...initial.preferences,...(parsed.preferences||{}),schoolPinHash:priorPin,schoolPinSalt:priorSalt};
  state.aiMessages=Array.isArray(parsed.aiMessages)?parsed.aiMessages.filter(message=>message&&['user','assistant'].includes(message.role)&&typeof message.content==='string').slice(-30):[];
  aiMessages=state.aiMessages;
  const supportedSearch=['https://duckduckgo.com/?q=','https://www.bing.com/search?q=','https://search.brave.com/search?q=','https://www.startpage.com/sp/search?query=','https://www.google.com/search?q='];
  if(!supportedSearch.includes(state.preferences.searchEngine)) state.preferences.searchEngine=initial.preferences.searchEngine;
  if(!['uv','scramjet'].includes(state.preferences.proxyEngine)) state.preferences.proxyEngine=apiConfig?.proxyEngine||'uv';
  if(!/^#[0-9a-f]{6}$/i.test(state.preferences.accentColor||'')) delete state.preferences.accentColor;
  state.preferences.schoolMode=false;
  state.preferences.studySession=null;
  for(const collection of ['tasks','courses','notes','events','bookmarks','history','studySessions','shortcuts']) state[collection]=parsed[collection];
  state.recentlyClosedTabs=Array.isArray(parsed.recentlyClosedTabs)?parsed.recentlyClosedTabs.slice(0,10):[];
  downloadRecords=Array.isArray(parsed.downloads)?parsed.downloads.slice(0,100).map(item=>({...item,id:item.id||uid()})):[];
  await window.InfinitesimalPolicy.saveDownloads(downloadRecords);
  state.tabs=[{id:uid(),title:'Home',url:'infinitesimal://home',view:'home'}];
  state.activeTab=state.tabs[0].id;
  state.currentView='home';
  state.preferences.onboardingComplete=true;
  localStorage.setItem(`${KEY}.searchConfigured`,'1');
  localStorage.setItem(`${KEY}.proxyEngine`,state.preferences.proxyEngine);
  tabFrames.clear();
  activeFrame=null;
  await saveStudyPolicy();
  render();
  flash('Workspace data imported. Current School Mode session was not imported.');
  setTimeout(()=>location.reload(),600);
}
function deleteIndexedDatabase() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.deleteDatabase('infinitesimal-browser');
    request.onsuccess=()=>resolve(true);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('The browser is still using local storage. Close other Infinitesimal tabs and try again.'));
  });
}
async function eraseAllData() {
  if(!confirm('Erase all Infinitesimal workspace data, study settings, audio files, downloads and local history from this browser? This cannot be undone.')) return;
  try {
    for(let index=localStorage.length-1;index>=0;index--) {
      const key=localStorage.key(index);
      if(key?.startsWith('infinitesimal.')) localStorage.removeItem(key);
    }
    await deleteIndexedDatabase();
    for(const cacheName of await caches.keys()) await caches.delete(cacheName);
    for(const registration of await navigator.serviceWorker?.getRegistrations?.()||[]) await registration.unregister();
    if(musicUrl) URL.revokeObjectURL(musicUrl);
    musicUrl='';
    audioFiles=[];
    downloadRecords=[];
    noiseSource?.stop();
    noiseSource=null;
    noiseGain=null;
    aiMessages=[];
    state={...initial,preferences:{...initial.preferences},tabs:[{id:uid(),title:'Home',url:'infinitesimal://home',view:'home'}],activeTab:null};
    state.activeTab=state.tabs[0].id;
    tabFrames.clear();
    activeFrame=null;
    render();
    flash('All Infinitesimal data was erased from this browser.');
    setTimeout(()=>location.reload(),600);
  } catch(error) {
    flash(error?.message||'Some local data could not be erased.');
  }
}
function parseIcsDate(value) {
  if(!value) return '';
  const raw=value.trim();
  if(/^\d{8}$/.test(raw)) return new Date(`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T00:00:00`).toISOString();
  const match=raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if(!match) return '';
  const [,year,month,day,hour,minute,second='00',utc]=match;
  const date=utc?new Date(Date.UTC(+year,+month-1,+day,+hour,+minute,+second)):new Date(+year,+month-1,+day,+hour,+minute,+second);
  return Number.isNaN(date.valueOf())?'':date.toISOString();
}
function decodeIcsText(value) {
  return value.replace(/\\n/gi,'\n').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\');
}
async function importIcsFile(file) {
  const source=(await file.text()).replace(/\r?\n[ \t]/g,'');
  const blocks=source.split(/BEGIN:VEVENT/i).slice(1).map(item=>item.split(/END:VEVENT/i)[0]);
  const imported=[];
  let unsupportedRecurrences=0;
  for(const block of blocks) {
    const properties={};
    for(const line of block.split(/\r?\n/)) {
      const match=line.match(/^([A-Z-]+)(?:;[^:]*)?:(.*)$/i);
      if(match) properties[match[1].toUpperCase()]=match[2];
    }
    const title=decodeIcsText(properties.SUMMARY||'').trim();
    const startAt=parseIcsDate(properties.DTSTART);
    if(!title||!startAt) continue;
    let rrule='';
    if(properties.RRULE) {
      try { parseRecurrenceRule(properties.RRULE); rrule=properties.RRULE; }
      catch { unsupportedRecurrences++; }
    }
    imported.push({id:uid(),title,startAt,endAt:parseIcsDate(properties.DTEND),courseId:'',source:'ics',...(rrule?{rrule}:{})});
  }
  if(!imported.length) throw new Error('No events with a title and supported start date were found in this .ics file.');
  state.events=[...state.events,...imported];
  persist();
  render();
  const recurrenceNote=unsupportedRecurrences?`; ${unsupportedRecurrences} unsupported recurring rule${unsupportedRecurrences===1?' was':'s were'} imported as one-time events`:'';
  flash(`${imported.length} event${imported.length===1?'':'s'} imported${recurrenceNote}.`);
}

document.addEventListener('click', event => {
  const target = event.target.closest('button,[data-view],[data-close-tab],[data-tab],[data-open-url],[data-edit-note],[data-edit-task],[data-edit-course],[data-edit-event],[data-edit-bookmark],[data-edit-shortcut],[data-delete-shortcut],[data-move-shortcut],[data-delete-audio],[data-move-audio],[data-play-track],[data-calendar-date],[data-calendar-shift],[data-calendar-mode],[data-delete-task],[data-delete-note],[data-delete-course],[data-delete-event],[data-delete-bookmark],[data-pin-note],[data-complete-task],[data-remove-download]');
  if (!target) return;
  if (target.dataset.action === 'retry-other-engine') {
    event.preventDefault();
    event.stopPropagation();
    retryWithOtherEngine();
    return;
  }
  if (target.dataset.closeTab) { event.stopPropagation(); closeTab(target.dataset.closeTab); return; }
  if (target.dataset.tab) {
    state.activeTab=target.dataset.tab;
    const t=activeTab();
    state.currentView=t.view==='browser'?'browser':t.view;
    activeFrame=t.view==='browser'?tabFrames.get(t.id)||null:null;
    if(t.view==='browser'&&!activeFrame&&t.url==='about:blank') {openBlankInTab(t);return;}
    if(t.view==='browser'&&!activeFrame&&/^https?:/i.test(t.url||'')) {void navigate(t.url,false);return;}
    render();return;
  }
  if (target.dataset.calendarDate) { calendarSelectedDate=target.dataset.calendarDate; render(); return; }
  if (target.dataset.calendarMode) { calendarMode=target.dataset.calendarMode; render(); return; }
  if (target.dataset.calendarShift) { const amount=Number(target.dataset.calendarShift); if(calendarMode==='month') calendarCursor.setMonth(calendarCursor.getMonth()+amount); else calendarCursor.setDate(calendarCursor.getDate()+amount*7); calendarSelectedDate=''; render(); return; }
  if (target.dataset.view) { if(target.tagName==='A') event.preventDefault(); openInternal(target.dataset.view); document.querySelector('#sidebar')?.classList.remove('open'); return; }
  if (target.dataset.openUrl) { event.preventDefault(); navigate(target.dataset.openUrl); return; }
  if (target.dataset.editNote) { noteForm(state.notes.find(x=>x.id===target.dataset.editNote)); return; }
  if (target.dataset.editTask) { taskForm(state.tasks.find(x=>x.id===target.dataset.editTask)); return; }
  if (target.dataset.editCourse) { courseForm(state.courses.find(x=>x.id===target.dataset.editCourse)); return; }
  if (target.dataset.editEvent) { eventForm(state.events.find(x=>x.id===target.dataset.editEvent)); return; }
  if (target.dataset.editBookmark) { bookmarkForm(state.bookmarks.find(x=>x.id===target.dataset.editBookmark)); return; }
  if (target.dataset.editShortcut) { shortcutForm(state.shortcuts.find(x=>x.id===target.dataset.editShortcut)); return; }
  if (target.dataset.deleteShortcut) { if(confirm('Remove this shortcut?')) {state.shortcuts=state.shortcuts.filter(x=>x.id!==target.dataset.deleteShortcut);state.shortcuts.forEach((item,index)=>item.order=index);render();flash('Shortcut removed');} return; }
  if (target.dataset.moveShortcut) {
    const ordered=[...state.shortcuts].sort((a,b)=>(a.order||0)-(b.order||0));
    const index=ordered.findIndex(item=>item.id===target.dataset.moveShortcut);
    const next=index+Number(target.dataset.direction);
    if(index>=0&&next>=0&&next<ordered.length) [ordered[index],ordered[next]]=[ordered[next],ordered[index]];
    ordered.forEach((item,position)=>item.order=position);
    state.shortcuts=ordered;render();return;
  }
  if (target.dataset.playTrack) { void playAudioTrack(target.dataset.playTrack); return; }
  if (target.dataset.deleteAudio) { void deleteAudioFile(target.dataset.deleteAudio); return; }
  if (target.dataset.moveAudio) {
    const index=audioFiles.findIndex(file=>file.id===target.dataset.moveAudio);
    const next=index+Number(target.dataset.direction);
    if(index>=0&&next>=0&&next<audioFiles.length) [audioFiles[index],audioFiles[next]]=[audioFiles[next],audioFiles[index]];
    void persistAudioFiles().then(render).catch(error=>flash(error?.message||'Playlist order could not be saved.'));
    return;
  }
  if (target.dataset.completeTask) {
    state.tasks=state.tasks.map(t=>t.id===target.dataset.completeTask?{...t,completed:!t.completed,updatedAt:now()}:t); render(); return;
  }
  if (target.dataset.deleteTask) { if(confirm('Delete this task?')) {state.tasks=state.tasks.filter(x=>x.id!==target.dataset.deleteTask);render();flash('Task deleted');} return; }
  if (target.dataset.deleteNote) { if(confirm('Delete this note?')) {state.notes=state.notes.filter(x=>x.id!==target.dataset.deleteNote);render();flash('Note deleted');} return; }
  if (target.dataset.deleteCourse) { if(confirm('Delete this course? Its linked tasks and events will remain, but without a course.')) {state.courses=state.courses.filter(x=>x.id!==target.dataset.deleteCourse);state.tasks=state.tasks.map(x=>x.courseId===target.dataset.deleteCourse?{...x,courseId:''}:x);state.events=state.events.map(x=>x.courseId===target.dataset.deleteCourse?{...x,courseId:''}:x);render();flash('Course removed');} return; }
  if (target.dataset.deleteEvent) { if(confirm('Delete this event?')) {state.events=state.events.filter(x=>x.id!==target.dataset.deleteEvent);render();flash('Event deleted');} return; }
  if (target.dataset.deleteBookmark) { if(confirm('Remove this bookmark?')) {state.bookmarks=state.bookmarks.filter(x=>x.id!==target.dataset.deleteBookmark);render();flash('Bookmark removed');} return; }
  if (target.dataset.removeDownload) {
    downloadRecords=downloadRecords.filter(item=>item.id!==target.dataset.removeDownload);
    void window.InfinitesimalPolicy.saveDownloads(downloadRecords).then(()=>{render();flash('Download removed from the list.');}).catch(error=>flash(error?.message||'The download list could not be saved.'));
    return;
  }
  if (target.dataset.pinNote) { state.notes=state.notes.map(n=>n.id===target.dataset.pinNote?{...n,pinned:!n.pinned,updatedAt:now()}:n);render();return; }
  const action = target.dataset.action;
  if (action==='new-tab') newTab();
  if (action==='new-blank-tab') newBlankTab();
  if (action==='menu') document.querySelector('#sidebar')?.classList.toggle('open');
  if (action==='back'||action==='forward') {
    const tab=activeTab(), step=action==='back'?-1:1, next=(tab.visitIndex??-1)+step;
    if(next>=0 && next<(tab.visitStack||[]).length) { tab.visitIndex=next; navigate(tab.visitStack[next],false); }
    else flash(action==='back'?'No earlier page in this tab.':'No later page in this tab.');
  }
  if (action==='reload') { if(activeTab().view==='browser') navigate(activeTab().url); else render(); }
  if (action==='reload-browser') { const tab=currentBrowserTab(); if(tab) {state.activeTab=tab.id;activeFrame=tabFrames.get(tab.id)||null;void navigate(tab.url);} }
  if (action==='bookmark-current') {
    const t=activeTab();
    if(t.view==='browser' && /^https?:/.test(t.url)) bookmarkForm({url:t.url,title:t.title});
    else flash('Open a web address before bookmarking it.');
  }
  if (action==='create-task') taskForm();
  if (action==='create-note') noteForm();
  if (action==='create-course') courseForm();
  if (action==='create-event') eventForm();
  if (action==='create-bookmark') bookmarkForm();
  if (action==='create-shortcut') shortcutForm();
  if (action==='close-modal') closeModal();
  if (action==='school-start') {const mode=document.querySelector('#restriction-mode')?.value;if(mode)state.preferences.restrictionMode=mode;void startStudySession();}
  if (action==='school-end') void endStudySession(false);
  if (action==='customize-restrictions') restrictionsForm();
  if (action==='clear-history') {if(confirm('Clear all locally stored browsing navigation entries?')) {state.history=[];render();flash('History cleared');}}
  if (action==='clear-downloads') {
    if(confirm('Clear the download activity list? This does not delete files saved by your host browser.')) {
      downloadRecords=[];
      void window.InfinitesimalPolicy.saveDownloads(downloadRecords).then(()=>{render();flash('Download activity cleared.');}).catch(error=>flash(error?.message||'The download list could not be cleared.'));
    }
  }
  if (action==='clear-ai-chat') clearAiChat();
  if (action==='clear-workspace') {
    if(confirm('Delete notes, tasks, courses, events and bookmarks stored by Infinitesimal on this browser?')) {
      state.notes=[];state.tasks=[];state.courses=[];state.events=[];state.bookmarks=[];persist();render();flash('Workspace data cleared');
    }
  }
  if (action==='save-search-settings') {
    const engine=document.querySelector('#search-engine')?.value;
    const proxyEngine=document.querySelector('#proxy-engine')?.value;
    const city=document.querySelector('#weather-city')?.value.trim()||'';
    const previousProxy=state.preferences.proxyEngine||apiConfig?.proxyEngine||'uv';
    if(engine) state.preferences.searchEngine=engine;
    if(proxyEngine) state.preferences.proxyEngine=proxyEngine;
    state.preferences.city=city;
    localStorage.setItem(`${KEY}.searchConfigured`,'1');
    if(proxyEngine) localStorage.setItem(`${KEY}.proxyEngine`,proxyEngine);
    persist();render();flash('Search preferences saved'); if(city) loadWeather();
    if(proxyEngine&&proxyEngine!==previousProxy) { setTimeout(()=>location.reload(),400); }
  }
  if (action==='refresh-config') loadConfig();
  if (action==='run-diagnostics') void runDiagnostics();
  if (action==='weather-retry') loadWeather();
  if (action==='focus-calculator') {
    const calculator=document.querySelector('#calculator-expression');
    calculator?.scrollIntoView({behavior:'smooth',block:'center'});
    calculator?.focus({preventScroll:true});
  }
  if (action==='focus-search') {
    const search=document.querySelector('#hero-search input');
    search?.scrollIntoView({behavior:'smooth',block:'center'});
    search?.focus({preventScroll:true});
  }
  if (action==='retry-navigation') navigate(activeTab().url);
  if (action==='retry-other-engine') retryWithOtherEngine();
  if (action==='choose-audio') document.querySelector('#audio-picker')?.click();
  if (action==='shuffle-audio') {state.preferences.musicShuffle=!state.preferences.musicShuffle;persist();render();}
  if (action==='toggle-noise') toggleFocusNoise();
  if (action==='export-data') exportWorkspace();
  if (action==='choose-import') document.querySelector('#import-workspace-file')?.click();
  if (action==='erase-all-data') void eraseAllData();
  if (action==='import-ics') document.querySelector('#ics-file')?.click();
  if (action==='remove-school-pin') {if(state.preferences.schoolPinHash&&confirm('Remove the School Mode PIN?')){delete state.preferences.schoolPinHash;delete state.preferences.schoolPinSalt;persist();render();flash('School Mode PIN removed.');}}
  if (action==='remove-site-rule') {
    try {const tab=currentBrowserTab();if(!tab)throw new Error();const host=new URL(tab.url).hostname;delete state.preferences.siteRules[host];persist();const frame=tabFrames.get(tab.id);if(frame)applyExtensionsToPage(frame,tab.url);render();flash(`Rules removed for ${host}.`);} catch {flash('Open a proxied site before removing its rules.');}
  }
  if (target.dataset.settings) {activeSettings=target.dataset.settings;render();}
  if (target.dataset.suggestion) navigate(target.dataset.suggestion);
});
document.addEventListener('submit', event => {
  if (event.target.id==='omnibox-form' || event.target.id==='hero-search') {
    event.preventDefault();
    const value=event.target.id==='omnibox-form'?document.querySelector('#omnibox').value:new FormData(event.target).get('query');
    document.querySelector('#suggestions')?.setAttribute('hidden','');
    navigate(value);
  }
  if (['task-form','note-form','course-form','event-form','bookmark-form','shortcut-form'].includes(event.target.id)) {
    event.preventDefault();
    if(event.target.reportValidity()) recordForm(event.target);
  }
  if (event.target.id==='onboarding-form') {
    event.preventDefault();
    const data=new FormData(event.target);
    state.preferences.firstName=String(data.get('firstName')||'').trim();
    state.preferences.searchEngine=String(data.get('searchEngine')||'https://duckduckgo.com/?q=');
    state.preferences.onboardingComplete=true;
    localStorage.setItem(`${KEY}.searchConfigured`,'1');
    persist();closeModal();render();flash('Your workspace preferences are saved.');
  }
  if (event.target.id==='general-form') {
    event.preventDefault();
    const data=new FormData(event.target);
    state.preferences.firstName=String(data.get('firstName')||'').trim();
    state.preferences.accentColor=String(data.get('accentColor')||'#d7b98e');
    persist();render();flash('General settings saved.');
  }
  if (event.target.id==='pin-form') {
    event.preventDefault();
    const pin=String(new FormData(event.target).get('pin')||'');
    if(pin.length<4) {flash('Use a PIN with at least 4 characters.');return;}
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const saltHex=[...salt].map(value=>value.toString(16).padStart(2,'0')).join('');
    void digestPin(pin,saltHex).then(hash=>{state.preferences.schoolPinHash=hash;state.preferences.schoolPinSalt=saltHex;persist();render();flash('School Mode PIN saved.');}).catch(error=>flash(error?.message||'The PIN could not be saved.'));
  }
  if (event.target.id==='restrictions-form') {
    event.preventDefault();
    const data=new FormData(event.target);
    try {
      const presetDomains=new Set(Object.values(restrictionPresets).flat());
      const typedBlocklist=normalizeDomainList(data.get('blocklist'));
      const blocklist=typedBlocklist.filter(domain=>!presetDomains.has(domain));
      for(const preset of data.getAll('presets')) blocklist.push(...(restrictionPresets[preset]||[]));
      const allowlist=normalizeDomainList(data.get('allowlist'));
      const mode=data.get('mode')==='strict'?'strict':'light';
      if(mode==='strict'&&!allowlist.length&&!confirm('Strict mode with an empty allowlist blocks all proxied websites during the session. Save these restrictions?')) return;
      state.preferences.blocklist=[...new Set(blocklist)];
      state.preferences.allowlist=allowlist;
      state.preferences.restrictionMode=mode;
      void saveStudyPolicy().then(()=>{closeModal();persist();render();flash('Site restrictions saved.');}).catch(error=>flash(error?.message||'Restrictions could not be saved to IndexedDB.'));
    } catch(error) { flash(error?.message||'Check the domain list.'); }
  }
  if (event.target.id==='site-rule-form') {
    event.preventDefault();
    try {
      const browserTab=currentBrowserTab();
      if(!browserTab) throw new Error('Open a proxied page first.');
      const hostname=new URL(browserTab.url).hostname;
      const data=new FormData(event.target);
      state.preferences.siteRules[hostname]={css:String(data.get('css')||''),js:String(data.get('js')||'')};
      persist();
      const frame=tabFrames.get(browserTab.id);
      if(frame) applyExtensionsToPage(frame,browserTab.url);
      render();
      flash(`Site rules saved for ${hostname}.`);
    } catch { flash('Open a proxied web page before saving site rules.'); }
  }
  if (event.target.id==='calculator-form') {
    event.preventDefault();
    const result=document.querySelector('#calculator-result');
    try {result.textContent=calculateExpression(String(new FormData(event.target).get('expression')||''));}
    catch(error) {result.textContent=error?.message||'Check the expression.';}
  }
  if (event.target.id==='translate-form') {event.preventDefault();void translateText(event.target);}
  if (event.target.id==='ai-form') {
    event.preventDefault();
    const input=event.target.elements.prompt;
    const prompt=input.value.trim();
    if(prompt){input.value='';sendAi(prompt);}
  }
});
document.addEventListener('input', event => {
  if (event.target.id==='omnibox') {
    clearTimeout(suggestionTimer);
    const q=event.target.value.trim();
    suggestionTimer=setTimeout(()=>loadSuggestions(q),220);
  }
  if(event.target.matches('[data-extension-size]')) {
    const value=Number(event.target.value);
    state.preferences.extensions.textSize=value;
    const output=document.querySelector('#extension-size');
    if(output) output.textContent=`${value}%`;
    persist();
    const browserTab=currentBrowserTab();
    const frame=browserTab?tabFrames.get(browserTab.id):null;
    if(frame) applyExtensionsToPage(frame,browserTab.url);
  }
  if(event.target.id==='history-search') {
    historyQuery=event.target.value;
    const results=document.querySelector('#history-results');
    if(results) results.innerHTML=historyResultsMarkup();
  }
  if(event.target.id==='note-body') {
    const preview=document.querySelector('#note-preview');
    if(preview) preview.innerHTML=markdownHtml(event.target.value);
  }
  if(event.target.id==='audio-volume') {
    const player=document.querySelector('#audio-player');
    if(player) player.volume=Number(event.target.value);
  }
});
document.addEventListener('change', event => {
  if(event.target.id==='audio-picker' && event.target.files?.length) {void addAudioFiles(event.target.files);event.target.value='';}
  if(event.target.id==='ics-file' && event.target.files?.[0]) {
    void importIcsFile(event.target.files[0]).catch(error=>flash(error?.message||'The calendar file could not be imported.'));
    event.target.value='';
  }
  if(event.target.id==='import-workspace-file' && event.target.files?.[0]) {
    void importWorkspaceFile(event.target.files[0]).catch(error=>flash(error?.message||'The workspace could not be imported.'));
    event.target.value='';
  }
  if(event.target.matches('[data-extension-toggle]')) {
    state.preferences.extensions[event.target.dataset.extensionToggle]=event.target.checked;
    persist();
    const browserTab=currentBrowserTab();
    const frame=browserTab?tabFrames.get(browserTab.id):null;
    if(frame) applyExtensionsToPage(frame,browserTab.url);
  }
});
document.addEventListener('keydown', event => {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod) {
    if(event.key==='Escape') closeModal();
    if(event.key==='Enter' && event.target.closest('#omnibox')) { event.preventDefault(); document.querySelector('#omnibox-form')?.requestSubmit(); }
    return;
  }
  const key=event.key.toLowerCase();
  if(key==='t'&&event.shiftKey) {event.preventDefault();reopenClosedTab();return;}
  if(key==='t') {event.preventDefault();newTab();}
  if(key==='w') {event.preventDefault();closeTab(state.activeTab);}
  if(key==='l') {event.preventDefault();focusOmnibox();}
  if(key==='r') {event.preventDefault();if(activeTab().view==='browser')navigate(activeTab().url);else render();}
});
document.addEventListener('click', event => {
  if(!event.target.closest('.omnibox-wrap')) {
    const suggestions=document.querySelector('#suggestions');
    if(suggestions) suggestions.hidden=true;
  }
});
navigator.serviceWorker?.addEventListener('message', event => {
  if(event.data?.source !== 'infinitesimal-service-worker') return;
  if(event.data.type==='download') {
    const item={...event.data.download,at:event.data.download?.at||now()};
    downloadRecords=[item,...downloadRecords.filter(existing=>existing.id!==item.id)].slice(0,100);
    void window.InfinitesimalPolicy?.saveDownloads?.(downloadRecords).then(()=>{
      if(state.currentView==='downloads'&&document.activeElement?.id!=='omnibox') render();
    }).catch(error=>flash(error?.message||'Download details could not be saved.'));
  }
});
const retryOnStartup = readEngineRetry();
if (BLANK_SHELL_MODE && !sessionStorage.getItem(BLANK_SHELL_KEY)) {
  const embeddedHome = { id: uid(), title: 'Home', url: 'infinitesimal://home', view: 'home' };
  state.tabs = [embeddedHome];
  state.activeTab = embeddedHome.id;
  state.currentView = 'home';
  render();
} else if (
  retryOnStartup &&
  state.tabs.some(tab => tab.id === retryOnStartup.tabId && tab.url === retryOnStartup.url) &&
  activeProxyEngine() === retryOnStartup.to
) {
  state.activeTab = retryOnStartup.tabId;
  state.currentView = 'browser';
  persist();
  setTimeout(() => void navigate(retryOnStartup.url, false), 0);
} else {
  if (retryOnStartup) sessionStorage.removeItem(ENGINE_RETRY_KEY);
  if (activeTab().view === 'browser' && activeTab().url === 'about:blank') openBlankInTab(activeTab());
  else render();
}
loadConfig();
setInterval(updateStudyClock,1000);
setInterval(()=>{
  const clock=document.querySelector('#live-clock');
  const date=document.querySelector('#live-date');
  if(clock) clock.textContent=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date());
  if(date) date.textContent=new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(new Date());
},30_000);
