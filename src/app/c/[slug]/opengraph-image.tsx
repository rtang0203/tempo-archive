import { ImageResponse } from "next/og";
import { tempoColor } from "@/components/tempo-color";
import { rotatedHistogram } from "@/engine/axis";
import { getCollection } from "@/server/collections";
import { db } from "@/server/context";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Link preview: the collection's tempo histogram, on the same rotated axis as the page. */
export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const c = await getCollection(db(), (await params).slug);
  const lanes = rotatedHistogram((c?.tracks ?? []).flatMap((t) => (t.bpmFolded ? [t.bpmFolded] : [])));
  const max = Math.max(1, ...lanes.map((l) => l.count));
  const start = lanes[0]!.lo;
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "#0e0e10", color: "#ececef", padding: 64 }}>
      <div style={{ fontSize: 28, color: "#8e8e96" }}>Tempo Atlas</div>
      <div style={{ fontSize: 64, fontWeight: 700, marginTop: 8 }}>{c?.title ?? "Collection"}</div>
      <div style={{ fontSize: 28, color: "#8e8e96", marginTop: 8 }}>{`${c?.tracks.length ?? 0} tracks laid out by tempo`}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flex: 1, marginTop: 40 }}>
        {lanes.map((l) => (
          <div
            key={l.lo}
            style={{ flex: 1, height: `${Math.max(3, (l.count / max) * 100)}%`, background: tempoColor(l.lo + 2, 1, start), borderRadius: "6px 6px 0 0" }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, color: "#8e8e96", marginTop: 12 }}>
        <span>{`${start} BPM`}</span>
        <span>{`${start * 2} BPM`}</span>
      </div>
    </div>,
    size,
  );
}
