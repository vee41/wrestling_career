import type { SliceAnalysis, SliceCriterion, SliceMatchImpact } from "@wrestling/sim";

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

function criteriaRows(criteria: readonly SliceCriterion[]): string {
  return criteria.map((criterion) => `<tr class="${criterion.pass ? "pass" : "fail"}">
    <td><strong>${html(criterion.id)}</strong></td><td>${html(criterion.strength)}</td>
    <td><span class="badge">${criterion.pass ? "PASS" : "FAIL"}</span></td>
    <td>${html(criterion.observed)}${criterion.detail ? `<small>${html(criterion.detail)}</small>` : ""}</td>
  </tr>`).join("\n");
}

function criteriaSummary(criteria: readonly SliceCriterion[]): string {
  const passed = criteria.filter((criterion) => criterion.pass).length;
  return `<details class="criteria"><summary><span class="badge ${passed === criteria.length ? "pass" : "fail"}">${passed}/${criteria.length} pass</span> Slice criteria</summary><div class="table-wrap"><table><thead><tr><th>Criterion</th><th>Strength</th><th>Result</th><th>Observed</th></tr></thead><tbody>${criteriaRows(criteria)}</tbody></table></div></details>`;
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

function injuries(analysis: SliceAnalysis): string {
  if (analysis.injuryArcs.length === 0) return `<p class="empty">No injury-related events.</p>`;
  return `<div class="injuries">${analysis.injuryArcs.map((arc) => `<details><summary><b>${html(wrestlerName(analysis, arc.wrestlerId))}</b><span>Injuries: ${arc.injuryTicks.map((tick) => `W${week(analysis, tick)}`).join(", ") || "—"} · Missed: ${arc.missedShowTicks.map((tick) => `W${week(analysis, tick)}`).join(", ") || "—"} · Returns: ${arc.returnTicks.map((tick) => `W${week(analysis, tick)}`).join(", ") || "—"}</span></summary><ul>${arc.events.map((event) => `<li><b>Week ${week(analysis, event.tick)}</b> · ${html(event.summary)}</li>`).join("")}</ul></details>`).join("")}</div>`;
}

function trajectoryRows(analysis: SliceAnalysis): string {
  return analysis.trajectories.slice().sort((a, b) => (b.end - b.start) - (a.end - a.start)).map((trajectory) => {
    const change = trajectory.end - trajectory.start;
    return `<tr data-name="${html(trajectory.wrestlerName.toLowerCase())}"><td><details class="wrestler-log"><summary>${html(trajectory.wrestlerName)}</summary>${popularityLogEntries(analysis, trajectory.wrestlerId)}</details></td><td>${trajectory.start}</td><td>${trajectory.end}</td><td class="${change > 0 ? "up" : change < 0 ? "down" : "flat"}">${change > 0 ? "+" : ""}${change}</td><td><svg class="trajectory" viewBox="0 0 260 52" preserveAspectRatio="none" aria-label="Popularity trajectory for ${html(trajectory.wrestlerName)}" data-values="${html(trajectory.samples.join(","))}"></svg></td></tr>`;
  }).join("\n");
}

function seedPanel(run: SliceReportRun, index: number): string {
  const { seed, analysis } = run;
  return `<section class="seed-panel" id="seed-${index}" ${index === 0 ? "" : "hidden"}>
    <div class="seed-heading"><div><span class="eyebrow">Simulation seed</span><h2>${html(seed)}</h2></div><p>Final #1: <b>${html(wrestlerName(analysis, analysis.topWrestlerId))}</b></p></div>
    <section><div class="section-heading"><div><h2>Popularity trajectories</h2><p>Sorted by net rise. Each line shows weekly general popularity.</p></div><label>Find wrestler <input class="trajectory-filter" type="search" placeholder="e.g. Cody Rhodes"></label></div><div class="table-wrap"><table class="trajectories"><thead><tr><th>Wrestler</th><th>Start</th><th>End</th><th>Change</th><th>Weekly trend</th></tr></thead><tbody>${trajectoryRows(analysis)}</tbody></table></div></section>
    <section>${criteriaSummary(analysis.criteria)}</section>
    <section><h2>Title lineages</h2><div class="lineages">${titleLineages(analysis)}</div></section>
    <section><h2>Story timelines</h2>${stories(analysis)}</section>
    <section><h2>PLE cards</h2>${pleCards(analysis)}</section>
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
  mustPass: boolean;
  shouldPass: number;
}): string {
  const { scenarioName, scenarioId, weeks, runs, crossSeed, mustPass, shouldPass } = input;
  const tabButtons = runs.map((run, index) => `<button class="seed-tab ${index === 0 ? "selected" : ""}" data-seed="${index}">${html(run.seed)}</button>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Slice validation · ${html(scenarioName)}</title>
<style>
:root{color-scheme:dark;--bg:#101317;--surface:#181d23;--surface2:#202733;--text:#edf0f5;--muted:#aab4c2;--line:#303947;--accent:#e7b95b;--green:#4fd18b;--red:#ff7777;--blue:#78b8ff}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}.hero{padding:48px max(24px,calc((100% - 1200px)/2));background:radial-gradient(circle at 75% 0,#41321d 0,transparent 36%),#151a20;border-bottom:1px solid var(--line)}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:var(--accent);font-weight:800}.hero h1{font-size:clamp(30px,5vw,52px);margin:4px 0}.hero p{color:var(--muted);margin:0}.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:28px}.summary article{background:#11161ccc;border:1px solid var(--line);border-radius:10px;padding:14px}.summary b{display:block;font-size:21px;margin-top:2px}.summary .pass b{color:var(--green)}.summary .fail b{color:var(--red)}main{max-width:1200px;margin:auto;padding:30px 24px 64px}.seed-tabs{display:flex;gap:8px;overflow:auto;margin-bottom:30px}.seed-tab{appearance:none;cursor:pointer;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:8px 14px}.seed-tab.selected{background:var(--accent);border-color:var(--accent);color:#1e1709;font-weight:800}.seed-heading,.section-heading{display:flex;justify-content:space-between;align-items:start;gap:16px}.seed-heading h2,section h2{margin:2px 0 12px}.seed-heading p{margin:8px 0;color:var(--muted)}section{margin:28px 0}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:10px}table{border-collapse:collapse;width:100%;min-width:650px}th{text-align:left;background:var(--surface2);font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}th,td{padding:11px 13px;border-bottom:1px solid var(--line)}tbody tr:last-child td{border:0}.badge{font-size:11px;font-weight:800;border-radius:999px;padding:3px 7px}.pass .badge,.badge.pass{background:#143a2a;color:var(--green)}.fail .badge,.badge.fail{background:#492024;color:var(--red)}small{display:block;color:var(--muted);margin-top:3px}.lineages,.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}.lineage,.ple-card,.story,.injuries details{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px}.lineage h3,.ple-card h3{margin:0}.lineage p{color:var(--muted);margin:4px 0}.lineage ol{padding-left:20px;margin:10px 0 0}.story-list,.injuries{display:grid;gap:10px}details>summary{cursor:pointer;list-style:none}details>summary::-webkit-details-marker{display:none}details[open]>summary{margin-bottom:8px}.story>summary{display:grid;grid-template-columns:minmax(180px,1fr) auto;gap:4px 16px}.story span,.injuries span{color:var(--muted)}.story p{margin:5px 0 0}.story-matches{margin-top:8px}.match{border-top:1px solid var(--line);padding:9px 0}.match>summary{cursor:pointer;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.match span{color:var(--accent);font-size:12px;text-transform:capitalize}.match i{font-style:normal;background:#29374c;color:var(--blue);font-size:11px;padding:2px 5px;border-radius:4px}.delta{display:inline-block;margin-left:3px;font-size:10px;padding:1px 5px;border-radius:4px;background:#1c2733;vertical-align:middle}.impacts{margin:8px 0 0;padding-left:18px}.impacts>li{margin-bottom:6px}.breakdown{margin:4px 0 0;padding-left:16px;color:var(--muted);font-size:12.5px}.breakdown li{border:0;padding:1px 0}.empty,.section-heading p{color:var(--muted)}label{font-size:12px;color:var(--muted)}input{display:block;margin-top:4px;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:7px 9px;width:210px}.trajectory{width:260px;height:52px;display:block}.trajectories td{vertical-align:top}.up{color:var(--green);font-weight:700}.down{color:var(--red);font-weight:700}.flat{color:var(--muted)}.criteria{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px}.criteria summary{display:flex;align-items:center;gap:10px;font-weight:700}.criteria .table-wrap{margin-top:12px}.injuries summary{display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap}.injuries ul{margin:0;padding-left:20px}@media(max-width:620px){.summary{grid-template-columns:1fr}.seed-heading,.section-heading{display:block}.section-heading label{display:block;margin-top:12px}.story>summary{display:block}.story span{display:block;margin-top:4px}}
</style></head><body>
<header class="hero"><span class="eyebrow">Wrestling career · validation report</span><h1>${html(scenarioName)}</h1><p>${html(scenarioId)} · ${runs.length} deterministic seed${runs.length === 1 ? "" : "s"} · ${weeks} weeks · AI-only</p><div class="summary"><article class="${mustPass ? "pass" : "fail"}"><span>Every MUST criterion</span><b>${mustPass ? "PASS" : "FAIL"}</b></article><article class="${crossSeed.pass ? "pass" : "fail"}"><span>SL-10 cross-seed variety</span><b>${crossSeed.pass ? "PASS" : "FAIL"}</b><small>${html(crossSeed.observed)}</small></article><article><span>Within-seed SHOULDs</span><b>${shouldPass}/${runs.length}</b><small>Seeds passing every applicable SHOULD clause</small></article></div></header>
<main><nav class="seed-tabs" aria-label="Simulation seed">${tabButtons}</nav>${runs.map(seedPanel).join("")}</main>
<script>for(const svg of document.querySelectorAll('.trajectory')){const values=svg.dataset.values.split(',').map(Number),min=Math.min(...values),max=Math.max(...values),range=max-min||1;svg.innerHTML='<path d="'+values.map((v,i)=>(i?'L':'M')+(i/(values.length-1||1)*260).toFixed(1)+' '+(48-(v-min)/range*44).toFixed(1)).join(' ')+'" fill="none" stroke="#78b8ff" stroke-width="2" vector-effect="non-scaling-stroke"/><path d="M0 50H260" stroke="#303947"/>'}for(const tab of document.querySelectorAll('.seed-tab'))tab.addEventListener('click',()=>{for(const button of document.querySelectorAll('.seed-tab'))button.classList.toggle('selected',button===tab);for(const panel of document.querySelectorAll('.seed-panel'))panel.hidden=panel.id!=='seed-'+tab.dataset.seed});for(const input of document.querySelectorAll('.trajectory-filter'))input.addEventListener('input',()=>{const panel=input.closest('.seed-panel');for(const row of panel.querySelectorAll('.trajectories tbody tr'))row.hidden=!row.dataset.name.includes(input.value.toLowerCase())});</script>
</body></html>`;
}
