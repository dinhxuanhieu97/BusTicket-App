import { useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/api-client";
import type { Stops } from "@/types/api.types";

type Session = {
  accessToken: string;
  scope: string;
  user: { operatorId: string | null; role: string };
};
type Route = { id: string; origin: string; destination: string; stops: Stops };
const kinds = ["pickup", "dropoff"] as const;
const labels = { pickup: "Điểm đón", dropoff: "Điểm trả" };

export default function AdminStops() {
  const [session, setSession] = useState<Session | null>(null);
  const [secret, setSecret] = useState("");
  const [ops, setOps] = useState<{ id: string; name: string }[]>([]);
  const [operator, setOperator] = useState("");
  const [routes, setRoutes] = useState<Route[]>([]);
  const [id, setId] = useState("");
  const [draft, setDraft] = useState<Stops>({ pickup: [], dropoff: [] });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }
  const headers = (s: Session) => ({
    Authorization: "Bearer " + s.accessToken,
  });
  function choose(route?: Route) {
    setId(route?.id ?? "");
    setDraft(route?.stops ?? { pickup: [], dropoff: [] });
    setMessage("");
  }
  async function load(s: Session, op: string) {
    const res = await apiRequest<{ routes: Route[] }>(
      "/admin/operators/" + op + "/routes",
      { headers: headers(s) },
    );
    setOperator(op);
    setRoutes(res.routes);
    choose(res.routes[0]);
  }
  async function enter(s: Session) {
    if (s.scope === "mfa_setup") {
      const setup = await apiRequest<{ secret: string }>("/auth/mfa/setup", {
        method: "POST",
        headers: headers(s),
      });
      setSecret(setup.secret);
    } else if (s.user.operatorId) {
      await load(s, s.user.operatorId);
    } else {
      const res = await apiRequest<{
        operators: { id: string; name: string }[];
      }>("/admin/operators", { headers: headers(s) });
      setOps(res.operators);
      if (res.operators[0]) await load(s, res.operators[0].id);
    }
    setSession(s);
  }
  function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    const otp = String(values.get("otp") || "");
    void run(async () => {
      const next = session
        ? await apiRequest<Session>("/auth/mfa/confirm", {
            method: "POST",
            headers: headers(session),
            body: { otp },
          })
        : await apiRequest<Session>("/auth/login", {
            method: "POST",
            body: {
              phone: values.get("phone"),
              password: values.get("password"),
              ...(otp ? { otp } : {}),
            },
          });
      await enter(next);
    });
  }
  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify(routes.find((r) => r.id === id)?.stops);
  const mayLeave = () =>
    !id || !dirty || window.confirm("Bỏ thay đổi chưa lưu?");
  const writable =
    session &&
    ["DISPATCHER", "OWNER", "PLATFORM_ADMIN"].includes(session.user.role);
  function save(e: FormEvent) {
    e.preventDefault();
    if (!session) return;
    void run(async () => {
      const stops = await apiRequest<Stops>(
        "/admin/operators/" + operator + "/routes/" + id + "/stops",
        { method: "PUT", headers: headers(session), body: draft },
      );
      setRoutes(routes.map((r) => (r.id === id ? { ...r, stops } : r)));
      setDraft(stops);
      setMessage("Đã lưu lịch đón, trả của tuyến.");
    });
  }
  return (
    <main className="pn-page">
      <h1 className="pn-section-title">Quản lý điểm đón, trả</h1>
      {!session || session.scope === "mfa_setup" ? (
        <form
          key={session?.scope}
          onSubmit={login}
          className="pn-card grid gap-4"
        >
          {session ? (
            <p>
              Nhập khóa này vào ứng dụng xác thực rồi điền mã 6 số:{" "}
              <code>{secret}</code>
            </p>
          ) : (
            <>
              <label className="pn-field">
                Số điện thoại nhân viên
                <input
                  name="phone"
                  type="tel"
                  autoComplete="username"
                  required
                />
              </label>
              <label className="pn-field">
                Mật khẩu
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
            </>
          )}
          <label className="pn-field">
            Mã xác thực {session ? "" : "(nếu đã bật)"}
            <input
              name="otp"
              autoComplete="one-time-code"
              inputMode="numeric"
              required={!!session}
            />
          </label>
          <button className="pn-button pn-button-primary" disabled={busy}>
            {session ? "Xác nhận" : "Đăng nhập"}
          </button>
        </form>
      ) : (
        <fieldset disabled={busy} className="grid gap-4">
          <div className="pn-card grid gap-3">
            <button
              className="pn-link justify-self-end"
              onClick={() => {
                if (mayLeave()) {
                  setSession(null);
                  setSecret("");
                  setOps([]);
                  setRoutes([]);
                  choose();
                }
              }}
            >
              Đăng xuất
            </button>
            {ops.length > 0 && (
              <label className="pn-field">
                Nhà xe
                <select
                  value={operator}
                  onChange={(e) => {
                    if (mayLeave())
                      void run(() => load(session, e.target.value));
                  }}
                >
                  {ops.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="pn-field">
              Tuyến xe
              <select
                value={id}
                onChange={(e) => {
                  if (mayLeave())
                    choose(routes.find((r) => r.id === e.target.value));
                }}
              >
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.origin} → {r.destination}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {id ? (
            <form className="grid gap-4" onSubmit={save}>
              <p className="pn-meta">
                Lịch áp dụng cho mọi chuyến của tuyến này. Nhập các điểm theo
                thứ tự xe chạy.
              </p>
              {kinds.map((kind) => (
                <section className="pn-card grid gap-3" key={kind}>
                  <h2 className="pn-section-title">{labels[kind]}</h2>
                  {draft[kind].map((stop, i) => {
                    const edit = (patch: Partial<typeof stop>) =>
                      setDraft({
                        ...draft,
                        [kind]: draft[kind].map((s, n) =>
                          n === i ? { ...s, ...patch } : s,
                        ),
                      });
                    return (
                      <fieldset
                        disabled={!writable}
                        key={i}
                        className="grid gap-2 border-b pb-3"
                      >
                        <label className="pn-field">
                          Tên điểm
                          <input
                            required
                            maxLength={160}
                            value={stop.name}
                            onChange={(e) => edit({ name: e.target.value })}
                          />
                        </label>
                        <div className="flex gap-3">
                          <label className="pn-field">
                            Giờ dự kiến
                            <input
                              required
                              type="time"
                              value={stop.time}
                              onChange={(e) => edit({ time: e.target.value })}
                            />
                          </label>
                          <label className="pn-field">
                            Ngày
                            <select
                              value={stop.day}
                              onChange={(e) =>
                                edit({ day: Number(e.target.value) })
                              }
                            >
                              {Array.from({ length: 8 }, (_, d) => (
                                <option key={d} value={d}>
                                  {d === 0
                                    ? "Ngày khởi hành"
                                    : d === 1
                                      ? "Ngày hôm sau"
                                      : "Sau " + d + " ngày"}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {writable && (
                          <button
                            type="button"
                            className="pn-link justify-self-end"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                [kind]: draft[kind].filter((_, n) => i !== n),
                              })
                            }
                          >
                            Xóa điểm
                          </button>
                        )}
                      </fieldset>
                    );
                  })}
                  {writable && (
                    <button
                      type="button"
                      className="pn-link"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          [kind]: [
                            ...draft[kind],
                            {
                              name: "",
                              time: "",
                              day:
                                draft[kind][draft[kind].length - 1]?.day ?? 0,
                            },
                          ],
                        })
                      }
                    >
                      + Thêm {labels[kind].toLowerCase()}
                    </button>
                  )}
                </section>
              ))}
              {writable && (
                <button
                  className="pn-button pn-button-primary"
                  disabled={!dirty}
                >
                  Lưu lịch đón, trả
                </button>
              )}
            </form>
          ) : (
            <p>Nhà xe chưa có tuyến.</p>
          )}
        </fieldset>
      )}
      {message && (
        <p className="pn-notice" role="status">
          {message}
        </p>
      )}
    </main>
  );
}
