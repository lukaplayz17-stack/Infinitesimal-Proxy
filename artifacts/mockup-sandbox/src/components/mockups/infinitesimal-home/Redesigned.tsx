import "./_group.css";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  CalendarDays,
  Check,
  CheckCircle2,
  Command,
  Download,
  History,
  Home,
  Music2,
  NotebookPen,
  Plus,
  Puzzle,
  RotateCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  School,
  Languages,
  Calculator,
  ArrowUpRight,
} from "lucide-react";

const navigation = [
  { label: "Home", Icon: Home, active: true },
  { label: "AI", Icon: Sparkles },
  { label: "School", Icon: School },
  { label: "Notes", Icon: NotebookPen },
  { label: "Tasks", Icon: CheckCircle2 },
  { label: "Calendar", Icon: CalendarDays },
  { label: "Bookmarks", Icon: Bookmark },
  { label: "History", Icon: History },
  { label: "Downloads", Icon: Download },
  { label: "Music", Icon: Music2 },
  { label: "Extensions", Icon: Puzzle },
  { label: "Translate", Icon: Languages },
];

function Sunset() {
  return (
    <svg className="redesign-sunset" viewBox="0 0 1100 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="redesignSky" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#d58d92" />
          <stop offset=".38" stopColor="#9b627c" />
          <stop offset=".72" stopColor="#4a4e71" />
          <stop offset="1" stopColor="#182942" />
        </linearGradient>
        <radialGradient id="redesignSunsetGlow">
          <stop stopColor="#f4b08f" stopOpacity=".86" />
          <stop offset="1" stopColor="#d87987" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1100" height="400" fill="url(#redesignSky)" />
      <ellipse cx="800" cy="170" rx="285" ry="175" fill="url(#redesignSunsetGlow)" />
      <circle cx="800" cy="173" r="25" fill="#f4c9a3" opacity=".9" />
      <path d="m0 270 142-93 105 65L451 31l96 132 96-70 168 167 113-94 176 99v135H0z" fill="#393d5a" opacity=".86" />
      <path d="m451 31 53 107 43 25z" fill="#e1b4a7" opacity=".4" />
      <path d="m0 319 146-83 111 92 142-115 113 105 139-129 124 127 123-92 202 106v70H0z" fill="#293650" />
      <path d="m0 355 133-33 117 22 154-52 109 54 148-47 143 43 118-45 178 55v48H0z" fill="#16263d" />
      <path d="M0 378q143-24 280 8t278-2 270-1 272 9v8H0z" fill="#111e33" />
      <g fill="#13213a">
        <path d="m731 357 20-67 25 67h-13v39h-20v-39z" />
        <path d="m824 365 17-49 21 49h-12v31h-16v-31z" />
        <path d="m901 360 20-59 22 59h-13v36h-18v-36z" />
      </g>
    </svg>
  );
}

export function Redesigned() {
  const today = new Date();
  const greeting = today.getHours() < 12 ? "Good morning." : today.getHours() < 18 ? "Good afternoon." : "Good evening.";
  return (
    <div className="infinitesimal-redesigned">
      <style>{`
        .infinitesimal-redesigned {
          min-height:100vh; color:#e9edf5; background:#0e1729;
          font:400 12px/1.5 'DM Sans',sans-serif; overflow:hidden;
          --ir-line:rgba(192,205,231,.11); --ir-muted:#8795ad; --ir-lilac:#aebce7;
        }
        .infinitesimal-redesigned * { box-sizing:border-box; }
        .ir-shell { min-height:100vh; display:grid; grid-template-columns:156px minmax(0,1fr); background:radial-gradient(ellipse at 75% 2%,#202744 0,transparent 38%),#0e1729; }
        .ir-sidebar { display:flex; flex-direction:column; padding:15px 10px 12px; background:rgba(8,15,27,.92); border-right:1px solid var(--ir-line); }
        .ir-brand { display:flex; gap:9px; align-items:center; padding:0 6px 19px; }
        .ir-brand-mark { display:grid; place-items:center; width:27px; height:27px; color:#94a9f7; border:1px solid rgba(143,163,239,.22); border-radius:9px; background:#192540; }
        .ir-brand-name { font:700 12px 'Manrope',sans-serif; letter-spacing:-.04em; }
        .ir-brand-caption { display:block; color:#78859c; font-size:7px; letter-spacing:.13em; text-transform:uppercase; }
        .ir-nav { display:grid; gap:3px; }
        .ir-nav-label { margin:0 8px 6px; color:#75839a; font-size:8px; text-transform:uppercase; letter-spacing:.14em; }
        .ir-nav button { display:flex; align-items:center; gap:9px; width:100%; padding:8px; border:0; border-radius:7px; color:#aeb9ce; background:transparent; text-align:left; font-size:10px; }
        .ir-nav button.active { color:#e9eeff; background:#202c4b; box-shadow:inset 2px 0 #9caff5; }
        .ir-nav button svg { width:13px; height:13px; color:#a7b2ca; }
        .ir-nav button.active svg { color:#adbcff; }
        .ir-sidebar-bottom { margin-top:auto; }
        .ir-privacy { padding:9px; border:1px solid var(--ir-line); border-radius:9px; background:#141f34; color:#c7d0df; font-size:9px; }
        .ir-privacy span { display:block; margin-top:4px; color:#8491a8; font-size:8px; line-height:1.45; }
        .ir-profile { display:flex; align-items:center; gap:8px; margin-top:11px; padding:0 3px; color:#d5dceb; font-size:9px; }
        .ir-avatar { display:grid; place-items:center; width:24px; height:24px; border-radius:50%; background:#536ba7; font-weight:700; }
        .ir-profile small { display:block; color:#8290a7; font-size:8px; }
        .ir-main { min-width:0; }
        .ir-chrome { position:sticky; top:0; z-index:2; background:rgba(8,14,26,.96); border-bottom:1px solid var(--ir-line); }
        .ir-tabs { display:flex; align-items:end; gap:4px; height:33px; padding:0 12px; border-bottom:1px solid rgba(255,255,255,.035); }
        .ir-tab { display:flex; align-items:center; gap:7px; height:27px; width:165px; padding:0 9px; border:1px solid var(--ir-line); border-bottom:0; border-radius:7px 7px 0 0; color:#d4dbea; background:#17233b; font-size:9px; }
        .ir-tab svg { width:11px; height:11px; color:#aab8e4; }
        .ir-tab-close { margin-left:auto; color:#8793a8; }
        .ir-toolbar { display:flex; align-items:center; gap:6px; height:38px; padding:4px 12px; }
        .ir-tool { display:grid; place-items:center; width:24px; height:24px; border:0; border-radius:6px; color:#9eabc2; background:transparent; }
        .ir-tool svg { width:13px; height:13px; }
        .ir-address { display:flex; align-items:center; gap:8px; flex:1; min-width:0; height:27px; margin:0 7px; padding:0 10px; border:1px solid rgba(193,205,228,.13); border-radius:18px; color:#aeb9cb; background:#111d33; font-size:9px; }
        .ir-address svg { width:12px; height:12px; }
        .ir-status { display:flex; align-items:center; gap:5px; color:#a7b3c7; font-size:8px; white-space:nowrap; }
        .ir-status svg { color:#70d9b1; width:11px; height:11px; }
        .ir-content { max-width:1510px; margin:auto; padding:18px clamp(17px,2.4vw,34px) 27px; }
        .ir-dashboard { display:grid; grid-template-columns:minmax(0,1fr) 218px; gap:15px; align-items:start; }
        .ir-primary { min-width:0; }
        .ir-hero { position:relative; min-height:247px; overflow:hidden; border:1px solid rgba(220,207,226,.14); border-radius:15px; background:#292840; }
        .redesign-sunset { position:absolute; inset:0; width:100%; height:100%; }
        .ir-hero:after { position:absolute; inset:0; content:''; background:linear-gradient(90deg,rgba(18,27,47,.72),rgba(23,30,50,.34) 48%,rgba(22,27,46,.04)),linear-gradient(0deg,rgba(13,23,41,.55),transparent 64%); }
        .ir-hero-top { position:relative; z-index:1; display:flex; justify-content:space-between; gap:12px; padding:28px 26px 0; }
        .ir-date { color:#ebc4b6; font-size:8px; text-transform:uppercase; letter-spacing:.16em; font-weight:700; }
        .ir-hero h1 { margin:8px 0 6px; color:#e4e8f3; font:500 clamp(24px,3vw,35px)/1.08 'Manrope',sans-serif; letter-spacing:-.05em; }
        .ir-hero h1 strong { color:#fff1e9; font-weight:700; }
        .ir-hero p { max-width:300px; margin:0; color:#ddd7e1; font-size:10px; line-height:1.6; }
        .ir-time { display:grid; align-content:start; justify-items:end; gap:4px; padding-top:4px; color:#f4eced; }
        .ir-time strong { font:500 21px 'Manrope',sans-serif; letter-spacing:-.04em; }
        .ir-time span { color:#d5cad7; font-size:8px; }
        .ir-search { position:absolute; z-index:1; right:4%; bottom:18px; left:4%; display:flex; align-items:center; gap:9px; height:40px; padding:0 13px; border:1px solid rgba(229,225,242,.66); border-radius:24px; background:rgba(13,25,47,.88); color:#cbd4e7; }
        .ir-search svg { flex:none; width:15px; height:15px; }
        .ir-search input { flex:1; min-width:0; border:0; outline:0; color:#f1f2f7; background:transparent; font:inherit; font-size:9px; }
        .ir-search input::placeholder { color:#a9b3c6; }
        .ir-search button { display:grid; place-items:center; width:25px; height:25px; border:0; border-radius:50%; background:#334776; color:#e6ebf8; }
        .ir-search button svg { width:12px; height:12px; }
        .ir-quicklinks { display:flex; flex-wrap:wrap; gap:6px; padding:11px 0 1px; }
        .ir-quicklinks button { display:flex; align-items:center; gap:6px; padding:6px 9px; border:1px solid rgba(189,204,234,.1); border-radius:20px; background:#17213a; color:#c2cce0; font-size:8px; }
        .ir-quicklinks svg { width:11px; height:11px; color:#a5b6f4; }
        .ir-shortcuts { margin-top:14px; }
        .ir-section-head { display:flex; justify-content:space-between; align-items:end; margin-bottom:8px; }
        .ir-kicker { color:#8294bc; font-size:7px; text-transform:uppercase; letter-spacing:.15em; font-weight:700; }
        .ir-section-head h2 { margin:2px 0 0; color:#edf0f7; font:600 12px 'Manrope',sans-serif; }
        .ir-add-shortcut { display:flex; align-items:center; gap:4px; border:0; background:none; color:#b7c4ed; font:inherit; font-size:8px; }
        .ir-add-shortcut svg { width:11px; height:11px; }
        .ir-shortcut-grid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:7px; }
        .ir-shortcut { display:grid; align-content:center; justify-items:center; gap:6px; min-height:66px; padding:7px; border:1px dashed rgba(178,195,229,.17); border-radius:10px; color:#aeb9ce; background:rgba(20,31,52,.54); font-size:8px; }
        .ir-shortcut.add svg { width:16px; height:16px; color:#a5b5e8; }
        .ir-widgets { display:grid; grid-template-columns:1fr 1fr; gap:9px; margin-top:13px; }
        .ir-widget,.ir-rail-panel { min-width:0; padding:12px; border:1px solid rgba(190,204,229,.1); border-radius:12px; background:linear-gradient(145deg,rgba(25,36,58,.96),rgba(16,27,46,.96)); }
        .ir-widget-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:9px; }
        .ir-widget-head h2,.ir-rail-head h2 { margin:2px 0 0; color:#edf0f7; font:600 11px 'Manrope',sans-serif; }
        .ir-small-link { display:flex; align-items:center; gap:3px; padding:0; border:0; color:#aebce7; background:none; font-size:8px; }
        .ir-small-link svg { width:10px; height:10px; }
        .ir-empty { display:grid; justify-items:center; align-content:center; min-height:96px; padding:8px; border:1px dashed rgba(178,194,225,.15); border-radius:8px; text-align:center; }
        .ir-empty-icon { display:grid; place-items:center; width:21px; height:21px; margin-bottom:5px; border:1px solid rgba(177,193,229,.18); border-radius:6px; color:#adbbe4; }
        .ir-empty-icon svg { width:11px; height:11px; }
        .ir-empty strong { color:#dce4f1; font-size:8px; }
        .ir-empty p { max-width:175px; margin:3px 0 6px; color:#8996ad; font-size:7px; line-height:1.45; }
        .ir-empty button { display:flex; align-items:center; gap:3px; padding:0; border:0; color:#b3c1ec; background:none; font-size:7px; }
        .ir-empty button svg { width:9px; height:9px; }
        .ir-quote { display:flex; align-items:center; gap:8px; margin-top:9px; padding:10px 12px; border:1px solid var(--ir-line); border-radius:10px; background:linear-gradient(100deg,#17253c,#202440); }
        .ir-quote-mark { color:#d5adb6; }
        .ir-quote blockquote { flex:1; margin:0; color:#c7cfdf; font:500 8px/1.5 'Manrope',sans-serif; }
        .ir-quote cite { color:#8c98ad; font-size:7px; font-style:normal; white-space:nowrap; }
        .ir-rail { display:grid; gap:9px; }
        .ir-rail-panel { padding:13px; }
        .ir-rail-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:9px; }
        .ir-rail-title { display:flex; align-items:center; gap:7px; }
        .ir-shield { display:grid; place-items:center; width:20px; height:20px; border:1px solid rgba(69,204,151,.22); border-radius:6px; color:#55d3a1; background:rgba(62,190,145,.1); }
        .ir-shield svg { width:11px; height:11px; }
        .ir-pill { padding:3px 6px; border:1px solid rgba(72,200,146,.2); border-radius:20px; color:#87dfb8; background:rgba(58,191,138,.08); font-size:7px; }
        .ir-school-mode { margin:2px 0 9px; color:#e2e8f4; font:600 9px 'Manrope',sans-serif; text-align:center; }
        .ir-study-ring { display:grid; place-content:center; justify-items:center; width:84px; height:84px; margin:9px auto 10px; border:4px solid #48cb98; border-radius:50%; box-shadow:0 0 0 4px rgba(72,203,152,.08),inset 0 0 16px rgba(72,203,152,.08); }
        .ir-study-ring strong { color:#f1f4fa; font:600 19px 'Manrope',sans-serif; }
        .ir-study-ring span { color:#a9b4c7; font-size:7px; }
        .ir-focus-copy { margin:0; color:#8e9bb1; font-size:8px; line-height:1.55; text-align:center; }
        .ir-school-button { width:100%; height:29px; margin-top:10px; border:1px solid rgba(138,163,224,.21); border-radius:7px; color:#e4eafa; background:#2a3d6d; font-size:8px; }
        .ir-school-more { display:flex; justify-content:center; align-items:center; gap:4px; margin:8px auto 0; border:0; color:#adbbe2; background:none; font-size:7px; }
        .ir-school-more svg { width:9px; height:9px; }
        .ir-coming-up { display:flex; align-items:center; justify-content:space-between; }
        .ir-upcoming-empty { display:grid; justify-items:center; padding:8px 2px 1px; text-align:center; }
        .ir-upcoming-empty svg { width:17px; height:17px; margin-bottom:6px; color:#a9b7e4; }
        .ir-upcoming-empty p { max-width:152px; margin:0; color:#8996ad; font-size:8px; line-height:1.5; }
        .ir-private-copy { margin:0; color:#909cb1; font-size:8px; line-height:1.6; }
        .ir-calculator { display:flex; justify-content:space-between; align-items:center; }
        .ir-calculator strong { display:flex; align-items:center; gap:7px; color:#e3e9f5; font:600 9px 'Manrope',sans-serif; }
        .ir-calculator strong svg { width:13px; height:13px; color:#aebdf0; }
        .ir-footer { display:flex; justify-content:center; gap:8px; padding-top:13px; color:#66758e; font-size:7px; }
        .ir-footer span+span:before { content:'·'; margin-right:8px; }
        @media(max-width:900px) {
          .ir-shell { grid-template-columns:136px minmax(0,1fr); }
          .ir-dashboard { grid-template-columns:minmax(0,1fr); }
          .ir-rail { grid-template-columns:1fr 1fr; }
          .ir-shortcut-grid { grid-template-columns:repeat(4,minmax(0,1fr)); }
        }
        @media(max-width:620px) {
          .ir-shell { grid-template-columns:54px minmax(0,1fr); }
          .ir-sidebar { align-items:center; padding:12px 5px; }
          .ir-brand { justify-content:center; padding:0 0 15px; }
          .ir-brand-copy,.ir-nav-label,.ir-nav button span,.ir-sidebar-bottom { display:none; }
          .ir-nav button { justify-content:center; padding:9px 4px; }
          .ir-content { padding:13px 10px 20px; }
          .ir-hero { min-height:230px; }
          .ir-hero-top { padding:21px 16px 0; }
          .ir-hero h1 { font-size:23px; }
          .ir-time strong { font-size:17px; }
          .ir-quicklinks { flex-wrap:nowrap; overflow:auto; }
          .ir-quicklinks button { flex:none; }
          .ir-shortcut-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
          .ir-widgets,.ir-rail { grid-template-columns:1fr; }
          .ir-quote { flex-wrap:wrap; }
          .ir-quote blockquote { min-width:calc(100% - 30px); }
          .ir-quote cite { margin-left:22px; }
        }
      `}</style>
      <div className="ir-shell">
        <aside className="ir-sidebar">
          <div className="ir-brand">
            <span className="ir-brand-mark"><Command size={16} /></span>
            <span className="ir-brand-copy"><span className="ir-brand-name">infinitesimal</span><span className="ir-brand-caption">quiet by design</span></span>
          </div>
          <div className="ir-nav-label">Workspace</div>
          <nav className="ir-nav" aria-label="Workspace">
            {navigation.slice(0, 6).map(({ label, Icon, active }) => <button className={active ? "active" : ""} key={label} type="button"><Icon /><span>{label}</span></button>)}
          </nav>
          <div className="ir-nav-label" style={{ marginTop: 15 }}>Library</div>
          <nav className="ir-nav" aria-label="Library">
            {navigation.slice(6).map(({ label, Icon }) => <button key={label} type="button"><Icon /><span>{label}</span></button>)}
          </nav>
          <div className="ir-sidebar-bottom">
            <nav className="ir-nav" aria-label="Settings">
              <button type="button"><Settings2 /><span>Settings</span></button>
              <button type="button"><Command /><span>Diagnostics</span></button>
            </nav>
            <div className="ir-privacy"><span style={{ display: "inline", color: "#75d7ac" }}>●</span> Quiet mode, by default<span>No ad network. No tracking pixels. Your workspace stays in this browser.</span></div>
            <div className="ir-profile"><span className="ir-avatar">S</span><span>Student<small>Personal workspace</small></span></div>
          </div>
        </aside>
        <main className="ir-main">
          <header className="ir-chrome">
            <div className="ir-tabs"><div className="ir-tab"><Home /><span>Home</span><span className="ir-tab-close">×</span></div><button className="ir-tool" aria-label="New tab" type="button"><Plus /></button></div>
            <div className="ir-toolbar">
              <button className="ir-tool" aria-label="Back" type="button"><ArrowLeft /></button>
              <button className="ir-tool" aria-label="Forward" type="button"><ArrowRight /></button>
              <button className="ir-tool" aria-label="Reload" type="button"><RotateCw /></button>
              <div className="ir-address"><Home /><span>Search Google or type a URL</span></div>
              <span className="ir-status"><ShieldCheck /> School Mode: Off</span>
            </div>
          </header>
          <div className="ir-content">
            <section className="ir-dashboard">
              <div className="ir-primary">
                <section className="ir-hero">
                  <Sunset />
                  <div className="ir-hero-top">
                    <div><div className="ir-date">A quieter place to begin</div><h1>{greeting}<br /><strong>Let’s make progress.</strong></h1><p>A browser for looking things up, keeping your schoolwork close, and tuning out the noise.</p></div>
                    <div className="ir-time"><strong>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(today)}</strong><span>{new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(today)}</span></div>
                  </div>
                  <form className="ir-search" onSubmit={(event) => event.preventDefault()}><Search /><input aria-label="Search the web or enter an address" placeholder="Search the web or enter an address" /><button aria-label="Search" type="submit"><ArrowUpRight /></button></form>
                </section>
                <nav className="ir-quicklinks" aria-label="Quick access">
                  <button type="button"><Search />Search</button><button type="button"><Sparkles />AI</button><button type="button"><School />School</button><button type="button"><NotebookPen />Notes</button><button type="button"><CheckCircle2 />Tasks</button><button type="button"><Calculator />Calculator</button><button type="button"><Languages />Translate</button>
                </nav>
                <section className="ir-shortcuts">
                  <div className="ir-section-head"><div><span className="ir-kicker">Your corner of the web</span><h2>Shortcuts</h2></div><button className="ir-add-shortcut" type="button"><Plus /> Add shortcut</button></div>
                  <div className="ir-shortcut-grid"><button className="ir-shortcut add" type="button"><Plus /><span>Add a website you use</span></button></div>
                </section>
                <div className="ir-widgets">
                  <section className="ir-widget"><div className="ir-widget-head"><div><span className="ir-kicker">A little at a time</span><h2>Today’s focus</h2></div><button className="ir-small-link" type="button">View all <ArrowUpRight /></button></div><div className="ir-empty"><span className="ir-empty-icon"><Check /></span><strong>Nothing in focus just yet</strong><p>Choose a task to keep close when you create or edit it.</p><button type="button">Open your task list <ArrowRight /></button></div></section>
                  <section className="ir-widget"><div className="ir-widget-head"><div><span className="ir-kicker">Keep what matters</span><h2>Notes</h2></div><button className="ir-small-link" type="button">Recent <ArrowUpRight /></button></div><div className="ir-empty"><span className="ir-empty-icon"><NotebookPen /></span><strong>A page with nothing on it yet</strong><p>Create a note for a class, a question, or a thought worth keeping.</p><button type="button">Create a note <ArrowRight /></button></div></section>
                </div>
                <section className="ir-quote"><span className="ir-quote-mark"><Sparkles size={12} /></span><blockquote>“The readiness is all.”</blockquote><cite>— William Shakespeare, Hamlet</cite></section>
                <div className="ir-footer"><span>Infinitesimal</span><span>Browse further. Do more.</span></div>
              </div>
              <aside className="ir-rail">
                <section className="ir-rail-panel">
                  <div className="ir-rail-head"><div className="ir-rail-title"><span className="ir-shield"><ShieldCheck /></span><h2>School Mode</h2></div><span className="ir-pill">Ready</span></div>
                  <div className="ir-school-mode">A quieter way to focus</div><div className="ir-study-ring"><strong>45:00</strong><span>session length</span></div><p className="ir-focus-copy">A timed session to help keep your attention on what matters. Your restrictions stay in your control.</p>
                  <button className="ir-school-button" type="button">Start 45-minute session <ArrowUpRight size={10} /></button>
                  <button className="ir-school-more" type="button">Customize restrictions <ArrowRight /></button>
                </section>
                <section className="ir-rail-panel">
                  <div className="ir-rail-head ir-coming-up"><h2>Coming up</h2><button className="ir-small-link" type="button">See all <ArrowUpRight /></button></div>
                  <div className="ir-upcoming-empty"><CalendarDays /><p>Your upcoming events and due dates will find a home here.</p></div>
                </section>
                <section className="ir-rail-panel"><div className="ir-rail-head"><h2>Outside, briefly</h2><span className="ir-pill">Optional</span></div><p className="ir-private-copy">Add a city in Settings to request current conditions.</p></section>
                <section className="ir-rail-panel"><div className="ir-rail-head"><h2>Yours, by default</h2><span className="ir-pill">Private</span></div><p className="ir-private-copy">Your notes, tasks, courses, events and bookmarks stay in this browser. No ad network, no tracking pixels.</p></section>
                <section className="ir-rail-panel ir-calculator"><strong><Calculator /> Calculator</strong><button className="ir-small-link" type="button">Open <ArrowUpRight /></button></section>
              </aside>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
