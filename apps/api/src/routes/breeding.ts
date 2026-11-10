import type { FastifyInstance } from "fastify";
import { asc, eq, or } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { breedingEntries } from "@rusttools/db";
import {
  BREEDING_ANIMAL_SPECIES,
  BREEDING_LOCATION_MAX_LEN,
  BREEDING_NAME_MAX_LEN,
  BREEDING_NOTES_MAX_LEN,
  BREEDING_POTENTIAL_MAX_LEN,
  BREEDING_QUANTITY_MAX,
  BREEDING_SERVER_LABEL_MAX_LEN,
  BREEDING_SPECIES_MAX_LEN,
  BREEDING_TRAITS_MAX_LEN,
  isBreedingKind,
  isBreedingSex,
  isValidCropGenes,
  normalizeBreedingGenes,
  normalizeBreedingSpecies,
  type BreedingEntry,
  type BreedingEntryInput,
  type BreedingKind,
} from "@rusttools/shared";
import { requireCapability } from "../lib/auth.js";
import { generateId } from "../lib/ids.js";

type Row = typeof breedingEntries.$inferSelect;
type Body = Record<string, unknown>;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ReaderDb = Pick<Tx, "select">;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

type MutationResult =
  | { ok: true; entry: BreedingEntry }
  | { ok: false; status: 400 | 404 | 409; error: string };

const ALLOWED_KEYS = new Set([
  "kind",
  "name",
  "species",
  "serverLabel",
  "genes",
  "traits",
  "quantity",
  "location",
  "available",
  "sex",
  "potential",
  "motherId",
  "fatherId",
  "notes",
]);

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function isPlainObject(value: unknown): value is Body {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEntry(row: Row): BreedingEntry {
  return {
    id: row.id,
    kind: row.kind as BreedingEntry["kind"],
    name: row.name,
    species: row.species,
    serverLabel: row.serverLabel,
    genes: row.genes,
    traits: row.traits,
    quantity: row.quantity,
    location: row.location,
    available: row.available,
    sex: row.sex as BreedingEntry["sex"],
    potential: row.potential,
    motherId: row.motherId,
    fatherId: row.fatherId,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toInput(row: Row): BreedingEntryInput {
  return {
    kind: row.kind as BreedingKind,
    name: row.name,
    species: row.species,
    serverLabel: row.serverLabel,
    genes: row.genes,
    traits: row.traits,
    quantity: row.quantity,
    location: row.location,
    available: row.available,
    sex: row.sex as BreedingEntry["sex"],
    potential: row.potential,
    motherId: row.motherId,
    fatherId: row.fatherId,
    notes: row.notes,
  };
}

function parseText(
  body: Body,
  key: string,
  label: string,
  max: number,
  fallback: string,
  opts: { required?: boolean; allowEmpty?: boolean } = {},
): Parsed<string> {
  if (!Object.hasOwn(body, key)) {
    if (opts.required && !fallback) return fail(`${label} is required`);
    return { ok: true, value: fallback };
  }
  const raw = body[key];
  if (typeof raw !== "string") return fail(`${label} must be a string`);
  const value = raw.trim();
  if (!value && !opts.allowEmpty) return fail(`${label} is required`);
  if (value.length > max) return fail(`${label} must be at most ${max} characters`);
  return { ok: true, value };
}

function parseQuantity(body: Body, fallback: number, kind: BreedingKind): Parsed<number> {
  if (!Object.hasOwn(body, "quantity")) return { ok: true, value: fallback };
  const raw = body.quantity;
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    return fail("quantity must be an integer");
  }
  if (raw < 0 || raw > BREEDING_QUANTITY_MAX) {
    return fail(`quantity must be between 0 and ${BREEDING_QUANTITY_MAX}`);
  }
  if (kind === "animal" && raw !== 1) return fail("quantity must be 1 for animals");
  return { ok: true, value: raw };
}

function parseAvailable(body: Body, fallback: boolean): Parsed<boolean> {
  if (!Object.hasOwn(body, "available")) return { ok: true, value: fallback };
  const raw = body.available;
  if (typeof raw !== "boolean") return fail("available must be a boolean");
  return { ok: true, value: raw };
}

function parseSex(body: Body, fallback: BreedingEntry["sex"]): Parsed<BreedingEntry["sex"]> {
  if (!Object.hasOwn(body, "sex")) return { ok: true, value: fallback };
  const raw = body.sex;
  if (typeof raw !== "string" || !isBreedingSex(raw)) {
    return fail("sex must be female, male, or unknown");
  }
  return { ok: true, value: raw };
}

function parseParent(
  body: Body,
  key: "motherId" | "fatherId",
  label: string,
  fallback: string | null,
): Parsed<string | null> {
  if (!Object.hasOwn(body, key)) return { ok: true, value: fallback };
  const raw = body[key];
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return fail(`${label} must be a string or null`);
  const value = raw.trim();
  if (!value) return fail(`${label} must be a non-empty id or null`);
  return { ok: true, value };
}

function buildDraft(body: Body, base: BreedingEntryInput | null): Parsed<BreedingEntryInput> {
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) return fail(`Unknown field: ${key}`);
  }

  let kind: BreedingKind;
  if (base) {
    kind = base.kind;
    if (Object.hasOwn(body, "kind")) {
      if (!isBreedingKind(body.kind)) return fail("kind must be crop or animal");
      if (body.kind !== base.kind) return fail("kind cannot be changed");
    }
  } else {
    if (!isBreedingKind(body.kind)) return fail("kind must be crop or animal");
    kind = body.kind;
  }

  const name = parseText(body, "name", "name", BREEDING_NAME_MAX_LEN, base?.name ?? "", {
    required: !base,
  });
  if (!name.ok) return name;

  const rawSpecies = parseText(
    body,
    "species",
    "species",
    BREEDING_SPECIES_MAX_LEN,
    base?.species ?? "",
    { required: !base },
  );
  if (!rawSpecies.ok) return rawSpecies;
  const species = normalizeBreedingSpecies(rawSpecies.value);
  if (!species) return fail("species is required");
  if (kind === "animal" && !BREEDING_ANIMAL_SPECIES.some((value) => value === species)) {
    return fail("animal species must be cow or sheep");
  }

  let genes: string;
  if (kind === "animal") {
    if (Object.hasOwn(body, "genes")) {
      if (typeof body.genes !== "string") return fail("genes must be a string");
      if (body.genes.trim()) return fail("genes must be blank for animals");
    }
    genes = "";
  } else {
    const rawGenes = Object.hasOwn(body, "genes") ? body.genes : (base?.genes ?? "");
    if (typeof rawGenes !== "string") return fail("genes must be a string");
    genes = normalizeBreedingGenes(rawGenes);
    if (!genes) return fail("genes is required for crops");
    if (!isValidCropGenes(genes)) {
      return fail("genes must be exactly six characters from GYHWX");
    }
  }

  const serverLabel = parseText(
    body,
    "serverLabel",
    "serverLabel",
    BREEDING_SERVER_LABEL_MAX_LEN,
    base?.serverLabel ?? "",
    { required: !base },
  );
  if (!serverLabel.ok) return serverLabel;

  const location = parseText(
    body,
    "location",
    "location",
    BREEDING_LOCATION_MAX_LEN,
    base?.location ?? "",
    { required: !base },
  );
  if (!location.ok) return location;

  const traits = parseText(
    body,
    "traits",
    "traits",
    BREEDING_TRAITS_MAX_LEN,
    base?.traits ?? "",
    { allowEmpty: true },
  );
  if (!traits.ok) return traits;

  const potential = parseText(
    body,
    "potential",
    "potential",
    BREEDING_POTENTIAL_MAX_LEN,
    base?.potential ?? "",
    { allowEmpty: true },
  );
  if (!potential.ok) return potential;

  const notes = parseText(body, "notes", "notes", BREEDING_NOTES_MAX_LEN, base?.notes ?? "", {
    allowEmpty: true,
  });
  if (!notes.ok) return notes;

  const quantity = parseQuantity(body, base?.quantity ?? 1, kind);
  if (!quantity.ok) return quantity;

  const available = parseAvailable(body, base?.available ?? true);
  if (!available.ok) return available;

  const sex = parseSex(body, base?.sex ?? "unknown");
  if (!sex.ok) return sex;

  const motherId = parseParent(body, "motherId", "motherId", base?.motherId ?? null);
  if (!motherId.ok) return motherId;

  const fatherId = parseParent(body, "fatherId", "fatherId", base?.fatherId ?? null);
  if (!fatherId.ok) return fatherId;

  if (motherId.value && motherId.value === fatherId.value) {
    return fail("motherId and fatherId must be different entries");
  }

  return {
    ok: true,
    value: {
      kind,
      name: name.value,
      species,
      serverLabel: serverLabel.value,
      genes,
      traits: traits.value,
      quantity: quantity.value,
      location: location.value,
      available: available.value,
      sex: sex.value,
      potential: potential.value,
      motherId: motherId.value,
      fatherId: fatherId.value,
      notes: notes.value,
    },
  };
}

type ParentRow = {
  id: string;
  kind: string;
  species: string;
  serverLabel: string;
  sex: string;
  motherId: string | null;
  fatherId: string | null;
};

function validateParents(
  db: ReaderDb,
  draft: BreedingEntryInput,
  selfId: string | null,
): string | null {
  const checks: Array<{ id: string | null; label: string; allowedSexes: string[] }> = [
    { id: draft.motherId, label: "Mother", allowedSexes: ["female", "unknown"] },
    { id: draft.fatherId, label: "Father", allowedSexes: ["male", "unknown"] },
  ];

  if (draft.kind !== "animal") {
    const ref = checks.find((check) => check.id);
    return ref ? `${ref.label} references are only supported on animal entries` : null;
  }

  const rows: ParentRow[] = db
    .select({
      id: breedingEntries.id,
      kind: breedingEntries.kind,
      species: breedingEntries.species,
      serverLabel: breedingEntries.serverLabel,
      sex: breedingEntries.sex,
      motherId: breedingEntries.motherId,
      fatherId: breedingEntries.fatherId,
    })
    .from(breedingEntries)
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const check of checks) {
    if (!check.id) continue;
    if (check.id === selfId) return `${check.label} cannot be the entry itself`;
    const parent = byId.get(check.id);
    if (!parent) return `${check.label} entry not found`;
    if (parent.kind !== "animal") return `${check.label} must reference an animal entry`;
    if (parent.species !== draft.species) return `${check.label} must be the same species`;
    if (parent.serverLabel !== draft.serverLabel) {
      return `${check.label} must be on the same serverLabel`;
    }
    if (!check.allowedSexes.includes(parent.sex)) {
      return `${check.label} must be ${check.allowedSexes[0]} or unknown`;
    }

    if (selfId) {
      const seen = new Set<string>();
      const stack = [check.id];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (current === selfId) return "Parent reference would create a cycle";
        if (seen.has(current)) continue;
        seen.add(current);
        const node = byId.get(current);
        if (node?.motherId) stack.push(node.motherId);
        if (node?.fatherId) stack.push(node.fatherId);
      }
    }
  }

  return null;
}

function childReferenceError(
  db: ReaderDb,
  existing: BreedingEntryInput,
  draft: BreedingEntryInput,
  id: string,
): string | null {
  if (
    existing.species === draft.species &&
    existing.serverLabel === draft.serverLabel &&
    existing.sex === draft.sex
  ) {
    return null;
  }

  const child = db
    .select({ id: breedingEntries.id })
    .from(breedingEntries)
    .where(
      or(eq(breedingEntries.motherId, id), eq(breedingEntries.fatherId, id)),
    )
    .limit(1)
    .get();

  return child
    ? "Entry is referenced by offspring; species, serverLabel, and sex cannot change"
    : null;
}

export async function registerBreedingRoutes(
  app: FastifyInstance,
  deps: { db: Database },
): Promise<void> {
  app.get("/breeding", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const rows = await deps.db
      .select()
      .from(breedingEntries)
      .orderBy(
        asc(breedingEntries.kind),
        asc(breedingEntries.species),
        asc(breedingEntries.name),
      );

    return { entries: rows.map(parseEntry) };
  });

  app.post("/breeding", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    if (!isPlainObject(request.body)) {
      return reply.status(400).send({ error: "Body must be a JSON object" });
    }
    const parsed = buildDraft(request.body, null);
    if (!parsed.ok) return reply.status(400).send({ error: parsed.error });
    const draft = parsed.value;

    // Reads, validation and the write run in one synchronous better-sqlite3
    // transaction so concurrent requests cannot validate against stale rows.
    const outcome = deps.db.transaction((tx): MutationResult => {
      const parentError = validateParents(tx, draft, null);
      if (parentError) return { ok: false, status: 400, error: parentError };

      const id = generateId();
      const now = new Date();
      tx.insert(breedingEntries)
        .values({
          id,
          ...draft,
          createdBy: user.discordUsername,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const row = tx
        .select()
        .from(breedingEntries)
        .where(eq(breedingEntries.id, id))
        .get();
      return { ok: true, entry: parseEntry(row!) };
    });

    if (!outcome.ok) return reply.status(outcome.status).send({ error: outcome.error });
    return reply.status(201).send(outcome.entry);
  });

  app.patch("/breeding/:id", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    if (!isPlainObject(request.body)) {
      return reply.status(400).send({ error: "Body must be a JSON object" });
    }
    const body = request.body;
    const { id } = request.params as { id: string };

    const outcome = deps.db.transaction((tx): MutationResult => {
      const existing = tx
        .select()
        .from(breedingEntries)
        .where(eq(breedingEntries.id, id))
        .get();
      if (!existing) return { ok: false, status: 404, error: "Entry not found" };

      const base = toInput(existing);
      const parsed = buildDraft(body, base);
      if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };

      const childError = childReferenceError(tx, base, parsed.value, id);
      if (childError) return { ok: false, status: 409, error: childError };

      const parentError = validateParents(tx, parsed.value, id);
      if (parentError) return { ok: false, status: 400, error: parentError };

      tx.update(breedingEntries)
        .set({ ...parsed.value, updatedAt: new Date() })
        .where(eq(breedingEntries.id, id))
        .run();

      const row = tx
        .select()
        .from(breedingEntries)
        .where(eq(breedingEntries.id, id))
        .get();
      return { ok: true, entry: parseEntry(row!) };
    });

    if (!outcome.ok) return reply.status(outcome.status).send({ error: outcome.error });
    return outcome.entry;
  });

  app.delete("/breeding/:id", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const { id } = request.params as { id: string };
    const result = await deps.db
      .delete(breedingEntries)
      .where(eq(breedingEntries.id, id));
    if (result.changes === 0) {
      return reply.status(404).send({ error: "Entry not found" });
    }
    return { ok: true };
  });
}

