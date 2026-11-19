export const icons:Record<string,string>={
 bus:'<rect x="5" y="3" width="14" height="16" rx="3"/><path d="M5 7h14M5 13h14M8 19v2m8-2v2M8 16h.01M16 16h.01"/>',
 wheel:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="m4 8 6 3m10-3-6 3m-2 3v7"/>',
 arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',chevron:'<path d="m9 5 7 7-7 7"/>',
 settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
 moon:'<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>',
 cloud:'<path d="M5 16a4 4 0 0 1 0-8 6 6 0 0 1 11-2 5 5 0 0 1 2 10ZM7 19l-1 2m6-2-1 2m6-2-1 2"/>',
 map:'<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16"/>',
 engine:'<path d="M4 8h12l4 4v6H4V8ZM8 4h6m-3 0v4M1 11v5m20-5h2v7"/>',
 parking:'<circle cx="12" cy="12" r="8"/><path d="M10 17V7h3a3 3 0 0 1 0 6h-3M2 5a15 15 0 0 0 0 14M22 5a15 15 0 0 1 0 14"/>',
 doors:'<path d="M3 3h18v18H3Zm9 0v18M7 8v8m10-8v8"/>',
 lights:'<path d="M12 5a7 7 0 0 1 0 14V5Zm-4 1H2m6 4H1m7 4H1m7 4H2"/>',
 wipers:'<path d="M3 4h18l2 12H1ZM5 16l9-9m-5 9 9-9"/>',
 hazards:'<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3h.01"/>',
 retarder:'<circle cx="12" cy="12" r="8"/><path d="M8 16V8h4a3 3 0 0 1 0 6H8m4 0 4 3"/>',
 horn:'<path d="M4 10h5l9-6v16l-9-6H4Zm17-2a7 7 0 0 1 0 8"/>',
 radio:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="m5 7 13-5M7 12h10"/><circle cx="8" cy="17" r="1"/><path d="M13 17h4"/>',
 ramp:'<path d="M2 19h20L7 9v10M7 5V2m3 3H7"/>',
 camera:'<rect x="2" y="6" width="20" height="15" rx="2"/><circle cx="12" cy="13" r="4"/><path d="m7 6 2-3h6l2 3"/>',
 pause:'<path d="M8 4v16M16 4v16"/>',play:'<path d="m7 3 14 9-14 9Z"/>',
 check:'<path d="m4 12 5 5L20 6"/>',close:'<path d="m5 5 14 14M5 19 19 5"/>',
 fuel:'<path d="M3 21V4h11v17M3 10h11M1 21h15m-2-15 6 6v6a2 2 0 0 0 4 0V9l-4-4"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
 shield:'<path d="m12 2 9 4v6q0 6-9 10-9-4-9-10V6l9-4Z"/><path d="m8 12 3 3 5-6"/>',
 back:'<path d="M20 12H4m6-6-6 6 6 6"/>',
 ticket:'<path d="M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4V5Zm12 0v14"/>',
 history:'<path d="M3 11a9 9 0 1 1 2 7M3 5v6h6m3-4v6l4 2"/>',
 mirror:'<rect x="5" y="2" width="14" height="17" rx="3"/><path d="M12 19v3M8 13l8-7"/>',
};
export const icon=(name:string,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]??icons.bus}</svg>`;
export const trackMap=`<svg viewBox="0 0 180 230" class="track-svg" aria-label="Proving ground oval track"><path class="map-road" d="M40 165V65a50 50 0 0 1 100 0v100a50 50 0 0 1-100 0Z"/><path class="map-dash" d="M40 165V65a50 50 0 0 1 100 0v100a50 50 0 0 1-100 0Z"/><rect x="71" y="93" width="39" height="27" rx="3" fill="currentColor" opacity=".13"/><text x="90" y="140" text-anchor="middle">DEPOT</text><circle id="map-dot" cx="40" cy="150" r="6" fill="#b9e877" stroke="#173a2e" stroke-width="3"/><path d="M27 153h26" stroke="currentColor" stroke-width="2"/></svg>`;
export const controls:[string,string,string][]=[['ignition','Engine','I'],['parking','Parking','P'],['doors','Doors','O'],['lights','Lights','L'],['wipers','Wipers','V'],['hazards','Hazards','H'],['left','Left','Z'],['right','Right','X'],['retarder','Retarder','R'],['horn','Horn','B'],['radio','Radio','N'],['ramp','Ramp','U']];
export function shell(){return `
  <canvas id="scene" aria-label="Interactive 3D bus and test track"></canvas>
  <div id="loading"><span class="loader"></span><strong>Preparing your bus</strong><small>Building the proving ground…</small></div>
  <header class="topbar"><a class="brand" href="#" id="brand"><span class="brand-mark">${icon('bus')}</span><span>CITYBUS<span class="brand-sub">D R I V E R</span></span></a><nav aria-label="Main navigation"><button data-nav="drive" class="nav active">Driving centre</button><button data-nav="garage" class="nav">My garage <span class="count">01</span></button><button data-nav="logbook" class="nav">Logbook</button></nav><div class="top-right"><span class="local-tag"><i></i> LOCAL DRIVER</span><button id="settings" class="icon-button" title="Settings" aria-label="Settings">${icon('settings')}</button><span class="avatar">JD</span></div></header>
  <main id="home">
    <div class="hero-copy" id="home-copy"><div class="eyebrow"><span class="line"></span> YOUR NEXT CHAPTER IS ON THE ROAD</div><h1>Every journey<br> starts with <em>you.</em></h1><p class="lead">Take the wheel. Feel the road.<br> Make every stop matter.</p>
      <article class="route-card"><div class="route-icon">${icon('map')}</div><div><span class="eyebrow">DRIVING FOUNDATION · 01</span><h2>The proving ground</h2><p>A quiet track. A proper introduction.</p></div><span class="small-pill">FREE DRIVE</span><div class="route-specs"><span>${icon('wheel')} Full vehicle simulation</span><span>${icon('shield')} No traffic. No pressure.</span></div></article>
      <button class="primary start-button" id="start">Take the wheel ${icon('arrow')}</button><button class="text-button" id="tutorial">First time? Start the guided walkthrough ${icon('chevron')}</button>
      <div class="device-note"><span>W A S D</span> Keyboard <i>·</i> Touch <i>·</i> Gamepad</div>
    </div>
    <div class="hero-copy hidden" id="garage-copy"><div class="eyebrow"><span class="line"></span> YOUR BUS. YOUR WAY.</div><h1>A little more<br><em>personal.</em></h1><p class="lead">CB 120 · Low-floor city bus<br>Fictional model. Real physics.</p><section class="garage-panel"><h2>Exterior finish</h2><div id="swatches"></div><label>Test ballast <output id="load-value">0 kg</output><input id="load" type="range" min="0" max="5000" step="250" value="0"></label><p class="muted">Ballast changes the actual chassis mass, suspension load and tire grip. It is not a passenger simulation.</p><label>Transmission<select id="garage-transmission"><option value="auto">6-speed automatic</option><option value="manual">6-speed manual + clutch</option></select></label></section><button class="primary" id="garage-start">Drive this bus ${icon('arrow')}</button></div>
    <div class="scene-label"><span class="status-dot"></span> LIVE 3D PREVIEW <span class="label-divider"></span> DRAG TO EXPLORE</div>
    <div class="scene-weather"><span>${icon('sun')} <b id="home-weather">Clear afternoon</b></span><button id="conditions">Change conditions ${icon('chevron')}</button></div>
    <section class="bus-info"><div><div class="eyebrow">READY FOR YOUR FIRST SHIFT</div><h2>CB <span>120</span><small>City series</small></h2></div><div class="spec"><strong>12.0 <small>m</small></strong><span>LENGTH</span></div><div class="spec"><strong>12,000 <small>kg</small></strong><span>BASE MASS</span></div><div class="spec"><strong>1,200 <small>N·m</small></strong><span>PEAK TORQUE</span></div><button id="inspect-bus" class="round-button" title="Customize bus" aria-label="Customize bus">${icon('arrow')}</button></section>
    <footer class="home-footer"><span><i></i> Local single-player · saved on this device</span><span>PROVING GROUND <b>/</b> DEVELOPMENT BUILD 0.1</span></footer>
  </main>
  <section id="drive-ui" class="hidden" aria-label="Driving controls">
    <div class="drive-top"><article class="route-hud"><span class="route-number">01</span><div><span class="eyebrow">PROVING GROUND</span><strong>Find your rhythm.</strong><span id="route-status">Start the engine to begin</span></div><button id="map-toggle" class="icon-button" aria-label="Toggle track map">${icon('map')}</button></article><div class="drive-tools"><button id="view" title="Camera (C)">${icon('camera')}<span id="view-label">Cockpit</span></button><button id="drive-settings" aria-label="Driving settings">${icon('settings')}</button><button id="pause" aria-label="Pause (Escape)">${icon('pause')}</button></div></div>
    <div class="minimap hidden" id="minimap">${trackMap}<span>TEST TRACK · 554 m</span></div>
    <div id="walkthrough" class="walkthrough hidden"><span class="eyebrow">GET COMFORTABLE</span><h3 id="lesson-title">01 / Start your engine</h3><p id="lesson-body">Press I or tap Engine. You can also click the ignition button in the 3D cockpit.</p><div class="lesson-progress"><i></i><i></i><i></i><i></i><i></i></div><button id="skip-tutorial" class="text-button">Dismiss walkthrough</button></div>
    <div class="drive-bottom"><div class="instrument-panel"><div class="speed-ring"><div><strong id="speed">0</strong><span>km/h</span></div><span class="gear" id="gear">N</span></div><div class="instrument-data"><div class="rpm-row"><span id="rpm">0</span> RPM <span id="engine-status">ENGINE OFF</span></div><div class="rpm-meter"><i id="rpm-fill"></i></div><div class="telemetry"><span>AIR <strong id="air">8.0</strong><small>bar</small></span><span>FUEL <strong id="fuel">210</strong><small>L</small></span><span>TEMP <strong id="temp">65</strong><small>°C</small></span></div><div class="status-row"><span id="parking-light">Ⓟ PARK</span><span id="door-light">DOORS</span><span id="abs-light">ABS</span><span id="surface">DRY</span></div></div></div>
      <div class="controls-area"><div class="control-toolbar"><span>YOUR COCKPIT <small>Click a control or use its key</small></span><button id="ticket-open" title="Ticket machine practice">${icon('ticket')}</button><button id="mirror-open" title="Adjust mirrors">${icon('mirror')}</button><button id="controls-toggle" aria-label="Expand or collapse controls">${icon('settings')}</button></div><div id="control-grid">${controls.map(([a,label,key])=>`<button class="control" data-action="${a}" title="${label} (${key})" aria-label="${label} (${key})" aria-pressed="false">${icon(a==='ignition'?'engine':a==='left'?'back':a==='right'?'arrow':a)}<span>${label}</span><kbd>${key}</kbd></button>`).join('')}</div><div class="transmission"><button data-action="gearDown" title="Downshift (Q)">− <kbd>Q</kbd></button><button data-action="automatic" id="transmission-mode" title="Switch transmission (M)">AUTOMATIC</button><button data-action="gearUp" title="Upshift (E)">+ <kbd>E</kbd></button><label class="clutch-control">CLUTCH<input id="clutch" type="range" min="0" max="1" step=".01" value="0"></label></div></div>
    </div>
    <div class="touch-driving"><div class="touch-steer"><button data-hold="steer:1" aria-label="Steer left">${icon('back')}</button><button data-hold="steer:-1" aria-label="Steer right">${icon('arrow')}</button></div><div class="touch-pedals"><button data-hold="brake:1" class="brake">BRAKE</button><button data-hold="throttle:1" class="throttle">DRIVE</button></div></div>
    <div class="drive-footer"><span id="input-status">W/S · pedals &nbsp; A/D · steer &nbsp; C · camera &nbsp; drag · look</span><span id="session-distance">0.00 km</span><span id="fps">60 FPS</span></div>
  </section>
  <div id="toast" role="status" aria-live="polite"></div><div id="tooltip" class="hidden"></div>
  <dialog id="dialog"><div class="dialog-header"><span class="eyebrow" id="dialog-kicker">CITYBUS DRIVER</span><button id="dialog-close" class="icon-button" aria-label="Close dialog">${icon('close')}</button></div><div id="dialog-content"></div></dialog>
`;}
