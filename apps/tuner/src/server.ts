import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { worldConfigSchema, type WorldConfig } from "@wrestling/contracts";
import { BOOKING_METRIC_DESCRIPTIONS, CROSS_SEED_INTRO, crossSeedSignals, SIGNAL_DESCRIPTIONS, SL_CRITERION_DESCRIPTIONS } from "@wrestling/sim";
import { cardComposition, injuryDigest, loadScenario, matchQualityStats, popularityTotals, roleCadence, runTuning } from "./tuning.js";

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATA_ROOT = fileURLToPath(new URL("../../../data/", import.meta.url));
const PORT = Number(process.env.TUNER_PORT ?? 4178);
const scenario = loadScenario(DATA_ROOT);
const indexHtml = readFileSync(resolve(APP_ROOT, "public", "index.html"), "utf8");
const clientJs = readFileSync(resolve(APP_ROOT, "public", "app.js"), "utf8");

interface RunRequest {
  config?: unknown;
  seedCount?: unknown;
}

function send(response: ServerResponse, status: number, body: string, contentType: string): void {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}

async function requestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function dashboardResult(config: WorldConfig, seedCount: number) {
  const result = runTuning(scenario, config, seedCount);
  const wrestlerNames = new Map(scenario.roster.map(({ wrestler }) => [wrestler.id, wrestler.name]));
  const titleNames = new Map(scenario.titles.map((title) => [title.id, title.name]));
  return {
    config: result.config,
    mustPass: result.mustPass,
    crossSeed: result.crossSeed,
    volatility: crossSeedSignals(result.runs.map(({ analysis }) => analysis)),
    signalDescriptions: SIGNAL_DESCRIPTIONS,
    criterionDescriptions: SL_CRITERION_DESCRIPTIONS,
    bookingMetricDescriptions: BOOKING_METRIC_DESCRIPTIONS,
    crossSeedIntro: CROSS_SEED_INTRO,
    runs: result.runs.map(({ seed, analysis }) => {
      const weekOf = (tick: number) => Math.floor(tick / analysis.ticksPerWeek) + 1;
      return {
        seed,
        criteria: analysis.criteria,
        signals: analysis.signals,
        popularityTotals: popularityTotals(analysis),
        bookingMetrics: analysis.bookingMetrics,
        cardComposition: cardComposition(analysis),
        matchQuality: matchQualityStats(analysis),
        roleCadence: roleCadence(analysis, scenario.roster),
        injuryDigest: injuryDigest(analysis),
        injuryArcs: analysis.injuryArcs
          .filter((arc) => arc.injuryTicks.length > 0 || arc.weeksLost > 0)
          .map((arc) => ({
            wrestlerId: arc.wrestlerId,
            name: wrestlerNames.get(arc.wrestlerId) ?? arc.wrestlerId,
            weeksLost: arc.weeksLost,
            injuries: arc.injuryTicks.map((tick) => ({ week: weekOf(tick), serious: arc.seriousInjuryTicks.includes(tick) })),
            missedShows: arc.missedShowTicks.map(weekOf),
            returns: arc.returnTicks.map(weekOf),
            events: arc.events.map((event) => ({ week: weekOf(event.tick), summary: event.summary })),
          })),
        wrestlers: analysis.trajectories.slice().sort((a, b) => a.wrestlerName.localeCompare(b.wrestlerName)).map((trajectory) => ({
          id: trajectory.wrestlerId,
          name: trajectory.wrestlerName,
          start: trajectory.start,
          end: trajectory.end,
          range: Math.max(...trajectory.samples) - Math.min(...trajectory.samples),
          samples: trajectory.samples,
          popularityLog: (analysis.popularityLogs[trajectory.wrestlerId] ?? []).map((entry) => ({
            ...entry,
            week: weekOf(entry.tick),
            opponentNames: entry.opponentIds.map((id) => wrestlerNames.get(id) ?? id),
            ...(entry.titleId === undefined ? {} : { titleName: titleNames.get(entry.titleId) ?? entry.titleId }),
          })),
        })),
      };
    }),
  };
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/") return send(response, 200, indexHtml, "text/html; charset=utf-8");
    if (request.method === "GET" && request.url === "/app.js") return send(response, 200, clientJs, "text/javascript; charset=utf-8");
    if (request.method === "GET" && request.url === "/api/config") {
      return send(response, 200, JSON.stringify({ scenario: scenario.manifest.name, config: scenario.config }), "application/json");
    }
    if (request.method === "POST" && request.url === "/api/run") {
      const body = await requestJson(request) as RunRequest;
      const config = worldConfigSchema.parse(body.config);
      const seedCount = body.seedCount === 3 ? 3 : 1;
      return send(response, 200, JSON.stringify(dashboardResult(config, seedCount)), "application/json");
    }
    return send(response, 404, "Not found", "text/plain; charset=utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return send(response, 400, JSON.stringify({ error: message }), "application/json");
  }
});

server.once("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the existing tuner or run: $env:TUNER_PORT=${PORT + 1}; pnpm tune`);
  } else {
    console.error(`Could not start the tuning dashboard: ${error.message}`);
  }
  process.exitCode = 1;
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Wrestling Career tuning dashboard: http://127.0.0.1:${PORT}`);
});
