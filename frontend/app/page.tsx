import { ArrowRight, Layers, MapPin, Satellite } from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl space-y-12 px-4 py-8 sm:py-12">
      <section className="rounded-3xl bg-gradient-to-br from-leaf-900 via-leaf-700 to-soil-700 p-7 text-white shadow-lg sm:p-12">
        <p className="text-sm font-medium text-white/80">NASA Space Apps 2026 · Field Shift</p>
        <h1 className="mt-3 max-w-2xl text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          Plan your next three seasons with NASA climate data
        </h1>
        <p className="mt-4 max-w-xl text-lg text-white/85">
          Draw your field, tell us your crop and soil, and compare three crop plans side by side: keep going as you are,
          protect your soil and water, or earn more.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/farm" className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-white px-6 text-lg font-semibold text-leaf-900 shadow hover:bg-leaf-50">
            Plan my field <ArrowRight className="size-5" aria-hidden />
          </Link>
          <Link href="/results/demo" className="inline-flex min-h-14 items-center justify-center rounded-xl border border-white/40 bg-white/10 px-6 text-lg font-semibold text-white hover:bg-white/20">
            See a sample report
          </Link>
        </div>
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="text-xl font-bold text-slate-900">
          How it works
        </h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            { icon: MapPin, title: "Draw your field", text: "Trace it on the satellite map. We measure the size for you." },
            { icon: Satellite, title: "We read NASA data", text: "Rain, heat and dryness records for your exact area, plus a forecast." },
            { icon: Layers, title: "Compare 3 plans", text: "Water, money and soil health for each plan, explained in plain words." },
          ].map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="card">
              <Icon className="size-7 text-leaf-600" aria-hidden />
              <p className="mt-3 font-semibold text-slate-900">
                {i + 1}. {title}
              </p>
              <p className="mt-1 text-sm text-slate-600">{text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
