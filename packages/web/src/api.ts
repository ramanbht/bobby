import type {
  AppSettings,
  Chat,
  ChatWithMessages,
  CreateChatRequest,
  CreateJobRequest,
  DistillResult,
  HarnessInfo,
  Job,
  ServerConfigInfo,
  UpdateChatRequest,
  UpdateJobRequest,
} from "@bobby/shared";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listHarnesses: () => fetch("/api/harnesses").then(json<HarnessInfo[]>),
  getConfig: () => fetch("/api/config").then(json<ServerConfigInfo>),
  listChats: () => fetch("/api/chats").then(json<Chat[]>),
  getChat: (id: string) => fetch(`/api/chats/${id}`).then(json<ChatWithMessages>),
  createChat: (body: CreateChatRequest) =>
    fetch("/api/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(json<Chat>),
  updateChat: (id: string, body: UpdateChatRequest) =>
    fetch(`/api/chats/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(json<Chat>),
  deleteChat: (id: string) =>
    fetch(`/api/chats/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),
  getSettings: () => fetch("/api/settings").then(json<AppSettings>),
  saveSettings: (body: AppSettings) =>
    fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(json<AppSettings>),
  distill: (id: string) =>
    fetch(`/api/chats/${id}/distill`, { method: "POST" }).then(
      json<(DistillResult & { distilled: true }) | { distilled: false; reason: string }>,
    ),
  listJobs: () => fetch("/api/jobs").then(json<Job[]>),
  createJob: (body: CreateJobRequest) =>
    fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(json<Job>),
  updateJob: (id: string, body: UpdateJobRequest) =>
    fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(json<Job>),
  deleteJob: (id: string) => fetch(`/api/jobs/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),
  runJob: (id: string) => fetch(`/api/jobs/${id}/run`, { method: "POST" }).then(json<{ ok: true }>),
};
