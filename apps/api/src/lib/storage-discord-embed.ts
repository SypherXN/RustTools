export interface StorageDiscordEmbedInput {
  monitorName: string;
  entityDbId: string;
  items: Array<{ name: string; quantity: number; shortname: string }>;
  recycle: { scrap: number; extras: Record<string, number> } | null;
  isToolCupboard: boolean;
  upkeepLabel?: string | null;
}

export function buildStorageChangeDiscordPayload(input: StorageDiscordEmbedInput): {
  embed: {
    title: string;
    description: string;
    color: number;
    fields: Array<{ name: string; value: string; inline?: boolean }>;
  };
  components: Array<{
    type: number;
    components: Array<{ type: number; style: number; label: string; custom_id: string }>;
  }>;
} {
  const topItems = input.items
    .slice(0, 8)
    .map((item) => `• ${item.name} ×${item.quantity}`)
    .join("\n");

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    {
      name: "Contents",
      value: topItems || "Empty",
    },
  ];

  if (input.isToolCupboard && input.upkeepLabel) {
    fields.push({ name: "Upkeep", value: input.upkeepLabel, inline: true });
  }

  if (input.recycle && (input.recycle.scrap > 0 || Object.keys(input.recycle.extras).length > 0)) {
    const parts = [`Scrap ×${input.recycle.scrap}`];
    for (const [name, qty] of Object.entries(input.recycle.extras)) {
      parts.push(`${name} ×${qty}`);
    }
    fields.push({ name: "Recycle estimate", value: parts.join(", ") });
  }

  return {
    embed: {
      title: `Storage: ${input.monitorName}`,
      description: "Contents updated",
      color: 0xe85d2a,
      fields,
    },
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            label: "Recycle breakdown",
            custom_id: `storage_recycle:${input.entityDbId}`,
          },
        ],
      },
    ],
  };
}

export function buildRecycleBreakdownEmbed(
  monitorName: string,
  recycle: { scrap: number; extras: Record<string, number> },
): {
  title: string;
  description: string;
  color: number;
  fields: Array<{ name: string; value: string }>;
} {
  const lines = [`Scrap: **${recycle.scrap}**`];
  for (const [name, qty] of Object.entries(recycle.extras)) {
    lines.push(`${name}: **${qty}**`);
  }

  return {
    title: `Recycle: ${monitorName}`,
    description: "Estimated yield if all contents are recycled",
    color: 0x5865f2,
    fields: [
      {
        name: "Materials",
        value: lines.join("\n") || "Nothing to recycle",
      },
    ],
  };
}
