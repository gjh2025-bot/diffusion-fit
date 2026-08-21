import { useMemo, useRef, useState } from "react";
import ComparisonPage from "@/pages/ComparisonPage";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ComposedChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertCircle,
  BarChart2,
  Battery,
  CheckCircle2,
  Download,
  Eraser,
  Loader2,
  Play,
  Square,
  Upload,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

import {
  buildGuessGrid,
  diffusionCoefficient,
  dimensionlessTime,
  fitDecay,
  fitDecayWithGuess,
  generateCurve,
  iterativeFitWithCutoff,
  type FitResult,
  type IterativeFitResult,
  type Point,
} from "@/lib/fit";
import { parseDataset } from "@/lib/parse";

const SAMPLE_DATA = `t,U
0,0.0312
2,0.0274
5,0.0228
10,0.0173
20,0.0108
40,0.0048
60,0.0024
90,0.0010
120,0.0005`;

function formatNumber(v: number, digits = 6): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs < 1e-3 || abs >= 1e4) return v.toExponential(digits);
  return v.toPrecision(digits);
}

function App() {
  const { toast } = useToast();
  const [view, setView] = useState<"fitter" | "comparison">("fitter");
  const [rawData, setRawData] = useState<string>(SAMPLE_DATA);
  const [k0Input, setK0Input] = useState<string>("0");
  const [lInput, setLInput] = useState<string>("0.001");
  const [thresholdInput, setThresholdInput] = useState<string>("0.03");
  const [autoTrim, setAutoTrim] = useState<boolean>(true);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [fit, setFit] = useState<FitResult | null>(null);
  const [iterative, setIterative] = useState<IterativeFitResult | null>(null);
  const [usedPoints, setUsedPoints] = useState<Point[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoOptimize, setAutoOptimize] = useState<boolean>(false);
  const [r2TargetInput, setR2TargetInput] = useState<string>("0.9");
  const [maxAttemptsInput, setMaxAttemptsInput] = useState<string>("20");
  const [optimizing, setOptimizing] = useState<boolean>(false);
  const [optimizeAttempt, setOptimizeAttempt] = useState<number>(0);
  const [optimizeSummary, setOptimizeSummary] = useState<{
    attempts: number;
    targetMet: boolean;
    bestR2: number;
  } | null>(null);
  const runIdRef = useRef<number>(0);

  const points = useMemo<Point[]>(() => {
    const r = parseDataset(rawData);
    return r.points;
  }, [rawData]);

  const k0Value = useMemo(() => {
    const n = Number(k0Input);
    return Number.isFinite(n) ? n : 0;
  }, [k0Input]);

  const lValue = useMemo(() => {
    const n = Number(lInput);
    return Number.isFinite(n) && n > 0 ? n : NaN;
  }, [lInput]);

  const thresholdValue = useMemo(() => {
    const n = Number(thresholdInput);
    return Number.isFinite(n) && n > 0 ? n : 0.03;
  }, [thresholdInput]);

  const r2TargetValue = useMemo(() => {
    const n = Number(r2TargetInput);
    return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.9;
  }, [r2TargetInput]);

  const maxAttemptsValue = useMemo(() => {
    const n = Math.round(Number(maxAttemptsInput));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, 200) : 20;
  }, [maxAttemptsInput]);

  const diffusion = useMemo(() => {
    if (!fit || !Number.isFinite(lValue)) return null;
    const tMin = usedPoints.length > 0 ? usedPoints[0].t : NaN;
    const Ds = diffusionCoefficient(fit.b, lValue);
    const tauMin = Number.isFinite(tMin)
      ? dimensionlessTime(fit.b, tMin)
      : NaN;
    return {
      Ds,
      tauMin,
      tMin,
      satisfied: Number.isFinite(tauMin) && tauMin >= thresholdValue,
    };
  }, [fit, lValue, thresholdValue, usedPoints]);

  const usedSet = useMemo(() => {
    const s = new Set<number>();
    usedPoints.forEach((p) => s.add(p.t));
    return s;
  }, [usedPoints]);

  const chartData = useMemo(() => {
    if (points.length === 0) return [] as Array<Record<string, number>>;
    const tMin = points[0].t;
    const tMax = points[points.length - 1].t;
    const span = tMax - tMin || 1;
    const padded = generateCurve(
      fit?.k0 ?? k0Value,
      fit?.a ?? 0,
      fit?.b ?? 0,
      tMin - span * 0.02,
      tMax + span * 0.02,
      240,
    );

    const merged = new Map<number, Record<string, number>>();
    for (const p of points) {
      const isUsed = usedSet.size === 0 || usedSet.has(p.t);
      merged.set(p.t, {
        t: p.t,
        ...(isUsed ? { measured: p.U } : { excluded: p.U }),
      });
    }
    if (fit) {
      for (const c of padded) {
        const existing = merged.get(c.t) ?? { t: c.t };
        existing.fit = c.U;
        merged.set(c.t, existing);
      }
    }
    return Array.from(merged.values()).sort((a, b) => a.t - b.t);
  }, [points, fit, k0Value, usedSet]);

  const handleStopOptimize = () => {
    runIdRef.current += 1;
    // Do NOT call setOptimizing(false) here — the active step() will do it
    // on its next tick after detecting the token mismatch.
  };

  const handleRunFit = () => {
    if (optimizing) return;
    setError(null);
    setOptimizeSummary(null);
    const parsed = parseDataset(rawData);
    setParseWarnings(parsed.warnings);
    if (parsed.points.length < 3) {
      setError("Provide at least 3 (t, U) data rows to fit a and b.");
      setFit(null);
      setIterative(null);
      setUsedPoints([]);
      return;
    }
    if (!Number.isFinite(k0Value)) {
      setError("k0 must be a finite number.");
      return;
    }

    // ── Plain (single-start) path ──────────────────────────────────────────
    if (!autoOptimize) {
      if (autoTrim) {
        if (!Number.isFinite(lValue)) {
          setError(
            "Electrolyte thickness l must be a positive number when auto-trim is on.",
          );
          return;
        }
        try {
          const iter = iterativeFitWithCutoff(
            parsed.points,
            k0Value,
            lValue,
            thresholdValue,
          );
          setIterative(iter);
          setFit(iter.finalStep.fit);
          const sorted = [...parsed.points].sort((a, b) => a.t - b.t);
          const drop = iter.finalStep.excludedIndices.length;
          setUsedPoints(sorted.slice(drop));
          if (iter.converged) {
            toast({
              title: "Fit satisfies cutoff",
              description: `τ_min = ${iter.finalStep.diffusion.tauMin.toFixed(4)} ≥ ${thresholdValue}  •  trimmed ${drop} early point(s)`,
            });
          } else {
            toast({
              title: "Cutoff not reached",
              description:
                "Could not satisfy τ ≥ threshold without dropping below 3 points. Showing the best attempt.",
              variant: "destructive",
            });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Fit failed.";
          setError(msg);
          setFit(null);
          setIterative(null);
          setUsedPoints([]);
        }
        return;
      }

      try {
        const result = fitDecay(parsed.points, k0Value);
        setFit(result);
        setIterative(null);
        setUsedPoints([...parsed.points].sort((a, b) => a.t - b.t));
        toast({
          title: "Fit complete",
          description: `R² = ${result.rSquared.toFixed(5)}  •  ${result.iterations} iterations`,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Fit failed.";
        setError(msg);
        setFit(null);
        setIterative(null);
        setUsedPoints([]);
      }
      return;
    }

    // ── Multi-start (auto-optimize) path ──────────────────────────────────
    // Step 1: determine the point subset (run auto-trim first if enabled).
    let ptsToOptimize: Point[] = [];
    if (autoTrim) {
      if (!Number.isFinite(lValue)) {
        setError(
          "Electrolyte thickness l must be a positive number when auto-trim is on.",
        );
        return;
      }
      try {
        const iter = iterativeFitWithCutoff(
          parsed.points,
          k0Value,
          lValue,
          thresholdValue,
        );
        const sorted = [...parsed.points].sort((a, b) => a.t - b.t);
        const drop = iter.finalStep.excludedIndices.length;
        ptsToOptimize = sorted.slice(drop);
        setIterative(iter);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Auto-trim failed.";
        setError(msg);
        return;
      }
    } else {
      ptsToOptimize = [...parsed.points].sort((a, b) => a.t - b.t);
      setIterative(null);
    }

    if (ptsToOptimize.length < 3) {
      setError("Too few points remain after trimming to run optimization.");
      return;
    }

    // Step 2: build the guess grid and start the async loop.
    const guesses = buildGuessGrid(ptsToOptimize, k0Value, maxAttemptsValue);
    // Capture targets in local vars so they remain stable across all ticks.
    const r2Target = r2TargetValue;
    const sortedPts = ptsToOptimize;

    // Assign a unique token to this run.  Any previous loop still draining
    // from a prior setTimeout will detect the mismatch and exit cleanly.
    runIdRef.current += 1;
    const myRunId = runIdRef.current;
    setOptimizing(true);
    setOptimizeAttempt(0);

    let attempt = 0;
    let bestFit: FitResult | null = null;

    function step() {
      const cancelled = runIdRef.current !== myRunId;

      if (cancelled || attempt >= guesses.length) {
        // Always reset the running indicator.
        setOptimizing(false);
        if (!cancelled) {
          if (bestFit) {
            // Natural completion — show summary and toast.
            setFit(bestFit);
            setUsedPoints(sortedPts);
            const targetMet = bestFit.rSquared >= r2Target;
            const s = attempt === 1 ? "" : "s";
            setOptimizeSummary({
              attempts: attempt,
              targetMet,
              bestR2: bestFit.rSquared,
            });
            toast({
              title: targetMet ? "R² target reached" : "Optimization complete",
              description: targetMet
                ? `Best R² = ${bestFit.rSquared.toFixed(5)} in ${attempt} attempt${s}`
                : `Best R² = ${bestFit.rSquared.toFixed(5)} (target ${r2Target} not reached) in ${attempt} attempt${s}`,
              variant: targetMet ? undefined : "destructive",
            });
          } else {
            // Every attempt failed validity checks — clear stale results.
            setFit(null);
            setUsedPoints([]);
            setOptimizeSummary(null);
            setError(
              "All optimization attempts failed to converge. Try adjusting k₀ or reducing the data range.",
            );
          }
        }
        // If cancelled, exit silently — no toast, no summary update.
        return;
      }

      const { a, b } = guesses[attempt];
      try {
        const result = fitDecayWithGuess(sortedPts, k0Value, a, b);
        if (
          Number.isFinite(result.rSquared) &&
          result.converged &&
          result.b > 0 &&
          (!bestFit || result.rSquared > bestFit.rSquared)
        ) {
          bestFit = result;
          setFit(result);
          setUsedPoints(sortedPts);
        }
      } catch {
        // ignore failed individual attempts
      }

      attempt++;
      setOptimizeAttempt(attempt);

      // Early-exit when the target is met (still guards against cancellation).
      if (bestFit && bestFit.rSquared >= r2Target) {
        if (runIdRef.current === myRunId) {
          setOptimizing(false);
          const s = attempt === 1 ? "" : "s";
          setOptimizeSummary({
            attempts: attempt,
            targetMet: true,
            bestR2: bestFit.rSquared,
          });
          setFit(bestFit);
          setUsedPoints(sortedPts);
          toast({
            title: "R² target reached",
            description: `Best R² = ${bestFit.rSquared.toFixed(5)} in ${attempt} attempt${s}`,
          });
        } else {
          setOptimizing(false);
        }
        return;
      }

      setTimeout(step, 0);
    }

    setTimeout(step, 0);
  };

  const handleClear = () => {
    runIdRef.current += 1; // invalidate any running loop
    setOptimizing(false);
    setOptimizeAttempt(0);
    setOptimizeSummary(null);
    setRawData("");
    setFit(null);
    setIterative(null);
    setUsedPoints([]);
    setError(null);
    setParseWarnings([]);
  };

  const handleLoadSample = () => {
    setRawData(SAMPLE_DATA);
    setK0Input("0");
    setFit(null);
    setIterative(null);
    setUsedPoints([]);
    setError(null);
    setParseWarnings([]);
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setRawData(text);
      setFit(null);
      setError(null);
    };
    reader.onerror = () => {
      toast({
        title: "Could not read file",
        description: "Try pasting the data into the text box instead.",
        variant: "destructive",
      });
    };
    reader.readAsText(file);
  };

  const handleDownloadResults = () => {
    if (!fit) return;
    const lines: string[] = [];
    lines.push("# Diffusion Coefficient Fit Results");
    lines.push("# Model: U = k0 + a * exp(-b * t)");
    lines.push(`# k0 (input): ${fit.k0}`);
    lines.push(`# a (fitted): ${fit.a}`);
    lines.push(`# b (fitted): ${fit.b}`);
    lines.push(`# tau_char = 1/b: ${1 / fit.b}`);
    lines.push(`# R^2: ${fit.rSquared}`);
    lines.push(`# RMSE: ${fit.rmse}`);
    lines.push(`# Iterations: ${fit.iterations}`);
    if (diffusion) {
      lines.push(`# l (electrolyte thickness): ${lValue}`);
      lines.push(`# Ds = l^2 * b / pi^2: ${diffusion.Ds}`);
      lines.push(`# t_min (used): ${diffusion.tMin}`);
      lines.push(`# tau_min = b*t_min/pi^2: ${diffusion.tauMin}`);
      lines.push(`# tau threshold: ${thresholdValue}`);
      lines.push(`# cutoff satisfied: ${diffusion.satisfied}`);
    }
    if (iterative) {
      lines.push(`# auto-trim attempts: ${iterative.steps.length}`);
      lines.push(
        `# excluded earliest points: ${iterative.finalStep.excludedIndices.length}`,
      );
    }
    lines.push("");
    const sorted = [...points].sort((a, b) => a.t - b.t);
    const usedTs = new Set(usedPoints.map((p) => p.t));
    lines.push("t,U_measured,U_predicted,residual,used_in_fit");
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const usedIdx = usedPoints.findIndex((u) => u.t === p.t);
      const pred = usedIdx >= 0 ? fit.predicted[usedIdx] : "";
      const res = usedIdx >= 0 ? fit.residuals[usedIdx] : "";
      lines.push(`${p.t},${p.U},${pred},${res},${usedTs.has(p.t) ? 1 : 0}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fit_results.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen w-full bg-background text-foreground">
        <header className="border-b border-border bg-card">
          <div className="mx-auto max-w-7xl px-6 py-5 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Battery className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                Open-Circuit Potential Decay Fitter
              </h1>
              <p className="text-sm text-muted-foreground">
                Fit{" "}
                <span className="font-mono">
                  U(t) = k₀ + a·exp(−b·t)
                </span>{" "}
                to extract <span className="font-mono">a</span> and{" "}
                <span className="font-mono">b</span> from your relaxation data.
              </p>
            </div>
          </div>
        </header>

        {view === "comparison" ? (
          <ComparisonPage onBack={() => setView("fitter")} />
        ) : (
        <>
        <main className="mx-auto max-w-7xl px-6 py-8 grid gap-6 lg:grid-cols-[420px_1fr]">
          <section className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">1. Input parameters</CardTitle>
                <CardDescription>
                  Offset voltage k₀ is held fixed. Electrolyte thickness l is
                  used to compute D<sub>s</sub> = l²·b/π² and the
                  dimensionless-time cutoff.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="k0">k₀ — offset voltage (V)</Label>
                  <Input
                    id="k0"
                    type="number"
                    step="any"
                    value={k0Input}
                    onChange={(e) => setK0Input(e.target.value)}
                    className="font-mono"
                    disabled={optimizing}
                  />
                  <p className="text-xs text-muted-foreground">
                    Tip: use the steady-state voltage at long resting times.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="l">l — electrolyte thickness</Label>
                  <Input
                    id="l"
                    type="number"
                    step="any"
                    value={lInput}
                    onChange={(e) => setLInput(e.target.value)}
                    className="font-mono"
                    placeholder="e.g. 0.001 (cm)"
                    disabled={optimizing}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use the same length unit you want for D<sub>s</sub> (e.g.
                    cm → cm²/time-unit). Time-unit comes from your{" "}
                    <span className="font-mono">t</span> column.
                  </p>
                </div>

                <div className="rounded-md border border-border bg-secondary/40 p-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <Label
                        htmlFor="auto-trim"
                        className="text-sm font-medium"
                      >
                        Auto-trim early-time data
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Iteratively drop the earliest points until{" "}
                        <span className="font-mono">
                          τ = D<sub>s</sub>·t<sub>min</sub>/l²
                        </span>{" "}
                        ≥ threshold.
                      </p>
                    </div>
                    <Switch
                      id="auto-trim"
                      checked={autoTrim}
                      onCheckedChange={setAutoTrim}
                      disabled={optimizing}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="threshold" className="text-xs">
                      τ threshold
                    </Label>
                    <Input
                      id="threshold"
                      type="number"
                      step="any"
                      value={thresholdInput}
                      onChange={(e) => setThresholdInput(e.target.value)}
                      className="font-mono h-8 text-sm"
                      disabled={!autoTrim || optimizing}
                    />
                  </div>
                </div>

                <div className="rounded-md border border-border bg-secondary/40 p-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <Label
                        htmlFor="auto-optimize"
                        className="text-sm font-medium"
                      >
                        Auto-optimize R²
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Try multiple initial-guess combinations to maximise R².
                      </p>
                    </div>
                    <Switch
                      id="auto-optimize"
                      checked={autoOptimize}
                      onCheckedChange={setAutoOptimize}
                      disabled={optimizing}
                    />
                  </div>
                  {autoOptimize && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="r2-target" className="text-xs">
                          R² target
                        </Label>
                        <Input
                          id="r2-target"
                          type="number"
                          step="0.01"
                          min="0"
                          max="1"
                          value={r2TargetInput}
                          onChange={(e) => setR2TargetInput(e.target.value)}
                          className="font-mono h-8 text-sm"
                          disabled={optimizing}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="max-attempts" className="text-xs">
                          Max attempts
                        </Label>
                        <Input
                          id="max-attempts"
                          type="number"
                          step="1"
                          min="1"
                          max="200"
                          value={maxAttemptsInput}
                          onChange={(e) => setMaxAttemptsInput(e.target.value)}
                          className="font-mono h-8 text-sm"
                          disabled={optimizing}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">2. Experimental data</CardTitle>
                <CardDescription>
                  Two columns: rest time <span className="font-mono">t</span>{" "}
                  and open-circuit potential{" "}
                  <span className="font-mono">U</span>. Header row optional.
                  Comma, tab, semicolon, or space separated.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={rawData}
                  onChange={(e) => setRawData(e.target.value)}
                  rows={12}
                  placeholder={"t,U\n0,0.031\n2,0.027\n5,0.022\n..."}
                  className="font-mono text-xs"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleLoadSample}
                  >
                    Load sample
                  </Button>
                  <label className="inline-flex">
                    <input
                      type="file"
                      accept=".csv,.txt,.tsv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFileUpload(f);
                        e.target.value = "";
                      }}
                    />
                    <Button variant="secondary" size="sm" asChild>
                      <span className="cursor-pointer">
                        <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload CSV
                      </span>
                    </Button>
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClear}
                    className="text-muted-foreground"
                  >
                    <Eraser className="h-3.5 w-3.5 mr-1.5" /> Clear
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  Detected: <span className="font-mono">{points.length}</span>{" "}
                  data point{points.length === 1 ? "" : "s"}.
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                {optimizing ? (
                  <Button
                    size="lg"
                    variant="destructive"
                    onClick={handleStopOptimize}
                    className="flex-1"
                  >
                    <Square className="h-4 w-4 mr-2 fill-current" /> Stop
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    onClick={handleRunFit}
                    disabled={points.length < 3}
                    className="flex-1"
                  >
                    <Play className="h-4 w-4 mr-2" /> Run fit
                  </Button>
                )}
                <Button
                  size="lg"
                  variant="secondary"
                  onClick={() => setView("comparison")}
                  disabled={optimizing}
                >
                  <BarChart2 className="h-4 w-4 mr-2" /> Comparison plot
                </Button>
              </div>
              {optimizing && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  <span>
                    Attempt {optimizeAttempt + 1} / {maxAttemptsValue}
                    {fit && (
                      <span className="ml-2 font-mono text-foreground">
                        R² = {fit.rSquared.toFixed(5)}
                      </span>
                    )}
                  </span>
                </div>
              )}
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Fit error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {parseWarnings.length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Parsing notes</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 space-y-0.5 text-xs">
                      {parseWarnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </section>

          <section className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base">Fit results</CardTitle>
                  <CardDescription>
                    Nonlinear least squares (Levenberg–Marquardt) with k₀ held
                    fixed.
                  </CardDescription>
                </div>
                {fit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadResults}
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {!fit ? (
                  <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    Enter your data and click <em>Run fit</em> to get values
                    for a and b.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <ResultStat
                        label="a"
                        value={formatNumber(fit.a)}
                        hint="amplitude (V)"
                      />
                      <ResultStat
                        label="b"
                        value={formatNumber(fit.b)}
                        hint="decay rate (1/time-unit)"
                      />
                      <ResultStat
                        label="τ_char = 1/b"
                        value={formatNumber(1 / fit.b, 6)}
                        hint="characteristic time"
                      />
                      <ResultStat
                        label="k₀ (fixed)"
                        value={formatNumber(fit.k0, 6)}
                        hint="offset (V)"
                      />
                      <ResultStat
                        label="R²"
                        value={fit.rSquared.toFixed(6)}
                        hint="goodness of fit"
                      />
                      <ResultStat
                        label="RMSE"
                        value={formatNumber(fit.rmse, 4)}
                        hint={`${fit.iterations} LM iterations`}
                      />
                    </div>

                    {optimizeSummary && (
                      <div
                        className={`rounded-md border px-3 py-2 text-xs flex items-center gap-2 ${
                          optimizeSummary.targetMet
                            ? "border-primary/40 bg-primary/5 text-primary"
                            : "border-destructive/40 bg-destructive/5 text-destructive"
                        }`}
                      >
                        {optimizeSummary.targetMet ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span>
                          {optimizeSummary.targetMet
                            ? `R² target (${r2TargetValue}) reached`
                            : `R² target (${r2TargetValue}) not reached`}
                          {" · "}best R²{" "}
                          <span className="font-mono">
                            {optimizeSummary.bestR2.toFixed(5)}
                          </span>{" "}
                          in {optimizeSummary.attempts}{" "}
                          attempt{optimizeSummary.attempts !== 1 ? "s" : ""}
                        </span>
                      </div>
                    )}

                    {diffusion && (
                      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-xs uppercase tracking-wide text-primary">
                              Diffusion coefficient
                            </div>
                            <div className="font-mono text-2xl font-semibold mt-1">
                              D<sub>s</sub> = {formatNumber(diffusion.Ds, 4)}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              units = (length unit of l)² / (time unit of t)
                              <br />
                              D<sub>s</sub> = l²·b/π²  with l ={" "}
                              <span className="font-mono">
                                {formatNumber(lValue, 4)}
                              </span>
                            </div>
                          </div>
                          {Number.isFinite(diffusion.tauMin) && (
                            <div className="text-right">
                              <Badge
                                variant={
                                  diffusion.satisfied
                                    ? "default"
                                    : "destructive"
                                }
                                className="gap-1"
                              >
                                {diffusion.satisfied ? (
                                  <CheckCircle2 className="h-3 w-3" />
                                ) : (
                                  <AlertCircle className="h-3 w-3" />
                                )}
                                {diffusion.satisfied
                                  ? "Cutoff satisfied"
                                  : "Cutoff not met"}
                              </Badge>
                              <div className="font-mono text-sm mt-1">
                                τ<sub>min</sub> ={" "}
                                {formatNumber(diffusion.tauMin, 4)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                t<sub>min</sub> ={" "}
                                <span className="font-mono">
                                  {formatNumber(diffusion.tMin, 4)}
                                </span>{" "}
                                · threshold {thresholdValue}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {iterative && iterative.steps.length > 1 && (
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-2">
                          Auto-trim history ({iterative.steps.length}{" "}
                          attempt{iterative.steps.length === 1 ? "" : "s"})
                        </div>
                        <div className="rounded-md border border-border overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-12">#</TableHead>
                                <TableHead>Dropped</TableHead>
                                <TableHead>n used</TableHead>
                                <TableHead>t_min</TableHead>
                                <TableHead>b</TableHead>
                                <TableHead>τ_min</TableHead>
                                <TableHead>R²</TableHead>
                                <TableHead className="w-12"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {iterative.steps.map((s) => {
                                const isFinal = s === iterative.finalStep;
                                return (
                                  <TableRow
                                    key={s.attempt}
                                    className={
                                      isFinal
                                        ? "bg-primary/5 font-medium"
                                        : ""
                                    }
                                  >
                                    <TableCell>{s.attempt}</TableCell>
                                    <TableCell>
                                      {s.excludedIndices.length}
                                    </TableCell>
                                    <TableCell>{s.fittedCount}</TableCell>
                                    <TableCell className="font-mono">
                                      {formatNumber(s.tMin, 4)}
                                    </TableCell>
                                    <TableCell className="font-mono">
                                      {formatNumber(s.fit.b, 4)}
                                    </TableCell>
                                    <TableCell className="font-mono">
                                      {formatNumber(
                                        s.diffusion.tauMin,
                                        4,
                                      )}
                                    </TableCell>
                                    <TableCell className="font-mono">
                                      {s.fit.rSquared.toFixed(4)}
                                    </TableCell>
                                    <TableCell>
                                      {s.diffusion.satisfied ? (
                                        <CheckCircle2 className="h-4 w-4 text-primary" />
                                      ) : (
                                        <AlertCircle className="h-4 w-4 text-muted-foreground" />
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                      Initial guesses (from log-linearization): a₀ ={" "}
                      <span className="font-mono">
                        {formatNumber(fit.initialGuess.a, 4)}
                      </span>
                      , b₀ ={" "}
                      <span className="font-mono">
                        {formatNumber(fit.initialGuess.b, 4)}
                      </span>
                      .
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Visualization</CardTitle>
                <CardDescription>
                  Scatter = measurements. Solid line = fitted model.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="fit">
                  <TabsList>
                    <TabsTrigger value="fit">Data &amp; fit</TabsTrigger>
                    <TabsTrigger value="residuals" disabled={!fit}>
                      Residuals
                    </TabsTrigger>
                    <TabsTrigger value="table" disabled={!fit}>
                      Table
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="fit">
                    <div className="h-[360px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="hsl(var(--border))"
                          />
                          <XAxis
                            dataKey="t"
                            type="number"
                            domain={["dataMin", "dataMax"]}
                            stroke="hsl(var(--muted-foreground))"
                            tick={{ fontSize: 12 }}
                            label={{
                              value: "Resting time t",
                              position: "insideBottom",
                              offset: -4,
                              fill: "hsl(var(--muted-foreground))",
                              fontSize: 12,
                            }}
                          />
                          <YAxis
                            stroke="hsl(var(--muted-foreground))"
                            tick={{ fontSize: 12 }}
                            domain={["auto", "auto"]}
                            label={{
                              value: "Open-circuit potential U",
                              angle: -90,
                              position: "insideLeft",
                              fill: "hsl(var(--muted-foreground))",
                              fontSize: 12,
                              style: { textAnchor: "middle" },
                            }}
                          />
                          <Tooltip
                            contentStyle={{
                              background: "hsl(var(--popover))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "var(--radius)",
                              fontSize: 12,
                            }}
                            formatter={(v: number) => formatNumber(v, 5)}
                          />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                          {fit && (
                            <ReferenceLine
                              y={fit.k0}
                              stroke="hsl(var(--muted-foreground))"
                              strokeDasharray="4 4"
                              label={{
                                value: "k₀",
                                fill: "hsl(var(--muted-foreground))",
                                fontSize: 11,
                                position: "right",
                              }}
                            />
                          )}
                          <Scatter
                            name="Measured (used)"
                            dataKey="measured"
                            fill="hsl(var(--chart-1))"
                          />
                          <Scatter
                            name="Excluded"
                            dataKey="excluded"
                            fill="hsl(var(--muted-foreground))"
                            shape="cross"
                          />
                          {fit && (
                            <Line
                              name="Fitted U(t)"
                              dataKey="fit"
                              stroke="hsl(var(--chart-3))"
                              strokeWidth={2}
                              dot={false}
                              isAnimationActive={false}
                            />
                          )}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </TabsContent>

                  <TabsContent value="residuals">
                    <div className="h-[300px] w-full">
                      {fit && (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart
                            data={usedPoints.map((p, i) => ({
                              t: p.t,
                              residual: fit.residuals[i],
                            }))}
                          >
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="hsl(var(--border))"
                            />
                            <XAxis
                              dataKey="t"
                              type="number"
                              domain={["dataMin", "dataMax"]}
                              stroke="hsl(var(--muted-foreground))"
                              tick={{ fontSize: 12 }}
                            />
                            <YAxis
                              stroke="hsl(var(--muted-foreground))"
                              tick={{ fontSize: 12 }}
                              domain={["auto", "auto"]}
                            />
                            <ReferenceLine
                              y={0}
                              stroke="hsl(var(--muted-foreground))"
                            />
                            <Tooltip
                              contentStyle={{
                                background: "hsl(var(--popover))",
                                border: "1px solid hsl(var(--border))",
                                borderRadius: "var(--radius)",
                                fontSize: 12,
                              }}
                              formatter={(v: number) => formatNumber(v, 5)}
                            />
                            <Line
                              type="monotone"
                              dataKey="residual"
                              stroke="hsl(var(--chart-2))"
                              strokeWidth={2}
                              dot={{ r: 3 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="table">
                    {fit && (
                      <div className="max-h-[360px] overflow-auto rounded-md border border-border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>t</TableHead>
                              <TableHead>U measured</TableHead>
                              <TableHead>U predicted</TableHead>
                              <TableHead>Residual</TableHead>
                              <TableHead>Used</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {[...points]
                              .sort((a, b) => a.t - b.t)
                              .map((p, i) => {
                                const usedIdx = usedPoints.findIndex(
                                  (u) => u.t === p.t,
                                );
                                const used = usedIdx >= 0;
                                return (
                                  <TableRow
                                    key={i}
                                    className={
                                      used
                                        ? ""
                                        : "text-muted-foreground"
                                    }
                                  >
                                    <TableCell className="font-mono">
                                      {formatNumber(p.t, 6)}
                                    </TableCell>
                                    <TableCell className="font-mono">
                                      {formatNumber(p.U, 6)}
                                    </TableCell>
                                    <TableCell className="font-mono">
                                      {used
                                        ? formatNumber(
                                            fit.predicted[usedIdx],
                                            6,
                                          )
                                        : "—"}
                                    </TableCell>
                                    <TableCell className="font-mono">
                                      {used
                                        ? formatNumber(
                                            fit.residuals[usedIdx],
                                            4,
                                          )
                                        : "—"}
                                    </TableCell>
                                    <TableCell>
                                      {used ? (
                                        <CheckCircle2 className="h-4 w-4 text-primary" />
                                      ) : (
                                        <span className="text-xs">
                                          excluded
                                        </span>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </section>
        </main>

        <footer className="border-t border-border mt-8 py-4">
          <div className="mx-auto max-w-7xl px-6 text-xs text-muted-foreground">
            Built for ion-transport diffusion analysis. All computation runs
            in your browser — your data never leaves the page.
          </div>
        </footer>
        </>
        )}
        <Toaster />
      </div>
    </TooltipProvider>
  );
}

function ResultStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

export default App;
