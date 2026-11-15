"use client";

import { useEffect, useState } from "react";
import type { Polygon, Priority, SoilType } from "./types";

/** Unfinished wizard answers, kept in the browser so a refresh or sign-in never loses work. */
export interface FieldDraft {
  step: 0 | 1 | 2 | 3;
  name: string;
  polygon: Polygon | null;
  regionId?: string | null;
  currentCrop: string | null;
  plantingMonth: number;
  soilType: SoilType | null;
  priority: Priority | null;
}

const KEY = "terrashift_draft_v1";

export const EMPTY_DRAFT: FieldDraft = {
  step: 0,
  name: "",
  polygon: null,
  regionId: null,
  currentCrop: null,
  plantingMonth: 10,
  soilType: null,
  priority: null,
};

function read(): FieldDraft {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<FieldDraft>) } : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}

export function clearDraft() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Returns [draft, update, loaded]. `loaded` is false until the browser copy is read. */
export function useDraft(): [FieldDraft, (patch: Partial<FieldDraft>) => void, boolean] {
  const [draft, setDraft] = useState<FieldDraft>(EMPTY_DRAFT);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setDraft(read());
    setLoaded(true);
  }, []);

  const update = (patch: Partial<FieldDraft>) =>
    setDraft((d) => {
      const next = { ...d, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage full or blocked: keep working in memory */
      }
      return next;
    });

  return [draft, update, loaded];
}
