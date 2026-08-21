import { useEffect, useRef, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  ErrorBar,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Eraser,
  Play,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import html2canvas from "html2canvas";
import { useToast } from "@/hooks/use-toast";
import { fitDecay, iterativeFitWithCutoff, diffusionCoefficient, dimensionlessTime } from "@/lib/fit";
import { parseDataset } from "@/lib/parse";

const SAMPLE_DATA_A = `t,U
0,0.0312
2,0.0274
5,0.0228
10,0.0173
20,0.0108
40,0.0048
60,0.0024
90,0.0010
120,0.0005`;

const SAMPLE_DATA_B = `t,U
0,0.0284
2,0.0251
5,0.0209
10,0.0158
20,0.0097
40,0.0041
60,0.0020
90,0.0008
120,0.0004`;

function uid() {
  return crypto.randomUUID();
}

type DatasetEntry = {
  id: string;
  title: string;
  concentration: string;
  concUnit: string;
  k0Input: string;
  lInput: string;
  thresholdInput: string;
  autoTrim: boolean;
  rawData: string;
};

type DatasetResult = {
  id: string;
  title: string;
  concentration: number;
  Ds: number;
  tauMin: number;
  satisfied: boolean;
  rSquared: number;
  b: number;
  trimmedCount: number;
  error?: string;
};

type GroupStats = {
  concentration: number;
  mean: number;
  sd: number;
  n: number;
  errorY: number;
};

function formatSci(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs < 1e-3 || abs >= 1e4) return v.toExponential(digits);
  return v.toPrecision(digits + 1);
}

function computeGroupStats(results: DatasetResult[]): GroupStats[] {
  const groups = new Map<number, number[]>();
  for (const r of results) {
    if (!r.error && Number.isFinite(r.Ds)) {
      const key = r.concentration;
      const arr = groups.get(key) ?? [];
      arr.push(r.Ds);
      groups.set(key, arr);
    }
  }
  return Array.from(groups.entries())
    .map(([c, vals]) => {
      const n = vals.length;
      const mean = vals.reduce((s, v) => s + v, 0) / n;
      const sd =
        n > 1
          ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
          : 0;
      const errorY =
        n >= 3 ? sd : n === 2 ? sd / Math.SQRT2 : 0;
      return { concentration: c, mean, sd, n, errorY };
    })
    .sort((a, b) => a.concentration - b.concentration);
}

function makeIndividualPoints(
  results: DatasetResult[],
  groups: GroupStats[],
): Array<{ concentration: number; Ds: number; title: string; jittered: number }> {
  const concRange =
    groups.length > 1
      ? groups[groups.length - 1].concentration - groups[0].concentration
      : groups[0]?.concentration ?? 1;
  const jitterMax = concRange * 0.025;

  const grouped = new Map<number, DatasetResult[]>();
  for (const r of results) {
    if (!r.error && Number.isFinite(r.Ds)) {
      const arr = grouped.get(r.concentration) ?? [];
      arr.push(r);
      grouped.set(r.concentration, arr);
    }
  }

  const pts: Array<{ concentration: number; Ds: number; title: string; jittered: number }> = [];
  for (const [c, rs] of grouped.entries()) {
    const n = rs.length;
    rs.forEach((r, i) => {
      const offset = n > 1 ? (i / (n - 1) - 0.5) * 2 * jitterMax : 0;
      pts.push({ concentration: c, Ds: r.Ds, title: r.title, jittered: c + offset });
    });
  }
  return pts;
}

function defaultEntry(title: string, conc: string, data: string): DatasetEntry {
  return {
    id: uid(),
    title,
    concentration: conc,
    concUnit: "mol.%",
    k0Input: "0",
    lInput: "0.001",
    thresholdInput: "0.03",
    autoTrim: true,
    rawData: data,
  };
}

type CardProps = {
  entry: DatasetEntry;
  index: number;
  onChange: (updated: DatasetEntry) => void;
  onRemove: () => void;
  result?: DatasetResult;
};

function DatasetCard({ entry, index, onChange, onRemove, result }: CardProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof DatasetEntry>(key: K, val: DatasetEntry[K]) {
    onChange({ ...entry, [key]: val });
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => set("rawData", String(reader.result ?? ""));
    reader.readAsText(file);
  }

  const points = parseDataset(entry.rawData).points;

  return (
    <Card className="relative">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="flex-1 grid grid-cols-2 gap-3 sm:grid-cols-[1fr_160px_120px]">
            <div className="space-y-1">
              <Label className="text-xs">Dataset title</Label>
              <Input
                value={entry.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder={`Dataset ${index + 1}`}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Salt concentration</Label>
              <Input
                type="number"
                step="any"
                value={entry.concentration}
                onChange={(e) => set("concentration", e.target.value)}
                placeholder="e.g. 0.1"
                className="h-8 text-sm font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Unit label</Label>
              <Input
                value={entry.concUnit}
                onChange={(e) => set("concUnit", e.target.value)}
                placeholder="mol.%"
                className="h-8 text-sm"
              />
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive shrink-0"
            onClick={onRemove}
            title="Remove dataset"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">k₀ (V, fixed)</Label>
            <Input
              type="number"
              step="any"
              value={entry.k0Input}
              onChange={(e) => set("k0Input", e.target.value)}
              className="h-8 text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">l (thickness, cm)</Label>
            <Input
              type="number"
              step="any"
              value={entry.lInput}
              onChange={(e) => set("lInput", e.target.value)}
              className="h-8 text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">τ threshold</Label>
            <Input
              type="number"
              step="any"
              value={entry.thresholdInput}
              onChange={(e) => set("thresholdInput", e.target.value)}
              disabled={!entry.autoTrim}
              className="h-8 text-sm font-mono border-t-[#114cd6] border-r-[#114cd6] border-b-[#114cd6] border-l-[#114cd6] bg-[#b8bdc242]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Auto-trim</Label>
            <div className="h-8 flex items-center">
              <Switch
                checked={entry.autoTrim}
                onCheckedChange={(v) => set("autoTrim", v)}
              />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Data (t, U columns)</Label>
          <Textarea
            value={entry.rawData}
            onChange={(e) => set("rawData", e.target.value)}
            rows={5}
            placeholder={"t,U\n0,0.031\n5,0.022\n..."}
            className="font-mono text-xs"
          />
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.tsv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.currentTarget.value = "";
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileRef.current?.click()}
              className="h-7 text-xs"
            >
              <Upload className="h-3 w-3 mr-1" /> Upload
            </Button>
            <span className="text-xs text-muted-foreground">
              {points.length} point{points.length === 1 ? "" : "s"} detected
            </span>
          </div>
        </div>

        {result && (
          <div
            className={`rounded-md border px-3 py-2 text-sm flex items-center justify-between gap-2 ${
              result.error
                ? "border-destructive/50 bg-destructive/5 text-destructive"
                : "border-primary/30 bg-primary/5"
            }`}
          >
            {result.error ? (
              <>
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-xs">{result.error}</span>
              </>
            ) : (
              <>
                <span className="font-mono">
                  D<sub>s</sub> = {formatSci(result.Ds)} cm²/s
                </span>
                <Badge
                  variant={result.satisfied ? "default" : "destructive"}
                  className="text-xs gap-1"
                >
                  {result.satisfied ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <AlertCircle className="h-3 w-3" />
                  )}
                  τ_min = {formatSci(result.tauMin, 3)}
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  R² = {result.rSquared.toFixed(4)}
                </span>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type Props = {
  onBack: () => void;
};

const STORAGE_KEY = "diffusion-fit:comparison-datasets";

function isValidEntry(e: unknown): e is DatasetEntry {
  if (!e || typeof e !== "object") return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.concentration === "string" &&
    typeof o.concUnit === "string" &&
    typeof o.k0Input === "string" &&
    typeof o.lInput === "string" &&
    typeof o.thresholdInput === "string" &&
    typeof o.autoTrim === "boolean" &&
    typeof o.rawData === "string"
  );
}

function loadSavedEntries(): DatasetEntry[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    if (parsed.some((e) => !isValidEntry(e))) return null;
    return parsed as DatasetEntry[];
  } catch {
    return null;
  }
}

export default function ComparisonPage({ onBack }: Props) {
  const [entries, setEntries] = useState<DatasetEntry[]>(() => {
    const saved = loadSavedEntries();
    return saved ?? [
      defaultEntry("Run 1", "0.1", SAMPLE_DATA_A),
      defaultEntry("Run 2", "0.1", SAMPLE_DATA_B),
      defaultEntry("Run 3", "0.5", SAMPLE_DATA_A),
    ];
  });
  const [results, setResults] = useState<DatasetResult[]>([]);
  const [hasRun, setHasRun] = useState(false);
  const [concUnitLabel, setConcUnitLabel] = useState("mol.%");
  const chartRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
    }
  }, [entries]);

  async function handleExportChart() {
    if (!chartRef.current) return;
    try {
      const canvas = await html2canvas(chartRef.current, { scale: 2, useCORS: true });
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = "ds_vs_concentration.png";
      a.click();
    } catch {
      toast({ title: "Export failed", description: "Could not capture the chart. Please try again.", variant: "destructive" });
    }
  }

  function clearAll() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
    }
    setEntries([]);
    setResults([]);
    setHasRun(false);
  }

  function addEntry() {
    setEntries((prev) => [
      ...prev,
      defaultEntry(`Dataset ${prev.length + 1}`, "", ""),
    ]);
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setResults((prev) => prev.filter((r) => r.id !== id));
  }

  function updateEntry(updated: DatasetEntry) {
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  }

  function runAll() {
    const newResults: DatasetResult[] = entries.map((entry) => {
      const conc = Number(entry.concentration);
      if (!Number.isFinite(conc)) {
        return {
          id: entry.id,
          title: entry.title || entry.id,
          concentration: NaN,
          Ds: NaN,
          tauMin: NaN,
          satisfied: false,
          rSquared: NaN,
          b: NaN,
          trimmedCount: 0,
          error: "Salt concentration must be a finite number.",
        };
      }

      const k0 = Number(entry.k0Input);
      const l = Number(entry.lInput);
      const threshold = Number(entry.thresholdInput) || 0.03;
      const { points, warnings: _w } = parseDataset(entry.rawData);

      if (points.length < 3) {
        return {
          id: entry.id,
          title: entry.title || entry.id,
          concentration: conc,
          Ds: NaN,
          tauMin: NaN,
          satisfied: false,
          rSquared: NaN,
          b: NaN,
          trimmedCount: 0,
          error: `Need ≥ 3 data points (got ${points.length}).`,
        };
      }

      if (entry.autoTrim && !(l > 0)) {
        return {
          id: entry.id,
          title: entry.title || entry.id,
          concentration: conc,
          Ds: NaN,
          tauMin: NaN,
          satisfied: false,
          rSquared: NaN,
          b: NaN,
          trimmedCount: 0,
          error:
            "Electrolyte thickness l must be a positive number when auto-trim is on.",
        };
      }

      try {
        if (entry.autoTrim) {
          const iter = iterativeFitWithCutoff(points, k0, l, threshold);
          const step = iter.finalStep;
          const Ds = diffusionCoefficient(step.fit.b, l);
          const sorted = [...points].sort((a, b) => a.t - b.t);
          const tMin = sorted.slice(step.excludedIndices.length)[0]?.t ?? NaN;
          const tauMin = dimensionlessTime(step.fit.b, tMin);
          return {
            id: entry.id,
            title: entry.title || entry.id,
            concentration: conc,
            Ds,
            tauMin,
            satisfied: step.diffusion.satisfied,
            rSquared: step.fit.rSquared,
            b: step.fit.b,
            trimmedCount: step.excludedIndices.length,
          };
        } else {
          const fit = fitDecay(points, k0);
          const Ds = l > 0 ? diffusionCoefficient(fit.b, l) : NaN;
          const sorted = [...points].sort((a, b) => a.t - b.t);
          const tMin = sorted[0]?.t ?? NaN;
          const tauMin = l > 0 ? dimensionlessTime(fit.b, tMin) : NaN;
          return {
            id: entry.id,
            title: entry.title || entry.id,
            concentration: conc,
            Ds,
            tauMin,
            satisfied: Number.isFinite(tauMin) && tauMin >= threshold,
            rSquared: fit.rSquared,
            b: fit.b,
            trimmedCount: 0,
          };
        }
      } catch (e) {
        return {
          id: entry.id,
          title: entry.title || entry.id,
          concentration: conc,
          Ds: NaN,
          tauMin: NaN,
          satisfied: false,
          rSquared: NaN,
          b: NaN,
          trimmedCount: 0,
          error: e instanceof Error ? e.message : "Fit failed.",
        };
      }
    });

    setResults(newResults);
    setHasRun(true);

    const firstUnit = entries.find((e) => e.concUnit)?.concUnit ?? "mol.%";
    setConcUnitLabel(firstUnit);
  }

  const validResults = results.filter((r) => !r.error && Number.isFinite(r.Ds));
  const groups = computeGroupStats(validResults);
  const individualPts = makeIndividualPoints(validResults, groups);

  const meanScatterData = groups.map((g) => ({
    concentration: g.concentration,
    Ds: g.mean,
    errorY: g.errorY,
    n: g.n,
  }));

  const lineData = groups.map((g) => ({
    concentration: g.concentration,
    Ds: g.mean,
  }));

  function csvCell(value: string): string {
    const escaped = value.replace(/"/g, '""');
    const safe = /^[=+\-@\t\r\n]/.test(escaped) ? `'${escaped}` : escaped;
    return `"${safe}"`;
  }

  function handleExport() {
    if (results.length === 0) return;
    const lines: string[] = [];
    lines.push("# Diffusion Coefficient Comparison");
    lines.push("# Model: U = k0 + a * exp(-b * t)");
    lines.push(`# Concentration unit: ${concUnitLabel}`);
    lines.push("");
    lines.push("title,concentration,Ds,tau_min,cutoff_satisfied,R2,trimmed_points,error");
    for (const r of results) {
      lines.push(
        [
          csvCell(r.title),
          r.concentration,
          r.error ? "" : r.Ds,
          r.error ? "" : r.tauMin,
          r.error ? "" : r.satisfied,
          r.error ? "" : r.rSquared,
          r.error ? "" : r.trimmedCount,
          r.error ? csvCell(r.error) : "",
        ].join(","),
      );
    }
    if (groups.length > 0) {
      lines.push("");
      lines.push("# Group statistics");
      lines.push("concentration,n,mean_Ds,sd_Ds");
      for (const g of groups) {
        lines.push(`${g.concentration},${g.n},${g.mean},${g.sd}`);
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "comparison_results.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const errorCount = results.filter((r) => r.error).length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="text-muted-foreground mb-2 -ml-2"
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to fitter
            </Button>
            <h2 className="text-xl font-semibold">Comparison Plot</h2>
            <p className="text-sm text-muted-foreground">
              Fit multiple datasets and plot D<sub>s</sub> vs. salt
              concentration with error bars.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" onClick={addEntry}>
              <Plus className="h-4 w-4 mr-1.5" /> Add dataset
            </Button>
            <Button
              variant="outline"
              onClick={clearAll}
              className="text-destructive hover:text-destructive"
              title="Clear all datasets and reset saved state"
            >
              <Eraser className="h-4 w-4 mr-1.5" /> Clear all
            </Button>
            <Button onClick={runAll} disabled={entries.length === 0}>
              <Play className="h-4 w-4 mr-1.5" /> Run all &amp; plot
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {entries.map((entry, i) => (
            <DatasetCard
              key={entry.id}
              entry={entry}
              index={i}
              onChange={updateEntry}
              onRemove={() => removeEntry(entry.id)}
              result={results.find((r) => r.id === entry.id)}
            />
          ))}
          {entries.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No datasets added. Click <em>Add dataset</em> to begin.
            </div>
          )}
        </div>

        {hasRun && errorCount > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>
              {errorCount} dataset{errorCount === 1 ? "" : "s"} failed
            </AlertTitle>
            <AlertDescription>
              Check the inline error messages on each card above.
            </AlertDescription>
          </Alert>
        )}

        {hasRun && validResults.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">
                  D<sub>s</sub> vs. Concentration
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Large dots = group mean. Error bars = ±SD (n ≥ 3) or ±SE
                  (n = 2). Small dots = individual measurements.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleExportChart}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Save chart
                </Button>
                <Button variant="outline" size="sm" onClick={handleExport}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div ref={chartRef} className="h-[380px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart margin={{ top: 10, right: 24, bottom: 32, left: 16 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      dataKey="concentration"
                      type="number"
                      name="Concentration"
                      domain={["auto", "auto"]}
                      tickFormatter={(v) => String(v)}
                      label={{
                        value: `Concentration (${concUnitLabel})`,
                        position: "insideBottom",
                        offset: -16,
                        style: {
                          fontSize: 12,
                          fill: "hsl(var(--muted-foreground))",
                        },
                      }}
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <YAxis
                      dataKey="Ds"
                      type="number"
                      name="Ds"
                      tickFormatter={(v) => formatSci(v, 2)}
                      label={{
                        value: "Ds (cm²/s)",
                        angle: -90,
                        position: "insideLeft",
                        offset: 8,
                        style: {
                          fontSize: 12,
                          fill: "hsl(var(--muted-foreground))",
                        },
                      }}
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                      width={72}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0]?.payload as Record<string, unknown>;
                        return (
                          <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
                            {!!d.title && (
                              <div className="font-medium mb-1">
                                {String(d.title)}
                              </div>
                            )}
                            <div>
                              Concentration:{" "}
                              <span className="font-mono">
                                {formatSci(Number(d.concentration) ?? Number(d.jittered), 4)}
                              </span>{" "}
                              {concUnitLabel}
                            </div>
                            <div>
                              D<sub>s</sub>:{" "}
                              <span className="font-mono">
                                {formatSci(Number(d.Ds), 4)}
                              </span>
                            </div>
                            {Number.isFinite(Number(d.errorY)) &&
                              Number(d.errorY) > 0 && (
                                <div>
                                  {Number(d.n) === 2 ? "±SE" : "±SD"}:{" "}
                                  <span className="font-mono">
                                    {formatSci(Number(d.errorY), 3)}
                                  </span>
                                </div>
                              )}
                          </div>
                        );
                      }}
                    />
                    <Legend
                      verticalAlign="top"
                      wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
                    />

                    {individualPts.length > 0 && (
                      <Scatter
                        name="Individual measurements"
                        data={individualPts.map((p) => ({
                          concentration: p.jittered,
                          Ds: p.Ds,
                          title: p.title,
                        }))}
                        fill="hsl(var(--chart-1))"
                        fillOpacity={0.4}
                        r={4}
                      />
                    )}

                    {groups.length >= 2 && (
                      <Line
                        name="Mean trend"
                        data={lineData}
                        dataKey="Ds"
                        stroke="hsl(var(--chart-3))"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        dot={false}
                        isAnimationActive={false}
                      />
                    )}

                    <Scatter
                      name="Group mean ± SD"
                      data={meanScatterData}
                      fill="hsl(var(--chart-1))"
                      r={7}
                    >
                      <ErrorBar
                        dataKey="errorY"
                        direction="y"
                        width={6}
                        stroke="hsl(var(--chart-1))"
                        strokeWidth={2}
                      />
                    </Scatter>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {groups.length > 0 && (
                <div className="mt-4 rounded-md border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          Concentration ({concUnitLabel})
                        </TableHead>
                        <TableHead>n</TableHead>
                        <TableHead>Mean D<sub>s</sub></TableHead>
                        <TableHead>SD / SE</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groups.map((g) => (
                        <TableRow key={g.concentration}>
                          <TableCell className="font-mono">
                            {g.concentration}
                          </TableCell>
                          <TableCell>{g.n}</TableCell>
                          <TableCell className="font-mono">
                            {formatSci(g.mean)}
                          </TableCell>
                          <TableCell className="font-mono">
                            {g.n > 1
                              ? `${formatSci(g.errorY)}${g.n === 2 ? " (SE)" : ""}`
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {hasRun && results.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">All results</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>
                        Conc. ({concUnitLabel})
                      </TableHead>
                      <TableHead>D<sub>s</sub></TableHead>
                      <TableHead>τ_min</TableHead>
                      <TableHead>Cutoff</TableHead>
                      <TableHead>R²</TableHead>
                      <TableHead>Trimmed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r) => (
                      <TableRow
                        key={r.id}
                        className={r.error ? "text-muted-foreground" : ""}
                      >
                        <TableCell>{r.title}</TableCell>
                        <TableCell className="font-mono">
                          {Number.isFinite(r.concentration)
                            ? r.concentration
                            : "—"}
                        </TableCell>
                        <TableCell className="font-mono">
                          {r.error ? (
                            <span className="text-destructive text-xs">
                              {r.error}
                            </span>
                          ) : (
                            formatSci(r.Ds)
                          )}
                        </TableCell>
                        <TableCell className="font-mono">
                          {r.error ? "—" : formatSci(r.tauMin, 3)}
                        </TableCell>
                        <TableCell>
                          {!r.error &&
                            (r.satisfied ? (
                              <Badge variant="default" className="gap-1 text-xs">
                                <CheckCircle2 className="h-3 w-3" /> OK
                              </Badge>
                            ) : (
                              <Badge
                                variant="destructive"
                                className="gap-1 text-xs"
                              >
                                <AlertCircle className="h-3 w-3" /> Not met
                              </Badge>
                            ))}
                        </TableCell>
                        <TableCell className="font-mono">
                          {r.error ? "—" : r.rSquared.toFixed(4)}
                        </TableCell>
                        <TableCell className="font-mono">
                          {r.error ? "—" : r.trimmedCount}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
    </div>
  );
}
