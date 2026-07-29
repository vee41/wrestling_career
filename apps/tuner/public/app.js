/* global document, clearTimeout, setTimeout, fetch, structuredClone, Blob, URL */

const controls = document.querySelector('#controls');
const results = document.querySelector('#results');
const status = document.querySelector('#status');
const verify = document.querySelector('#verify');
const reset = document.querySelector('#reset');
const exportButton = document.querySelector('#export');
let baseline;
let values;
let timer;
let requestId = 0;
let latestData;
let selectedSeedIndex = 0;
let selectedWrestlerId;
let sortKey = 'name';
let sortDirection = 1;
let tooltipOverlay;

const SPECS = {
  segmentPerformanceWeight:[0,1,.01], segmentCrowdWeight:[0,1,.01], segmentStoryWeight:[0,1,.01],
  overexposureFatigueFloor:[0,100,1], overexposurePenaltyFactor:[0,1,.01], reactionMaxStep:[0,30,1], reactionDecayStep:[0,20,1],
  popularityMaxStep:[1,10,1], momentumDecayFactor:[0,1,.01], momentumMemoryFactor:[0,1,.01], momentumSurpriseFactor:[0,1,.01], momentumPushFactor:[0,15,.25],
  popularityBand:[1,30,1], gravityFactor:[0,.3,.01], idleGravityFactor:[0,.03,.001], crowdIgnitionChance:[0,.6,.01],
  crowdIgnitionMomentumMin:[0,50,1], crowdIgnitionMomentumMax:[0,50,1], lossEdgeBase:[0,30,1], pleMainEventStarPowerGain:[0,25,1],
  sustainedMomentumStarPowerChange:[0,10,1], worldTitleWinStarPowerGain:[0,30,1], worldTitleLossStarPowerLoss:[0,30,1],
  midcardTitleWinStarPowerGain:[0,30,1], midcardTitleLossStarPowerLoss:[0,30,1], scarcityCrowdBonusMax:[0,30,1],
  scarcityStarPowerFloor:[0,100,1], relevanceGraceWeeks:[0,10,1], relevanceDecayRatePerWeek:[0,10,1], relevanceDecayCap:[0,50,1],
  relevanceHardFloor:[0,50,1], rubStarPowerGain:[0,15,1],
};
const TOOLTIPS = {
  segmentPerformanceWeight: 'Higher: in-ring performance has more influence on a match segment. Lower: performance matters less.',
  segmentCrowdWeight: 'Higher: crowd response has more influence on a match segment. Lower: crowd response matters less.',
  segmentStoryWeight: 'Higher: storyline advancement has more influence on a match segment. Lower: story progress matters less.',
  overexposureFatigueFloor: 'Higher: wrestlers need more fatigue before overexposure hurts them. Lower: overexposure penalties begin sooner.',
  overexposurePenaltyFactor: 'Higher: booking a fatigued wrestler too often hurts their segment more. Lower: overexposure has a softer penalty.',
  reactionMaxStep: 'Higher: the crowd reaction can move further after one appearance. Lower: crowd reactions change more gradually.',
  reactionDecayStep: 'Higher: crowd reactions settle back toward popularity faster while idle. Lower: reactions linger longer.',
  popularityMaxStep: 'Higher: one match can change general popularity by more. Lower: match-to-match popularity swings are capped tighter.',
  momentumDecayFactor: 'Higher: momentum persists longer between appearances. Lower: momentum fades faster while idle.',
  momentumMemoryFactor: 'Higher: existing momentum carries more into the next match. Lower: each match resets momentum more.',
  momentumSurpriseFactor: 'Higher: above- or below-expectation results move momentum more. Lower: surprise results matter less.',
  momentumPushFactor: 'Higher: momentum converts into general popularity more strongly. Lower: momentum produces smaller popularity movement.',
  popularityBand: 'Higher: a hot streak can rise further above earned star power. Lower: general popularity stays closer to earned status.',
  gravityFactor: 'Higher: an appearance pulls popularity toward earned star power more strongly. Lower: match outcomes dominate that pull.',
  idleGravityFactor: 'Higher: idle wrestlers drift toward their relevance-adjusted anchor faster. Lower: absence changes popularity more slowly.',
  crowdIgnitionChance: 'Higher: more matches trigger a random crowd-ignition momentum boost. Lower: ignition moments are rarer.',
  crowdIgnitionMomentumMin: 'Higher: every crowd-ignition boost starts stronger. Lower: ignition boosts can start smaller.',
  crowdIgnitionMomentumMax: 'Higher: the strongest possible crowd-ignition boost is larger. Lower: ignition spikes are capped lower.',
  lossEdgeBase: 'Higher: losses carry a larger baseline momentum penalty. Lower: ordinary losses are less damaging.',
  pleMainEventStarPowerGain: 'Higher: a strong PLE main event grants more lasting star power. Lower: that milestone gives less status.',
  sustainedMomentumStarPowerChange: 'Higher: a three-week sustained slump removes more lasting star power. Lower: long slumps damage status less.',
  worldTitleWinStarPowerGain: 'Higher: winning a world title grants more lasting star power. Lower: the title-win status boost is smaller.',
  worldTitleLossStarPowerLoss: 'Higher: losing a world title costs more lasting star power. Lower: title losses are less damaging to status.',
  midcardTitleWinStarPowerGain: 'Higher: winning a midcard title grants more lasting star power. Lower: the title-win status boost is smaller.',
  midcardTitleLossStarPowerLoss: 'Higher: losing a midcard title costs more lasting star power. Lower: title losses are less damaging to status.',
  scarcityCrowdBonusMax: 'Higher: rare appearances can add a larger scarcity bonus to the segment. Lower: rarity creates less extra buzz.',
  scarcityStarPowerFloor: 'Higher: only more established stars receive a scarcity bonus. Lower: more wrestlers can benefit from rare appearances.',
  relevanceGraceWeeks: 'Higher: regular wrestlers can be absent longer before relevance decay begins. Lower: absence starts hurting relevance sooner.',
  relevanceDecayRatePerWeek: 'Higher: a regular wrestler loses relevance faster after the grace period. Lower: relevance decays more slowly.',
  relevanceDecayCap: 'Higher: long absences can reduce the relevance anchor by more. Lower: the total absence penalty is capped sooner.',
  relevanceHardFloor: 'Higher: relevance cannot pull an absent wrestler below a higher popularity anchor. Lower: absence can settle at a lower anchor.',
  rubStarPowerGain: 'Higher: beating a legend or part-timer grants more lasting star power. Lower: that rare-opponent rub is smaller.',
};
const label = (key) => key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
const number = (value) => Number.isInteger(value) ? String(value) : Number(value).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');

function dismissTooltip() {
  tooltipOverlay?.remove();
  tooltipOverlay = undefined;
}

function showTooltip(target) {
  dismissTooltip();
  const bounds = target.getBoundingClientRect();
  const popover = document.createElement('div');
  popover.className = 'tooltip-popover';
  popover.setAttribute('role', 'tooltip');
  popover.textContent = target.dataset.tooltip;
  const maxLeft = document.documentElement.clientWidth - 270;
  const maxTop = document.documentElement.clientHeight - 120;
  popover.style.left = `${Math.max(8, Math.min(bounds.right + 10, maxLeft))}px`;
  popover.style.top = `${Math.max(8, Math.min(bounds.top - 4, maxTop))}px`;
  document.body.append(popover);
  tooltipOverlay = popover;
}

function renderControls() {
  dismissTooltip();
  controls.innerHTML = Object.entries(values).filter(([key, value]) => typeof value === 'number' && SPECS[key]).map(([key, value]) => {
    const [min,max,step] = SPECS[key];
    return `<div class="control"><div class="label-line"><label for="${key}">${label(key)}</label><output id="${key}-value">${number(value)}</output></div><input id="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"><div class="hint">${min}–${max}</div></div>`;
  }).join('');
  for (const optionLabel of controls.querySelectorAll('label')) {
    optionLabel.title = TOOLTIPS[optionLabel.htmlFor];
    const tooltip = document.createElement('span');
    tooltip.className = 'tooltip';
    tooltip.tabIndex = 0;
    tooltip.setAttribute('role', 'img');
    tooltip.setAttribute('aria-label', TOOLTIPS[optionLabel.htmlFor]);
    tooltip.dataset.tooltip = TOOLTIPS[optionLabel.htmlFor];
    tooltip.textContent = '?';
    tooltip.addEventListener('mouseenter', () => showTooltip(tooltip));
    tooltip.addEventListener('mouseleave', dismissTooltip);
    tooltip.addEventListener('focus', () => showTooltip(tooltip));
    tooltip.addEventListener('blur', dismissTooltip);
    optionLabel.after(tooltip);
  }
  for (const input of controls.querySelectorAll('input')) input.addEventListener('input', event => {
    values[event.target.id] = Number(event.target.value);
    document.querySelector(`#${event.target.id}-value`).value = number(values[event.target.id]);
    clearTimeout(timer); timer = setTimeout(() => run(1), 180);
  });
}

function spark(samples) {
  const low = Math.min(...samples), high = Math.max(...samples), span = Math.max(1, high-low);
  return samples.map((value,index) => `${(index/(samples.length-1))*100},${21-((value-low)/span)*18}`).join(' ');
}
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
const delta = (value) => `${value > 0 ? '+' : ''}${value}`;
function sortedWrestlers(wrestlers) {
  return wrestlers.slice().sort((a, b) => {
    const left = sortKey === 'delta' ? a.end - a.start : a[sortKey];
    const right = sortKey === 'delta' ? b.end - b.start : b[sortKey];
    const comparison = typeof left === 'string' ? left.localeCompare(right) : left - right;
    return comparison === 0 ? a.name.localeCompare(b.name) : comparison * sortDirection;
  });
}
function sortHeader(key, text) {
  const active = key === sortKey;
  const arrow = active ? (sortDirection === 1 ? ' ▲' : ' ▼') : '';
  return `<button class="sort-header" type="button" data-sort-key="${key}" aria-sort="${active ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'}">${text}${arrow}</button>`;
}
function criterionCards(criteria, descriptions) {
  return criteria.map(item => {
    const tooltip = descriptions?.[item.id] ?? '';
    return `<article class="stat signal-stat"><span class="option-label">${item.id} <small>[${item.strength}]</small><span class="tooltip" tabindex="0" role="img" aria-label="${escapeHtml(tooltip)}" data-tooltip="${escapeHtml(tooltip)}">?</span></span><b class="${item.pass ? 'pass' : 'fail'}">${item.pass ? 'PASS' : 'FAIL'}</b><small>${escapeHtml(item.observed)}${item.detail ? `<br>${escapeHtml(item.detail)}` : ''}</small></article>`;
  }).join('');
}
function crossSeedCard(label, value, tooltip, tone) {
  return `<article class="stat signal-stat"><span class="option-label">${label}<span class="tooltip" tabindex="0" role="img" aria-label="${escapeHtml(tooltip)}" data-tooltip="${escapeHtml(tooltip)}">?</span></span><b${tone ? ` class="${tone}"` : ''}>${value}</b></article>`;
}
function crossSeedCards(crossSeed, volatility, criterionDescriptions, signalDescriptions) {
  return [
    crossSeedCard('Winner variety (SL-10)', crossSeed.pass ? 'PASS' : 'FAIL', `${criterionDescriptions?.['SL-10'] ?? ''} Observed: ${crossSeed.observed}`, crossSeed.pass ? 'pass' : 'fail'),
    crossSeedCard('Rise-count spread (SL-1)', volatility.risesRange.join('-'), signalDescriptions?.risesRange ?? ''),
    crossSeedCard('Fall-count spread (SL-2)', volatility.fallsRange.join('-'), signalDescriptions?.fallsRange ?? ''),
    crossSeedCard('Swing-share spread (SL-3)', volatility.nonMonotonicShareRange.map(v => `${Math.round(v * 100)}%`).join('-'), signalDescriptions?.nonMonotonicShareRange ?? ''),
  ].join('');
}
const SIGNAL_ROWS = [
  ['topTierCount', 'Top tier (88+)', v => String(v)],
  ['popularitySpreadStdDev', 'Popularity spread', v => v.toFixed(1)],
  ['rankStability', 'Rank stability', v => v.toFixed(2)],
  ['skillPopularityCorrelation', 'Skill/popularity corr.', v => v.toFixed(2)],
  ['starPowerRunningHotCount', 'Running hot', v => String(v)],
  ['starPowerSuppressedCount', 'Suppressed', v => String(v)],
  ['unresolvedStoryCount', 'Unresolved stories', v => String(v)],
];
function signalCards(signals, descriptions) {
  return SIGNAL_ROWS.map(([key, label, format]) => `<article class="stat signal-stat"><span class="option-label">${label}<span class="tooltip" tabindex="0" role="img" aria-label="${escapeHtml(descriptions[key] ?? '')}" data-tooltip="${escapeHtml(descriptions[key] ?? '')}">?</span></span><b>${format(signals[key])}</b></article>`).join('');
}
function attachTooltips(container) {
  for (const tooltip of container.querySelectorAll('.tooltip')) {
    tooltip.addEventListener('mouseenter', () => showTooltip(tooltip));
    tooltip.addEventListener('mouseleave', dismissTooltip);
    tooltip.addEventListener('focus', () => showTooltip(tooltip));
    tooltip.addEventListener('blur', dismissTooltip);
  }
}
function appendPopularityTotals(totals) {
  const summary = results.querySelector('#popularity-totals');
  const statistics = [
    ['Popularity gained', delta(totals.gains), 'pass', 'Roster weekly increases'],
    ['Popularity lost', delta(totals.losses), 'fail', 'Roster weekly decreases'],
    ['Company net', delta(totals.net), totals.net > 0 ? 'pass' : totals.net < 0 ? 'fail' : '', 'Gains plus losses'],
  ];
  for (const [heading, value, tone, detail] of statistics) {
    const card = document.createElement('div');
    card.className = 'stat';
    const title = document.createElement('span');
    title.textContent = heading;
    const amount = document.createElement('b');
    amount.className = tone;
    amount.textContent = value;
    const note = document.createElement('small');
    note.textContent = detail;
    card.append(title, amount, note);
    summary.append(card);
  }
}
function detailView(wrestler) {
  if (!wrestler) return '<div class="detail-empty">Select a wrestler to inspect their popularity history.</div>';
  const change = wrestler.end - wrestler.start;
  const entries = wrestler.popularityLog.length === 0 ? '<li class="detail-empty">No reported popularity or status changes in this slice.</li>' : wrestler.popularityLog.map(entry => {
    const statusEntry = entry.kind === 'status';
    const title = statusEntry ? 'Status milestone' : `${entry.won ? 'Won' : 'Lost'} vs. ${entry.opponentNames.join(', ') || 'opposition'}`;
    const context = statusEntry
      ? `Star power ${entry.before} to ${entry.after}${entry.summary ? ` · ${entry.summary}` : ''}`
      : `Popularity ${entry.before} to ${entry.after}${entry.titleName ? ` · ${entry.titleName}` : ''}${entry.showKind ? ` · ${entry.showKind.toUpperCase()}` : ''}${entry.reason ? ` · ${label(entry.reason)}` : ''}`;
    return `<li><div class="log-title"><span>Week ${entry.week} · ${escapeHtml(title)}</span><span class="delta ${entry.delta > 0 ? 'positive' : entry.delta < 0 ? 'negative' : ''}">${delta(entry.delta)}</span></div><div class="log-meta">${escapeHtml(context)}</div></li>`;
  }).join('');
  return `<h2>${escapeHtml(wrestler.name)}</h2><div class="detail-stat"><div><span>Start</span><b>${wrestler.start}</b></div><div><span>End</span><b>${wrestler.end}</b></div><div><span>Change</span><b class="${change > 0 ? 'pass' : change < 0 ? 'fail' : ''}">${delta(change)}</b></div></div><h2>Why popularity changed</h2><p>Match entries track general popularity. Status milestones track earned star power separately.</p><ul class="log-list">${entries}</ul>`;
}
function render(data) {
  latestData = data;
  const run = data.runs[selectedSeedIndex] || data.runs[0];
  selectedSeedIndex = data.runs.indexOf(run);
  if (!run.wrestlers.some(wrestler => wrestler.id === selectedWrestlerId)) selectedWrestlerId = run.wrestlers[0]?.id;
  const selected = run.wrestlers.find(wrestler => wrestler.id === selectedWrestlerId);
  const rows = sortedWrestlers(run.wrestlers).map(wrestler => {
    const change = wrestler.end - wrestler.start;
    return `<tr class="wrestler-row ${wrestler.id === selectedWrestlerId ? 'selected' : ''}" data-wrestler-id="${wrestler.id}"><td><button type="button" data-wrestler-id="${wrestler.id}">${escapeHtml(wrestler.name)}</button></td><td>${wrestler.start}</td><td>${wrestler.end}</td><td class="delta ${change > 0 ? 'positive' : change < 0 ? 'negative' : ''}">${delta(change)}</td><td>${wrestler.range}</td><td><svg class="mini-chart" viewBox="0 0 100 24" preserveAspectRatio="none"><polyline fill="none" stroke="#85b8ff" stroke-width="2" points="${spark(wrestler.samples)}"/></svg></td></tr>`;
  }).join('');
  results.innerHTML = `<article class="panel criterion-panel"><h2>Popularity totals (this seed)</h2><div class="summary" id="popularity-totals"></div></article><article class="panel criterion-panel"><h2>Cross-seed <small class="hint">(across all simulated seeds, advisory)</small></h2><p class="cross-seed-intro">${escapeHtml(data.crossSeedIntro ?? '')}</p><div class="summary signal-summary">${crossSeedCards(data.crossSeed, data.volatility, data.criterionDescriptions ?? {}, data.signalDescriptions ?? {})}</div></article><div class="seed-picker"><h2>Slice results</h2><label>Seed <select id="seed-select">${data.runs.map((candidate,index) => `<option value="${index}" ${index === selectedSeedIndex ? 'selected' : ''}>${candidate.seed}</option>`).join('')}</select></label></div><article class="panel criterion-panel"><h2>Criteria <small class="hint">(this seed, advisory)</small></h2><div class="summary signal-summary">${criterionCards(run.criteria, data.criterionDescriptions ?? {})}</div></article><article class="panel criterion-panel"><h2>Health signals</h2><div class="summary signal-summary">${signalCards(run.signals, data.signalDescriptions ?? {})}</div></article><div class="roster-layout"><article class="panel"><h2>All wrestlers</h2><p>Click a row to inspect every reported popularity and status change.</p><div class="table-wrap"><table class="roster-table"><thead><tr><th>${sortHeader('name', 'Wrestler')}</th><th>${sortHeader('start', 'Start')}</th><th>${sortHeader('end', 'End')}</th><th>${sortHeader('delta', 'Δ')}</th><th>${sortHeader('range', 'Range')}</th><th>Trend</th></tr></thead><tbody>${rows}</tbody></table></div></article><article class="panel detail" id="wrestler-detail">${detailView(selected)}</article></div>`;
  appendPopularityTotals(run.popularityTotals);
  document.querySelector('#seed-select').addEventListener('change', event => { selectedSeedIndex = Number(event.target.value); selectedWrestlerId = undefined; render(latestData); });
  for (const button of results.querySelectorAll('button[data-sort-key]')) button.addEventListener('click', event => { const nextKey = event.currentTarget.dataset.sortKey; if (sortKey === nextKey) sortDirection *= -1; else { sortKey = nextKey; sortDirection = nextKey === 'name' ? 1 : -1; } render(latestData); });
  for (const button of results.querySelectorAll('button[data-wrestler-id]')) button.addEventListener('click', event => { selectedWrestlerId = event.currentTarget.dataset.wrestlerId; render(latestData); });
  attachTooltips(results);
}
async function run(seedCount) {
  const active = ++requestId; status.textContent = `Simulating ${seedCount} seed${seedCount === 1 ? '' : 's'}…`; verify.disabled = true; results.classList.add('loading');
  try {
    const response = await fetch('/api/run', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({popularity:values,seedCount})});
    const data = await response.json(); if (active !== requestId) return; if (!response.ok) throw new Error(data.error);
    render(data); status.textContent = `Finished ${seedCount} deterministic 26-week slice${seedCount === 1 ? '' : 's'}.`;
  } catch (error) { if (active === requestId) status.textContent = `Run failed: ${error.message}`; }
  finally { if (active === requestId) { verify.disabled = false; results.classList.remove('loading'); } }
}

const data = await fetch('/api/config').then(response => response.json());
baseline = data.popularity; values = structuredClone(baseline); document.querySelector('#scenario').textContent = `${data.scenario} · local deterministic popularity tuner`;
renderControls(); run(1);
verify.addEventListener('click', () => run(3));
reset.addEventListener('click', () => { values = structuredClone(baseline); renderControls(); run(1); });
exportButton.addEventListener('click', () => { const blob = new Blob([JSON.stringify({ popularity: values }, null, 2)], {type:'application/json'}); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'popularity-tuning.json'; link.click(); URL.revokeObjectURL(url); });
