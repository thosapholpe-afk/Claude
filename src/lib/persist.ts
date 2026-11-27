import type { CustomSensorDef, Project } from "../core/types";

const CUR = "tconnect.current";
const LIST = "tconnect.projects";
const SENSORS = "tconnect.customSensors";

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export interface ProjectMeta {
  id: string;
  name: string;
  boardId: string;
  updatedAt: number;
}

export function loadProject(): Project | null {
  return safe(() => {
    const id = localStorage.getItem(CUR);
    if (!id) return null;
    const raw = localStorage.getItem(`tconnect.project.${id}`);
    return raw ? (JSON.parse(raw) as Project) : null;
  }, null);
}

export function saveProject(p: Project) {
  safe(() => {
    localStorage.setItem(`tconnect.project.${p.id}`, JSON.stringify(p));
    localStorage.setItem(CUR, p.id);
    const list = listProjects().filter((m) => m.id !== p.id);
    list.unshift({ id: p.id, name: p.name, boardId: p.boardId, updatedAt: p.updatedAt });
    localStorage.setItem(LIST, JSON.stringify(list.slice(0, 60)));
  }, undefined);
}

export function listProjects(): ProjectMeta[] {
  return safe(() => JSON.parse(localStorage.getItem(LIST) ?? "[]") as ProjectMeta[], []);
}

export function openProject(id: string): Project | null {
  return safe(() => {
    const raw = localStorage.getItem(`tconnect.project.${id}`);
    return raw ? (JSON.parse(raw) as Project) : null;
  }, null);
}

export function deleteProject(id: string) {
  safe(() => {
    localStorage.removeItem(`tconnect.project.${id}`);
    localStorage.setItem(LIST, JSON.stringify(listProjects().filter((m) => m.id !== id)));
  }, undefined);
}

export function loadCustomSensors(): CustomSensorDef[] {
  return safe(() => JSON.parse(localStorage.getItem(SENSORS) ?? "[]") as CustomSensorDef[], []);
}

export function saveCustomSensors(list: CustomSensorDef[]) {
  safe(() => localStorage.setItem(SENSORS, JSON.stringify(list)), undefined);
}

export function download(name: string, data: BlobPart, type = "application/octet-stream") {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
