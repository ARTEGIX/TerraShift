import { randomUUID } from "node:crypto";
import { Router } from "express";
import { mongoReady } from "../db/mongo";
import { validateBody } from "../middleware/validate";
import { Project, type IProject, type IProjectSeason } from "../models/Project";
import { projectRecalculate } from "../services/agronomyClient";
import type { ProjectRecalcRequest } from "../types/contract";
import { HttpError } from "../utils/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import { findRunById } from "./analyses";
import { findFarmById } from "./farms";
import {
  projectCreateSchema,
  projectPatchSchema,
  projectRecalcSchema,
  type ProjectCreate,
  type ProjectPatch,
  type ProjectRecalc,
} from "./schemas";

const router = Router();

const memoryProjects = new Map<string, IProject>();

export function deleteProjectsByFarmIdFromMemory(farmId: string): void {
  for (const [id, p] of memoryProjects.entries()) {
    if (p.farm_id === farmId) memoryProjects.delete(id);
  }
}

export function deleteProjectsByReportIdFromMemory(reportId: string): void {
  for (const [id, p] of memoryProjects.entries()) {
    if (p.report_id === reportId) memoryProjects.delete(id);
  }
}

function toPublicProject(p: IProject) {
  return {
    id: p._id,
    _id: p._id,
    owner: p.owner,
    name: p.name,
    farm_id: p.farm_id,
    report_id: p.report_id,
    selected_strategy: p.selected_strategy,
    seasons: p.seasons,
    totals: p.totals,
    objectives: p.objectives,
    warnings: p.warnings,
    recalculation_count: p.recalculation_count,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

/** POST /api/projects — create project from report, snapshot selected strategy */
router.post(
  "/",
  validateBody(projectCreateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as ProjectCreate;

    // Fetch the simulation run
    const run = await findRunById(body.report_id);
    if (!run) throw HttpError.notFound(`Report '${body.report_id}' not found`);

    // Find the selected strategy in the prediction
    const strategy = (run.prediction.strategies as any[]).find(
      (s: any) => s.id === body.selected_strategy || s.short_id === body.selected_strategy,
    );
    if (!strategy) {
      throw HttpError.badRequest(
        `Strategy '${body.selected_strategy}' not found in report '${body.report_id}'`,
      );
    }

    // Snapshot the strategy seasons into project seasons
    const seasons: IProjectSeason[] = (strategy.seasons as any[]).map((s: any) => ({
      season_number: s.season,
      season: s.season,
      season_label: s.season_label,
      crop_id: s.crop_id,
      crop_name: s.crop_name,
      metrics: s.metrics,
    }));

    const projectId = `proj_${randomUUID().slice(0, 8)}`;
    const now = new Date();
    const projectDoc: IProject = {
      _id: projectId,
      name: body.name,
      farm_id: run.farm_id ?? "",
      report_id: body.report_id,
      selected_strategy: body.selected_strategy,
      seasons,
      totals: strategy.totals ?? {},
      objectives: strategy.objectives ?? { f_soil: 0, f_water: 0, f_cost: 0 },
      warnings: strategy.warnings ?? [],
      recalculation_count: 0,
      created_at: now,
      updated_at: now,
    };

    memoryProjects.set(projectId, projectDoc);

    if (mongoReady()) {
      await Project.create(projectDoc);
    }

    res.status(201).json({ project: toPublicProject(projectDoc) });
  }),
);

/** GET /api/projects — list projects with optional ?farm_id= and ?report_id= */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const farmId = typeof req.query.farm_id === "string" ? req.query.farm_id : undefined;
    const reportId = typeof req.query.report_id === "string" ? req.query.report_id : undefined;

    if (mongoReady()) {
      const filter: Record<string, string> = {};
      if (farmId) filter.farm_id = farmId;
      if (reportId) filter.report_id = reportId;
      const projects = await Project.find(filter).sort({ created_at: -1 }).lean<IProject[]>();
      res.json({ projects: projects.map(toPublicProject) });
      return;
    }

    const list = Array.from(memoryProjects.values()).filter((p) => {
      if (farmId && p.farm_id !== farmId) return false;
      if (reportId && p.report_id !== reportId) return false;
      return true;
    });
    res.json({ projects: list.map(toPublicProject) });
  }),
);

/** GET /api/projects/:id — fetch project workspace data including farm_id and report_id provenance links */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;

    let projectDoc: IProject | undefined;
    const mem = memoryProjects.get(id);
    if (mem) {
      projectDoc = mem;
    } else if (mongoReady()) {
      const doc = await Project.findById(id).lean<IProject>();
      if (doc) projectDoc = doc;
    }

    if (!projectDoc) throw HttpError.notFound(`Project '${id}' not found`);

    const farm = await findFarmById(projectDoc.farm_id);
    const report = await findRunById(projectDoc.report_id);

    res.json({
      project: toPublicProject(projectDoc),
      farm: farm
        ? {
            id: farm._id,
            _id: farm._id,
            name: farm.name,
            soil_type: farm.soil_type,
            current_crop: farm.current_crop,
            area_ha: farm.area_ha,
            centroid: farm.centroid,
            polygon: farm.polygon,
            planting_month: farm.planting_month,
          }
        : null,
      report: report
        ? {
            id: report.id,
            _id: report.id,
            recommended_strategy: report.recommended_strategy,
            climate_source: report.climate_source,
            created_at: report.created_at,
          }
        : null,
    });
  }),
);

type SeasonInput = { crop_id: string; target_water_mm?: number | null; input_cost_usd_ha?: number | null };

/** PATCH /api/projects/:id — update metadata or season params (no recalc) */
router.patch(
  "/:id",
  validateBody(projectPatchSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as ProjectPatch;
    const id = req.params.id;

    let existing: IProject | undefined;
    const mem = memoryProjects.get(id);
    if (mem) {
      existing = mem;
    } else if (mongoReady()) {
      const doc = await Project.findById(id).lean<IProject>();
      if (doc) existing = doc;
    }
    if (!existing) throw HttpError.notFound(`Project '${id}' not found`);

    const now = new Date();
    const updated: IProject = {
      ...existing,
      ...(body.name !== undefined && { name: body.name }),
      ...(body.seasons !== undefined && {
        seasons: body.seasons.map((s: SeasonInput, i: number) => {
          const prev = existing!.seasons[i];
          const targetWater = s.target_water_mm !== undefined
            ? (s.target_water_mm === null ? undefined : s.target_water_mm)
            : prev?.target_water_mm;
          const inputCost = s.input_cost_usd_ha !== undefined
            ? (s.input_cost_usd_ha === null ? undefined : s.input_cost_usd_ha)
            : prev?.input_cost_usd_ha;
          return {
            ...prev,
            crop_id: s.crop_id,
            target_water_mm: targetWater,
            input_cost_usd_ha: inputCost,
          };
        }),
      }),
      updated_at: now,
    };

    memoryProjects.set(id, updated);
    if (mongoReady()) {
      await Project.findByIdAndUpdate(id, updated, { new: true });
    }

    res.json({ project: toPublicProject(updated) });
  }),
);

/** POST /api/projects/:id/recalculate — send updated seasons to engine, persist metrics */
router.post(
  "/:id/recalculate",
  validateBody(projectRecalcSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as ProjectRecalc;
    const id = req.params.id;

    // Find the project
    let existing: IProject | undefined;
    const mem = memoryProjects.get(id);
    if (mem) {
      existing = mem;
    } else if (mongoReady()) {
      const doc = await Project.findById(id).lean<IProject>();
      if (doc) existing = doc;
    }
    if (!existing) throw HttpError.notFound(`Project '${id}' not found`);

    // Fetch the farm for field baseline
    const farm = await findFarmById(existing.farm_id);
    if (!farm) throw HttpError.notFound(`Farm '${existing.farm_id}' not found`);

    // Assemble engine request
    const engineReq: ProjectRecalcRequest = {
      centroid: farm.centroid,
      soil_type: farm.soil_type,
      current_crop: farm.current_crop,
      region_id: farm.region_id,
      priority: farm.default_priority,
      planting_month: farm.planting_month ?? 10,
      area_ha: farm.area_ha,
      seasons: body.seasons.map((s: SeasonInput, i: number) => {
        const prev = existing!.seasons[i];
        const targetWater = s.target_water_mm !== undefined
          ? (s.target_water_mm === null ? undefined : s.target_water_mm)
          : prev?.target_water_mm;
        const inputCost = s.input_cost_usd_ha !== undefined
          ? (s.input_cost_usd_ha === null ? undefined : s.input_cost_usd_ha)
          : prev?.input_cost_usd_ha;
        return {
          crop_id: s.crop_id,
          ...(targetWater !== undefined && { target_water_mm: targetWater }),
          ...(inputCost !== undefined && { input_cost_usd_ha: inputCost }),
        };
      }),
    };

    const result = await projectRecalculate(engineReq);

    // Merge updated metrics back into project seasons
    const updatedSeasons: IProjectSeason[] = body.seasons.map((s: SeasonInput, i: number) => {
      const prev = existing!.seasons[i];
      const targetWater = s.target_water_mm !== undefined
        ? (s.target_water_mm === null ? undefined : s.target_water_mm)
        : prev?.target_water_mm;
      const inputCost = s.input_cost_usd_ha !== undefined
        ? (s.input_cost_usd_ha === null ? undefined : s.input_cost_usd_ha)
        : prev?.input_cost_usd_ha;
      return {
        season_number: i + 1,
        season: i + 1,
        season_label: result.seasons[i]?.season_label ?? prev?.season_label,
        crop_id: s.crop_id,
        crop_name: result.seasons[i]?.crop_name ?? prev?.crop_name,
        target_water_mm: targetWater,
        input_cost_usd_ha: inputCost,
        metrics: result.seasons[i]?.metrics ?? prev?.metrics,
      };
    });

    const now = new Date();
    const updated: IProject = {
      ...existing,
      seasons: updatedSeasons,
      totals: result.totals,
      objectives: result.objectives,
      warnings: result.warnings,
      recalculation_count: (existing.recalculation_count ?? 0) + 1,
      updated_at: now,
    };

    memoryProjects.set(id, updated);
    if (mongoReady()) {
      await Project.findByIdAndUpdate(id, updated, { new: true });
    }

    res.json({ project: toPublicProject(updated) });
  }),
);

/** DELETE /api/projects/:id */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const existedMem = memoryProjects.delete(id);
    let deletedDb = 0;
    if (mongoReady()) {
      const result = await Project.deleteOne({ _id: id });
      deletedDb = result.deletedCount ?? 0;
    }
    if (!existedMem && deletedDb === 0) throw HttpError.notFound("Project not found");
    res.status(204).end();
  }),
);

export default router;
