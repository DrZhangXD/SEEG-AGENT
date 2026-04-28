import { useMemo } from "react";

import type { ChannelInfo } from "../api/client";
import { useAppStore } from "../store/appStore";

export function ChannelList() {
  const recording = useAppStore((s) => s.recording);
  const selected = useAppStore((s) => s.selectedChannels);
  const toggle = useAppStore((s) => s.toggleChannel);
  const setSelected = useAppStore((s) => s.setSelected);

  const byLead = useMemo(() => {
    const m = new Map<string, ChannelInfo[]>();
    if (!recording) return m;
    for (const c of recording.channels) {
      if (c.kind !== "seeg") continue;
      const key = c.lead ?? "?";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(c);
    }
    for (const arr of m.values())
      arr.sort((a, b) => (a.contact_index ?? 0) - (b.contact_index ?? 0));
    return m;
  }, [recording]);

  if (!recording) return <div className="channel-list muted">加载一个文件以查看通道</div>;

  return (
    <div className="channel-list">
      <div className="header">
        <h3>SEEG 通道 ({recording.n_seeg})</h3>
        <div className="actions">
          <button onClick={() => setSelected([])}>清空</button>
          <button
            onClick={() =>
              setSelected(
                recording.channels.filter((c) => c.kind === "seeg").map((c) => c.clean_name),
              )
            }
          >
            全选
          </button>
        </div>
      </div>
      {[...byLead.entries()].map(([lead, chans]) => (
        <div key={lead} className="lead-group">
          <div className="lead-label">电极 {lead}</div>
          <div className="contacts">
            {chans.map((c) => (
              <button
                key={c.clean_name}
                className={`contact ${selected.includes(c.clean_name) ? "sel" : ""}`}
                onClick={() => toggle(c.clean_name)}
                title={c.raw_name}
              >
                {c.clean_name}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="selected-summary">
        已选 {selected.length} 个通道
      </div>
    </div>
  );
}
