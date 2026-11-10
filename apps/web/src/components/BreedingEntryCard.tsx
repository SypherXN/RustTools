import type { BreedingEntry } from "@rusttools/shared";
import { GeneStrip } from "./BreedingGenes";
import {
  breedingKindLabel,
  breedingSexLabel,
  breedingSpeciesLabel,
  breedingById,
  formatBreedingUpdated,
  isBreedingAvailable,
} from "../lib/breeding-utils";

export function BreedingEntryCard({
  entry,
  entries,
  canEdit,
  busyId,
  onEdit,
  onDelete,
  onUseAsCentre,
  onUseAsDonor,
}: {
  entry: BreedingEntry;
  entries: BreedingEntry[];
  canEdit: boolean;
  busyId: string | null;
  onEdit: (entry: BreedingEntry) => void;
  onDelete: (entry: BreedingEntry) => void;
  onUseAsCentre: (entry: BreedingEntry) => void;
  onUseAsDonor: (entry: BreedingEntry) => void;
}) {
  const byId = breedingById(entries);
  const mother = entry.motherId ? byId.get(entry.motherId) : null;
  const father = entry.fatherId ? byId.get(entry.fatherId) : null;
  const available = isBreedingAvailable(entry);

  return (
    <li className={`card breeding-item${available ? "" : " breeding-item-unavailable"}`}>
      <div className="breeding-item-header">
        <div className="breeding-item-title">
          <div className="breeding-badges">
            <span className={`badge breeding-kind breeding-kind-${entry.kind}`}>
              {breedingKindLabel(entry)}
            </span>
            {entry.kind === "animal" && (
              <span className={`badge breeding-sex breeding-sex-${entry.sex}`}>
                {breedingSexLabel(entry)}
              </span>
            )}
            {!available && (
              <span className="badge breeding-unavailable-badge">Not available</span>
            )}
          </div>
          <h4>{entry.name}</h4>
        </div>
        {canEdit && (
          <div className="inline-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={busyId !== null}
              onClick={() => onEdit(entry)}
            >
              Edit
            </button>
            <button
              type="button"
              className="danger"
              disabled={busyId !== null}
              onClick={() => onDelete(entry)}
            >
              {busyId === entry.id ? "Deleting…" : "Delete"}
            </button>
          </div>
        )}
      </div>

      <div className="breeding-item-body">
        {entry.kind === "crop" && (
          <div className="breeding-item-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onUseAsCentre(entry)}
              title="Load this seed as the calculator's centre"
            >
              Use as centre
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onUseAsDonor(entry)}
              title="Add this seed as a donor line in the calculator"
            >
              Use as donor
            </button>
          </div>
        )}

        {entry.genes && <GeneStrip genes={entry.genes} />}
        <dl className="breeding-meta">
          <div>
            <dt>Species</dt>
            <dd>{breedingSpeciesLabel(entry)}</dd>
          </div>
          <div>
            <dt>Server / wipe</dt>
            <dd>{entry.serverLabel}</dd>
          </div>
          <div>
            <dt>Quantity</dt>
            <dd>{entry.quantity}</dd>
          </div>
          <div className="breeding-meta-wide">
            <dt>Pickup</dt>
            <dd>{entry.location}</dd>
          </div>
          {entry.traits && (
            <div className="breeding-meta-wide">
              <dt>Observed traits</dt>
              <dd>{entry.traits}</dd>
            </div>
          )}
          {entry.potential && (
            <div className="breeding-meta-wide">
              <dt>Observed potential</dt>
              <dd>{entry.potential}</dd>
            </div>
          )}
          <div>
            <dt>Added by</dt>
            <dd>{entry.createdBy}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{formatBreedingUpdated(entry.updatedAt)}</dd>
          </div>
        </dl>
        {entry.kind === "animal" && (mother || father) && (
          <p className="breeding-lineage">
            Lineage: {mother ? `mother “${mother.name}”` : "mother not recorded"}
            {" × "}
            {father ? `father “${father.name}”` : "father not recorded"}.
          </p>
        )}
        {entry.notes && <p className="breeding-notes">{entry.notes}</p>}
      </div>
    </li>
  );
}
