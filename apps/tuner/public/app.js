/* global document, clearTimeout, setTimeout, fetch, structuredClone, Blob, URL */

const controls = document.querySelector('#controls');
const controlsTitle = document.querySelector('#controls-title');
const controlsBlurb = document.querySelector('#controls-blurb');
const tabs = document.querySelector('#tabs');
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
let activeGroup = 'popularity';
let selectedSeedIndex = 0;
let selectedWrestlerId;
let sortKey = 'name';
let sortDirection = 1;
let tooltipOverlay;

// A control spec is one of: [min,max,step] (slider) · {type:'bool'} · {type:'enum',options}.
const BOOL = { type: 'bool' };
const TITLE_ELIGIBILITY = { type: 'enum', options: ['none', 'all', 'midcard'] };

const POPULARITY_FIELDS = {
  segmentPerformanceWeight: { spec: [0, 1, .01], tip: 'Higher: in-ring performance has more influence on a match segment. Lower: performance matters less.' },
  segmentCrowdWeight: { spec: [0, 1, .01], tip: 'Higher: crowd response has more influence on a match segment. Lower: crowd response matters less.' },
  segmentStoryWeight: { spec: [0, 1, .01], tip: 'Higher: storyline advancement has more influence on a match segment. Lower: story progress matters less.' },
  overexposureFatigueFloor: { spec: [0, 100, 1], tip: 'Higher: wrestlers need more fatigue before overexposure hurts them. Lower: overexposure penalties begin sooner.' },
  overexposurePenaltyFactor: { spec: [0, 1, .01], tip: 'Higher: booking a fatigued wrestler too often hurts their segment more. Lower: overexposure has a softer penalty.' },
  reactionMaxStep: { spec: [0, 30, 1], tip: 'Higher: the crowd reaction can move further after one appearance. Lower: crowd reactions change more gradually.' },
  reactionDecayStep: { spec: [0, 20, 1], tip: 'Higher: crowd reactions settle back toward popularity faster while idle. Lower: reactions linger longer.' },
  popularityMaxStep: { spec: [1, 10, 1], tip: 'Higher: one match can change general popularity by more. Lower: match-to-match popularity swings are capped tighter.' },
  momentumDecayFactor: { spec: [0, 1, .01], tip: 'Higher: momentum persists longer between appearances. Lower: momentum fades faster while idle.' },
  momentumMemoryFactor: { spec: [0, 1, .01], tip: 'Higher: existing momentum carries more into the next match. Lower: each match resets momentum more.' },
  momentumSurpriseFactor: { spec: [0, 1, .01], tip: 'Higher: above- or below-expectation results move momentum more. Lower: surprise results matter less.' },
  momentumPushFactor: { spec: [0, 15, .25], tip: 'Higher: momentum converts into general popularity more strongly. Lower: momentum produces smaller popularity movement.' },
  popularityBand: { spec: [1, 30, 1], tip: 'Higher: a hot streak can rise further above earned star power. Lower: general popularity stays closer to earned status.' },
  gravityFactor: { spec: [0, .3, .01], tip: 'Higher: an appearance pulls popularity toward earned star power more strongly. Lower: match outcomes dominate that pull.' },
  idleGravityFactor: { spec: [0, .03, .001], tip: 'Higher: idle wrestlers drift toward their relevance-adjusted anchor faster. Lower: absence changes popularity more slowly.' },
  crowdIgnitionChance: { spec: [0, .6, .01], tip: 'Higher: more matches trigger a random crowd-ignition momentum boost. Lower: ignition moments are rarer.' },
  crowdIgnitionMomentumMin: { spec: [0, 50, 1], tip: 'Higher: every crowd-ignition boost starts stronger. Lower: ignition boosts can start smaller.' },
  crowdIgnitionMomentumMax: { spec: [0, 50, 1], tip: 'Higher: the strongest possible crowd-ignition boost is larger. Lower: ignition spikes are capped lower.' },
  lossEdgeBase: { spec: [0, 30, 1], tip: 'Higher: losses carry a larger baseline momentum penalty. Lower: ordinary losses are less damaging.' },
  segmentDominantEdgeFactor: { spec: [0, .5, .01], tip: 'Higher: out-talking a bigger star in a segment is worth more of the popularity gap. Lower: dominating a promo means less.' },
  segmentNonDominantEdge: { spec: [-5, 0, 1], tip: 'More negative: losing a promo exchange costs momentum like a clean loss. Zero: an appearance is never a burial.' },
  pleMainEventStarPowerGain: { spec: [0, 25, 1], tip: 'Higher: a strong PLE main event grants more lasting star power. Lower: that milestone gives less status.' },
  sustainedMomentumStarPowerChange: { spec: [0, 10, 1], tip: 'Higher: a three-week sustained slump removes more lasting star power. Lower: long slumps damage status less.' },
  worldTitleWinStarPowerGain: { spec: [0, 30, 1], tip: 'Higher: winning a world title grants more lasting star power. Lower: the title-win status boost is smaller.' },
  worldTitleLossStarPowerLoss: { spec: [0, 30, 1], tip: 'Higher: losing a world title costs more lasting star power. Lower: title losses are less damaging to status.' },
  midcardTitleWinStarPowerGain: { spec: [0, 30, 1], tip: 'Higher: winning a midcard title grants more lasting star power. Lower: the title-win status boost is smaller.' },
  midcardTitleLossStarPowerLoss: { spec: [0, 30, 1], tip: 'Higher: losing a midcard title costs more lasting star power. Lower: title losses are less damaging to status.' },
  scarcityCrowdBonusMax: { spec: [0, 30, 1], tip: 'Higher: rare appearances can add a larger scarcity bonus to the segment. Lower: rarity creates less extra buzz.' },
  scarcityStarPowerFloor: { spec: [0, 100, 1], tip: 'Higher: only more established stars receive a scarcity bonus. Lower: more wrestlers can benefit from rare appearances.' },
  relevanceGraceWeeks: { spec: [0, 10, 1], tip: 'Higher: regular wrestlers can be absent longer before relevance decay begins. Lower: absence starts hurting relevance sooner.' },
  relevanceDecayRatePerWeek: { spec: [0, 10, 1], tip: 'Higher: a regular wrestler loses relevance faster after the grace period. Lower: relevance decays more slowly.' },
  relevanceDecayCap: { spec: [0, 50, 1], tip: 'Higher: long absences can reduce the relevance anchor by more. Lower: the total absence penalty is capped sooner.' },
  relevanceHardFloor: { spec: [0, 50, 1], tip: 'Higher: relevance cannot pull an absent wrestler below a higher popularity anchor. Lower: absence can settle at a lower anchor.' },
  rubStarPowerGain: { spec: [0, 15, 1], tip: 'Higher: beating a legend or part-timer grants more lasting star power. Lower: that rare-opponent rub is smaller.' },
};

const BOOKING_FIELDS = {
  segmentChance: { spec: [0, 1, .01], tip: 'Higher: more eligible TV story slots become non-match segments (angles/promos). Lower: shows lean toward matches.' },
  restTierPopularityThreshold: { spec: [0, 100, 1], tip: 'Higher: only the very top acts get paced (rested) down the card. Lower: more of the roster can be rested off big matches.' },
  restPenalty: { spec: [0, 400, 10], tip: 'Higher: established acts are held back from repeat main events much harder. Lower: they can headline every week.' },
  maxMultiWayParticipants: { spec: [3, 4, 1], tip: 'The most wrestlers a single multi-way match may include.' },
  multiWayChance: { spec: [0, 1, .01], tip: 'Higher: more undercard matches become multi-way. Lower: singles matches dominate.' },
  heatStoryMomentumWeight: { spec: [0, 2, .05], tip: 'Higher: a program’s story momentum drives its card ranking more. Lower: story heat matters less to placement.' },
  heatParticipantMomentumWeight: { spec: [0, 2, .05], tip: 'Higher: the participants’ own momentum weighs more in ranking a program. Lower: it matters less.' },
  heatParticipantPopularityWeight: { spec: [0, 1, .05], tip: 'Higher: raw participant popularity weighs more in ranking a program. Lower: popularity matters less to placement.' },
  grudgeHeatBonus: { spec: [0, 60, 1], tip: 'Higher: personal-grudge programs jump the card more. Lower: grudges get less of a placement boost.' },
  worldTitleStakesHeatBonus: { spec: [0, 80, 1], tip: 'Higher: world-title stakes push a program up the card more. Lower: the belt matters less to placement.' },
  midcardTitleStakesHeatBonus: { spec: [0, 60, 1], tip: 'Higher: midcard-title stakes push a program up the card more. Lower: that belt matters less to placement.' },
  titleDefenseStalenessWeeks: { spec: [0, 20, 1], tip: 'Higher: a champion can go longer between defenses before the title reads as stale. Lower: defenses are demanded sooner.' },
  contenderReadyMomentumThreshold: { spec: [-100, 100, 5], tip: 'Higher: a challenger needs more momentum before the booker treats them as title-ready. Lower: contenders emerge sooner.' },
  minimumProgramBuildShows: { spec: [1, 6, 1], tip: 'Higher: a program must build over more TV shows before it can pay off at a PLE. Lower: programs can pay off faster.' },
  maxPayoffExtensions: { spec: [0, 5, 1], tip: 'Higher: a program whose payoff window passed gets more chances to aim at the next PLE. Zero: it is abandoned immediately.' },
  coolingResolveWeeks: { spec: [1, 10, 1], tip: 'Higher: a cooling story lingers longer before it resolves quietly. Lower: cold programs are released faster.' },
  crowdResponseInterestDrop: { spec: [1, 100, 1], tip: 'Higher: audience interest must fall further below its peak before the booker reads a crowd response. Lower: it reacts sooner.' },
  heatContradictionLimit: { spec: [1, 6, 1], tip: 'Higher: more segments may run against their intended heat before it is read as a pivot. Lower: pivots trigger sooner.' },
  coolDownTicks: { spec: [1, 10, 1], tip: 'Higher: a cool-down response keeps a program off TV longer. Lower: it returns sooner.' },
  repeatedBeatTypeLimit: { spec: [2, 8, 1], tip: 'Higher: a program may repeat a beat type more before it reads as repetitive. Lower: repetition triggers sooner.' },
  maxPayoffsPerEvent: { spec: [1, 10, 1], tip: 'Higher: one event may carry more program blowoffs. Lower: extra payoffs are pushed to the next event.' },
  programCandidateRetentionTicks: { spec: [1, 120, 1], tip: 'How long the private booking-candidate trace is retained (observability only).' },
  beatOutsideCandidateCount: { spec: [1, 8, 1], tip: 'Higher: a beat names more possible outside bodies (opponents, run-ins). Lower: fewer candidates are listed.' },
  maxOptionalBeatParticipants: { spec: [0, 4, 1], tip: 'Higher: a beat may book more optional participants, turning it into a multi-body angle. Lower: beats stay tight.' },
  tvMainEventMatchBias: { spec: [0, 100, 1], tip: 'Higher: TV shows almost always close on a match. Lower: a hot angle can more easily take the main event.' },
  repeatPlacementPenalty: { spec: [0, 100, 1], tip: 'Higher: a program pays more to keep the same card slot two shows running. Lower: placements can repeat freely.' },
  repeatPairingPenalty: { spec: [0, 100, 1], tip: 'Higher: re-running a pairing seen this run costs more. Lower: the same match can recur cheaply.' },
  consecutivePairingPenalty: { spec: [0, 150, 5], tip: 'Higher: running the same pairing on back-to-back shows is penalised harder. Lower: immediate rematches are cheap.' },
  objectiveSlotFitBonus: { spec: [0, 80, 1], tip: 'Higher: slots that serve the promotion’s creative objective are rewarded more. Lower: objective fit matters less.' },
  rotationFormMatches: { spec: [1, 8, 1], tip: 'How many recent open-rotation matches a wrestler’s form is read from when scouting contenders.' },
  contenderFormBonus: { spec: [0, 30, 1], tip: 'Higher: winning rotation matches counts for more when building someone up. Lower: form matters less to program candidates.' },
};

const MATCH_FIELDS = {
  ringPerformanceWeight: { spec: [0, 1, .01], tip: 'Higher: ring performance skill weighs more in match outcomes. Lower: it matters less.' },
  psychologyWeight: { spec: [0, 1, .01], tip: 'Higher: psychology skill weighs more in match outcomes. Lower: it matters less.' },
  athleticismWeight: { spec: [0, 1, .01], tip: 'Higher: athleticism weighs more in match outcomes. Lower: it matters less.' },
  conditionWeight: { spec: [0, 1, .01], tip: 'Higher: current condition weighs more in match outcomes. Lower: fatigue matters less to results.' },
  storyMomentumFactor: { spec: [0, .5, .01], tip: 'Higher: story momentum swings match outcomes more. Lower: booking momentum matters less to who wins.' },
  intentAssertivenessFactor: { spec: [0, 20, .5], tip: 'Higher: an assertive match intent shifts the outcome more. Lower: intent matters less.' },
  performanceVariance: { spec: [0, 40, 1], tip: 'Higher: more random spread in per-match performance (upsets). Lower: results track skill more tightly.' },
  qualityRawScoreWeight: { spec: [0, 1, .01], tip: 'Higher: raw performance drives match quality more. Lower: quality leans on chemistry instead.' },
  qualityChemistryWeight: { spec: [0, 1, .01], tip: 'Higher: pairing chemistry drives match quality more. Lower: chemistry matters less to quality.' },
  crowdQualityWeight: { spec: [0, 1, .05], tip: 'Higher: in-ring quality drives crowd reaction more. Lower: the crowd cares less about workrate.' },
  crowdStoryInterestWeight: { spec: [0, 1, .05], tip: 'Higher: story interest drives crowd reaction more. Lower: the crowd cares less about the angle.' },
  crowdNoStoryBase: { spec: [0, 50, 1], tip: 'Higher: matches with no story still draw a warmer baseline crowd. Lower: story-less matches feel flatter.' },
  crowdVariance: { spec: [0, 40, 1], tip: 'Higher: more random spread in crowd reactions. Lower: crowd response is more predictable.' },
};

const HEALTH_FIELDS = {
  bookableCondition: { spec: [0, 100, 1], tip: 'Higher: wrestlers need to be fresher to be booked; being driven below this is the injury. Lower: they work through more wear.' },
  seriousInjuryCondition: { spec: [0, 100, 1], tip: 'Higher: more injuries count as serious (longer layoffs). Lower: only the worst are serious.' },
  seriousInjuryPhysicalCost: { spec: [0, 100, 1], tip: 'Higher: only very high-cost spots make an injury serious regardless of condition. Lower: risky spots turn serious sooner.' },
  minorAbsenceWeeks: { spec: [1, 8, 1], tip: 'Whole show-weeks a minor injury keeps a wrestler off the card.' },
  seriousAbsenceWeeks: { spec: [1, 16, 1], tip: 'Whole show-weeks a serious injury costs — roughly a full PLE cycle at the shipped cadence.' },
};

const ROLE_FIELDS = {
  idealGapWeeks: { spec: [1, 16, 1], tip: 'Target weeks between appearances for this role. Higher: rarer, more special. Lower: on TV more often.' },
  scarcityMagnitude: { spec: [0, 2, .05], tip: 'Higher: rarity gives this role a bigger scarcity bonus when they do appear. Lower: rarity matters less.' },
  overexposureSensitivity: { spec: [0, 3, .1], tip: 'Higher: this role is punished harder for appearing too often. Lower: they tolerate frequent booking.' },
  relevanceDecay: { spec: BOOL, tip: 'On: this role loses relevance while absent. Off: absence does not erode their anchor.' },
  storyGated: { spec: BOOL, tip: 'On: this role only appears when a story calls for it. Off: they can be booked freely.' },
  titleEligibility: { spec: TITLE_ELIGIBILITY, tip: 'Which titles this role may hold: none, all, or midcard only.' },
};

const WORLD_FIELDS = {
  decisionTicksPerWeek: { spec: [1, 4, 1], tip: 'Decision ticks per week (booking cadence). Higher: more decision points per week.' },
  pleIntervalWeeks: { spec: [1, 12, 1], tip: 'Weeks between premium live events. Higher: PLEs are rarer.' },
  sliceWeeks: { spec: [1, 52, 1], tip: 'Length of the validation slice in weeks. The SL criteria are calibrated for the baseline value.' },
  'tvCardSize.min': { spec: [1, 14, 1], tip: 'Minimum slots on a television card.' },
  'tvCardSize.max': { spec: [1, 14, 1], tip: 'Maximum slots on a television card.' },
  'pleCardSize.min': { spec: [1, 14, 1], tip: 'Minimum slots on a premium live event card.' },
  'pleCardSize.max': { spec: [1, 14, 1], tip: 'Maximum slots on a premium live event card.' },
};

const GROUPS = [
  { id: 'popularity', label: 'Popularity', prefix: 'popularity', title: 'Popularity tuning', blurb: 'GDD §10 anchored, surprise-driven popularity. Watch the roster trajectories below.', fields: POPULARITY_FIELDS },
  { id: 'booking', label: 'Booking', prefix: 'booking', title: 'Booking & card composition', blurb: 'How the GM builds cards and paces programs. Watch booking metrics and the match/segment mix.', fields: BOOKING_FIELDS },
  { id: 'match', label: 'Match', prefix: 'match', title: 'Match outcome & quality', blurb: 'How attributes become results and match quality. Watch the quality distribution.', fields: MATCH_FIELDS },
  { id: 'health', label: 'Health', prefix: 'health', title: 'Wear & injuries', blurb: 'Injury thresholds and enforced absence. Watch the injury toll.', fields: HEALTH_FIELDS },
  { id: 'roles', label: 'Roles', title: 'Role cadence & eligibility', blurb: 'Per-role appearance cadence and title access. Watch the cadence table.', roles: true },
  { id: 'world', label: 'Cadence', prefix: '', title: 'Show cadence & card size', blurb: 'Schedule shape: shows per week, PLE interval, and card sizes.', fields: WORLD_FIELDS },
];
const ROLE_KEYS = ['legend', 'part_timer', 'regular', 'prospect'];
const groupById = (id) => GROUPS.find((group) => group.id === id);

const label = (key) => key.replace(/[._]/g, ' ').replace(/([A-Z])/g, ' $1').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (character) => character.toUpperCase());
const number = (value) => Number.isInteger(value) ? String(value) : Number(value).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
const pct = (value) => `${Math.round(value * 100)}%`;
const getPath = (object, path) => path.split('.').reduce((current, key) => (current === undefined ? undefined : current[key]), object);
function setPath(object, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let target = object;
  for (const key of keys) target = target[key];
  target[last] = value;
}

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

function attachTooltips(container) {
  for (const tooltip of container.querySelectorAll('.tooltip')) {
    tooltip.addEventListener('mouseenter', () => showTooltip(tooltip));
    tooltip.addEventListener('mouseleave', dismissTooltip);
    tooltip.addEventListener('focus', () => showTooltip(tooltip));
    tooltip.addEventListener('blur', dismissTooltip);
  }
}

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const delta = (value) => `${value > 0 ? '+' : ''}${value}`;
const tipMark = (tip) => tip ? `<span class="tooltip" tabindex="0" role="img" aria-label="${escapeHtml(tip)}" data-tooltip="${escapeHtml(tip)}">?</span>` : '';

// ---- Controls -------------------------------------------------------------

function controlHtml(id, spec, tip, name) {
  const value = getPath(values, id);
  const heading = `<span class="option-label"><label for="${id}">${name}</label>${tipMark(tip)}</span>`;
  if (Array.isArray(spec)) {
    const [min, max, step] = spec;
    return `<div class="control"><div class="label-line">${heading}<output id="${id}-value">${number(value)}</output></div><input id="${id}" data-type="number" type="range" min="${min}" max="${max}" step="${step}" value="${value}"><div class="hint">${min}–${max}</div></div>`;
  }
  if (spec.type === 'bool') {
    return `<div class="control switch"><div class="label-line">${heading}<input id="${id}" data-type="bool" type="checkbox" ${value ? 'checked' : ''}></div></div>`;
  }
  return `<div class="control"><div class="label-line">${heading}</div><select id="${id}" data-type="enum">${spec.options.map(option => `<option value="${option}" ${option === value ? 'selected' : ''}>${option}</option>`).join('')}</select></div>`;
}

function renderControls() {
  dismissTooltip();
  const group = groupById(activeGroup);
  controlsTitle.textContent = group.title;
  controlsBlurb.textContent = group.blurb;
  if (group.roles) {
    controls.innerHTML = ROLE_KEYS.map(role => `<div class="role-section"><h3 class="role-heading">${label(role)}</h3>${Object.entries(ROLE_FIELDS).map(([key, { spec, tip }]) => controlHtml(`roles.${role}.${key}`, spec, tip, label(key))).join('')}</div>`).join('');
  } else {
    controls.innerHTML = Object.entries(group.fields).map(([key, { spec, tip }]) => controlHtml(group.prefix ? `${group.prefix}.${key}` : key, spec, tip, label(key))).join('');
  }
  attachTooltips(controls);
  for (const element of controls.querySelectorAll('[data-type]')) {
    const eventName = element.dataset.type === 'number' ? 'input' : 'change';
    element.addEventListener(eventName, () => {
      const value = element.dataset.type === 'number' ? Number(element.value) : element.dataset.type === 'bool' ? element.checked : element.value;
      setPath(values, element.id, value);
      const output = document.getElementById(`${element.id}-value`);
      if (output) output.value = number(value);
      clearTimeout(timer);
      timer = setTimeout(() => run(1), 180);
    });
  }
}

// ---- Shared render helpers (reused across tabs) ---------------------------

function spark(samples) {
  const low = Math.min(...samples), high = Math.max(...samples), span = Math.max(1, high - low);
  return samples.map((value, index) => `${(index / (samples.length - 1)) * 100},${21 - ((value - low) / span) * 18}`).join(' ');
}
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
function metricCard(name, value, tip, detail) {
  return `<article class="stat signal-stat"><span class="option-label">${escapeHtml(name)}${tipMark(tip)}</span><b>${escapeHtml(String(value))}</b>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</article>`;
}
function tokenCard(name, counts, tip) {
  const entries = Object.entries(counts ?? {}).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
  const body = entries.length === 0
    ? '<span class="token-none">none</span>'
    : `<table class="token-table"><tbody>${entries.map(([key, count]) => `<tr><td>${escapeHtml(key.replace(/_/g, ' '))}</td><td>${count}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="token-card"><span>${escapeHtml(name)}${tipMark(tip)}</span>${body}</div>`;
}
function criterionCards(criteria, descriptions) {
  return criteria.map(item => {
    const tip = descriptions?.[item.id] ?? '';
    return `<article class="stat signal-stat"><span class="option-label">${item.id} <small>[${item.strength}]</small>${tipMark(tip)}</span><b class="${item.pass ? 'pass' : 'fail'}">${item.pass ? 'PASS' : 'FAIL'}</b><small>${escapeHtml(item.observed)}${item.detail ? `<br>${escapeHtml(item.detail)}` : ''}</small></article>`;
  }).join('');
}
function crossSeedCards(crossSeed, volatility, criterionDescriptions, signalDescriptions) {
  const card = (name, value, tip, tone) => `<article class="stat signal-stat"><span class="option-label">${name}${tipMark(tip)}</span><b${tone ? ` class="${tone}"` : ''}>${value}</b></article>`;
  return [
    card('Winner variety (SL-10)', crossSeed.pass ? 'PASS' : 'FAIL', `${criterionDescriptions?.['SL-10'] ?? ''} Observed: ${crossSeed.observed}`, crossSeed.pass ? 'pass' : 'fail'),
    card('Rise-count spread (SL-1)', volatility.risesRange.join('-'), signalDescriptions?.risesRange ?? ''),
    card('Fall-count spread (SL-2)', volatility.fallsRange.join('-'), signalDescriptions?.fallsRange ?? ''),
    card('Swing-share spread (SL-3)', volatility.nonMonotonicShareRange.map(v => `${Math.round(v * 100)}%`).join('-'), signalDescriptions?.nonMonotonicShareRange ?? ''),
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
  return SIGNAL_ROWS.map(([key, name, format]) => metricCard(name, format(signals[key]), descriptions[key] ?? '')).join('');
}
function appendPopularityTotals(totals) {
  const summary = results.querySelector('#popularity-totals');
  if (!summary) return;
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

// ---- Per-tab main views ---------------------------------------------------

function popularityView(run) {
  if (!run.wrestlers.some(wrestler => wrestler.id === selectedWrestlerId)) selectedWrestlerId = run.wrestlers[0]?.id;
  const selected = run.wrestlers.find(wrestler => wrestler.id === selectedWrestlerId);
  const rows = sortedWrestlers(run.wrestlers).map(wrestler => {
    const change = wrestler.end - wrestler.start;
    return `<tr class="wrestler-row ${wrestler.id === selectedWrestlerId ? 'selected' : ''}" data-wrestler-id="${wrestler.id}"><td><button type="button" data-wrestler-id="${wrestler.id}">${escapeHtml(wrestler.name)}</button></td><td>${wrestler.start}</td><td>${wrestler.end}</td><td class="delta ${change > 0 ? 'positive' : change < 0 ? 'negative' : ''}">${delta(change)}</td><td>${wrestler.range}</td><td><svg class="mini-chart" viewBox="0 0 100 24" preserveAspectRatio="none"><polyline fill="none" stroke="#85b8ff" stroke-width="2" points="${spark(wrestler.samples)}"/></svg></td></tr>`;
  }).join('');
  return `<article class="panel criterion-panel"><h2>Popularity totals (this seed)</h2><div class="summary" id="popularity-totals"></div></article><div class="roster-layout"><article class="panel"><h2>All wrestlers</h2><p>Click a row to inspect every reported popularity and status change.</p><div class="table-wrap"><table class="roster-table"><thead><tr><th>${sortHeader('name', 'Wrestler')}</th><th>${sortHeader('start', 'Start')}</th><th>${sortHeader('end', 'End')}</th><th>${sortHeader('delta', 'Δ')}</th><th>${sortHeader('range', 'Range')}</th><th>Trend</th></tr></thead><tbody>${rows}</tbody></table></div></article><article class="panel detail" id="wrestler-detail">${detailView(selected)}</article></div>`;
}

function bookingView(run, data) {
  const composition = run.cardComposition;
  const metrics = run.bookingMetrics;
  const describe = data.bookingMetricDescriptions ?? {};
  const compositionPanel = `<article class="panel criterion-panel"><h2>Card composition <small class="hint">(match / segment mix)</small></h2><div class="summary signal-summary">
    ${metricCard('Match slots', composition.matchSlots, 'Total match slots booked across every show.')}
    ${metricCard('Segment slots', composition.segmentSlots, 'Total non-match angle/promo slots booked.')}
    ${metricCard('Segment share', pct(composition.segmentShare), 'Segments as a share of all booked slots. Driven by booking.segmentChance.')}
    ${metricCard('Avg TV card', composition.avgTvCardSize.toFixed(1), 'Average slots per television show. Driven by tvCardSize.')}
    ${metricCard('Matches / TV', composition.avgMatchesPerTvShow.toFixed(1), 'Average matches per television show.')}
    ${metricCard('Segments / TV', composition.avgSegmentsPerTvShow.toFixed(1), 'Average segments per television show.')}
    ${metricCard('Multi-way matches', composition.multiWayMatches, 'Matches with three or more participants. Driven by multiWayChance.')}
  </div></article>`;
  const metricsPanel = `<article class="panel criterion-panel"><h2>Booking metrics <small class="hint">(booking_ai §12)</small></h2><div class="summary signal-summary">
    ${metricCard('Programs created', metrics.programsCreated, describe.programsCreated)}
    ${metricCard('Completion', pct(metrics.completionRate), describe.completionRate, `${metrics.programsResolved} resolved`)}
    ${metricCard('Abandonment', pct(metrics.abandonmentRate), describe.abandonmentRate, `${metrics.programsAbandoned} abandoned`)}
    ${metricCard('Backlog', metrics.programsOpen, describe.programsOpen)}
    ${metricCard('Median duration', `${metrics.medianProgramDurationWeeks.toFixed(1)} wk`, describe.medianProgramDurationWeeks)}
    ${metricCard('Beats before payoff', metrics.medianBeatsBeforePayoff.toFixed(1), describe.medianBeatsBeforePayoff)}
    ${metricCard('PLE build coverage', pct(metrics.pleBuildCoverage.share), describe.pleBuildCoverage, `${metrics.pleBuildCoverage.built}/${metrics.pleBuildCoverage.total}`)}
    ${metricCard('Direct rematches', metrics.directRematches, describe.directRematches)}
    ${metricCard('Consecutive pairings', metrics.consecutivePairings, describe.consecutivePairings)}
    ${metricCard('Finish adherence', pct(metrics.finishAdherence.rate), describe.finishAdherence, `${metrics.finishAdherence.adhered}/${metrics.finishAdherence.planned}`)}
    ${metricCard('TV main-event matches', pct(metrics.televisionMatchMainEvents.share), describe.televisionMatchMainEvents, `${metrics.televisionMatchMainEvents.matches}/${metrics.televisionMatchMainEvents.total}`)}
    ${metricCard('Story from segments', pct(metrics.segmentStoryAdvancementShare), describe.segmentStoryAdvancementShare)}
    ${metricCard('Main-eventers', metrics.distinctMainEventers, describe.distinctMainEventers)}
    ${metricCard('Title challengers', metrics.distinctTitleChallengers, describe.distinctTitleChallengers)}
    ${metricCard('Escalation violations', metrics.escalationOrderViolations, describe.escalationOrderViolations)}
    ${metricCard('Repeated placements', metrics.repeatedPlacements, describe.repeatedPlacements)}
    ${metricCard('Score inversions', metrics.scoreInversions, describe.scoreInversions)}
  </div></article>`;
  const distributions = `<article class="panel criterion-panel"><h2>Distributions</h2><div class="token-grid">
    ${tokenCard('Programs by objective', metrics.programsByObjective, describe.programsByObjective)}
    ${tokenCard('Revisions by cause', metrics.revisionsByCause, 'Plan revisions grouped by the trigger that caused them.')}
    ${tokenCard('Revision responses', metrics.revisionsByResponse, 'Which replanning responses were actually used.')}
    ${tokenCard('Beats generated', metrics.beatsGeneratedByType, 'Every beat the planner created, by type.')}
    ${tokenCard('Beats resolved', metrics.beatsResolvedByType, 'Beats that actually aired, by type.')}
    ${tokenCard('Beat statuses', metrics.beatsByStatus, 'Beat lifecycle spread across statuses.')}
  </div></article>`;
  return compositionPanel + metricsPanel + distributions;
}

function matchView(run) {
  const quality = run.matchQuality;
  if (quality.count === 0) return '<article class="panel"><p>No match quality was recorded this seed.</p></article>';
  const maxBar = Math.max(1, ...quality.histogram.map(bucket => bucket.count));
  const bars = quality.histogram.map(bucket => `<div class="qbar-row"><span>${bucket.label}</span><div class="qbar"><i style="width:${(bucket.count / maxBar) * 100}%"></i></div><span>${bucket.count}</span></div>`).join('');
  return `<article class="panel criterion-panel"><h2>Match quality <small class="hint">(this seed)</small></h2><div class="summary signal-summary">
    ${metricCard('Matches', quality.count, 'Matches with a quality score this seed.')}
    ${metricCard('Mean', quality.mean.toFixed(1), 'Average booked match quality.')}
    ${metricCard('Median', quality.median.toFixed(1), 'Median booked match quality.')}
    ${metricCard('Range', `${quality.min}–${quality.max}`, 'Lowest to highest match quality.')}
  </div></article><article class="panel"><h2>Quality distribution</h2>${bars}</article>`;
}

function healthView(run) {
  const digest = run.injuryDigest;
  const tiles = `<div class="summary signal-summary">
    ${metricCard('Injury events', digest.injuryEvents, 'Total injuries across the roster.')}
    ${metricCard('Serious', digest.seriousInjuries, 'Injuries costing a full PLE cycle.')}
    ${metricCard('Minor', digest.minorInjuries, 'Injuries costing about a week.')}
    ${metricCard('Weeks lost', digest.totalWeeksLost, 'Total show-weeks lost to injury.')}
    ${metricCard('Wrestlers hurt', digest.wrestlersInjured, 'Distinct wrestlers who took an injury.')}
    ${metricCard('Missed shows', digest.missedShows, 'Show appearances lost to injury.')}
  </div>`;
  const rows = run.injuryArcs.length === 0
    ? '<tr><td colspan="4" class="detail-empty">No injuries this seed.</td></tr>'
    : run.injuryArcs.map(arc => `<tr><td>${escapeHtml(arc.name)}</td><td class="num">${arc.weeksLost}</td><td>${arc.injuries.map(injury => `W${injury.week}${injury.serious ? '!' : ''}`).join(', ') || '—'}</td><td>${arc.returns.map(week => `W${week}`).join(', ') || '—'}</td></tr>`).join('');
  const table = `<article class="panel"><h2>Injury arcs</h2><table class="data-table"><thead><tr><th>Wrestler</th><th class="num">Weeks out</th><th>Injuries (! = serious)</th><th>Returns</th></tr></thead><tbody>${rows}</tbody></table></article>`;
  return `<article class="panel criterion-panel"><h2>Injury toll <small class="hint">(this seed)</small></h2>${tiles}</article>${table}`;
}

function rolesView(run) {
  const rows = run.roleCadence.map(role => `<tr><td>${escapeHtml(label(role.role))}</td><td class="num">${role.wrestlers}</td><td class="num">${role.appearances}</td><td class="num">${role.avgAppearances.toFixed(1)}</td><td class="num">${role.avgGapWeeks.toFixed(1)}</td></tr>`).join('');
  return `<article class="panel"><h2>Appearance cadence by role <small class="hint">(this seed)</small></h2><p>Average gap = weeks ÷ average appearances per wrestler. Compare against each role’s idealGapWeeks dial.</p><table class="data-table"><thead><tr><th>Role</th><th class="num">Wrestlers</th><th class="num">Appearances</th><th class="num">Avg / wrestler</th><th class="num">Avg gap (wk)</th></tr></thead><tbody>${rows}</tbody></table></article>`;
}

function worldView(run) {
  const composition = run.cardComposition;
  return `<article class="panel criterion-panel"><h2>Resulting schedule <small class="hint">(this seed)</small></h2><div class="summary signal-summary">
    ${metricCard('TV shows', composition.tvShows, 'Television shows run over the slice.')}
    ${metricCard('PLE shows', composition.pleShows, 'Premium live events run over the slice.')}
    ${metricCard('Avg TV card', composition.avgTvCardSize.toFixed(1), 'Average slots per TV show, from tvCardSize.')}
    ${metricCard('Match slots', composition.matchSlots, 'Total matches booked.')}
    ${metricCard('Segment slots', composition.segmentSlots, 'Total segments booked.')}
    ${metricCard('Segment share', pct(composition.segmentShare), 'Segments as a share of all slots.')}
  </div></article>`;
}

function groupView(run, data) {
  switch (activeGroup) {
    case 'booking': return bookingView(run, data);
    case 'match': return matchView(run);
    case 'health': return healthView(run);
    case 'roles': return rolesView(run);
    case 'world': return worldView(run);
    default: return popularityView(run);
  }
}

// ---- Top-level render -----------------------------------------------------

function render(data) {
  latestData = data;
  const run = data.runs[selectedSeedIndex] || data.runs[0];
  selectedSeedIndex = data.runs.indexOf(run);
  const shared = `<article class="panel criterion-panel"><h2>Cross-seed <small class="hint">(across all simulated seeds, advisory)</small></h2><p class="cross-seed-intro">${escapeHtml(data.crossSeedIntro ?? '')}</p><div class="summary signal-summary">${crossSeedCards(data.crossSeed, data.volatility, data.criterionDescriptions ?? {}, data.signalDescriptions ?? {})}</div></article><div class="seed-picker"><h2>${escapeHtml(groupById(activeGroup).label)} · slice results</h2><label>Seed <select id="seed-select">${data.runs.map((candidate, index) => `<option value="${index}" ${index === selectedSeedIndex ? 'selected' : ''}>${candidate.seed}</option>`).join('')}</select></label></div><article class="panel criterion-panel"><h2>Criteria <small class="hint">(this seed, advisory)</small></h2><div class="summary signal-summary">${criterionCards(run.criteria, data.criterionDescriptions ?? {})}</div></article><article class="panel criterion-panel"><h2>Health signals</h2><div class="summary signal-summary">${signalCards(run.signals, data.signalDescriptions ?? {})}</div></article>`;
  results.innerHTML = shared + groupView(run, data);
  document.querySelector('#seed-select').addEventListener('change', event => { selectedSeedIndex = Number(event.target.value); selectedWrestlerId = undefined; render(latestData); });
  if (activeGroup === 'popularity') {
    appendPopularityTotals(run.popularityTotals);
    for (const button of results.querySelectorAll('button[data-sort-key]')) button.addEventListener('click', event => { const nextKey = event.currentTarget.dataset.sortKey; if (sortKey === nextKey) sortDirection *= -1; else { sortKey = nextKey; sortDirection = nextKey === 'name' ? 1 : -1; } render(latestData); });
    for (const button of results.querySelectorAll('button[data-wrestler-id]')) button.addEventListener('click', event => { selectedWrestlerId = event.currentTarget.dataset.wrestlerId; render(latestData); });
  }
  attachTooltips(results);
}

function renderTabs() {
  tabs.innerHTML = GROUPS.map(group => `<button class="tab ${group.id === activeGroup ? 'active' : ''}" type="button" data-group="${group.id}">${group.label}</button>`).join('');
  for (const button of tabs.querySelectorAll('.tab')) button.addEventListener('click', () => {
    if (activeGroup === button.dataset.group) return;
    activeGroup = button.dataset.group;
    for (const other of tabs.querySelectorAll('.tab')) other.classList.toggle('active', other === button);
    renderControls();
    if (latestData) render(latestData);
  });
}

async function run(seedCount) {
  const active = ++requestId; status.textContent = `Simulating ${seedCount} seed${seedCount === 1 ? '' : 's'}…`; verify.disabled = true; results.classList.add('loading');
  try {
    const response = await fetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: values, seedCount }) });
    const data = await response.json(); if (active !== requestId) return; if (!response.ok) throw new Error(data.error);
    render(data); status.textContent = `Finished ${seedCount} deterministic ${values.sliceWeeks}-week slice${seedCount === 1 ? '' : 's'}.`;
  } catch (error) { if (active === requestId) status.textContent = `Run failed: ${error.message}`; }
  finally { if (active === requestId) { verify.disabled = false; results.classList.remove('loading'); } }
}

const data = await fetch('/api/config').then(response => response.json());
baseline = data.config; values = structuredClone(baseline); document.querySelector('#scenario').textContent = `${data.scenario} · local deterministic balance lab`;
renderTabs(); renderControls(); run(1);
verify.addEventListener('click', () => run(3));
reset.addEventListener('click', () => { values = structuredClone(baseline); renderControls(); run(1); });
exportButton.addEventListener('click', () => { const blob = new Blob([`${JSON.stringify(values, null, 2)}\n`], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'config.json'; link.click(); URL.revokeObjectURL(url); });
