import { CROSS_SEED_INTRO, SIGNAL_DESCRIPTIONS, SL_CRITERION_DESCRIPTIONS, type CrossSeedSignals, type SliceAnalysis, type SliceCriterion, type SliceMatchImpact, type SliceSignals } from "@wrestling/sim";

export interface SliceReportRun {
  seed: string;
  analysis: SliceAnalysis;
}

function html(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function wrestlerName(analysis: SliceAnalysis, id: string): string {
  return analysis.trajectories.find((trajectory) => trajectory.wrestlerId === id)?.wrestlerName ?? id;
}

function deltaBadge(delta: number): string {
  const cls = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return `<small class="delta ${cls}">${delta > 0 ? "+" : ""}${delta}</small>`;
}

function wrestlerWithDelta(analysis: SliceAnalysis, impacts: readonly SliceMatchImpact[], id: string): string {
  const impact = impacts.find((candidate) => candidate.wrestlerId === id);
  return `${html(wrestlerName(analysis, id))}${impact ? deltaBadge(impact.delta) : ""}`;
}

function matchBreakdown(analysis: SliceAnalysis, impacts: readonly SliceMatchImpact[]): string {
  if (impacts.length === 0) return `<p class="empty">No popularity data recorded for this match.</p>`;
  return `<ul class="impacts">${impacts.map((impact) => `<li><b>${html(wrestlerName(analysis, impact.wrestlerId))}</b> ${deltaBadge(impact.delta)}<ul class="breakdown">
    <li>Popularity ${impact.before} → ${impact.after}</li>
    <li>Segment value ${impact.segment.toFixed(1)} vs. expected ${impact.expectedSegment.toFixed(1)}</li>
    <li>Win/loss edge ${impact.edge.toFixed(1)}</li>
    <li>Momentum ${impact.momentumBefore} → ${impact.momentumAfter}</li>
    ${impact.reason ? `<li>Reason: ${html(impact.reason.replaceAll("_", " "))}</li>` : ""}
  </ul></li>`).join("")}</ul>`;
}

function week(analysis: SliceAnalysis, tick: number): number {
  return Math.floor(tick / analysis.ticksPerWeek) + 1;
}

function popularityLogEntries(analysis: SliceAnalysis, wrestlerId: string): string {
  const entries = analysis.popularityLogs[wrestlerId] ?? [];
  if (entries.length === 0) return `<p class="empty">No logged popularity changes.</p>`;
  return `<ul class="impacts">${entries.map((entry) => `<li><b>Week ${week(analysis, entry.tick)}</b> ${deltaBadge(entry.delta)}<ul class="breakdown">
    <li>Popularity ${entry.before} → ${entry.after}</li>
    ${entry.kind === "match"
      ? `<li>${entry.won ? "Won" : "Lost"} vs. ${entry.opponentIds.map((id) => html(wrestlerName(analysis, id))).join(", ") || "—"}${entry.titleId ? " · Title match" : ""} (${html((entry.showKind ?? "tv").toUpperCase())})</li>`
      : `<li>${html(entry.summary ?? "")}</li>`}
    ${entry.reason ? `<li>Reason: ${html(entry.reason.replaceAll("_", " "))}</li>` : ""}
  </ul></li>`).join("")}</ul>`;
}

function criterionCard(criterion: SliceCriterion): string {
  const tooltip = SL_CRITERION_DESCRIPTIONS[criterion.id] ?? "";
  return `<article class="${criterion.pass ? "pass" : "fail"}" title="${html(tooltip)}"><span>${html(criterion.id)} <small>[${html(criterion.strength)}]</small><span class="info" aria-hidden="true">ⓘ</span></span><b>${criterion.pass ? "PASS" : "FAIL"}</b><small>${html(criterion.observed)}${criterion.detail ? `<br>${html(criterion.detail)}` : ""}</small></article>`;
}

function criteriaCards(criteria: readonly SliceCriterion[]): string {
  return `<div class="signals criteria-cards">${criteria.map(criterionCard).join("")}</div>`;
}

function crossSeedCard(label: string, value: string, tooltip: string, tone?: "pass" | "fail"): string {
  return `<article class="${tone ?? ""}" title="${html(tooltip)}"><span>${html(label)}<span class="info" aria-hidden="true">ⓘ</span></span><b>${html(value)}</b></article>`;
}

function crossSeedCards(crossSeed: SliceCriterion, volatility: CrossSeedSignals): string {
  return `<p class="cross-seed-intro">${html(CROSS_SEED_INTRO)}</p><div class="signals">
    ${crossSeedCard("Winner variety (SL-10)", crossSeed.pass ? "PASS" : "FAIL", `${SL_CRITERION_DESCRIPTIONS["SL-10"]} Observed: ${crossSeed.observed}`, crossSeed.pass ? "pass" : "fail")}
    ${crossSeedCard("Rise-count spread (SL-1)", volatility.risesRange.join("-"), SIGNAL_DESCRIPTIONS.risesRange)}
    ${crossSeedCard("Fall-count spread (SL-2)", volatility.fallsRange.join("-"), SIGNAL_DESCRIPTIONS.fallsRange)}
    ${crossSeedCard("Swing-share spread (SL-3)", volatility.nonMonotonicShareRange.map((v) => `${Math.round(v * 100)}%`).join("-"), SIGNAL_DESCRIPTIONS.nonMonotonicShareRange)}
  </div>`;
}

function titleLineages(analysis: SliceAnalysis): string {
  return analysis.titleLineages.map((lineage) => {
    const initial = lineage.initialHolderId ? wrestlerName(analysis, lineage.initialHolderId) : "Vacant";
    const changes = lineage.changes.length === 0
      ? `<li class="muted">No title matches recorded.</li>`
      : lineage.changes.map((change) => `<li><b>Week ${week(analysis, change.tick)}</b> · ${change.defended ? "Defended by" : "Won by"} ${html(wrestlerName(analysis, change.holderId))}</li>`).join("");
    return `<article class="lineage"><h3>${html(lineage.titleName)}</h3><p>Started with <b>${html(initial)}</b></p><ol>${changes}</ol></article>`;
  }).join("");
}

function storyMatches(analysis: SliceAnalysis, story: SliceAnalysis["stories"][number]): string {
  if (story.matches.length === 0) return `<p class="empty">No matches tied to this story.</p>`;
  return `<div class="story-matches">${story.matches.map((match) => `<details class="match"><summary><span>Week ${week(analysis, match.tick)} · ${html(match.showKind.toUpperCase())} · ${html(match.position.replaceAll("_", " "))}</span><b>${match.participants.map((id) => wrestlerWithDelta(analysis, match.impacts, id)).join(" vs. ")}</b><i>Winner: ${html(wrestlerName(analysis, match.winnerWrestlerId))}</i>${match.titleId ? "<i>Title</i>" : ""}</summary>${matchBreakdown(analysis, match.impacts)}</details>`).join("")}</div>`;
}

function stories(analysis: SliceAnalysis): string {
  if (analysis.stories.length === 0) return `<p class="empty">No stories started or resolved.</p>`;
  return `<div class="story-list">${analysis.stories.map((story) => {
    const participants = story.participants.map((id) => wrestlerName(analysis, id)).join(" vs. ");
    const started = story.startTick === undefined ? "Seeded" : `Week ${week(analysis, story.startTick)}`;
    const ended = story.resolveTick === undefined ? "Still active" : `Week ${week(analysis, story.resolveTick)}${story.resolvedAtPle ? " · PLE blowoff" : ""}`;
    return `<details class="story"><summary><b>${html(participants)}</b><span>${html(started)} → ${html(ended)}</span></summary><p>${html(story.description)}</p>${storyMatches(analysis, story)}</details>`;
  }).join("")}</div>`;
}

function pleCards(analysis: SliceAnalysis): string {
  if (analysis.pleCards.length === 0) return `<p class="empty">No PLE cards were run.</p>`;
  return `<div class="cards">${analysis.pleCards.map((card) => `<article class="ple-card"><h3>Week ${card.week}</h3>${card.matches.map((match) => `<details class="match"><summary><span>${html(match.position.replaceAll("_", " "))}</span><b>${match.participants.map((id) => wrestlerWithDelta(analysis, match.impacts, id)).join(" vs. ")}</b>${match.titleId ? "<i>Title</i>" : ""}${match.storyId ? "<i>Story</i>" : ""}</summary>${matchBreakdown(analysis, match.impacts)}</details>`).join("")}</article>`).join("")}</div>`;
}

function showCards(analysis: SliceAnalysis): string {
  if (analysis.showCards.length === 0) return `<p class="empty">No show cards were run.</p>`;
  return `<div class="cards">${analysis.showCards.map((card) => `<article class="ple-card"><h3>Week ${card.week} <small>${html(card.kind.toUpperCase())}</small></h3>${card.slots.map((slot) => {
    const names = slot.participants.map((id) => wrestlerWithDelta(analysis, slot.impacts, id)).join(slot.kind === "match" ? " vs. " : " · ");
    const result = slot.kind === "segment"
      ? `${slot.dominantWrestlerId ? `<i>Dominant: ${html(wrestlerName(analysis, slot.dominantWrestlerId))}</i>` : ""}${slot.heatDeltas ? `<ul class="breakdown">${slot.heatDeltas.map((delta) => `<li>${html(wrestlerName(analysis, delta.wrestlerId))}: +heat ${delta.positive}, -heat ${delta.negative}, story +${delta.storyAdvancement}</li>`).join("")}</ul>` : ""}`
      : `${slot.winnerWrestlerId ? `<i>Winner: ${html(wrestlerName(analysis, slot.winnerWrestlerId))}</i>` : ""}`;
    return `<details class="match"><summary><span>${html(slot.position.replaceAll("_", " "))} · ${html(slot.kind)}</span><b>${names}</b>${slot.titleId ? "<i>Title</i>" : ""}${slot.storyId ? "<i>Story</i>" : ""}${slot.quality !== undefined ? `<i>Quality: ${slot.quality}</i>` : ""}</summary>${result}${matchBreakdown(analysis, slot.impacts)}</details>`;
  }).join("")}</article>`).join("")}</div>`;
}

function injuries(analysis: SliceAnalysis): string {
  if (analysis.injuryArcs.length === 0) return `<p class="empty">No injury-related events.</p>`;
  return `<div class="injuries">${analysis.injuryArcs.map((arc) => `<details><summary><b>${html(wrestlerName(analysis, arc.wrestlerId))}</b><span>Injuries: ${arc.injuryTicks.map((tick) => `W${week(analysis, tick)}`).join(", ") || "—"} · Missed: ${arc.missedShowTicks.map((tick) => `W${week(analysis, tick)}`).join(", ") || "—"} · Returns: ${arc.returnTicks.map((tick) => `W${week(analysis, tick)}`).join(", ") || "—"}</span></summary><ul>${arc.events.map((event) => `<li><b>Week ${week(analysis, event.tick)}</b> · ${html(event.summary)}</li>`).join("")}</ul></details>`).join("")}</div>`;
}

function signalCard(label: string, value: string, key: keyof typeof SIGNAL_DESCRIPTIONS): string {
  return `<article title="${html(SIGNAL_DESCRIPTIONS[key])}"><span>${html(label)}<span class="info" aria-hidden="true">ⓘ</span></span><b>${html(value)}</b></article>`;
}

function signalsPanel(signals: SliceSignals): string {
  return `<div class="signals" aria-label="Slice health signals (advisory, not gates)">
    ${signalCard("Top tier (88+)", String(signals.topTierCount), "topTierCount")}
    ${signalCard("Popularity spread", signals.popularitySpreadStdDev.toFixed(1), "popularitySpreadStdDev")}
    ${signalCard("Rank stability", signals.rankStability.toFixed(2), "rankStability")}
    ${signalCard("Skill/popularity corr.", signals.skillPopularityCorrelation.toFixed(2), "skillPopularityCorrelation")}
    ${signalCard("Running hot", String(signals.starPowerRunningHotCount), "starPowerRunningHotCount")}
    ${signalCard("Suppressed", String(signals.starPowerSuppressedCount), "starPowerSuppressedCount")}
    ${signalCard("Unresolved stories", String(signals.unresolvedStoryCount), "unresolvedStoryCount")}
  </div>`;
}

function popularityTotals(analysis: SliceAnalysis): string {
  const { gains, losses, net } = analysis.popularityTotals;
  const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;
  const netClass = net > 0 ? "up" : net < 0 ? "down" : "flat";
  return `<div class="popularity-totals" aria-label="Company popularity movement"><article><span>Gained</span><b class="up">${signed(gains)}</b><small>All wrestler popularity increases</small></article><article><span>Lost</span><b class="down">${signed(losses)}</b><small>All wrestler popularity decreases</small></article><article><span>Net</span><b class="${netClass}">${signed(net)}</b><small>Gains plus losses</small></article></div>`;
}

function trajectoryRows(analysis: SliceAnalysis): string {
  return analysis.trajectories.slice().sort((a, b) => b.end - a.end || a.wrestlerName.localeCompare(b.wrestlerName)).map((trajectory) => {
    const change = trajectory.end - trajectory.start;
    const range = Math.max(...trajectory.samples) - Math.min(...trajectory.samples);
    return `<tr data-name="${html(trajectory.wrestlerName.toLowerCase())}" data-start="${trajectory.start}" data-end="${trajectory.end}" data-change="${change}" data-trend="${range}"><td><details class="wrestler-log"><summary>${html(trajectory.wrestlerName)}</summary>${popularityLogEntries(analysis, trajectory.wrestlerId)}</details></td><td>${trajectory.start}</td><td>${trajectory.end}</td><td class="${change > 0 ? "up" : change < 0 ? "down" : "flat"}">${change > 0 ? "+" : ""}${change}</td><td><svg class="trajectory" viewBox="0 0 260 52" preserveAspectRatio="none" aria-label="Popularity trajectory for ${html(trajectory.wrestlerName)}" data-values="${html(trajectory.samples.join(","))}"></svg></td></tr>`;
  }).join("\n");
}

function seedPanel(run: SliceReportRun, index: number): string {
  const { seed, analysis } = run;
  return `<section class="seed-panel" id="seed-${index}" ${index === 0 ? "" : "hidden"}>
    <div class="seed-heading"><div><span class="eyebrow">Simulation seed</span><h2>${html(seed)}</h2></div><p>Final #1: <b>${html(wrestlerName(analysis, analysis.topWrestlerId))}</b></p></div>
    <section><h2>Criteria <small class="section-note">(advisory — watch these and react on your own judgment, they don't block anything)</small></h2>${criteriaCards(analysis.criteria)}</section>
    <section><h2>Signals <small class="section-note">(advisory — watch these and react on your own judgment, they don't block anything)</small></h2>${signalsPanel(analysis.signals)}</section>
    <section><div class="section-heading"><div><h2>Popularity trajectories</h2><p>Sorted by end popularity. Select a header to change the order; each line shows weekly general popularity.</p></div><label>Find wrestler <input class="trajectory-filter" type="search" placeholder="e.g. Cody Rhodes"></label></div>${popularityTotals(analysis)}<div class="table-wrap"><table class="trajectories"><thead><tr><th><button class="trajectory-sort" type="button" data-sort="name">Wrestler</button></th><th><button class="trajectory-sort" type="button" data-sort="start">Start</button></th><th aria-sort="descending"><button class="trajectory-sort" type="button" data-sort="end">End</button></th><th><button class="trajectory-sort" type="button" data-sort="change">Change</button></th><th><button class="trajectory-sort" type="button" data-sort="trend" title="Sort by weekly popularity range">Weekly trend</button></th></tr></thead><tbody>${trajectoryRows(analysis)}</tbody></table></div></section>
    <section><h2>Title lineages</h2><div class="lineages">${titleLineages(analysis)}</div></section>
    <section><h2>Story timelines</h2>${stories(analysis)}</section>
    <section><h2>PLE cards</h2>${pleCards(analysis)}</section>
    <section><h2>Complete show cards</h2>${showCards(analysis)}</section>
    <section><h2>Injury and return arcs</h2>${injuries(analysis)}</section>
  </section>`;
}

/** Generates a standalone report: no server, build step, or external assets required. */
export function renderSliceHtmlReport(input: {
  scenarioName: string;
  scenarioId: string;
  weeks: number;
  runs: readonly SliceReportRun[];
  crossSeed: SliceCriterion;
  volatility: CrossSeedSignals;
}): string {
  const { scenarioName, scenarioId, weeks, runs, crossSeed, volatility } = input;
  const tabButtons = runs.map((run, index) => `<button class="seed-tab ${index === 0 ? "selected" : ""}" data-seed="${index}">${html(run.seed)}</button>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Slice validation · ${html(scenarioName)}</title>
<style>
:root{color-scheme:dark;--bg:#101317;--surface:#181d23;--surface2:#202733;--text:#edf0f5;--muted:#aab4c2;--line:#303947;--accent:#e7b95b;--green:#4fd18b;--red:#ff7777;--blue:#78b8ff}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}.hero{padding:48px max(24px,calc((100% - 1200px)/2));background:radial-gradient(circle at 75% 0,#41321d 0,transparent 36%),#151a20;border-bottom:1px solid var(--line)}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:var(--accent);font-weight:800}.hero h1{font-size:clamp(30px,5vw,52px);margin:4px 0}.hero p{color:var(--muted);margin:0}.popularity-totals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}.popularity-totals article{background:#11161ccc;border:1px solid var(--line);border-radius:10px;padding:14px}.popularity-totals b{display:block;font-size:21px;margin-top:2px}main{max-width:1200px;margin:auto;padding:30px 24px 64px}.seed-tabs{display:flex;gap:8px;overflow:auto;margin-bottom:30px}.seed-tab{appearance:none;cursor:pointer;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:8px 14px}.seed-tab.selected{background:var(--accent);border-color:var(--accent);color:#1e1709;font-weight:800}.seed-heading,.section-heading{display:flex;justify-content:space-between;align-items:start;gap:16px}.seed-heading h2,section h2{margin:2px 0 12px}.seed-heading p{margin:8px 0;color:var(--muted)}section{margin:28px 0}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:10px}table{border-collapse:collapse;width:100%;min-width:650px}th{text-align:left;background:var(--surface2);font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}th,td{padding:11px 13px;border-bottom:1px solid var(--line)}tbody tr:last-child td{border:0}.trajectory-sort{appearance:none;border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;letter-spacing:inherit;text-transform:inherit;padding:0}.trajectory-sort:hover,.trajectory-sort:focus-visible{color:var(--text);text-decoration:underline}.trajectory-sort[data-direction=ascending]::after{content:" ▲"}.trajectory-sort[data-direction=descending]::after{content:" ▼"}small{display:block;color:var(--muted);margin-top:3px}.lineages,.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}.lineage,.ple-card,.story,.injuries details{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px}.lineage h3,.ple-card h3{margin:0}.lineage p{color:var(--muted);margin:4px 0}.lineage ol{padding-left:20px;margin:10px 0 0}.story-list,.injuries{display:grid;gap:10px}details>summary{cursor:pointer;list-style:none}details>summary::-webkit-details-marker{display:none}details[open]>summary{margin-bottom:8px}.story>summary{display:grid;grid-template-columns:minmax(180px,1fr) auto;gap:4px 16px}.story span,.injuries span{color:var(--muted)}.story p{margin:5px 0 0}.story-matches{margin-top:8px}.match{border-top:1px solid var(--line);padding:9px 0}.match>summary{cursor:pointer;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.match span{color:var(--accent);font-size:12px;text-transform:capitalize}.match i{font-style:normal;background:#29374c;color:var(--blue);font-size:11px;padding:2px 5px;border-radius:4px}.delta{display:inline-block;margin-left:3px;font-size:10px;padding:1px 5px;border-radius:4px;background:#1c2733;vertical-align:middle}.impacts{margin:8px 0 0;padding-left:18px}.impacts>li{margin-bottom:6px}.breakdown{margin:4px 0 0;padding-left:16px;color:var(--muted);font-size:12.5px}.breakdown li{border:0;padding:1px 0}.empty,.section-heading p{color:var(--muted)}label{font-size:12px;color:var(--muted)}input{display:block;margin-top:4px;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:7px 9px;width:210px}.trajectory{width:260px;height:52px;display:block}.trajectories td{vertical-align:top}.up{color:var(--green);font-weight:700}.down{color:var(--red);font-weight:700}.flat{color:var(--muted)}.injuries summary{display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap}.injuries ul{margin:0;padding-left:20px}.signals{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:6px}.signals article{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px;cursor:help}.signals article.pass{border-color:#1f4a34}.signals article.fail{border-color:#5a2a2e}.signals article.pass b{color:var(--green)}.signals article.fail b{color:var(--red)}.signals span{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:12px}.signals b{display:block;font-size:21px;margin-top:4px}.info{color:var(--accent);font-size:10px;border:1px solid currentColor;border-radius:50%;width:14px;height:14px;line-height:12px;text-align:center;flex:none}.section-note{display:inline;font-size:12px;font-weight:400;margin-left:8px;color:var(--muted)}.cross-seed-intro{color:var(--muted);max-width:760px;margin:6px 0 14px}@media(max-width:620px){.popularity-totals{grid-template-columns:1fr}.seed-heading,.section-heading{display:block}.section-heading label{display:block;margin-top:12px}.story>summary{display:block}.story span{display:block;margin-top:4px}}
</style></head><body>
<header class="hero"><span class="eyebrow">Wrestling career · slice signal report</span><h1>${html(scenarioName)}</h1><p>${html(scenarioId)} · ${runs.length} deterministic seed${runs.length === 1 ? "" : "s"} · ${weeks} weeks · AI-only · every card below is advisory, not a blocking gate — react on your own judgment</p>
<h2>Cross-seed</h2>${crossSeedCards(crossSeed, volatility)}</header>
<main><nav class="seed-tabs" aria-label="Simulation seed">${tabButtons}</nav>${runs.map(seedPanel).join("")}</main>
<script>for(const svg of document.querySelectorAll('.trajectory')){const values=svg.dataset.values.split(',').map(Number),min=Math.min(...values),max=Math.max(...values),range=max-min||1;svg.innerHTML='<path d="'+values.map((v,i)=>(i?'L':'M')+(i/(values.length-1||1)*260).toFixed(1)+' '+(48-(v-min)/range*44).toFixed(1)).join(' ')+'" fill="none" stroke="#78b8ff" stroke-width="2" vector-effect="non-scaling-stroke"/><path d="M0 50H260" stroke="#303947"/>'}function sortTrajectories(table,key,direction){const body=table.tBodies[0],rows=[...body.rows],factor=direction==='ascending'?1:-1;rows.sort((left,right)=>{const a=key==='name'?left.dataset.name:Number(left.dataset[key]),b=key==='name'?right.dataset.name:Number(right.dataset[key]),comparison=typeof a==='string'?a.localeCompare(b):a-b;return comparison===0?left.dataset.name.localeCompare(right.dataset.name):comparison*factor});body.append(...rows);table.dataset.sort=key;table.dataset.direction=direction;for(const button of table.querySelectorAll('.trajectory-sort')){const active=button.dataset.sort===key;button.dataset.direction=active?direction:'';button.closest('th').setAttribute('aria-sort',active?direction:'none')}}for(const table of document.querySelectorAll('.trajectories')){sortTrajectories(table,'end','descending');for(const button of table.querySelectorAll('.trajectory-sort'))button.addEventListener('click',()=>{const same=table.dataset.sort===button.dataset.sort,direction=same&&table.dataset.direction==='descending'?'ascending':same&&table.dataset.direction==='ascending'?'descending':button.dataset.sort==='name'?'ascending':'descending';sortTrajectories(table,button.dataset.sort,direction)})}for(const tab of document.querySelectorAll('.seed-tab'))tab.addEventListener('click',()=>{for(const button of document.querySelectorAll('.seed-tab'))button.classList.toggle('selected',button===tab);for(const panel of document.querySelectorAll('.seed-panel'))panel.hidden=panel.id!=='seed-'+tab.dataset.seed});for(const input of document.querySelectorAll('.trajectory-filter'))input.addEventListener('input',()=>{const panel=input.closest('.seed-panel');for(const row of panel.querySelectorAll('.trajectories tbody tr'))row.hidden=!row.dataset.name.includes(input.value.toLowerCase())});</script>
</body></html>`;
}
