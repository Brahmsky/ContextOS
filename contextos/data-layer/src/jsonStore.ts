import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFile } from "../../packages/utils/src/files.js";

export type JsonRecord = Record<string, unknown>;

export type StoreFile = "stream" | "islands" | "anchors" | "recipes" | "views";

const storePath = (rootDir: string, name: StoreFile) => `${rootDir}/data/${name}/${name}.json`;

export async function readStore(rootDir: string, name: StoreFile): Promise<JsonRecord[]> {
  return readJsonFile(storePath(rootDir, name), [] as JsonRecord[]);
}

export async function writeStore(rootDir: string, name: StoreFile, records: JsonRecord[]): Promise<void> {
  await writeJsonFile(storePath(rootDir, name), records);
}

export async function appendStore(rootDir: string, name: StoreFile, record: JsonRecord): Promise<JsonRecord> {
  const records = await readStore(rootDir, name);
  const next = { id: record.id ?? randomUUID(), ...record } as JsonRecord;
  records.push(next);
  await writeStore(rootDir, name, records);
  return next;
}
