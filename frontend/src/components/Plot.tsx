// react-plotly.js@2.6 + React 19 + Vite has broken default-export interop:
// `import Plot from 'react-plotly.js'` and even
// `import createPlotlyComponent from 'react-plotly.js/factory'`
// can resolve to a `{ default: fn }` namespace object instead of the
// function itself, depending on whether Vite serves an ESM shim.
//
// We do a namespace import and unwrap defensively.
import type { ComponentType } from "react";
import type { PlotParams } from "react-plotly.js";
import * as factoryModule from "react-plotly.js/factory";
// @ts-expect-error -- plotly.js-dist-min has no bundled types
import * as plotlyModule from "plotly.js-dist-min";

type FactoryFn = (Plotly: unknown) => ComponentType<PlotParams>;

function unwrap<T>(mod: unknown, isFunction = true): T {
  // Vite's CJS prebundle wraps modules sometimes twice:
  //   import * as M  →  M = { default: { default: fn, __esModule: true } }
  // Walk down `.default` until we hit a function (or run out).
  let cur: unknown = mod;
  for (let i = 0; i < 4; i++) {
    if (isFunction && typeof cur === "function") return cur as T;
    if (cur && typeof cur === "object" && "default" in (cur as object)) {
      cur = (cur as { default: unknown }).default;
      continue;
    }
    break;
  }
  // Plotly is a namespace object, not a function — return whatever we got.
  return cur as T;
}

const createPlotlyComponent = unwrap<FactoryFn>(factoryModule, true);
// Plotly is the namespace object {newPlot, plot, ...}, not a function.
const Plotly = unwrap<unknown>(plotlyModule, false);

if (typeof createPlotlyComponent !== "function") {
  // Surface a clear error in the console rather than React's opaque
  // "Element type is invalid" if the unwrap somehow still missed.
  console.error("[Plot] createPlotlyComponent unwrap failed:", factoryModule);
}

const Plot = createPlotlyComponent(Plotly);

export default Plot;
