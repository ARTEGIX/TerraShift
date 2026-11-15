"use client";

import { ArrowRight, FolderKanban, Plus, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Notice } from "@/components/ui/controls";
import { PageLoader } from "@/components/ui/Loaders";
import { deleteProject, listProjects } from "@/lib/api";
import { letterOf, type Project } from "@/lib/types";

const dateFmt = (d?: string) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((err) => setError((err as Error).message));
  }, []);

  async function handleDelete(project: Project) {
    if (!confirm(`Delete project "${project.name}"?`)) return;
    setDeletingId(project.id);
    try {
      await deleteProject(project.id);
      setProjects((prev) => prev?.filter((p) => p.id !== project.id) ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-bold leading-tight tracking-tight text-ink">My projects</h1>
          <p className="mt-1 text-[17px] text-ink-3">Active 3-season farm rotation projects.</p>
        </div>
        <Link href="/farms" className="btn-primary">
          <Plus className="size-5" aria-hidden /> New from field report
        </Link>
      </div>

      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {projects === null && !error && <PageLoader label="Loading your projects…" />}

      {projects?.length === 0 && (
        <div className="card mt-8 text-center">
          <FolderKanban className="mx-auto size-9 text-leaf-600" aria-hidden />
          <p className="mt-2 text-lg font-semibold text-ink">No projects yet</p>
          <p className="text-ink-3">Generate a field report and click &ldquo;Create Project&rdquo; to start a 3-season workspace.</p>
          <Link href="/farm" className="btn-primary mt-4 inline-flex">
            Plan a field <ArrowRight className="size-5" aria-hidden />
          </Link>
        </div>
      )}

      <ul className="mt-6 space-y-4">
        {projects?.map((project) => {
          const planLetter = letterOf(project.selected_strategy);
          return (
            <li key={project.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/projects/${project.id}`} className="text-[20px] font-semibold tracking-tight text-ink hover:text-leaf-700">
                      {project.name}
                    </Link>
                    <span className="rounded-full bg-leaf-50 px-2.5 py-0.5 text-[12px] font-semibold text-leaf-700">
                      Based on Plan {planLetter}
                    </span>
                    {project.recalculation_count > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.05] px-2.5 py-0.5 text-[12px] font-medium text-ink-2">
                        <RefreshCw className="size-3" aria-hidden /> {project.recalculation_count} recalc
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[14px] text-ink-3">
                    {project.created_at ? `Created ${dateFmt(project.created_at)} · ` : ""}
                    Net Margin: ${Math.round(project.totals?.net_margin_usd_ha ?? 0)}/ha · Water:{" "}
                    {Math.round(project.totals?.water_use_mm ?? 0)} mm
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Link href={`/projects/${project.id}`} className="btn-primary !min-h-10 !px-4 text-sm">
                    Open Project
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDelete(project)}
                    disabled={deletingId === project.id}
                    aria-label={`Delete ${project.name}`}
                    className="grid size-10 place-items-center rounded-2xl bg-black/[0.05] text-ink-3 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-black/[0.06] pt-3">
                {project.seasons.map((s, idx) => (
                  <span key={`${project.id}-s-${idx}`} className="rounded-full bg-black/[0.04] px-3 py-1 text-[13px] font-medium text-ink-2">
                    0{idx + 1}: {s.crop_name}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
