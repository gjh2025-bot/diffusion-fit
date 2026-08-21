import { levenbergMarquardt } from "ml-levenberg-marquardt";

export type Point = { t: number; U: number };

export type FitResult = {
  a: number;
  b: number;
  k0: number;
  rSquared: number;
  rmse: number;
  iterations: number;
  converged: boolean;
  residuals: number[];
  predicted: number[];
  initialGuess: { a: number; b: number };
};

export function model(k0: number) {
  return ([a, b]: number[]) =>
    (t: number) =>
      k0 + a * Math.exp(-b * t);
}

function linearInitialGuess(
  points: Point[],
  k0: number,
): { a: number; b: number } {
  const usable: { t: number; y: number }[] = [];
  let sign = 0;
  for (const p of points) {
    const diff = p.U - k0;
    if (diff === 0) continue;
    if (sign === 0) sign = diff > 0 ? 1 : -1;
    if (sign * diff > 0) {
      usable.push({ t: p.t, y: Math.log(Math.abs(diff)) });
    }
  }

  if (usable.length < 2) {
    const aGuess = points.length > 0 ? points[0].U - k0 : 0.001;
    return { a: aGuess === 0 ? 0.001 : aGuess, b: 0.01 };
  }

  let sumT = 0;
  let sumY = 0;
  let sumTT = 0;
  let sumTY = 0;
  const n = usable.length;
  for (const { t, y } of usable) {
    sumT += t;
    sumY += y;
    sumTT += t * t;
    sumTY += t * y;
  }
  const denom = n * sumTT - sumT * sumT;
  if (denom === 0) {
    return { a: sign * Math.exp(sumY / n), b: 0.01 };
  }
  const slope = (n * sumTY - sumT * sumY) / denom;
  const intercept = (sumY - slope * sumT) / n;
  const aGuess = sign * Math.exp(intercept);
  const bGuess = -slope;
  return {
    a: Number.isFinite(aGuess) && aGuess !== 0 ? aGuess : 0.001,
    b: Number.isFinite(bGuess) ? bGuess : 0.01,
  };
}

/**
 * Build a grid of (a, b) initial guesses for multi-start optimization.
 * The log-linearization guess is always first; the rest explore the
 * parameter space in logarithmic steps around it.
 */
export function buildGuessGrid(
  points: Point[],
  k0: number,
  maxGuesses: number,
): Array<{ a: number; b: number }> {
  const linear = linearInitialGuess(points, k0);
  const us = points.map((p) => p.U);
  const ts = points.map((p) => p.t);
  const uMin = Math.min(...us);
  const uMax = Math.max(...us);
  const uRange = uMax - uMin;
  const tRange = Math.max(...ts) - Math.min(...ts);

  const bCenter =
    Math.abs(linear.b) > 0 ? Math.abs(linear.b) : tRange > 0 ? 1 / tRange : 0.01;
  const bFactors = [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10, 30, 100];
  const bCandidates = bFactors
    .map((f) => bCenter * f)
    .filter((b) => b > 0 && Number.isFinite(b));

  const aCandidates = [
    linear.a,
    points[0].U - k0,
    points[points.length - 1].U - k0,
    uRange * 0.5,
    uRange,
    -uRange * 0.5,
    -uRange,
    uMax - k0,
    uMin - k0,
  ].filter((a) => Number.isFinite(a) && Math.abs(a) > 0);

  const seen = new Set<string>();
  const guesses: Array<{ a: number; b: number }> = [];

  function tryAdd(a: number, b: number) {
    if (guesses.length >= maxGuesses) return;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return;
    const key = `${a.toPrecision(3)}_${b.toPrecision(3)}`;
    if (seen.has(key)) return;
    seen.add(key);
    guesses.push({ a, b });
  }

  tryAdd(linear.a, Math.abs(linear.b) > 0 ? linear.b : bCenter);
  for (const b of bCandidates) {
    for (const a of aCandidates) {
      tryAdd(a, b);
    }
  }
  return guesses;
}

/**
 * Like fitDecay but accepts explicit initial guesses for a and b instead of
 * computing them from log-linearization. Used by the multi-start optimizer.
 */
export function fitDecayWithGuess(
  points: Point[],
  k0: number,
  aGuess: number,
  bGuess: number,
): FitResult {
  if (points.length < 3) {
    throw new Error(
      "At least 3 data points are required to fit two parameters.",
    );
  }
  const ts = points.map((p) => p.t);
  const us = points.map((p) => p.U);
  const fitFn = model(k0);

  const result = levenbergMarquardt({ x: ts, y: us }, fitFn, {
    damping: 1e-2,
    initialValues: [aGuess, bGuess],
    maxIterations: 500,
    errorTolerance: 1e-12,
    gradientDifference: 1e-7,
  });

  const [aFit, bFit] = result.parameterValues;
  const fn = fitFn([aFit, bFit]);
  const predicted = ts.map(fn);
  const residuals = us.map((u, i) => u - predicted[i]);
  const meanU = us.reduce((s, v) => s + v, 0) / us.length;
  const ssRes = residuals.reduce((s, r) => s + r * r, 0);
  const ssTot = us.reduce((s, v) => s + (v - meanU) ** 2, 0);
  const rSquared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  const rmse = Math.sqrt(ssRes / us.length);

  return {
    a: aFit,
    b: bFit,
    k0,
    rSquared,
    rmse,
    iterations: result.iterations,
    converged: Number.isFinite(aFit) && Number.isFinite(bFit),
    residuals,
    predicted,
    initialGuess: { a: aGuess, b: bGuess },
  };
}

export function fitDecay(points: Point[], k0: number): FitResult {
  if (points.length < 3) {
    throw new Error(
      "At least 3 data points are required to fit two parameters.",
    );
  }

  const ts = points.map((p) => p.t);
  const us = points.map((p) => p.U);
  const initial = linearInitialGuess(points, k0);

  const fitFn = model(k0);

  const result = levenbergMarquardt(
    { x: ts, y: us },
    fitFn,
    {
      damping: 1e-2,
      initialValues: [initial.a, initial.b],
      maxIterations: 500,
      errorTolerance: 1e-12,
      gradientDifference: 1e-7,
    },
  );

  const [aFit, bFit] = result.parameterValues;
  const fn = fitFn([aFit, bFit]);
  const predicted = ts.map(fn);
  const residuals = us.map((u, i) => u - predicted[i]);

  const meanU = us.reduce((s, v) => s + v, 0) / us.length;
  const ssRes = residuals.reduce((s, r) => s + r * r, 0);
  const ssTot = us.reduce((s, v) => s + (v - meanU) ** 2, 0);
  const rSquared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  const rmse = Math.sqrt(ssRes / us.length);

  return {
    a: aFit,
    b: bFit,
    k0,
    rSquared,
    rmse,
    iterations: result.iterations,
    converged: Number.isFinite(aFit) && Number.isFinite(bFit),
    residuals,
    predicted,
    initialGuess: initial,
  };
}

export type DiffusionResult = {
  Ds: number;
  tauMin: number;
  satisfied: boolean;
};

/** Ds = l² · b / π²  (b in 1/time, l in length → Ds in length²/time). */
export function diffusionCoefficient(b: number, l: number): number {
  return (l * l * b) / (Math.PI * Math.PI);
}

/** Dimensionless time τ = Ds · t / l² = b · t / π² (independent of l). */
export function dimensionlessTime(b: number, t: number): number {
  return (b * t) / (Math.PI * Math.PI);
}

export function evaluateCutoff(
  b: number,
  l: number,
  tMin: number,
  threshold: number,
): DiffusionResult {
  const Ds = diffusionCoefficient(b, l);
  const tauMin = dimensionlessTime(b, tMin);
  return { Ds, tauMin, satisfied: tauMin >= threshold };
}

export type IterativeFitStep = {
  attempt: number;
  excludedIndices: number[];
  fittedCount: number;
  tMin: number;
  fit: FitResult;
  diffusion: DiffusionResult;
};

export type IterativeFitResult = {
  steps: IterativeFitStep[];
  finalStep: IterativeFitStep;
  converged: boolean;
  reason: "satisfied" | "too-few-points" | "non-converging";
  threshold: number;
};

/**
 * Iteratively trim the earliest measurement(s) until the dimensionless
 * time at t_min satisfies τ ≥ threshold. Returns every attempt so the UI
 * can show the trimming history.
 */
export function iterativeFitWithCutoff(
  allPoints: Point[],
  k0: number,
  l: number,
  threshold: number,
  minPoints = 3,
): IterativeFitResult {
  if (allPoints.length < minPoints) {
    throw new Error(
      `At least ${minPoints} data points are required to fit two parameters.`,
    );
  }
  if (!(l > 0)) {
    throw new Error("Electrolyte thickness l must be a positive number.");
  }

  const sorted = [...allPoints].sort((a, b) => a.t - b.t);
  const steps: IterativeFitStep[] = [];

  for (let drop = 0; drop <= sorted.length - minPoints; drop++) {
    const subset = sorted.slice(drop);
    const tMin = subset[0].t;
    const fit = fitDecay(subset, k0);
    const diffusion = evaluateCutoff(fit.b, l, tMin, threshold);
    const step: IterativeFitStep = {
      attempt: drop + 1,
      excludedIndices: Array.from({ length: drop }, (_, i) => i),
      fittedCount: subset.length,
      tMin,
      fit,
      diffusion,
    };
    steps.push(step);

    if (!Number.isFinite(fit.b) || fit.b <= 0) {
      // can't satisfy a positive-τ cutoff with a non-positive decay rate
      continue;
    }
    if (diffusion.satisfied) {
      return {
        steps,
        finalStep: step,
        converged: true,
        reason: "satisfied",
        threshold,
      };
    }
  }

  const finalStep = steps[steps.length - 1];
  const reason: IterativeFitResult["reason"] = finalStep
    ? finalStep.diffusion.satisfied
      ? "satisfied"
      : "too-few-points"
    : "non-converging";

  return {
    steps,
    finalStep,
    converged: false,
    reason,
    threshold,
  };
}

export function generateCurve(
  k0: number,
  a: number,
  b: number,
  tMin: number,
  tMax: number,
  steps = 200,
): Point[] {
  const out: Point[] = [];
  if (steps < 2 || tMax <= tMin) return out;
  const dt = (tMax - tMin) / (steps - 1);
  for (let i = 0; i < steps; i++) {
    const t = tMin + dt * i;
    out.push({ t, U: k0 + a * Math.exp(-b * t) });
  }
  return out;
}
