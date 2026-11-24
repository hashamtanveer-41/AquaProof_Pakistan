import { localWeather } from "@/domain/data";
import type { Field } from "@/domain/data";

export type Scenario = {
  rain: number;
  delay: number;
  rate: number;
  amount: number;
  date: string;
  canal: boolean;
};
const dayMs = 86_400_000;
const startDate = Date.UTC(2026, 2, 20, 12);
const dateLabel = (date: Date) =>
  date.toLocaleDateString("en-PK", { day: "numeric", month: "short", timeZone: "UTC" });

export function baseline(field: Field): Scenario {
  return {
    rain: localWeather(field).rain,
    delay: 0,
    rate: field.rate,
    amount: field.crop === "Wheat" ? 35 : 24,
    date: "2026-03-22",
    canal: field.source.includes("Canal"),
  };
}

export function simulate(field: Field, result: Scenario) {
  const map = localWeather(field);
  const pump = field.source.includes("Tubewell");
  const canal = field.source.includes("Canal") && result.canal;
  const pumpDate = new Date(`${result.date}T12:00:00Z`);
  const canalDate = new Date(Date.UTC(2026, 2, parseInt(map.canalDay) + result.delay, 12));
  const pumpIn = Math.max(0, (pumpDate.getTime() - startDate) / dayMs);
  const canalIn = Math.max(0, (canalDate.getTime() - startDate) / dayMs);
  const demand = Math.max(0, result.amount - result.rain * 0.65);
  const volume = field.acres * 4.0468564 * demand;
  const peak = (days: number) =>
    Math.min(
      100,
      Math.max(0, Math.round(map.depletion + map.eto * 1.2 * days - result.rain * 0.55)),
    );
  const cost = (volume / 160) * result.rate;
  const compare = [
    {
      title: "Wait for canal water",
      valid: canal,
      date: dateLabel(canalDate),
      cost: 0,
      risk: peak(canalIn),
      type: 0,
    },
    {
      title: "Irrigate using tubewell",
      valid: pump,
      date: dateLabel(pumpDate),
      cost,
      risk: peak(pumpIn),
      type: 1,
    },
    {
      title: "Combine tubewell and canal",
      valid: canal && pump && pumpIn <= canalIn,
      date: `${dateLabel(pumpDate)} + ${dateLabel(canalDate)}`,
      cost: cost * 0.35,
      risk: Math.max(peak(pumpIn), peak(canalIn) - 11),
      type: 2,
    },
  ];
  const score = (s: (typeof compare)[number]) => Math.max(0, s.risk - 54) * 4200 + s.cost;
  const best =
    demand > 0 ? compare.filter((s) => s.valid).sort((a, b) => score(a) - score(b))[0] : undefined;
  const without = Array.from({ length: 7 }, (_, i) => peak(i));
  const series = without.map((value, i) => {
    const reduction =
      best?.type === 0
        ? i >= canalIn
          ? 23
          : 0
        : best?.type === 1
          ? i >= pumpIn
            ? 23
            : 0
          : best?.type === 2
            ? (i >= pumpIn ? 11 : 0) + (i >= canalIn ? 12 : 0)
            : 0;
    return Math.max(0, value - Math.round(reduction * Math.min(1, demand / 25)));
  });
  return { volume, demand, compare, best, series, without };
}
