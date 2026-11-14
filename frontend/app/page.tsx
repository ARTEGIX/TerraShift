import { ArrowRight, Layers, MapPin, Satellite } from "lucide-react";
import Link from "next/link";
import { FieldOrbit } from "@/components/ui/Loaders";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl px-5 pb-16 pt-10 sm:pt-16">
      <section className="flex flex-col items-center text-center">
        <FieldOrbit />
        <p className="mt-8 text-[15px] font-semibold text-leaf-700">NASA Space Apps 2026 · Field Shift</p>
        <h1 className="mt-3 text-[40px] font-bold leading-[1.1] tracking-tight text-ink sm:text-[56px]">
          Plan your next three seasons.
        </h1>
        <p className="mt-4 max-w-xl text-[19px] leading-relaxed text-ink-3">
          Draw your field. We read NASA climate data for it and show you three crop plans, with what to do each month.
        </p>
        <div className="mt-8 flex w-full max-w-sm flex-col gap-3">
          <Link href="/farm" className="btn-primary min-h-14 text-[19px]">
            Plan my field <ArrowRight className="size-5" aria-hidden />
          </Link>
        </div>
      </section>

      <section aria-labelledby="how" className="mt-16">
        <h2 id="how" className="sr-only">
          How it works
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: MapPin, title: "Draw your field", text: "Trace it on the satellite map." },
            { icon: Satellite, title: "We read NASA data", text: "Rain, heat and dry months for your area." },
            { icon: Layers, title: "Get your plan", text: "Three options and a month-by-month calendar." },
          ].map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="card flex items-start gap-4 sm:flex-col sm:gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-leaf-50 text-leaf-700">
                <Icon className="size-5" aria-hidden />
              </span>
              <span>
                <span className="block text-[17px] font-semibold text-ink">
                  {i + 1}. {title}
                </span>
                <span className="mt-0.5 block text-[15px] text-ink-3">{text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
