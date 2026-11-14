import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-12 py-6">
      <section className="rounded-2xl bg-gradient-to-br from-leaf-900 via-leaf-700 to-soil-700 text-white p-8 md:p-12 shadow-lg">
        <span className="inline-block text-xs uppercase tracking-wider bg-white/15 px-3 py-1 rounded-full mb-4">
          Field Shift: Adapting Farms with NASA Data
        </span>
        <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight max-w-3xl">
          Turn NASA satellite climate trends into resilient 3-season crop rotations.
        </h1>
        <p className="mt-4 text-white/85 max-w-2xl text-base md:text-lg">
          Draw your farm boundary, pick your current crop and soil type, and let our two-layer agronomy engine combine
          NASA POWER agroclimatology time-series regression with a multi-objective genetic algorithm.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link
            href="/farm"
            className="px-5 py-3 rounded-xl bg-white text-leaf-900 font-semibold hover:bg-leaf-50 transition shadow"
          >
            Analyze My Field →
          </Link>
          <Link
            href="/results/demo"
            className="px-5 py-3 rounded-xl bg-white/15 text-white font-semibold hover:bg-white/25 transition border border-white/30"
          >
            View Live Demo Report
          </Link>
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl p-6 border border-soil-100 shadow-sm">
          <div className="text-2xl mb-2">🛰️</div>
          <h2 className="font-bold text-slate-900">NASA POWER Agroclimatology</h2>
          <p className="text-sm text-slate-600 mt-1">
            Monthly temperature, bias-corrected rainfall, solar irradiance, and evapotranspiration cached per 1.1 km
            grid cell in Redis.
          </p>
        </div>
        <div className="bg-white rounded-xl p-6 border border-soil-100 shadow-sm">
          <div className="text-2xl mb-2">📈</div>
          <h2 className="font-bold text-slate-900">Layer 1: Time-Series Risk Engine</h2>
          <p className="text-sm text-slate-600 mt-1">
            OLS seasonal-trend regression + AR(1) residuals forecast soil moisture deficits, bare-field erosion windows,
            heat stress, and regional monoculture saturation.
          </p>
        </div>
        <div className="bg-white rounded-xl p-6 border border-soil-100 shadow-sm">
          <div className="text-2xl mb-2">🧬</div>
          <h2 className="font-bold text-slate-900">Layer 2: Genetic Rotation Optimizer</h2>
          <p className="text-sm text-slate-600 mt-1">
            Evolves 3-season crop sequences comparing Baseline (A), Soil &amp; Water Resilience (B), and Cost &amp;
            Market Optimized (C), explained in plain language by Gemini.
          </p>
        </div>
      </section>
    </div>
  );
}
