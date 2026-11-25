import React, { useEffect, useState } from "react";
import { Flag, KeyRound, LogIn, UserCog } from "lucide-react";
import { adminApi } from "./adminApi.js";

const KINDS = {
  "admin.signin": { label: "Signed in to the dashboard", icon: LogIn },
  "member.update": { label: "Changed a member", icon: UserCog },
  "code.create": { label: "Created a Pro code", icon: KeyRound },
  "report.review": { label: "Reviewed a report", icon: Flag },
};

const describe = (event, members) => {
  const d = event.detail || {};
  const target = members.find((m) => m.id === event.targetId);
  return [
    event.action !== "admin.signin" && target ? target.name || target.email : "",
    d.plan && `plan: ${d.plan}`,
    d.status && `status: ${d.status}`,
    d.codeEnding && `code ending ${d.codeEnding}`,
    d.note && `note: ${d.note}`,
    d.location && `from ${d.location}`,
  ]
    .filter(Boolean)
    .join(" · ");
};

export function ActivityLog({ run }) {
  const [events, setEvents] = useState(null);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([run(adminApi.audit), run(adminApi.members).catch(() => [])])
      .then(([list, people]) => {
        setEvents(list);
        setMembers(people);
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="ad-page">
      <div className="ad-head">
        <div>
          <h1>Activity</h1>
          <p className="ad-muted">Every sign-in and change made in this dashboard, newest first. Entries can't be edited or deleted.</p>
        </div>
      </div>
      {error && <div className="ad-error">{error}</div>}
      <div className="ad-glass ad-card ad-rise">
        {!events && !error && <p className="ad-muted">Loading…</p>}
        {events && !events.length && <p className="ad-empty">No activity yet.</p>}
        <ol className="ad-feed">
          {(events || []).map((e) => {
            const kind = KINDS[e.action] || { label: e.action, icon: UserCog };
            const Icon = kind.icon;
            return (
              <li key={e.id}>
                <span className="ad-feed-icon">
                  <Icon size={15} />
                </span>
                <div>
                  <b>{kind.label}</b>
                  <span>{describe(e, members)}</span>
                  <small>
                    {e.adminEmail} · {new Date(e.createdAt).toLocaleString()}
                  </small>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
